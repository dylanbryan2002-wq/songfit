/* Experiment B for the creator-lists plan (docs/review/24 v3): rebuild one clip's recommendations from a cached control
   run, changing only the safe direction. Everything the control already paid for is reused: the analysis and brief, the
   current and unexpected lists, Deezer verification and component scores of any song+window the control scored. Only new
   songs are verified and only new song+windows are scored. Then the production combine (cached totals) → diversify →
   selectSections. No explanations: the paired judge sees title, artist and section only.
   Replay (safe = "replay") reuses everything and must reproduce the control's picks exactly; that is the check before
   any treatment number is trusted. */
import type { GeneratedCandidate, Pick, ScoredCandidate, VerifiedCandidate, VideoAnalysis } from "../../src/shared/types";
import type { CandidateInsert } from "../../src/db/queries/candidates";
import { mergeCandidates } from "../../src/engine/candidates/generateCandidates";
import { normalizeKey } from "../../src/engine/catalog/normalize";
import { validateSection } from "../../src/engine/catalog/verifyCandidates";
import { diversify } from "../../src/engine/diversify/diversify";
import { selectSections } from "../../src/engine/sections/selectSections";
import type { CreatorPick } from "../../src/engine/catalog/creatorLists";
import type { OursResult } from "./ours";

export type RebuildDeps = {
  verify: (cands: GeneratedCandidate[]) => Promise<{ verified: VerifiedCandidate[] }>;
  score: (cands: VerifiedCandidate[]) => Promise<ScoredCandidate[]>;
};

export type Funnel = { offered: number; generated: number; verified: number; top15: number; top5: number };

export type RebuildResult = {
  picks: Pick[];
  generated: GeneratedCandidate[];
  reused_verified: number; newly_verified: number; reused_scores: number; newly_scored: number;
  funnel: Funnel | null;
};

const keyOf = (c: { title: string; artist: string }) => normalizeKey(c.title, c.artist);
const windowKey = (c: { catalog_key: string; proposed_start: number; proposed_end: number; anchor_seconds: number }) =>
  `${c.catalog_key}|${c.proposed_start}|${c.proposed_end}|${c.anchor_seconds}`;

/** A verified control row back into the engine's VerifiedCandidate, carrying the (possibly new) candidate's window. */
function fromRow(row: CandidateInsert, c: GeneratedCandidate): VerifiedCandidate | null {
  if (!row.verified || !row.deezer_id || row.duration_seconds == null || !row.preview_url || !row.canonical_title || !row.canonical_artist) return null;
  const valid = validateSection(c, row.duration_seconds);
  if (!valid) return null;
  return {
    ...valid, directions: [...valid.directions],
    verified_via: "deezer", catalog_key: `deezer:${row.deezer_id}`, deezer_id: row.deezer_id, itunes_id: row.itunes_id ?? null,
    canonical_title: row.canonical_title, canonical_artist: row.canonical_artist, duration_seconds: row.duration_seconds,
    artwork_url: row.artwork_url ?? null, deezer_url: row.deezer_url ?? null, preview_url: row.preview_url,
  };
}

/** Control's generated list with the safe direction removed (songs only in safe are dropped). */
export function withoutSafe(generated: GeneratedCandidate[]): GeneratedCandidate[] {
  return generated.flatMap((g) => {
    const directions = g.directions.filter((d) => d !== "safe");
    return directions.length ? [{ ...g, directions }] : [];
  });
}

export async function rebuild(
  base: OursResult, analysis: VideoAnalysis, safe: GeneratedCandidate[] | "replay", deps: RebuildDeps, offered: CreatorPick[] = [],
): Promise<RebuildResult> {
  const generated = safe === "replay" ? base.generated : mergeCandidates([safe, withoutSafe(base.generated)]);

  // Control rows, verified first in the control's scored order (which is also the stable-sort tie order).
  const rowByKey = new Map<string, CandidateInsert>();
  for (const r of base.candidates) if (!rowByKey.has(keyOf(r)) || (r.verified && !rowByKey.get(keyOf(r))!.verified)) rowByKey.set(keyOf(r), r);
  const scoreByWindow = new Map<string, { component_scores: ScoredCandidate["component_scores"]; total_score: number }>();
  const controlOrder = new Map<string, number>();
  base.candidates.forEach((r, i) => {
    if (!r.verified || !r.deezer_id || r.total_score == null || !r.component_scores) return;
    const ck = `deezer:${r.deezer_id}`;
    if (!controlOrder.has(ck)) controlOrder.set(ck, i);
    scoreByWindow.set(windowKey({ catalog_key: ck, proposed_start: r.proposed_start, proposed_end: r.proposed_end, anchor_seconds: r.anchor_seconds }),
      { component_scores: r.component_scores as ScoredCandidate["component_scores"], total_score: r.total_score });
  });

  const reused: VerifiedCandidate[] = [];
  const unknown: GeneratedCandidate[] = [];
  for (const c of generated) {
    const row = rowByKey.get(keyOf(c));
    if (!row) { unknown.push(c); continue; }
    const v = fromRow(row, c);
    if (v) reused.push(v); // a control row that was unverified stays unverified: never shown
  }
  const fresh = unknown.length ? (await deps.verify(unknown)).verified : [];

  // Dedupe by recording, keeping the first and merging directions (as verifyCandidates does).
  const byKey = new Map<string, VerifiedCandidate>();
  const verified: VerifiedCandidate[] = [];
  for (const v of [...reused, ...fresh]) {
    const prev = byKey.get(v.catalog_key);
    if (prev) { for (const d of v.directions) if (!prev.directions.includes(d)) prev.directions.push(d); continue; }
    byKey.set(v.catalog_key, v);
    verified.push(v);
  }

  const cached: ScoredCandidate[] = [];
  const toScore: VerifiedCandidate[] = [];
  for (const v of verified) {
    const s = scoreByWindow.get(windowKey(v));
    if (s) cached.push({ ...v, component_scores: s.component_scores, total_score: s.total_score });
    else toScore.push(v);
  }
  const newlyScored = toScore.length ? await deps.score(toScore) : [];

  // Control's order first (reproduces its stable-sort ties), new ones after; then the production sort.
  const ordered = [
    ...cached.sort((a, b) => (controlOrder.get(a.catalog_key) ?? 1e9) - (controlOrder.get(b.catalog_key) ?? 1e9)),
    ...newlyScored,
  ].sort((a, b) => b.total_score - a.total_score);
  const picks = selectSections(diversify(ordered), analysis);

  const ids = new Set(offered.map((o) => `deezer:${o.deezer_id}`));
  const offeredKeys = new Set(offered.map((o) => keyOf(o)));
  const funnel: Funnel | null = offered.length && safe !== "replay" ? {
    offered: offered.length,
    generated: safe.filter((g) => offeredKeys.has(keyOf(g))).length,
    verified: verified.filter((v) => ids.has(v.catalog_key)).length,
    top15: picks.filter((p) => ids.has(p.catalog_key)).length,
    top5: picks.slice(0, 5).filter((p) => ids.has(p.catalog_key)).length,
  } : null;

  return { picks, generated, reused_verified: reused.length, newly_verified: fresh.length, reused_scores: cached.length, newly_scored: newlyScored.length, funnel };
}

/** Same song and same section at every rank: the replay check. Returns the first difference, or null. */
export function firstDifference(a: { rank: number; catalog_key: string; start_seconds: number; end_seconds: number }[], b: typeof a): string | null {
  const sa = [...a].sort((x, y) => x.rank - y.rank);
  const sb = [...b].sort((x, y) => x.rank - y.rank);
  if (sa.length !== sb.length) return `pick count ${sa.length} vs ${sb.length}`;
  for (let i = 0; i < sa.length; i++) {
    const x = sa[i]!, y = sb[i]!;
    if (x.catalog_key !== y.catalog_key) return `rank ${x.rank}: ${x.catalog_key} vs ${y.catalog_key}`;
    if (x.start_seconds !== y.start_seconds || x.end_seconds !== y.end_seconds) return `rank ${x.rank}: section ${x.start_seconds}-${x.end_seconds} vs ${y.start_seconds}-${y.end_seconds}`;
  }
  return null;
}

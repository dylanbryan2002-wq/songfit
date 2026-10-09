/* Experiment B for the creator-lists plan (docs/review/24 v3): a SHORTLIST SCREENING experiment, not a preview of
   shipping B. It rebuilds one clip's recommendations from a cached control run, changing only the safe direction.
   Reused from the control: the analysis and brief, the current and unexpected lists, Deezer identity of any candidate the
   control verified, and component scores of any candidate whose scoring inputs are unchanged. Everything else is verified
   and scored fresh. Then production combine (cached totals) → diversify → selectSections, in production's order.
   Not reproduced: the insufficient-candidate regeneration, explanations, and scoring batch context for new candidates
   (they are scored in their own batch). Validate any winner through the full production path before shipping.
   Replay (safe = "replay") must reproduce the control's picks exactly. */
import { createHash } from "node:crypto";
import type { GeneratedCandidate, Pick, ScoredCandidate, VerifiedCandidate, VideoAnalysis } from "../../src/shared/types";
import type { CandidateInsert } from "../../src/db/queries/candidates";
import { mergeCandidates } from "../../src/engine/candidates/generateCandidates";
import { normalizeKey } from "../../src/engine/catalog/normalize";
import { validateSection, type UnverifiedCandidate } from "../../src/engine/catalog/verifyCandidates";
import { diversify } from "../../src/engine/diversify/diversify";
import { selectSections } from "../../src/engine/sections/selectSections";
import type { CreatorPick } from "../../src/engine/catalog/creatorLists";
import type { OursResult } from "./ours";

export type RebuildDeps = {
  verify: (cands: GeneratedCandidate[]) => Promise<{ verified: VerifiedCandidate[]; unverified: UnverifiedCandidate[]; lookupFailed: GeneratedCandidate[] }>;
  score: (cands: VerifiedCandidate[]) => Promise<ScoredCandidate[]>;
};

/** Per offered recording: was it newly proposed in safe, is it in the verified pool (any direction), and was it picked. */
export type Funnel = { offered: number; safe_generated: number; in_pool: number; top15: number; top5: number };

export type RebuildResult = {
  picks: Pick[];
  generated: GeneratedCandidate[];
  scored: ScoredCandidate[]; // the full verified pool with scores, in production's sorted order
  unverified: UnverifiedCandidate[];
  lookupFailed: GeneratedCandidate[];
  reused_verified: number; newly_verified: number; reused_scores: number; newly_scored: number;
  funnel: Funnel | null;
};

const keyOf = (c: { title: string; artist: string }) => normalizeKey(c.title, c.artist);

/** Everything the scorer reads from a candidate (model scores and the rule dimensions). */
export const scoringKey = (c: {
  catalog_key: string; proposed_start: number; proposed_end: number; anchor_seconds: number;
  section_is_vocal: boolean; section_reason: string; fit_reason: string;
}) => [c.catalog_key, c.proposed_start, c.proposed_end, c.anchor_seconds, c.section_is_vocal, c.section_reason, c.fit_reason].join("\u0001");

/** A verified control row back into the engine's VerifiedCandidate, carrying this candidate's window. Null = verify again. */
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

  const verifiedRow = new Map<string, CandidateInsert>();
  for (const r of base.candidates) if (r.verified && !verifiedRow.has(keyOf(r))) verifiedRow.set(keyOf(r), r);
  const cachedScore = new Map<string, { component_scores: ScoredCandidate["component_scores"]; total_score: number }>();
  for (const r of base.candidates) {
    if (!r.verified || !r.deezer_id || r.total_score == null || !r.component_scores) continue;
    cachedScore.set(scoringKey({
      catalog_key: `deezer:${r.deezer_id}`, proposed_start: r.proposed_start, proposed_end: r.proposed_end, anchor_seconds: r.anchor_seconds,
      section_is_vocal: !!r.section_is_vocal, section_reason: r.section_reason ?? "", fit_reason: r.fit_reason ?? "",
    }),
      { component_scores: r.component_scores as ScoredCandidate["component_scores"], total_score: r.total_score });
  }

  // Identity is reused only from a verified control row with a still-valid window; anything else is verified again
  // (a control miss, missing sample, provider failure or impossible window may differ for this candidate).
  const slots: (VerifiedCandidate | GeneratedCandidate)[] = [];
  const toVerify: GeneratedCandidate[] = [];
  let reusedVerified = 0;
  for (const c of generated) {
    const row = verifiedRow.get(keyOf(c));
    const v = row ? fromRow(row, c) : null;
    if (v) { slots.push(v); reusedVerified++; } else { slots.push(c); toVerify.push(c); }
  }
  const fresh = toVerify.length ? await deps.verify(toVerify) : { verified: [], unverified: [], lookupFailed: [] };
  const freshByCand = new Map<GeneratedCandidate, VerifiedCandidate>();
  // verifyCandidates keeps input order and drops duplicates of a recording; map results back to their candidate.
  for (const v of fresh.verified) {
    const c = toVerify.find((x) => !freshByCand.has(x) && keyOf(x) === keyOf(v));
    if (c) freshByCand.set(c, v);
  }

  // Production order: generated order, first candidate per recording wins, later ones only add directions.
  const byKey = new Map<string, VerifiedCandidate>();
  const verified: VerifiedCandidate[] = [];
  for (const s of slots) {
    const v = "catalog_key" in s ? s : freshByCand.get(s);
    if (!v) continue;
    const prev = byKey.get(v.catalog_key);
    if (prev) { for (const d of v.directions) if (!prev.directions.includes(d)) prev.directions.push(d); continue; }
    const copy = { ...v, directions: [...v.directions] };
    byKey.set(copy.catalog_key, copy);
    verified.push(copy);
  }

  const toScore = verified.filter((v) => !cachedScore.has(scoringKey(v)));
  const newlyScored = toScore.length ? await deps.score(toScore) : [];
  const newByKey = new Map(newlyScored.map((s) => [s.catalog_key, s]));
  const pool: ScoredCandidate[] = verified.map((v) => {
    const cached = cachedScore.get(scoringKey(v));
    if (cached) return { ...v, ...cached };
    const s = newByKey.get(v.catalog_key);
    if (!s) throw new Error(`scorer returned no score for ${v.catalog_key}`);
    return { ...v, component_scores: s.component_scores, total_score: s.total_score };
  });
  const scored = [...pool].sort((a, b) => b.total_score - a.total_score); // stable: ties keep generated order, as production
  const picks = selectSections(diversify(scored), analysis);

  const ids = new Set(offered.map((o) => `deezer:${o.deezer_id}`));
  const funnel: Funnel | null = offered.length && safe !== "replay" ? {
    offered: offered.length,
    // In B every safe-direction candidate is new (the control's safe list was removed), so an offered recording counts
    // as generated when the new safe list named it, or when its pool entry carries the safe direction.
    safe_generated: offered.filter((o) => safe.some((g) => keyOf(g) === keyOf(o)) || !!byKey.get(`deezer:${o.deezer_id}`)?.directions.includes("safe")).length,
    in_pool: scored.filter((v) => ids.has(v.catalog_key)).length,
    top15: picks.filter((p) => ids.has(p.catalog_key)).length,
    top5: picks.slice(0, 5).filter((p) => ids.has(p.catalog_key)).length,
  } : null;

  return {
    picks, generated, scored, unverified: fresh.unverified, lookupFailed: fresh.lookupFailed,
    reused_verified: reusedVerified, newly_verified: fresh.verified.length,
    reused_scores: pool.length - newlyScored.length, newly_scored: newlyScored.length, funnel,
  };
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

export const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

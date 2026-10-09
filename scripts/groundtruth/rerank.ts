/* Rerank cached candidate pools with the current diversify (and optionally the current scorer), no new generation.
     pnpm local scripts/groundtruth/rerank.ts --root <batch> --from v7 --tag <tag> [--rescore] [--split tune|test|all] [--force]
   Reads work/<id>/ours.<from>.json (treatment status ok), rebuilds the verified pool from its stored candidate rows,
   then: --rescore → scoreCandidates on the whole pool with the current scoring prompt; otherwise the stored scores.
   Then the production sort → diversify → selectSections, and writes work/<id>/ours.<tag>.json (same shape).
   Used for docs/review/24 §14: top 3 by score (no rescoring) and scoring-v5 timing (rescoring). */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { scoreCandidates } from "../../src/engine/scoring/scoreCandidates";
import { PROMPT_VERSION as SCORING_VERSION } from "../../src/engine/scoring/modelScores";
import { diversify } from "../../src/engine/diversify/diversify";
import { selectSections } from "../../src/engine/sections/selectSections";
import { toCandidateInsert } from "../../src/engine/recommend";
import { LIMITS } from "../../src/shared/config";
import type { ScoredCandidate, VerifiedCandidate } from "../../src/shared/types";
import type { CandidateInsert } from "../../src/db/queries/candidates";
import { parseClipsCsv } from "./intake";
import { sha } from "./treatment-lib";
import type { TreatmentResult } from "./treatment";

/** A stored verified, scored row back into the engine's ScoredCandidate. */
export function rowToScored(r: CandidateInsert): ScoredCandidate | null {
  if (!r.verified || !r.deezer_id || r.duration_seconds == null || !r.preview_url || !r.canonical_title || !r.canonical_artist) return null;
  if (r.total_score == null || !r.component_scores) return null;
  const v: VerifiedCandidate = {
    title: r.title, artist: r.artist, proposed_start: r.proposed_start, proposed_end: r.proposed_end, anchor_seconds: r.anchor_seconds,
    section_is_vocal: !!r.section_is_vocal, section_reason: r.section_reason ?? "", fit_reason: r.fit_reason ?? "", directions: [...(r.directions ?? [])] as VerifiedCandidate["directions"],
    verified_via: "deezer", catalog_key: `deezer:${r.deezer_id}`, deezer_id: r.deezer_id, itunes_id: r.itunes_id ?? null,
    canonical_title: r.canonical_title, canonical_artist: r.canonical_artist, duration_seconds: r.duration_seconds,
    artwork_url: r.artwork_url ?? null, deezer_url: r.deezer_url ?? null, preview_url: r.preview_url,
  };
  return { ...v, component_scores: r.component_scores as ScoredCandidate["component_scores"], total_score: r.total_score };
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      root: { type: "string" }, from: { type: "string", default: "v7" }, tag: { type: "string" },
      rescore: { type: "boolean", default: false }, split: { type: "string", default: "tune" }, force: { type: "boolean", default: false },
    },
  });
  if (!args.root || !args.tag) { console.error("usage: rerank.ts --root <batch> --from v7 --tag <tag> [--rescore] [--split tune|test|all]"); process.exit(1); }
  const root = path.resolve(args.root.replace(/^~(?=$|\/)/, os.homedir()));
  let clips = parseClipsCsv(await fs.readFile(path.join(root, "clips.csv"), "utf8"));
  if (args.split !== "all") clips = clips.filter((c) => c.split === args.split);
  const counts: Record<string, number> = { ok: 0, failed: 0, cached: 0, skipped: 0 };
  for (const clip of clips) {
    const work = path.join(root, "work", clip.id);
    const srcText = await fs.readFile(path.join(work, `ours.${args.from}.json`), "utf8").catch(() => null);
    const src = srcText ? (JSON.parse(srcText) as TreatmentResult) : null;
    if (!src || src.treatment?.status !== "ok") { counts.skipped!++; continue; }
    const out = path.join(work, `ours.${args.tag}.json`);
    const srcSha = sha(srcText!);
    const prior = await fs.readFile(out, "utf8").then((t) => JSON.parse(t) as TreatmentResult & { rerank?: { src_sha: string; scoring: string } }).catch(() => null);
    if (!args.force && prior?.rerank?.src_sha === srcSha && (!args.rescore || prior.rerank.scoring === SCORING_VERSION) && prior.treatment.status === "ok") { counts.cached!++; continue; }
    const t0 = Date.now();
    try {
      const pool = src.candidates.map(rowToScored).filter((c): c is ScoredCandidate => !!c);
      let scored: ScoredCandidate[];
      if (args.rescore) {
        const ctx = { deadlineAt: Date.now() + LIMITS.pipelineBudgetMs };
        scored = await scoreCandidates(src.analysis, src.brief, pool.map(({ component_scores: _c, total_score: _t, ...v }) => v), { ctx });
      } else {
        scored = [...pool].sort((a, b) => b.total_score - a.total_score);
      }
      const picks = selectSections(diversify(scored), src.analysis);
      const unverified = src.candidates.filter((r) => !r.verified);
      const result = {
        ...src,
        finals: picks.map((p) => ({ ...p, explanation: "", spotify_url: "" })),
        candidates: [...scored.map((c) => toCandidateInsert(clip.id, c, true, src.treatment.prompt_version)), ...unverified],
        treatment: { ...src.treatment, status: "ok" as const, base_tag: src.treatment.base_tag, elapsed_ms: Date.now() - t0 },
        rerank: { from: args.from, src_sha: srcSha, rescored: args.rescore, scoring: args.rescore ? SCORING_VERSION : "stored" },
      };
      await fs.writeFile(out, JSON.stringify(result, null, 2));
      counts.ok!++;
      console.log(`${clip.id}: ok${args.rescore ? ` rescored ${scored.length}` : ""} (${Math.round((Date.now() - t0) / 1000)} s)`);
    } catch (err) {
      counts.failed!++;
      const error = err instanceof Error ? err.message : String(err);
      console.error(`${clip.id}: FAILED ${error}`);
      // Persist the failure so the judge counts it against this arm instead of dropping the clip.
      await fs.writeFile(out, JSON.stringify({ ...src, finals: [], recommend_error: error, treatment: { ...src.treatment, status: "failed", error } }, null, 2));
    }
  }
  console.log(`\n${JSON.stringify(counts)}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

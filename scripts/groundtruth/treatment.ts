/* Experiment B runner (docs/review/24 v3): a shortlist screening experiment (see treatment-lib.ts for what it does and
   does not reproduce). Creator-list shortlist in the safe direction, everything else from the control.
     pnpm local scripts/groundtruth/treatment.ts --root <batch> [--base round2] [--tag listsB] [--split tune|test|all] [--only <id>] [--force] [--replay]
   --replay: no model calls; rebuilds every clip from its control run and checks picks and sections are identical.
   Population: every clip in the split with a control artifact (identified song or not). A clip the control never ran
   on is outside the comparison and listed as such.
   Every scheduled clip ends with an artifact work/<id>/ours.<tag>.json whose treatment.status is one of
     ok | ineligible (control copied) | failed (retried once on a later invocation, then final) | control_failed.
   An artifact is stale, and rebuilt, when the control file, the lists version or the prompt version changed. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { generateCandidates, CREATOR_PICKS_PROMPT_VERSION } from "../../src/engine/candidates/generateCandidates";
import { verifyCandidates } from "../../src/engine/catalog/verifyCandidates";
import { scoreCandidates } from "../../src/engine/scoring/scoreCandidates";
import { listTypesFor } from "../../src/engine/catalog/listTypes";
import { CREATOR_LISTS_VERSION, shortlistFor, type CreatorPick, type ListType } from "../../src/engine/catalog/creatorLists";
import { toCandidateInsert } from "../../src/engine/recommend";
import { LIMITS } from "../../src/shared/config";
import type { FinalRecommendation } from "../../src/shared/types";
import { parseClipsCsv } from "./intake";
import { probeDuration } from "./intake";
import type { OursResult } from "./ours";
import { firstDifference, rebuild, sha, type Funnel } from "./treatment-lib";

export const MAX_ATTEMPTS = 2;

export type TreatmentStatus = "ok" | "ineligible" | "failed" | "control_failed";
export type TreatmentMeta = {
  status: TreatmentStatus; attempts: number; error: string | null;
  base_tag: string; base_sha: string; eligible: boolean; types: ListType[]; offered: CreatorPick[]; funnel: Funnel | null;
  reused_verified: number; newly_verified: number; reused_scores: number; newly_scored: number;
  prompt_version: string; lists_version: string; elapsed_ms: number;
};
export type TreatmentResult = OursResult & { treatment: TreatmentMeta };

/** Rebuild unless the cached artifact is current and final (ok, ineligible, control_failed, or failed twice). */
export function needsRun(prior: TreatmentResult | null, baseSha: string): boolean {
  if (!prior?.treatment) return true;
  const t = prior.treatment;
  if (t.base_sha !== baseSha || t.lists_version !== CREATOR_LISTS_VERSION || t.prompt_version !== CREATOR_PICKS_PROMPT_VERSION) return true;
  return t.status === "failed" && t.attempts < MAX_ATTEMPTS;
}

const asFinals = (picks: Awaited<ReturnType<typeof rebuild>>["picks"]): FinalRecommendation[] =>
  picks.map((p) => ({ ...p, explanation: "", spotify_url: "" })); // judged on title, artist and section only

async function main() {
  const { values: args } = parseArgs({
    options: {
      root: { type: "string" }, base: { type: "string", default: "round2" }, tag: { type: "string", default: "listsB" },
      split: { type: "string", default: "tune" }, only: { type: "string" }, force: { type: "boolean", default: false },
      replay: { type: "boolean", default: false },
    },
  });
  if (!args.root) { console.error("usage: treatment.ts --root <batch> [--base round2] [--tag listsB] [--split tune|test|all] [--only <id>] [--replay]"); process.exit(1); }
  const root = path.resolve(args.root.replace(/^~(?=$|\/)/, os.homedir()));
  let clips = parseClipsCsv(await fs.readFile(path.join(root, "clips.csv"), "utf8"));
  if (args.split !== "all") clips = clips.filter((c) => c.split === args.split);
  if (args.only) clips = clips.filter((c) => c.id === args.only);

  const counts: Record<string, number> = { replayed_ok: 0, replay_diff: 0, ok: 0, ineligible: 0, failed: 0, control_failed: 0, cached: 0, no_control: 0 };
  const noControl: string[] = [];
  for (const clip of clips) {
    const work = path.join(root, "work", clip.id);
    const baseText = await fs.readFile(path.join(work, `ours.${args.base}.json`), "utf8").catch(() => null);
    if (!baseText) { counts.no_control!++; noControl.push(clip.id); continue; }
    const base = JSON.parse(baseText) as OursResult;
    const baseSha = sha(baseText);
    const out = path.join(work, `ours.${args.tag}.json`);
    const prior = args.replay ? null : await fs.readFile(out, "utf8").then((t) => JSON.parse(t) as TreatmentResult).catch(() => null);
    if (!args.replay && !args.force && !needsRun(prior, baseSha)) { counts.cached!++; console.log(`${clip.id}: cached (${prior!.treatment.status})`); continue; }
    const attempts = prior?.treatment && prior.treatment.base_sha === baseSha && prior.treatment.status === "failed" ? prior.treatment.attempts + 1 : 1;

    const t0 = Date.now();
    const ctx = { deadlineAt: Date.now() + LIMITS.pipelineBudgetMs };
    const duration = base.analysis ? await probeDuration(path.join(root, "videos", clip.file)).catch(() => null) : null;
    const analysis = base.analysis ? { ...base.analysis, duration_seconds: duration ?? base.analysis.duration_seconds ?? null } : base.analysis;
    const types = analysis ? listTypesFor(analysis, base.brief) : [];
    const offered = analysis?.dialogue_present && types.length ? shortlistFor(types) : [];
    const meta = (status: TreatmentStatus, extra: Partial<TreatmentMeta> = {}): TreatmentMeta => ({
      status, attempts, error: null, base_tag: args.base!, base_sha: baseSha, eligible: offered.length > 0, types, offered, funnel: null,
      reused_verified: 0, newly_verified: 0, reused_scores: 0, newly_scored: 0,
      prompt_version: CREATOR_PICKS_PROMPT_VERSION, lists_version: CREATOR_LISTS_VERSION, elapsed_ms: Date.now() - t0, ...extra,
    });
    const deps = {
      verify: (c: Parameters<typeof verifyCandidates>[0]) => verifyCandidates(c, { ctx }),
      score: (v: Parameters<typeof scoreCandidates>[2]) => scoreCandidates(analysis, base.brief, v, { ctx }),
    };

    if (args.replay) {
      if (base.recommend_error || base.finals.length === 0) continue;
      const r = await rebuild(base, analysis, "replay", deps);
      const diff = firstDifference(r.picks, base.finals);
      if (diff) { counts.replay_diff!++; console.log(`${clip.id}: REPLAY DIFFERS ${diff}`); } else counts.replayed_ok!++;
      continue;
    }

    let result: TreatmentResult;
    if (base.recommend_error || base.finals.length === 0 || !analysis) {
      result = { ...base, finals: [], recommend_error: base.recommend_error ?? "control produced no picks", treatment: meta("control_failed") };
    } else if (offered.length === 0) {
      result = { ...base, analysis, treatment: meta("ineligible") };
    } else {
      try {
        const safe = await generateCandidates(base.brief, analysis, { directions: ["safe"], creatorPicks: offered, ctx });
        const r = await rebuild(base, analysis, safe, deps, offered);
        result = {
          ...base, analysis, generated: r.generated, finals: asFinals(r.picks), recommend_error: null,
          candidates: [
            ...r.scored.map((c) => toCandidateInsert(clip.id, c, true, CREATOR_PICKS_PROMPT_VERSION)),
            ...[...r.unverified, ...r.lookupFailed].map((c) => toCandidateInsert(clip.id, c, false, CREATOR_PICKS_PROMPT_VERSION)),
          ],
          treatment: meta("ok", { funnel: r.funnel, reused_verified: r.reused_verified, newly_verified: r.newly_verified, reused_scores: r.reused_scores, newly_scored: r.newly_scored }),
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        result = { ...base, analysis, finals: [], candidates: [], recommend_error: error, treatment: meta("failed", { error }) };
      }
    }
    await fs.writeFile(out, JSON.stringify(result, null, 2));
    counts[result.treatment.status]!++;
    const f = result.treatment.funnel;
    console.log(`${clip.id}: ${result.treatment.status}${f ? ` [${types.join(",")}] offered ${f.offered} → safe ${f.safe_generated} → pool ${f.in_pool} → top15 ${f.top15} → top5 ${f.top5}; scored ${result.treatment.newly_scored} new` : ""}${result.treatment.error ? ` ${result.treatment.error}` : ""} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  console.log(`\n${JSON.stringify(counts)}`);
  if (noControl.length) console.log(`outside the comparison (no ${args.base} run): ${noControl.join(", ")}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

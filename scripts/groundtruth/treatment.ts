/* Experiment B runner (docs/review/24 v3): creator-list shortlist in the safe direction, everything else from the control.
     pnpm local scripts/groundtruth/treatment.ts --root <batch> [--base round2] [--tag listsB] [--split tune|test|all] [--only <id>] [--force] [--replay]
   --replay: no model calls; rebuilds every clip from its control run and checks the picks and sections are identical.
             Run it first; a treatment number is only trusted when every clip replays exactly.
   Eligible clip = someone talking (control analysis) and at least one active list type with a non-empty shortlist.
   Ineligible clips get the control's picks copied (identical by construction; the paired judge ties them without a call).
   Writes work/<id>/ours.<tag>.json (control fields + new generated/finals + `treatment` metadata). */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { generateCandidates, CREATOR_PICKS_PROMPT_VERSION } from "../../src/engine/candidates/generateCandidates";
import { verifyCandidates } from "../../src/engine/catalog/verifyCandidates";
import { scoreCandidates } from "../../src/engine/scoring/scoreCandidates";
import { listTypesFor } from "../../src/engine/catalog/listTypes";
import { CREATOR_LISTS_VERSION, shortlistFor, type CreatorPick, type ListType } from "../../src/engine/catalog/creatorLists";
import { LIMITS } from "../../src/shared/config";
import type { FinalRecommendation } from "../../src/shared/types";
import { parseClipsCsv, probeDuration } from "./intake";
import type { OursResult } from "./ours";
import { firstDifference, rebuild, type Funnel } from "./treatment-lib";

export type TreatmentMeta = {
  base_tag: string; eligible: boolean; types: ListType[]; offered: CreatorPick[]; funnel: Funnel | null;
  reused_verified: number; newly_verified: number; reused_scores: number; newly_scored: number;
  prompt_version: string; lists_version: string; elapsed_ms: number;
};
export type TreatmentResult = OursResult & { treatment: TreatmentMeta };

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
  let clips = parseClipsCsv(await fs.readFile(path.join(root, "clips.csv"), "utf8")).filter((c) => c.song && c.artist);
  if (args.split !== "all") clips = clips.filter((c) => c.split === args.split);
  if (args.only) clips = clips.filter((c) => c.id === args.only);

  const counts = { replayed_ok: 0, replay_diff: 0, eligible: 0, ineligible: 0, cached: 0, skipped: 0, failed: 0 };
  for (const clip of clips) {
    const work = path.join(root, "work", clip.id);
    const base = await fs.readFile(path.join(work, `ours.${args.base}.json`), "utf8").then((t) => JSON.parse(t) as OursResult).catch(() => null);
    if (!base || base.recommend_error || base.finals.length === 0) { console.log(`${clip.id}: no usable ${args.base} run, skipped`); counts.skipped++; continue; }
    const duration = await probeDuration(path.join(root, "videos", clip.file));
    const analysis = { ...base.analysis, duration_seconds: duration };
    const deps = {
      verify: (c: Parameters<typeof verifyCandidates>[0]) => verifyCandidates(c),
      score: (v: Parameters<typeof scoreCandidates>[2]) => scoreCandidates(analysis, base.brief, v),
    };

    if (args.replay) {
      const r = await rebuild(base, analysis, "replay", deps);
      const diff = firstDifference(r.picks, base.finals);
      if (diff) { counts.replay_diff++; console.log(`${clip.id}: REPLAY DIFFERS ${diff}`); } else counts.replayed_ok++;
      continue;
    }

    const out = path.join(work, `ours.${args.tag}.json`);
    if (!args.force && (await fs.access(out).then(() => true, () => false))) { counts.cached++; console.log(`${clip.id}: cached`); continue; }
    const types = listTypesFor(analysis, base.brief);
    const offered = analysis.dialogue_present && types.length ? shortlistFor(types) : [];
    const t0 = Date.now();
    const meta = (extra: Partial<TreatmentMeta>): TreatmentMeta => ({
      base_tag: args.base!, eligible: offered.length > 0, types, offered, funnel: null,
      reused_verified: 0, newly_verified: 0, reused_scores: 0, newly_scored: 0,
      prompt_version: CREATOR_PICKS_PROMPT_VERSION, lists_version: CREATOR_LISTS_VERSION, elapsed_ms: Date.now() - t0, ...extra,
    });
    try {
      let result: TreatmentResult;
      if (offered.length === 0) {
        result = { ...base, treatment: meta({}) };
        counts.ineligible++;
      } else {
        const ctx = { deadlineAt: Date.now() + LIMITS.pipelineBudgetMs };
        const safe = await generateCandidates(base.brief, analysis, { directions: ["safe"], creatorPicks: offered, ctx });
        const r = await rebuild(base, analysis, safe, deps, offered);
        result = {
          ...base, generated: r.generated, candidates: [], finals: asFinals(r.picks), recommend_error: null,
          treatment: meta({ funnel: r.funnel, reused_verified: r.reused_verified, newly_verified: r.newly_verified, reused_scores: r.reused_scores, newly_scored: r.newly_scored }),
        };
        counts.eligible++;
      }
      await fs.writeFile(out, JSON.stringify(result, null, 2));
      const f = result.treatment.funnel;
      console.log(`${clip.id}: ${result.treatment.eligible ? `[${types.join(",")}] offered ${f?.offered} → generated ${f?.generated} → verified ${f?.verified} → top15 ${f?.top15} → top5 ${f?.top5}; scored ${result.treatment.newly_scored} new` : "ineligible, control copied"} (${Math.round((Date.now() - t0) / 1000)} s)`);
    } catch (err) {
      counts.failed++;
      console.error(`${clip.id}: FAILED ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n${JSON.stringify(counts)}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

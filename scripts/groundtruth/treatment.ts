/* Experiment B runner (docs/review/24 v3): a shortlist screening experiment (see treatment-lib.ts for what it does and
   does not reproduce). Creator-list shortlist in the safe direction, everything else from the control.
     pnpm local scripts/groundtruth/treatment.ts --root <batch> [--base round2] [--tag listsB] [--split tune|test|all] [--only <id>] [--force] [--replay]
         [--directions safe|all] [--model candidates|candidatesStrong] [--picks yes|no]
   Defaults reproduce the creator-lists run. The model run (docs/review/24 §13) regenerates all three directions:
     --directions all --picks no [--model candidatesStrong]
   --replay: no model calls; rebuilds every clip from its control run and checks picks and sections are identical.
   Population: every clip in the split with a control artifact (identified song or not). A clip the control never ran
   on is outside the comparison and listed as such.
   Every scheduled clip ends with an artifact work/<id>/ours.<tag>.json whose treatment.status is one of
     ok | ineligible (control copied) | failed (retried once on a later invocation, then final) | control_failed.
   An artifact is stale, and rebuilt, when the control file, the lists version or the prompt version changed. */
import "./assert-tree";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { generateCandidates, CREATOR_PICKS_PROMPT_VERSION, LESSONS_PROMPT_VERSION, PROMPT_VERSION } from "../../src/engine/candidates/generateCandidates";
import { LESSONS_VERSION } from "../../src/engine/candidates/creatorLessons";
import { usageTotals } from "../../src/shared/anthropic";
import { verifyCandidates } from "../../src/engine/catalog/verifyCandidates";
import { scoreCandidates } from "../../src/engine/scoring/scoreCandidates";
import { listTypesFor } from "../../src/engine/catalog/listTypes";
import { CREATOR_LISTS_VERSION, shortlistFor, type CreatorPick, type ListType } from "../../src/engine/catalog/creatorLists";
import { toCandidateInsert } from "../../src/engine/recommend";
import { LIMITS, MODELS } from "../../src/shared/config";
import { DirectionTag } from "../../src/shared/types";
import type { FinalRecommendation } from "../../src/shared/types";
import { parseClipsCsv, type ClipSpec } from "./intake";
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
  model?: string; directions?: DirectionTag[]; picks?: boolean; lessons?: string | null;
};

export type RunConfig = { prompt_version: string; model: string; directions: DirectionTag[]; picks: boolean; lessons?: string | null };

/** List prices in $ per million tokens for the models this harness may call; any other model stops the run. */
export const PRICES: Record<string, { input: number; output: number }> = { "claude-sonnet-5-5": { input: 3, output: 15 } };
export function spentDollars(totals: Map<string, { input: number; output: number }> = usageTotals): number {
  let d = 0;
  for (const [model, t] of totals) {
    const p = PRICES[model];
    if (!p) throw new Error(`no price for ${model}: refusing to continue under a spending cap`);
    d += (t.input * p.input + t.output * p.output) / 1e6;
  }
  return d;
}
/** Worst case for one clip (3 candidate lists with retries + scoring ~60 songs); observed ≈ $0.45. */
export const RESERVE_PER_CLIP = 1.0;
export type TreatmentResult = OursResult & { treatment: TreatmentMeta };

const DEFAULT_RUN: RunConfig = { prompt_version: CREATOR_PICKS_PROMPT_VERSION, model: MODELS.candidates, directions: ["safe"], picks: true };

/** Rebuild unless the cached artifact is current and final (ok, ineligible, control_failed, or failed twice). */
export function needsRun(prior: TreatmentResult | null, baseSha: string, run: RunConfig = DEFAULT_RUN): boolean {
  if (!prior?.treatment) return true;
  const t = prior.treatment;
  if (t.base_sha !== baseSha || t.lists_version !== CREATOR_LISTS_VERSION || t.prompt_version !== run.prompt_version) return true;
  if ((t.model ?? MODELS.candidates) !== run.model || (t.directions ?? ["safe"]).join() !== run.directions.join() || (t.picks ?? true) !== run.picks) return true;
  if ((t.lessons ?? null) !== (run.lessons ?? null)) return true;
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
      directions: { type: "string", default: "safe" }, // safe | all
      model: { type: "string", default: "candidates" }, // a MODELS key: candidates | candidatesStrong
      picks: { type: "string", default: "yes" }, // yes | no: offer the creator-list shortlist
      lessons: { type: "string", default: "no" }, // yes | no: append the creator lessons to the candidates system prompt
      "max-dollars": { type: "string" }, // hard cap for this process; required whenever --lessons yes
    },
  });
  if (args.directions !== "safe" && args.directions !== "all") throw new Error(`--directions must be safe or all, got ${args.directions}`);
  if (args.picks !== "yes" && args.picks !== "no") throw new Error(`--picks must be yes or no, got ${args.picks}`);
  if (args.lessons !== "yes" && args.lessons !== "no") throw new Error(`--lessons must be yes or no, got ${args.lessons}`);
  const cap = args["max-dollars"] != null ? Number(args["max-dollars"]) : null;
  if (cap != null && !(cap > 0)) throw new Error(`--max-dollars must be a positive number, got ${args["max-dollars"]}`);
  if (args.lessons === "yes" && cap == null && !args.replay) throw new Error("--lessons yes needs --max-dollars");
  if ((args.directions !== "safe" || args.picks !== "yes" || args.model !== "candidates") && args.tag === "listsB" && !args.replay) {
    throw new Error("a non-default run needs its own --tag (listsB holds the creator-lists results)");
  }
  const directions: DirectionTag[] = args.directions === "all" ? [...DirectionTag.options] : ["safe"];
  const modelKey = args.model as keyof typeof MODELS;
  if (!(modelKey === "candidates" || modelKey === "candidatesStrong")) throw new Error(`--model must be candidates or candidatesStrong, got ${args.model}`);
  const usePicks = args.picks !== "no";
  const useLessons = args.lessons === "yes";
  if (usePicks && useLessons) throw new Error("--picks yes and --lessons yes test different things; run one at a time");
  const run: RunConfig = {
    prompt_version: useLessons ? LESSONS_PROMPT_VERSION : usePicks ? CREATOR_PICKS_PROMPT_VERSION : PROMPT_VERSION,
    model: MODELS[modelKey], directions, picks: usePicks, lessons: useLessons ? LESSONS_VERSION : null,
  };
  if (!args.root) { console.error("usage: treatment.ts --root <batch> [--base round2] [--tag listsB] [--split tune|test|all] [--only <id>] [--replay] [--directions safe|all] [--model candidates|candidatesStrong] [--picks yes|no]"); process.exit(1); }
  // --root may list several batches (comma-separated) so one process, and one spending cap, covers them all.
  const jobs: { root: string; clip: ClipSpec }[] = [];
  for (const r of args.root.split(",")) {
    const root = path.resolve(r.replace(/^~(?=$|\/)/, os.homedir()));
    let clips = parseClipsCsv(await fs.readFile(path.join(root, "clips.csv"), "utf8"));
    if (args.split !== "all") clips = clips.filter((c) => c.split === args.split);
    if (args.only) { const ids = new Set(args.only.split(",")); clips = clips.filter((c) => ids.has(c.id)); }
    for (const clip of clips) jobs.push({ root, clip });
  }

  const counts: Record<string, number> = { replayed_ok: 0, replay_diff: 0, ok: 0, ineligible: 0, failed: 0, control_failed: 0, cached: 0, no_control: 0 };
  const noControl: string[] = [];
  for (const { root, clip } of jobs) {
    const work = path.join(root, "work", clip.id);
    const baseText = await fs.readFile(path.join(work, `ours.${args.base}.json`), "utf8").catch(() => null);
    if (!baseText) { counts.no_control!++; noControl.push(clip.id); continue; }
    const base = JSON.parse(baseText) as OursResult;
    const baseSha = sha(baseText);
    const out = path.join(work, `ours.${args.tag}.json`);
    const prior = args.replay ? null : await fs.readFile(out, "utf8").then((t) => JSON.parse(t) as TreatmentResult).catch(() => null);
    if (!args.replay && !args.force && !needsRun(prior, baseSha, run)) { counts.cached!++; console.log(`${clip.id}: cached (${prior!.treatment.status})`); continue; }
    const attempts = prior?.treatment && prior.treatment.base_sha === baseSha && prior.treatment.status === "failed" ? prior.treatment.attempts + 1 : 1;

    if (cap != null && !args.replay) {
      const spent = spentDollars();
      if (spent + RESERVE_PER_CLIP > cap) { console.log(`STOP: spent $${spent.toFixed(2)} of $${cap}; the next clip could exceed the cap`); break; }
    }
    const t0 = Date.now();
    const ctx = { deadlineAt: Date.now() + LIMITS.pipelineBudgetMs };
    const duration = base.analysis ? await probeDuration(path.join(root, "videos", clip.file)).catch(() => null) : null;
    const analysis = base.analysis ? { ...base.analysis, duration_seconds: duration ?? base.analysis.duration_seconds ?? null } : base.analysis;
    const types = analysis ? listTypesFor(analysis, base.brief) : [];
    const offered = usePicks && analysis?.dialogue_present && types.length ? shortlistFor(types) : [];
    const eligible = usePicks ? offered.length > 0 : !!analysis;
    const meta = (status: TreatmentStatus, extra: Partial<TreatmentMeta> = {}): TreatmentMeta => ({
      status, attempts, error: null, base_tag: args.base!, base_sha: baseSha, eligible, types, offered, funnel: null,
      reused_verified: 0, newly_verified: 0, reused_scores: 0, newly_scored: 0,
      prompt_version: run.prompt_version, lists_version: CREATOR_LISTS_VERSION, elapsed_ms: Date.now() - t0,
      model: run.model, directions: run.directions, picks: run.picks, lessons: run.lessons ?? null, ...extra,
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
    } else if (!eligible) {
      result = { ...base, analysis, treatment: meta("ineligible") };
    } else {
      try {
        const fresh = await generateCandidates(base.brief, analysis, { directions, model: run.model, ...(offered.length ? { creatorPicks: offered } : {}), ...(useLessons ? { lessons: true } : {}), ctx });
        const r = await rebuild(base, analysis, fresh, deps, offered, directions);
        result = {
          ...base, analysis, generated: r.generated, finals: asFinals(r.picks), recommend_error: null,
          candidates: [
            ...r.scored.map((c) => toCandidateInsert(clip.id, c, true, run.prompt_version)),
            ...[...r.unverified, ...r.lookupFailed].map((c) => toCandidateInsert(clip.id, c, false, run.prompt_version)),
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
  console.log(`spent this run: $${spentDollars().toFixed(2)}${cap != null ? ` of a $${cap} cap` : ""}`);
  if (noControl.length) console.log(`outside the comparison (no ${args.base} run): ${noControl.join(", ")}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

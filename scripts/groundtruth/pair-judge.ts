/* Paired judge (docs/review/24 v3 §8–9): rank 1 of run A vs rank 1 of run B on the same clip, symmetric inputs.
     pnpm local scripts/groundtruth/pair-judge.ts --root <batch> --a round2 --b listsB [--split tune|test|all] [--only <id>] [--force] [--summary]
   Both options get title, artist and the section to use; nothing else (no explanations, no Gemini text, no truth).
   The video description is A's analysis, which B reuses by construction. A/B order is shuffled per clip.
   Identical song and section → tie without a call. A missing or failed run is a loss for that arm (both missing: failure).
   A judge call that fails is retried once, then recorded as judge_error. Writes work/<id>/pair.<a>-vs-<b>.json.
   --summary: no calls; prints wins / losses / ties, decided, failures, a two-sided sign test, hit rates and sameness. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { callClaude, type ClaudeCall } from "../../src/shared/anthropic";
import { MODELS } from "../../src/shared/config";
import { extractJson } from "../../src/shared/json";
import type { FinalRecommendation, VideoAnalysis } from "../../src/shared/types";
import { compareClip } from "./compare";
import { parseClipsCsv, type ClipSpec } from "./intake";
import type { OursResult } from "./ours";

export const PROMPT_VERSION = "pair-judge-v1";

const SYSTEM = `You judge which of two song sections fits a short-form video (Reel / TikTok) better as its music.
You never see the video: you get a written description of it from a muted viewing and two options labelled A and B,
each a song and the part of it to use. Both come from recommendation systems. Judge fit to the video as described:
mood, energy, pacing, whether it sits well under speech when someone is talking, and whether a creator in this niche
would plausibly use it. Not fame, not your own taste. Reply with one JSON object only.`;

const Answer = z.object({ winner: z.enum(["A", "B", "tie"]), confidence: z.enum(["low", "medium", "high"]), reason: z.string().min(1) });

export type Arm = "a" | "b";
export type PairStatus = "win_a" | "win_b" | "tie" | "tie_identical" | "fail_a" | "fail_b" | "fail_both" | "judge_error";
export type PairResult = {
  status: PairStatus; confidence: "low" | "medium" | "high" | null; reason: string | null;
  order: { A: Arm; B: Arm } | null; a: Option | null; b: Option | null; prompt_version: string; model: string;
};
type Option = { title: string; artist: string; start_seconds: number; end_seconds: number; catalog_key: string };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const top = (r: OursResult | null): Option | null => {
  const f = r && !r.recommend_error ? [...r.finals].sort((x, y) => x.rank - y.rank)[0] : undefined;
  return f ? { title: f.canonical_title, artist: f.canonical_artist, start_seconds: f.start_seconds, end_seconds: f.end_seconds, catalog_key: f.catalog_key } : null;
};

export function buildPairPrompt(a: VideoAnalysis, A: Option, B: Option): string {
  return [
    "VIDEO (description from a muted viewing)",
    `summary: ${a.summary}`,
    `format: ${a.content_type}`,
    `mood: ${a.mood.join(", ")}`,
    `energy: ${a.energy}; pacing: ${a.pacing}; someone talking: ${a.dialogue_present ? "yes" : "no"}${a.duration_seconds != null ? `; length ${Math.round(a.duration_seconds)} s` : ""}`,
    "key moments:",
    ...a.important_moments.map((m) => `- ${m.time}s ${m.type}${m.note ? `: ${m.note}` : ""}`),
    "",
    `OPTION A: ${A.title} — ${A.artist}, use ${mmss(A.start_seconds)}–${mmss(A.end_seconds)}`,
    `OPTION B: ${B.title} — ${B.artist}, use ${mmss(B.start_seconds)}–${mmss(B.end_seconds)}`,
    "",
    "Which fits this video better? Answer with exactly:",
    '{"winner": "A" | "B" | "tie", "confidence": "low" | "medium" | "high", "reason": "one sentence"}',
  ].join("\n");
}

export async function judgePair(
  analysis: VideoAnalysis, runA: OursResult | null, runB: OursResult | null,
  call: ClaudeCall = callClaude, random: () => number = Math.random,
): Promise<PairResult> {
  const a = top(runA), b = top(runB);
  const base = { confidence: null, reason: null, order: null, a, b, prompt_version: PROMPT_VERSION, model: MODELS.analysis };
  if (!a && !b) return { ...base, status: "fail_both" };
  if (!a) return { ...base, status: "fail_a" };
  if (!b) return { ...base, status: "fail_b" };
  if (a.catalog_key === b.catalog_key && a.start_seconds === b.start_seconds && a.end_seconds === b.end_seconds) return { ...base, status: "tie_identical" };
  const order: { A: Arm; B: Arm } = random() < 0.5 ? { A: "a", B: "b" } : { A: "b", B: "a" };
  const opt = (arm: Arm) => (arm === "a" ? a : b);
  const user = buildPairPrompt(analysis, opt(order.A), opt(order.B));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await call({ model: MODELS.analysis, system: SYSTEM, user, maxTokens: 2000 });
      const p = Answer.parse(extractJson(text));
      const status: PairStatus = p.winner === "tie" ? "tie" : order[p.winner] === "a" ? "win_a" : "win_b";
      return { ...base, status, confidence: p.confidence, reason: p.reason, order };
    } catch { /* retried once, then judge_error */ }
  }
  return { ...base, status: "judge_error", order };
}

/** Two-sided exact sign test over decided pairs. */
export function signTestP(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  let tail = 0;
  let c = 1; // C(n, 0)
  for (let i = 0; i <= k; i++) { tail += c; c = (c * (n - i)) / (i + 1); }
  return Math.min(1, (2 * tail) / 2 ** n);
}

export type Tally = { clips: number; win_b: number; win_a: number; tie: number; decided: number; net_b: number; fail_a: number; fail_b: number; fail_both: number; judge_error: number; p: number };

/** One-arm failure counts as a loss for that arm (v3 decision rule). */
export function tally(results: PairResult[]): Tally {
  const n = (s: PairStatus) => results.filter((r) => r.status === s).length;
  const win_b = n("win_b") + n("fail_a");
  const win_a = n("win_a") + n("fail_b");
  return {
    clips: results.length, win_b, win_a, tie: n("tie") + n("tie_identical"), decided: win_a + win_b, net_b: win_b - win_a,
    fail_a: n("fail_a"), fail_b: n("fail_b"), fail_both: n("fail_both"), judge_error: n("judge_error"), p: signTestP(win_b, win_a),
  };
}

/** Most frequent recording in the top 5 across clips, and in how many clips it appears. */
export function sameness(runs: (OursResult | null)[]): { key: string | null; title: string | null; clips: number } {
  const count = new Map<string, { n: number; title: string }>();
  for (const r of runs) {
    if (!r || r.recommend_error) continue;
    const seen = new Set<string>();
    for (const f of [...r.finals].sort((x, y) => x.rank - y.rank).slice(0, 5)) {
      if (seen.has(f.catalog_key)) continue;
      seen.add(f.catalog_key);
      const c = count.get(f.catalog_key) ?? { n: 0, title: f.canonical_title };
      c.n++; count.set(f.catalog_key, c);
    }
  }
  let best: { key: string | null; title: string | null; clips: number } = { key: null, title: null, clips: 0 };
  for (const [key, c] of count) if (c.n > best.clips) best = { key, title: c.title, clips: c.n };
  return best;
}

const readRun = (file: string) => fs.readFile(file, "utf8").then((t) => JSON.parse(t) as OursResult).catch(() => null);

async function main() {
  const { values: args } = parseArgs({
    options: {
      root: { type: "string" }, a: { type: "string", default: "round2" }, b: { type: "string", default: "listsB" },
      split: { type: "string", default: "tune" }, only: { type: "string" }, force: { type: "boolean", default: false },
      summary: { type: "boolean", default: false },
    },
  });
  if (!args.root) { console.error("usage: pair-judge.ts --root <batch>[,<batch>...] --a <tag> --b <tag> [--split tune|test|all] [--summary]"); process.exit(1); }
  const roots = args.root.split(",").map((r) => path.resolve(r.replace(/^~(?=$|\/)/, os.homedir())));
  const rows: { clip: ClipSpec; root: string; result: PairResult; A: OursResult | null; B: OursResult | null }[] = [];
  for (const root of roots) {
    let clips = parseClipsCsv(await fs.readFile(path.join(root, "clips.csv"), "utf8")).filter((c) => c.song && c.artist);
    if (args.split !== "all") clips = clips.filter((c) => c.split === args.split);
    if (args.only) clips = clips.filter((c) => c.id === args.only);
    for (const clip of clips) {
      const work = path.join(root, "work", clip.id);
      const A = await readRun(path.join(work, `ours.${args.a}.json`));
      const B = await readRun(path.join(work, `ours.${args.b}.json`));
      if (!A && !B) continue; // clip never ran in either arm (no video): not part of the comparison
      const out = path.join(work, `pair.${args.a}-vs-${args.b}.json`);
      let result = args.force ? null : await fs.readFile(out, "utf8").then((t) => JSON.parse(t) as PairResult).catch(() => null);
      if (result?.status === "judge_error") result = null; // predeclared: one more attempt on the next run
      if (!result) {
        if (args.summary) continue;
        const analysis = (A ?? B)!.analysis;
        result = await judgePair(analysis, A, B);
        await fs.writeFile(out, JSON.stringify(result, null, 2));
        console.log(`${clip.id}: ${result.status}${result.reason ? ` (${result.confidence}) ${result.reason}` : ""}`);
      }
      rows.push({ clip, root, result, A, B });
    }
  }

  const eligible = (r: (typeof rows)[number]) => !!(r.B as (OursResult & { treatment?: { eligible: boolean } }) | null)?.treatment?.eligible;
  const fmt = (t: Tally) => `${t.clips} clips: B wins ${t.win_b}, A wins ${t.win_a}, ties ${t.tie}; decided ${t.decided}, net B ${t.net_b >= 0 ? "+" : ""}${t.net_b}, sign test p=${t.p.toFixed(3)}; failures A ${t.fail_a} / B ${t.fail_b} / both ${t.fail_both}; judge errors ${t.judge_error}`;
  console.log(`\nAll        ${fmt(tally(rows.map((r) => r.result)))}`);
  console.log(`Eligible   ${fmt(tally(rows.filter(eligible).map((r) => r.result)))}`);
  const hits = (arm: "A" | "B") => rows.filter((r) => r[arm] && !r[arm]!.recommend_error && compareClip({ song: r.clip.song!, artist: r.clip.artist!, start_seconds: r.clip.start_seconds }, r[arm]!).result === "hit").length;
  console.log(`Hit rate   A ${hits("A")}/${rows.length}, B ${hits("B")}/${rows.length} (clips with an identified song)`);
  const sa = sameness(rows.map((r) => r.A)), sb = sameness(rows.map((r) => r.B));
  console.log(`Sameness   A: ${sa.title ?? "-"} in ${sa.clips} of ${rows.length} top-5s; B: ${sb.title ?? "-"} in ${sb.clips} of ${rows.length}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

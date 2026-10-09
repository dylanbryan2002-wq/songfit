/* Paired judge (docs/review/24 v3 §8–9): rank 1 of run A vs rank 1 of run B on the same clip, symmetric inputs.
     pnpm local scripts/groundtruth/pair-judge.ts --root <batch>[,<batch>] --a round2 --b listsB [--split tune|test|all] [--only <id>] [--force] [--summary]
   Both options get title, artist and the section to use; nothing else (no explanations, no Gemini text, no truth).
   The video description is the shared analysis (B's copy carries the probed duration). A/B order is shuffled per clip.
   Population: every clip in the split with an artifact in either arm (identified song or not). Identical song and
   section → tie without a call. A missing or failed run is a loss for that arm; both failed is a failure.
   A judge call is attempted twice per invocation; a judge_error result is kept and retried on later invocations until
   MAX_JUDGE_ATTEMPTS, then final. A result is stale (re-judged) when either arm's top pick or the prompt version changed.
   Writes work/<id>/pair.<a>-vs-<b>.json.
   --summary: no calls; every scheduled clip is reported, pending and stale ones included. */
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
import { sha } from "./treatment-lib";
import type { TreatmentResult } from "./treatment";

export const PROMPT_VERSION = "pair-judge-v1";

const SYSTEM = `You judge which of two song sections fits a short-form video (Reel / TikTok) better as its music.
You never see the video: you get a written description of it from a muted viewing and two options labelled A and B,
each a song and the part of it to use. Both come from recommendation systems. Judge fit to the video as described:
mood, energy, pacing, whether it sits well under speech when someone is talking, and whether a creator in this niche
would plausibly use it. Not fame, not your own taste. Reply with one JSON object only.`;

const Answer = z.object({ winner: z.enum(["A", "B", "tie"]), confidence: z.enum(["low", "medium", "high"]), reason: z.string().min(1) });

export type Arm = "a" | "b";
export type PairStatus = "win_a" | "win_b" | "tie" | "tie_identical" | "fail_a" | "fail_b" | "fail_both" | "judge_error";
export const MAX_JUDGE_ATTEMPTS = 2;
export type PairResult = {
  status: PairStatus; attempts?: number; a_sha?: string; b_sha?: string; confidence: "low" | "medium" | "high" | null; reason: string | null;
  order: { A: Arm; B: Arm } | null; a: Option | null; b: Option | null; prompt_version: string; model: string;
};
type Option = { title: string; artist: string; start_seconds: number; end_seconds: number; catalog_key: string; moment?: number };

const mmss = (s: number) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
export const top = (r: OursResult | null): Option | null => {
  const f = r && !r.recommend_error ? [...r.finals].sort((x, y) => x.rank - y.rank)[0] : undefined;
  return f ? { title: f.canonical_title, artist: f.canonical_artist, start_seconds: f.start_seconds, end_seconds: f.end_seconds, catalog_key: f.catalog_key } : null;
};

export const TOP3_PROMPT_VERSION = "pair-judge-top3-v1";
const TOP3_SYSTEM = `You judge which of two short lists of song sections gives a creator better choices for their short-form
video (Reel / TikTok). You never see the video: you get a written description of it from a muted viewing and two lists
labelled A and B, each three songs with the part to use and when its musical moment lands. Both lists come from
recommendation systems. Judge how well the three options fit the video as described (mood, energy, pacing, speech, what
the music should do for the viewer) and whether a creator in this niche would plausibly use them. Not fame, not your own
taste. Reply with one JSON object only.`;

export const topN = (r: OursResult | null, n: number): Option[] | null => {
  const fs_ = r && !r.recommend_error ? [...r.finals].sort((x, y) => x.rank - y.rank).slice(0, n) : [];
  return fs_.length ? fs_.map((f) => ({ title: f.canonical_title, artist: f.canonical_artist, start_seconds: f.start_seconds, end_seconds: f.end_seconds, catalog_key: f.catalog_key, moment: Math.round((f.anchor_seconds - f.start_seconds) * 10) / 10 })) : null;
};
const setKey = (o: Option[]) => o.map((x) => `${x.catalog_key}@${x.start_seconds}-${x.end_seconds}`).sort().join("|");

export function buildTop3Prompt(a: VideoAnalysis, A: Option[], B: Option[]): string {
  const list = (o: Option[]) => o.map((x, i) => `  ${i + 1}. ${x.title} — ${x.artist}, use ${mmss(x.start_seconds)}–${mmss(x.end_seconds)}${x.moment != null ? `, musical moment ${x.moment} s in` : ""}`).join("\n");
  return videoBlock(a).join("\n") + `\n\nLIST A\n${list(A)}\n\nLIST B\n${list(B)}\n\nWhich list gives this creator better choices? Answer with exactly:\n{"winner": "A" | "B" | "tie", "confidence": "low" | "medium" | "high", "reason": "one sentence"}`;
}

/** Top-3 comparison: same statuses and failure rules as judgePair. */
export async function judgeTop3(
  analysis: VideoAnalysis, runA: OursResult | null, runB: OursResult | null,
  call: ClaudeCall = callClaude, random: () => number = Math.random,
): Promise<PairResult> {
  const a = topN(runA, 3), b = topN(runB, 3);
  const base = { confidence: null, reason: null, order: null, a: a?.[0] ?? null, b: b?.[0] ?? null, a_sha: sha(JSON.stringify(a)), b_sha: sha(JSON.stringify(b)), prompt_version: TOP3_PROMPT_VERSION, model: MODELS.analysis };
  if (!a && !b) return { ...base, status: "fail_both" };
  if (!a) return { ...base, status: "fail_a" };
  if (!b) return { ...base, status: "fail_b" };
  if (setKey(a) === setKey(b)) return { ...base, status: "tie_identical" };
  const order: { A: Arm; B: Arm } = random() < 0.5 ? { A: "a", B: "b" } : { A: "b", B: "a" };
  const user = buildTop3Prompt(analysis, order.A === "a" ? a : b, order.B === "a" ? a : b);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await call({ model: MODELS.analysis, system: TOP3_SYSTEM, user, maxTokens: 2000 });
      const p = Answer.parse(extractJson(text));
      const status: PairStatus = p.winner === "tie" ? "tie" : order[p.winner] === "a" ? "win_a" : "win_b";
      return { ...base, status, confidence: p.confidence, reason: p.reason, order };
    } catch { /* retried once, then judge_error */ }
  }
  return { ...base, status: "judge_error", order };
}

function videoBlock(a: VideoAnalysis): string[] {
  return [
    "VIDEO (description from a muted viewing)",
    `summary: ${a.summary}`,
    `format: ${a.content_type}`,
    `mood: ${a.mood.join(", ")}`,
    `energy: ${a.energy}; pacing: ${a.pacing}; someone talking: ${a.dialogue_present ? "yes" : "no"}${a.duration_seconds != null ? `; length ${Math.round(a.duration_seconds)} s` : ""}`,
    "key moments:",
    ...a.important_moments.map((m) => `- ${m.time}s ${m.type}${m.note ? `: ${m.note}` : ""}`),
  ];
}

export function buildPairPrompt(a: VideoAnalysis, A: Option, B: Option): string {
  return [
    ...videoBlock(a),
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
  const base = { confidence: null, reason: null, order: null, a, b, a_sha: optSha(a), b_sha: optSha(b), prompt_version: PROMPT_VERSION, model: MODELS.analysis };
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

export const optSha = (o: Option | null) => sha(JSON.stringify(o));

/** A cached result no longer describes the current runs (or the judge prompt changed). */
export function isStale(r: PairResult, runA: OursResult | null, runB: OursResult | null): boolean {
  if (r.prompt_version === TOP3_PROMPT_VERSION) return r.a_sha !== sha(JSON.stringify(topN(runA, 3))) || r.b_sha !== sha(JSON.stringify(topN(runB, 3)));
  return r.prompt_version !== PROMPT_VERSION || r.a_sha !== optSha(top(runA)) || r.b_sha !== optSha(top(runB));
}

/** Wilson 95% interval for B's share of decided pairs. */
export function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96, p = wins / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
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

const readRun = (file: string) => fs.readFile(file, "utf8").then((t) => JSON.parse(t) as TreatmentResult).catch(() => null);

async function main() {
  const { values: args } = parseArgs({
    options: {
      root: { type: "string" }, a: { type: "string", default: "round2" }, b: { type: "string", default: "listsB" },
      split: { type: "string", default: "tune" }, only: { type: "string" }, force: { type: "boolean", default: false },
      summary: { type: "boolean", default: false },
      top: { type: "string", default: "1" }, // 1 = rank-1 comparison (pair-judge-v1); 3 = top-3 lists (pair-judge-top3-v1)
    },
  });
  if (args.top !== "1" && args.top !== "3") throw new Error(`--top must be 1 or 3, got ${args.top}`);
  const top3 = args.top === "3";
  if (!args.root) { console.error("usage: pair-judge.ts --root <batch>[,<batch>...] --a <tag> --b <tag> [--split tune|test|all] [--summary]"); process.exit(1); }
  const roots = args.root.split(",").map((r) => path.resolve(r.replace(/^~(?=$|\/)/, os.homedir())));
  type Row = { clip: ClipSpec; result: PairResult | null; state: "done" | "pending" | "stale"; A: OursResult | null; B: TreatmentResult | null };
  const rows: Row[] = [];
  for (const root of roots) {
    let clips = parseClipsCsv(await fs.readFile(path.join(root, "clips.csv"), "utf8"));
    if (args.split !== "all") clips = clips.filter((c) => c.split === args.split);
    if (args.only) clips = clips.filter((c) => c.id === args.only);
    for (const clip of clips) {
      const work = path.join(root, "work", clip.id);
      const A = await readRun(path.join(work, `ours.${args.a}.json`));
      const B = await readRun(path.join(work, `ours.${args.b}.json`));
      if (!A && !B) continue; // never scheduled in either arm (treatment.ts lists these as outside the comparison)
      const out = path.join(work, `pair.${args.a}-vs-${args.b}${top3 ? ".top3" : ""}.json`);
      const cached = args.force ? null : await fs.readFile(out, "utf8").then((t) => JSON.parse(t) as PairResult).catch(() => null);
      const stale = !!cached && isStale(cached, A, B);
      const retry = !!cached && !stale && cached.status === "judge_error" && (cached.attempts ?? 1) < MAX_JUDGE_ATTEMPTS;
      if (cached && !stale && !retry) { rows.push({ clip, result: cached, state: "done", A, B }); continue; }
      if (args.summary) { rows.push({ clip, result: retry ? cached : null, state: stale ? "stale" : retry ? "done" : "pending", A, B }); continue; }
      const analysis = (B?.analysis ?? A?.analysis)!;
      const result: PairResult = { ...(await (top3 ? judgeTop3 : judgePair)(analysis, A, B)), attempts: (retry ? (cached!.attempts ?? 1) : 0) + 1 };
      await fs.writeFile(out, JSON.stringify(result, null, 2));
      console.log(`${clip.id}: ${result.status}${result.reason ? ` (${result.confidence}) ${result.reason}` : ""}`);
      rows.push({ clip, result, state: "done", A, B });
    }
  }

  const done = rows.filter((r) => r.state === "done" && r.result).map((r) => ({ ...r, result: r.result! }));
  const eligible = (r: Row) => !!r.B?.treatment?.eligible;
  const fmt = (t: Tally) => {
    const [lo, hi] = wilson(t.win_b, t.decided);
    return `${t.clips} clips: B wins ${t.win_b}, A wins ${t.win_a}, ties ${t.tie}; decided ${t.decided}, net B ${t.net_b >= 0 ? "+" : ""}${t.net_b}; B share of decided ${t.decided ? Math.round((100 * t.win_b) / t.decided) : "-"}% (95% ${Math.round(lo * 100)}–${Math.round(hi * 100)}%), sign test p=${t.p.toFixed(3)}; failures A ${t.fail_a} / B ${t.fail_b} / both ${t.fail_both}; judge errors ${t.judge_error}`;
  };
  console.log(`\nScheduled ${rows.length}; judged ${done.length}; pending ${rows.filter((r) => r.state === "pending").length}; stale ${rows.filter((r) => r.state === "stale").length}`);
  console.log(`All        ${fmt(tally(done.map((r) => r.result)))}`);
  console.log(`Eligible   ${fmt(tally(done.filter(eligible).map((r) => r.result)))}`);
  const identified = rows.filter((r) => r.clip.song && r.clip.artist);
  const hits = (arm: "A" | "B") => identified.filter((r) => r[arm] && !r[arm]!.recommend_error && compareClip({ song: r.clip.song!, artist: r.clip.artist!, start_seconds: r.clip.start_seconds }, r[arm]!).result === "hit").length;
  console.log(`Hit rate   A ${hits("A")}/${identified.length}, B ${hits("B")}/${identified.length} (identified clips only)`);
  // Proposed = the real song was generated at all (hit, or lost after generation). The bottleneck metric.
  const proposed = (arm: "A" | "B") => identified.filter((r) => {
    const run = r[arm];
    if (!run || run.recommend_error) return false;
    const v = compareClip({ song: r.clip.song!, artist: r.clip.artist!, start_seconds: r.clip.start_seconds }, run);
    return v.result === "hit" || v.lost_at !== "not_generated";
  }).length;
  console.log(`Proposed   real song generated at all: A ${proposed("A")}/${identified.length}, B ${proposed("B")}/${identified.length}`);
  const times = rows.flatMap((r) => (r.B?.treatment?.status === "ok" ? [r.B.treatment.elapsed_ms / 1000] : [])).sort((x, y) => x - y);
  if (times.length) console.log(`B rebuild time per clip: median ${Math.round(times[Math.floor(times.length / 2)]!)} s, max ${Math.round(times[times.length - 1]!)} s (recommend stage minus explanations)`);
  const sa = sameness(rows.map((r) => r.A)), sb = sameness(rows.map((r) => r.B));
  console.log(`Sameness   A: ${sa.title ?? "-"} in ${sa.clips} of ${rows.length} top-5s; B: ${sb.title ?? "-"} in ${sb.clips} of ${rows.length}`);
  const reach = new Map<string, { title: string; offered: number; top5: number }>();
  for (const r of rows) {
    const t = r.B?.treatment;
    if (!t?.eligible) continue;
    const top5 = new Set([...(r.B!.finals ?? [])].sort((x, y) => x.rank - y.rank).slice(0, 5).map((f) => f.catalog_key));
    for (const o of t.offered) {
      const e = reach.get(o.deezer_id) ?? { title: `${o.title} — ${o.artist}`, offered: 0, top5: 0 };
      e.offered++; if (top5.has(`deezer:${o.deezer_id}`)) e.top5++;
      reach.set(o.deezer_id, e);
    }
  }
  console.log("Offered songs: clips offered → clips with it in B's top 5");
  for (const e of [...reach.values()].sort((x, y) => y.top5 - x.top5 || y.offered - x.offered)) console.log(`  ${e.title}: ${e.offered} → ${e.top5}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

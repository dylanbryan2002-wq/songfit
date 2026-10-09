/* Blind judge: the creator's real song vs our rank-1 pick, one Claude call per clip (docs/review/18, round 2).
     pnpm local scripts/groundtruth/judge.ts --root <batch> --tag <tag> [--only <id>] [--force]
   For every clip with a known song and a cached engine run work/<id>/ours.<tag>.json, the judge reads our analysis,
   Gemini's words when pasted, and the two songs labelled A and B in random order, and says which fits the video better.
   Writes work/<id>/judge.<tag>.json; an existing file is kept unless --force. The judge never sees the video. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { callClaude, type ClaudeCall } from "../../src/shared/anthropic";
import { MODELS } from "../../src/shared/config";
import { extractJson } from "../../src/shared/json";
import type { Truth } from "./compare";
import { readGeminiReply, type GeminiReply } from "./gemini";
import { parseClipsCsv } from "./intake";
import type { OursResult } from "./ours";

export const PROMPT_VERSION = "judge-v1";

const SYSTEM = `You judge which of two songs fits a short-form video (Reel / TikTok) better as the music under or over it.
You never see the video: you get a written analysis of it from a muted viewing, sometimes a second watcher's notes made
with sound, and two candidate songs labelled A and B. One of them is the song the creator used, the other is a
recommendation engine's top pick; you are not told which. Judge fit to the video as described, not fame, and do not
treat the second watcher's description of the original music as the answer. Reply with one JSON object only.`;

const Answer = z.object({
  winner: z.enum(["A", "B", "tie"]),
  confidence: z.enum(["low", "medium", "high"]),
  reason: z.string().min(1),
});

export type Label = "A" | "B";
export type Side = "real" | "ours";

export type JudgeResult = {
  real: { title: string; artist: string; start_seconds: number };
  ours: { rank: number; title: string; artist: string; start_seconds: number; end_seconds: number; explanation: string };
  winner: Side | "tie";
  confidence: "low" | "medium" | "high";
  reason: string;
  order: Record<Label, Side>; // which label each side got in the prompt
  prompt_version: string;
  model: string;
};

export type JudgeInput = { truth: Truth; ours: OursResult; gemini: GeminiReply | null };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Gemini's PART 1 free text: everything before the json block. */
const geminiProse = (raw: string) => raw.split(/```json/i)[0]!.trim();

function buildPrompt(input: JudgeInput, order: Record<Label, Side>): string {
  const a = input.ours.analysis;
  const top = [...input.ours.finals].sort((x, y) => x.rank - y.rank)[0]!;
  const candidate = (side: Side) =>
    side === "real"
      ? `${input.truth.song} — ${input.truth.artist}\nstarts at ${mmss(input.truth.start_seconds)}`
      : `${top.canonical_title} — ${top.canonical_artist}\nsection ${mmss(top.start_seconds)}–${mmss(top.end_seconds)}\nwhy: ${top.explanation}`;
  const lines = [
    "VIDEO (analysis from a muted viewing)",
    `summary: ${a.summary}`,
    `story: ${a.story ?? "-"}`,
    `mood: ${a.mood.join(", ")}`,
    `energy: ${a.energy}; pacing: ${a.pacing}; dialogue present: ${a.dialogue_present ? "yes" : "no"}`,
    "important moments:",
    ...a.important_moments.map((m) => `- ${m.time}s ${m.type}${m.note ? `: ${m.note}` : ""}`),
  ];
  if (input.gemini) {
    const g = input.gemini.parsed;
    lines.push("", "SECOND WATCHER (with sound; its description of the music is of whichever song the creator used)",
      geminiProse(input.gemini.raw), `role: ${g.music.role}`, `why it works: ${g.music.why_it_works}`);
  }
  lines.push("", `CANDIDATE A\n${candidate(order.A)}`, "", `CANDIDATE B\n${candidate(order.B)}`, "",
    "Which fits this video better as the music under/over it? Answer with exactly:",
    '{"winner": "A" | "B" | "tie", "confidence": "low" | "medium" | "high", "reason": "one sentence"}');
  return lines.join("\n");
}

/** One model call. `random` is injectable so a test can fix the A/B order. */
export async function judgeClip(input: JudgeInput, call: ClaudeCall = callClaude, random: () => number = Math.random): Promise<JudgeResult> {
  const order: Record<Label, Side> = random() < 0.5 ? { A: "real", B: "ours" } : { A: "ours", B: "real" };
  const text = await call({ model: MODELS.analysis, system: SYSTEM, user: buildPrompt(input, order), maxTokens: 2000 });
  let parsed: z.infer<typeof Answer>;
  try {
    parsed = Answer.parse(extractJson(text));
  } catch (e) {
    throw new Error(`judge answer did not parse: ${e instanceof Error ? e.message : String(e)}\n--- model text ---\n${text}`);
  }
  const top = [...input.ours.finals].sort((x, y) => x.rank - y.rank)[0]!;
  return {
    real: { title: input.truth.song, artist: input.truth.artist, start_seconds: input.truth.start_seconds },
    ours: { rank: top.rank, title: top.canonical_title, artist: top.canonical_artist, start_seconds: top.start_seconds, end_seconds: top.end_seconds, explanation: top.explanation },
    winner: parsed.winner === "tie" ? "tie" : order[parsed.winner],
    confidence: parsed.confidence, reason: parsed.reason, order, prompt_version: PROMPT_VERSION, model: MODELS.analysis,
  };
}

async function main() {
  const { values: args } = parseArgs({
    options: { root: { type: "string" }, tag: { type: "string" }, only: { type: "string" }, force: { type: "boolean", default: false } },
  });
  if (!args.root || !args.tag) { console.error("usage: pnpm local scripts/groundtruth/judge.ts --root <batch> --tag <tag> [--only <id>] [--force]"); process.exit(1); }
  const root = path.resolve(args.root.replace(/^~(?=$|\/)/, os.homedir()));
  let clips = parseClipsCsv(await fs.readFile(path.join(root, "clips.csv"), "utf8"));
  if (args.only) clips = clips.filter((c) => c.id === args.only);
  const counts = { ours: 0, real: 0, tie: 0 };
  for (const clip of clips) {
    if (!clip.song || !clip.artist) continue;
    const work = path.join(root, "work", clip.id);
    const oursFile = path.join(work, `ours.${args.tag}.json`);
    const ours = await fs.readFile(oursFile, "utf8").then((t) => JSON.parse(t) as OursResult).catch(() => null);
    if (!ours || ours.finals.length === 0) { console.log(`${clip.id}: no engine run with finals for tag ${args.tag}, skipped`); continue; }
    const out = path.join(work, `judge.${args.tag}.json`);
    let result = args.force ? null : await fs.readFile(out, "utf8").then((t) => JSON.parse(t) as JudgeResult).catch(() => null);
    if (result) console.log(`${clip.id}: cached`);
    else {
      result = await judgeClip({ truth: { song: clip.song, artist: clip.artist, start_seconds: clip.start_seconds }, ours, gemini: await readGeminiReply(root, clip.id) });
      await fs.writeFile(out, JSON.stringify(result, null, 2));
    }
    counts[result.winner] += 1;
    console.log(`${clip.id}: prefers ${result.winner} (${result.confidence}): ${result.reason}`);
  }
  console.log(`\njudge prefers ours ${counts.ours} / real ${counts.real} / tie ${counts.tie}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

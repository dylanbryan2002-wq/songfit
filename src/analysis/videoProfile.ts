// Video profile (new engine, Dylan 2026-10-11): reads the video into the song dictionary so the closest songs can win.
// The model gives each source's reading separately (words, colour); the code combines energy and mood with
// SOURCE_WEIGHTS (weights.ts) and the measured pacing. Fields approved by Dylan: feelings, energy, mood, vocals,
// lyric themes, content type, key moments, confidence. Not wired into the pipeline until the engine switch is on.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS, LIMITS, env } from "../shared/config";
import { PipelineError } from "../shared/errors";
import { extractJson } from "../shared/json";
import { logger } from "../shared/logger";
import { remainingBudget } from "../pipeline/budget";
import { SOURCE_WEIGHTS } from "../engine/scoring/weights";
import { buildUserContent, type AnalyzeInput } from "./analyzeVideo";
import type { Pacing } from "../media/pacing";

export const PROMPT_VERSION = "profile-v1";

export const FEELINGS = ["Motivational", "Inspirational", "Reflective", "Heartfelt", "Sad", "Nostalgic", "Funny", "Upbeat", "Hype", "Calm/Focused", "Dramatic"] as const;
export const THEMES = ["love", "breakup/heartbreak", "longing", "self-belief/empowerment", "ambition/success", "flexing/money", "partying", "friendship", "gratitude", "joy/optimism", "grief/loss", "nostalgia", "freedom/escape", "rebellion/anger", "faith", "family"] as const;
export const CONTENT_TYPES = ["Educational", "Advice", "Commentary/Opinion", "Reaction", "Podcast/Interview", "Product/Review", "Vlog", "Storytelling", "Funny/Upbeat", "Motivational", "Challenge", "Deep", "Aesthetic/Montage", "Building in public"] as const;
export const STORY_FEELINGS = ["emotional", "sad", "inspirational", "motivational", "funny", "interesting", "deep"] as const;

const unit = z.number().min(0).max(1);
const Reading = z.object({ energy: unit, mood: unit });
const Level = z.enum(["high", "medium", "low"]);
export const ProfileReading = z.object({
  talking: z.enum(["on camera", "voice-over", "none"]),
  words: Reading.nullable(),
  colour: Reading,
  feelings: z.object(Object.fromEntries(FEELINGS.map((f) => [f, unit])) as Record<(typeof FEELINGS)[number], typeof unit>).strict(),
  vocals: z.enum(["instrumental preferred", "vocals OK"]),
  themes_fit: z.array(z.enum(THEMES)).max(3),
  themes_avoid: z.array(z.enum(THEMES)),
  content_type: z.enum(CONTENT_TYPES),
  story_feeling: z.enum(STORY_FEELINGS).nullable(),
  key_moments: z.array(z.object({ time: z.number(), what: z.string() })).max(3),
  confidence: z.object({ feelings: Level, energy: Level, mood: Level, themes: Level }),
});
export type ProfileReading = z.infer<typeof ProfileReading>;
export type Voice = { energy: number; mood: number };
export type VideoProfile = { reading: ProfileReading; pacing: Pacing | null; voice?: Voice | null; faces?: Voice | null; energy: number | null; mood: number | null };

const SYSTEM_PROMPT = `You read a short-form video (frames with timestamps, the words heard, and the creator's vibe if given) and describe WHAT THE MUSIC SHOULD BE, in Songfit's song dictionary.
Give each source's reading separately; the code combines them with fixed weights, so do not blend them yourself:
- words: what is said or written (message, topic, tone of the words). null only if there are no words at all.
- colour: the look (colour, light, warmth, darkness).
Do NOT judge editing pace; it is measured separately. energy and mood are 0-1 (mood 0 = sad/dark, 1 = happy/bright).
feelings: how strongly the MUSIC should make viewers feel each of ${FEELINGS.join(", ")}; most should be 0 and 1-3 clearly above 0.5.
vocals: "instrumental preferred" when someone talks, otherwise "vocals OK".
themes_fit (at most 3) and themes_avoid use only: ${THEMES.join(", ")}.
content_type is one of: ${CONTENT_TYPES.join(", ")}. Purpose beats format: a skit that teaches is Educational. story_feeling is set only for Storytelling: ${STORY_FEELINGS.join(", ")}, judged by the ending.
key_moments: the 1-3 biggest moments with their time in seconds.
When the creator gave a vibe, it decides the feelings; the footage decides what happens and when.
Output one JSON object only with keys: talking, words, colour, feelings, vocals, themes_fit, themes_avoid, content_type, story_feeling, key_moments, confidence {feelings, energy, mood, themes}.`;

let singleton: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (!singleton) singleton = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), maxRetries: 0 });
  return singleton;
}

async function call(c: Anthropic, messages: Anthropic.Messages.MessageParam[], deadlineAt?: number) {
  const started = Date.now();
  const res = await c.messages.create(
    { model: MODELS.analysis, max_tokens: 2000, system: SYSTEM_PROMPT, messages },
    { timeout: remainingBudget({ deadlineAt }, LIMITS.modelTimeoutMs) },
  );
  logger.info("model.call", { model: MODELS.analysis, step: "profile", ms: Date.now() - started, input_tokens: res.usage?.input_tokens, output_tokens: res.usage?.output_tokens, stop_reason: res.stop_reason });
  if (res.stop_reason === "max_tokens") throw new PipelineError("analyze", "profile output truncated");
  return res.content.filter((b): b is Anthropic.Messages.TextBlock => b.type === "text").map((b) => b.text).join("\n");
}

function parse(raw: string): ProfileReading | { error: string } {
  let json: unknown;
  try { json = extractJson(raw); } catch (e) { return { error: `not valid JSON: ${(e as Error).message}` }; }
  const p = ProfileReading.safeParse(json);
  return p.success ? p.data : { error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}

function blend(weights: Record<string, number>, values: Record<string, number | null | undefined>) {
  let sum = 0, total = 0;
  for (const [k, w] of Object.entries(weights)) {
    const v = values[k];
    if (v === null || v === undefined) continue;
    sum += w * v; total += w;
  }
  return total ? sum / total : null;
}

/** Energy and mood from the sources that exist, weighted by SOURCE_WEIGHTS. Editing (pacing) feeds energy only. */
export function combineEnergyMood(r: Pick<ProfileReading, "talking" | "words" | "colour">, editEnergy: number | null, voice: Voice | null = null, faces: Voice | null = null) {
  const w = r.talking !== "none" ? SOURCE_WEIGHTS.talking : SOURCE_WEIGHTS.notTalking;
  return {
    energy: blend(w.energy, { words: r.words?.energy, voice: voice?.energy, faces: faces?.energy, edit: editEnergy, colour: r.colour?.energy }),
    mood: blend(w.mood, { words: r.words?.mood, voice: voice?.mood, faces: faces?.mood, colour: r.colour?.mood }),
  };
}

/** pacing and faces may still be running when this is called: the model call does not need them, they are awaited
    only for the energy/mood combine after the reply (same result, less waiting). */
export async function buildVideoProfile(
  input: AnalyzeInput, pacingIn: Pacing | null | Promise<Pacing | null>,
  opts: { client?: Anthropic; deadlineAt?: number; voice?: Voice | null; faces?: Voice | null | Promise<Voice | null> } = {},
): Promise<VideoProfile & { raw: string }> {
  const c = opts.client ?? defaultClient();
  const userMsg: Anthropic.Messages.MessageParam = { role: "user", content: buildUserContent(input) };
  let raw = await call(c, [userMsg], opts.deadlineAt);
  let r = parse(raw);
  if ("error" in r) {
    logger.warn("profile.retry", { error: r.error });
    raw = await call(c, [userMsg, { role: "assistant", content: raw }, { role: "user", content: `That was not valid: ${r.error}. Output the corrected JSON object only.` }], opts.deadlineAt);
    r = parse(raw);
    if ("error" in r) throw new PipelineError("analyze", `profile invalid after retry: ${r.error}. Raw: ${raw.slice(0, 2000)}`);
  }
  const [pacing, faces] = await Promise.all([pacingIn, opts.faces ?? null]);
  return { reading: r, pacing, voice: opts.voice ?? null, faces, ...combineEnergyMood(r, pacing?.energy ?? null, opts.voice ?? null, faces), raw };
}

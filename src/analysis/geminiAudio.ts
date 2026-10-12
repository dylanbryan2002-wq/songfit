// Gemini listens to the video's audio (new engine; Dylan decided Gemini, not Whisper, 2026-10-11): the words with
// times, plus the voice reading (energy and mood 0..1), speech speed, laughter and a sarcasm hint (voice-feeling rubric,
// 2026-10-10: energy and laughter are reliable, sarcasm is only a hint). Needs a PAID key before creator videos are sent
// (Google's free tier may use the content). One call per video; one retry with the error, then fail with the raw text.
import fs from "node:fs/promises";
import { z } from "zod";
import { MODELS, LIMITS, env } from "../shared/config";
import { PipelineError } from "../shared/errors";
import { extractJson } from "../shared/json";
import { logger } from "../shared/logger";
import { remainingBudget } from "../pipeline/budget";
import type { Transcript } from "./transcribe";

export const PROMPT_VERSION = "voice-v2"; // v2 (2026-10-12): the tone of voice also rates the 11 feelings
const RETRY_WAITS_MS = [2_000, 5_000, 10_000];

const unit = z.number().min(0).max(1);
const FEELINGS = ["Motivational", "Inspirational", "Reflective", "Heartfelt", "Sad", "Nostalgic", "Funny", "Upbeat", "Hype", "Calm/Focused", "Dramatic"] as const;
const Feelings = z.object(Object.fromEntries(FEELINGS.map((f) => [f, unit])) as Record<(typeof FEELINGS)[number], typeof unit>).strict();
const Reply = z.object({
  transcript: z.string(),
  segments: z.array(z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string() })),
  voice: z.object({ energy: unit, mood: unit }).nullable(),
  words_per_second: z.number().min(0).nullable(),
  laughter: z.boolean(),
  sarcasm: z.boolean(),
  feelings: Feelings.nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});

export type Heard = {
  transcript: Transcript; voice: { energy: number; mood: number } | null; feelings: Record<string, number> | null; wordsPerSecond: number | null;
  laughter: boolean; sarcasm: boolean; raw: string;
};

const PROMPT = `Listen to this short video's audio. Ignore any background music except to note it is there.
Return ONE JSON object:
- transcript: every word a person says (and any sung words), as text.
- segments: [{start, end, text}] in seconds for each line or phrase.
- voice: how the speaking voice sounds, energy 0-1 (calm -> intense) and mood 0-1 (sad/dark -> happy/bright), from speed, pauses, pitch, loudness and laughter. null if nobody speaks.
- words_per_second: average speaking speed, null if nobody speaks.
- laughter: true if anyone laughs.
- sarcasm: true only if the tone clearly contradicts the words.
- feelings: from HOW they speak (tone, drive, pace, conviction, warmth), how strongly background MUSIC under this voice
  should make viewers feel each of: ${FEELINGS.join(", ")} (0-1; most 0, 1-3 clearly above 0.5). An assertive, fast,
  fired-up delivery calls for driving music (Motivational, Hype) even when the story itself is a setback. null if nobody speaks.
- confidence: high | medium | low.`;

export async function listenWithGemini(
  audioPath: string | null,
  opts: { fetchImpl?: typeof fetch; apiKey?: string; deadlineAt?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Heard> {
  if (!audioPath) return { transcript: { text: "", segments: [] }, voice: null, feelings: null, wordsPerSecond: null, laughter: false, sarcasm: false, raw: "" };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const key = opts.apiKey ?? env("GEMINI_API_KEY");
  const audio = (await fs.readFile(audioPath)).toString("base64");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent`;

  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  /** Google answers 503/429/5xx when busy: wait and try again (2 s, 5 s, 10 s), then fail. Same request, same result. */
  const post = async (init: RequestInit) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, init);
      const busy = res.status === 429 || res.status >= 500;
      if (!busy || attempt >= RETRY_WAITS_MS.length) return res;
      logger.warn("voice.busy_retry", { status: res.status, attempt: attempt + 1 });
      await sleep(RETRY_WAITS_MS[attempt]!);
    }
  };
  const call = async (note: string | null) => {
    const started = Date.now();
    const res = await post({
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: "audio/wav", data: audio } }, { text: note ? `${PROMPT}\n\n${note}` : PROMPT }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 }, // same audio, same read
      }),
      signal: AbortSignal.timeout(remainingBudget({ deadlineAt: opts.deadlineAt }, LIMITS.modelTimeoutMs)),
    });
    if (!res.ok) throw new PipelineError("analyze", `gemini ${res.status}`);
    const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    logger.info("model.call", { model: MODELS.gemini, step: "voice", ms: Date.now() - started });
    return (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  };
  const parse = (raw: string) => {
    try { const p = Reply.safeParse(extractJson(raw)); return p.success ? p.data : { error: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }; }
    catch (e) { return { error: `not valid JSON: ${(e as Error).message}` }; }
  };

  let raw = await call(null);
  let r = parse(raw);
  if ("error" in r) {
    logger.warn("voice.retry", { error: r.error });
    raw = await call(`Your previous answer was not valid (${r.error}). Output the corrected JSON object only.`);
    r = parse(raw);
    if ("error" in r) throw new PipelineError("analyze", `gemini voice reply invalid after retry: ${r.error}. Raw: ${raw.slice(0, 2000)}`);
  }
  return { transcript: { text: r.transcript, segments: r.segments }, voice: r.voice, feelings: r.feelings, wordsPerSecond: r.words_per_second, laughter: r.laughter, sarcasm: r.sarcasm, raw };
}

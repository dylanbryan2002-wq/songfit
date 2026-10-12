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

export const PROMPT_VERSION = "voice-v1";

const unit = z.number().min(0).max(1);
const Reply = z.object({
  transcript: z.string(),
  segments: z.array(z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string() })),
  voice: z.object({ energy: unit, mood: unit }).nullable(),
  words_per_second: z.number().min(0).nullable(),
  laughter: z.boolean(),
  sarcasm: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
});

export type Heard = {
  transcript: Transcript; voice: { energy: number; mood: number } | null; wordsPerSecond: number | null;
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
- confidence: high | medium | low.`;

export async function listenWithGemini(
  audioPath: string | null,
  opts: { fetchImpl?: typeof fetch; apiKey?: string; deadlineAt?: number } = {},
): Promise<Heard> {
  if (!audioPath) return { transcript: { text: "", segments: [] }, voice: null, wordsPerSecond: null, laughter: false, sarcasm: false, raw: "" };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const key = opts.apiKey ?? env("GEMINI_API_KEY");
  const audio = (await fs.readFile(audioPath)).toString("base64");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.gemini}:generateContent`;

  const call = async (note: string | null) => {
    const started = Date.now();
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: "audio/wav", data: audio } }, { text: note ? `${PROMPT}\n\n${note}` : PROMPT }] }],
        generationConfig: { responseMimeType: "application/json" },
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
  return { transcript: { text: r.transcript, segments: r.segments }, voice: r.voice, wordsPerSecond: r.words_per_second, laughter: r.laughter, sarcasm: r.sarcasm, raw };
}

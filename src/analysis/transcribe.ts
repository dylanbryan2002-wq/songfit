import fs from "node:fs";
import OpenAI from "openai";
import { MODELS, env } from "../shared/config";
import { logger } from "../shared/logger";
import { remainingBudget } from "../pipeline/budget";

export type TranscriptSegment = { start: number; end: number; text: string };
export type Transcript = { text: string; segments: TranscriptSegment[] };

const WHISPER_TIMEOUT_MS = 60_000;

let singleton: OpenAI | null = null;
function defaultClient(): OpenAI {
  if (!singleton) singleton = new OpenAI({ apiKey: env("OPENAI_API_KEY") });
  return singleton;
}

/**
 * Words Whisper hears, spoken or sung, with segment timestamps. Returns an empty
 * transcript when there is no audio track. Does NOT decide whether this is dialogue —
 * the analysis model does (Task 2.3).
 */
export async function transcribe(
  audioPath: string | null,
  opts: { client?: OpenAI; deadlineAt?: number } = {},
): Promise<Transcript> {
  if (!audioPath) return { text: "", segments: [] };
  const c = opts.client ?? defaultClient();
  const result = (await c.audio.transcriptions.create(
    {
      file: fs.createReadStream(audioPath),
      model: MODELS.whisper,
      response_format: "verbose_json",
    },
    { timeout: remainingBudget(opts, WHISPER_TIMEOUT_MS) },
  )) as { text?: string; segments?: { start: number; end: number; text: string }[] };

  const text = (result.text ?? "").trim();
  const segments: TranscriptSegment[] = Array.isArray(result.segments)
    ? result.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
    : [];
  logger.info("analysis.transcribed", { chars: text.length, segments: segments.length });
  return { text, segments };
}

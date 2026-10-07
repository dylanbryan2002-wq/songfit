import fs from "node:fs";
import OpenAI from "openai";
import { MODELS, env } from "../shared/config";
import { logger } from "../shared/logger";
import { PipelineError } from "../shared/errors";
import { remainingBudget } from "../pipeline/budget";

export type TranscriptSegment = { start: number; end: number; text: string };
export type Transcript = { text: string; segments: TranscriptSegment[] };

const WHISPER_TIMEOUT_MS = 60_000;

let singleton: OpenAI | null = null;
function defaultClient(): OpenAI {
  if (!singleton) singleton = new OpenAI({ apiKey: env("OPENAI_API_KEY") });
  return singleton;
}

/** Class name, status and a truncated message only; never headers, request body or the error object. */
function safeMessage(e: unknown): string {
  const err = e as { name?: unknown; status?: unknown; message?: unknown } | null;
  const name = typeof err?.name === "string" ? err.name : "Error";
  const status = typeof err?.status === "number" ? ` ${err.status}` : "";
  const msg = typeof err?.message === "string" ? err.message.slice(0, 200) : "";
  return `${name}${status}${msg ? `: ${msg}` : ""}`;
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
  const stream = fs.createReadStream(audioPath);
  let result: { text?: string; segments?: { start: number; end: number; text: string }[] };
  try {
    result = (await c.audio.transcriptions.create(
      { file: stream, model: MODELS.whisper, response_format: "verbose_json" },
      { timeout: remainingBudget(opts, WHISPER_TIMEOUT_MS) },
    )) as typeof result;
  } catch (e) {
    throw new PipelineError("analyze", `whisper: ${safeMessage(e)}`);
  } finally {
    stream.destroy();
  }

  const text = (result.text ?? "").trim();
  const segments: TranscriptSegment[] = Array.isArray(result.segments)
    ? result.segments.map((s) => ({ start: s.start, end: s.end, text: (s.text ?? "").trim() }))
    : [];
  logger.info("analysis.transcribed", { chars: text.length, segments: segments.length });
  return { text, segments };
}

/* Gemini as a second watcher, via the consumer app: Dylan uploads the clip with GEMINI_PROMPT and pastes the whole
   reply into <root>/gemini/<id>.md. This module parses that paste. No API, no key. See docs/review/18 (revision). */
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { Energy, Pacing } from "../../src/shared/types";

export const PROMPT_VERSION = "gemini-paste-v1";
/** The exact text Dylan pastes into the Gemini app; bump PROMPT_VERSION when GEMINI_PROMPT.md changes. */
export const GEMINI_PROMPT = readFileSync(path.join(__dirname, "GEMINI_PROMPT.md"), "utf8");

const KeyMoment = z.object({ time: z.number().min(0), type: z.string(), note: z.string().nullable().optional() });

/** Strict on the keys the prompt asks for; extra keys are dropped (z.object strips unknown keys). */
export const GeminiAnalysis = z.object({
  summary: z.string(),
  content_category: z.string(), // Gemini strays off our list ("technology"); kept verbatim for the side-by-side diff
  setting: z.string().nullable(),
  story: z.string().nullable(),
  energy: Energy,
  pacing: Pacing,
  mood: z.array(z.string()),
  aesthetic: z.array(z.string()),
  dialogue_present: z.boolean(),
  key_moments: z.array(KeyMoment),
  song: z.object({ title: z.string().nullable(), artist: z.string().nullable(), confidence: z.enum(["high", "medium", "low"]) }), // recorded, never trusted
  music: z.object({
    section_start_seconds_in_song: z.number().min(0).nullable(),
    hits: z.array(z.object({ video_time: z.number().min(0), what_music_does: z.string() })),
    role: z.enum(["contrast", "amplify", "punchline", "trend", "narration", "other"]),
    role_note: z.string(),
    why_it_works: z.string(),
  }),
  brief: z.object({
    text: z.string(),
    moods: z.array(z.string()),
    energy: z.number().min(0).max(1),
    tempo: z.string(), // free text in the prompt Dylan has (e.g. "fast", "120-130 bpm")
    vocals: z.string(),
    genres: z.array(z.string()),
    familiarity: z.string(),
  }),
});
export type GeminiAnalysis = z.infer<typeof GeminiAnalysis>;

export type GeminiReply = { parsed: GeminiAnalysis; raw: string; prompt_version: string };

/** The whole pasted reply travels with the error so a bad paste can be fixed by hand. */
export class GeminiParseError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(`${message}\n--- pasted reply ---\n${raw}`);
    this.name = "GeminiParseError";
    this.raw = raw;
  }
}

const JSON_FENCE_RE = /```json\s*([\s\S]*?)```/i;

/** The first ```json block of a pasted reply, validated. */
export function parseGeminiReply(raw: string): GeminiAnalysis {
  const fence = JSON_FENCE_RE.exec(raw);
  if (!fence?.[1]) throw new GeminiParseError("no ```json block in the pasted reply", raw);
  let json: unknown;
  try {
    json = JSON.parse(fence[1]);
  } catch (e) {
    throw new GeminiParseError(`the json block is not valid JSON: ${(e as Error).message}`, raw);
  }
  const parsed = GeminiAnalysis.safeParse(json);
  if (!parsed.success) {
    throw new GeminiParseError(`the json block does not match the prompt's keys: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, raw);
  }
  return parsed.data;
}

/** <root>/gemini/<id>.md, or null when Dylan has not pasted a reply for this clip yet. */
export async function readGeminiReply(root: string, id: string): Promise<GeminiReply | null> {
  const file = path.join(root, "gemini", `${id}.md`);
  const raw = await fs.readFile(file, "utf8").catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
  if (raw === null) return null;
  return { parsed: parseGeminiReply(raw), raw, prompt_version: PROMPT_VERSION };
}

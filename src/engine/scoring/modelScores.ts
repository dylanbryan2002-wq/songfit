import { z } from "zod";
import { ComponentScore, type MusicBrief, type VerifiedCandidate, type VideoAnalysis } from "@/src/shared/types";
import { MODELS, LIMITS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { MODEL_DIMENSIONS, type ModelDimension } from "@/src/engine/scoring/dimensions";

// v5 (2026-10-09): the moment is given in seconds after the clip starts; v4 gave the song timestamp and the scorer
// compared it with video time ("Lift at 58s, misses 12s climax" for a moment 8 s into the clip).
export const PROMPT_VERSION = "scoring-v5";
// Measured 2026-10-07: 60 candidates × 6 dims truncated at 5400 tokens (90/item was a guess). Real cost is
// ~170 output tokens per item plus ~1.5k hidden reasoning per call, so score in parallel chunks of 20.
// scoring-v3 (2026-10-08): its conditional rules raised a 20-item chunk to 3.9k–4.4k and truncated at 4400.
const TOKENS_PER_ITEM = 320;
const MIN_TOKENS = 2000;
const MAX_TOKENS = 16_000;
const CHUNK_SIZE = 20;

const SYSTEM = `You are Songfit's music supervisor. You score candidate song sections against a specific
short-form video. Be decisive and discriminating: use the full 0–1 range, do not give everything 0.7.
A 1.0 means "this is exactly the song a great editor would pick"; a 0.2 means "clearly wrong".
Reasons are at most 10 words. You must return one object for EVERY candidate index.`;

const DIMENSION_DEFINITIONS: Record<ModelDimension, string> = {
  semantic: "Does the song make sense for what is literally happening in the video (subject, setting, story)?",
  emotional: "Does the emotional character of this section match or productively contrast the video's feel and the creator's intent?",
  aesthetic: "Does the sound match the visual world (luxury vs raw, modern vs retro, polished vs lo-fi)?",
  pacing: "Do the energy and rhythm of this section fit the edit's pace and cuts, and does its musical moment land near the key moment? The moment is given as seconds after the clip starts playing, which is the same clock as the video's key moments. If the video is under 10 s and the moment is more than 5 s in, the creator never hears it: score ≤ 0.3.",
  cultural: "Would this creator realistically use this song on Instagram or TikTok right now, given their niche and audience? Songs whose social moment peaked in 2020–2023 read dated: ≤ 0.5 unless the brief asks for nostalgia.",
  originality: "Is it good without being painfully obvious or exhausted?",
};

// scoring-v4 (docs/review/19, round 1): the rules below depend on the video, so they are appended only when they apply.
// Someone talking over the music: a stock Reels choice is a miss.
export const STOCK_CHOICE_RULE =
  "Score ≤ 0.3 if this song is a stock TikTok/Reels choice for this kind of joke or mood (e.g. Sweater Weather, Dreams, golden hour, Mad World, Careless Whisper, Eye of the Tiger, Sailor Song) — a creator would roll their eyes.";
// No dialogue: the song carries the edit, and creators pick the heavily used song on purpose (Law & Order, Stereo Love, Sailor Song).
export const SONG_CARRIES_EDIT_RULE =
  "No one is talking, so the song carries the edit: do NOT lower this score because the song is widely used on Reels or TikTok; heavy use is neutral to positive here.";
// Under 15 s the edit usually cuts on the hook; round 1 scored a drop at 4.5 s as "Hook 5s in; missed".
export const SHORT_VIDEO_PACING_RULE =
  "This video is under 15 s: a hook, drop or vocal entry inside the first 5 s of the section is a PLUS (it lands on the cut), never a miss.";
const SHORT_VIDEO_SECONDS = 15;

function dimensionDefinitions(analysis: VideoAnalysis): Record<ModelDimension, string> {
  const defs = { ...DIMENSION_DEFINITIONS };
  if (analysis.dialogue_present) {
    defs.originality += ` ${STOCK_CHOICE_RULE}`;
  } else {
    defs.cultural += ` ${SONG_CARRIES_EDIT_RULE}`;
    defs.originality += ` ${SONG_CARRIES_EDIT_RULE}`;
  }
  if (analysis.duration_seconds != null && analysis.duration_seconds < SHORT_VIDEO_SECONDS) defs.pacing += ` ${SHORT_VIDEO_PACING_RULE}`;
  return defs;
}

const Item = z.object({ index: z.number().int().min(0) }).and(
  z.object(Object.fromEntries(MODEL_DIMENSIONS.map((d) => [d, ComponentScore])) as Record<ModelDimension, typeof ComponentScore>),
);

export function buildScoringPrompt(analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[]): string {
  const definitions = dimensionDefinitions(analysis);
  const defs = MODEL_DIMENSIONS.map((d) => `- ${d}: ${definitions[d]}`).join("\n");
  const list = cands
    .map((c, i) => `${i}. "${c.canonical_title}" — ${c.canonical_artist} | song ${c.proposed_start}s–${c.proposed_end}s (${Math.round((c.proposed_end - c.proposed_start) * 10) / 10} s clip), musical moment ${Math.round((c.anchor_seconds - c.proposed_start) * 10) / 10} s after the clip starts | ${c.section_reason} | proposed because: ${c.fit_reason}`)
    .join("\n");
  const moments = analysis.important_moments.map((m) => `${m.time}s ${m.type}`).join("; ") || "none";
  return `VIDEO
${analysis.summary}
Duration: ${analysis.duration_seconds != null ? `${analysis.duration_seconds.toFixed(1)}s` : "unknown"}.
Category: ${analysis.content_category}. Aesthetic: ${analysis.aesthetic.join(", ")}. Mood: ${analysis.mood.join(", ")}.
Energy ${analysis.energy}, pacing ${analysis.pacing}. Dialogue: ${analysis.dialogue_present ? "yes" : "no"}. Key moments: ${moments}.

MUSIC BRIEF
${brief.text}

DIMENSIONS (score each 0–1, reason ≤ 10 words)
${defs}

CANDIDATES (${cands.length}; return exactly ${cands.length} objects, indexes 0–${cands.length - 1})
${list}

Return ONLY a compact JSON array on one line (no indentation), one object per candidate:
{ "index": number, "semantic": {"score": number, "reason": string}, "emotional": {...}, "aesthetic": {...}, "pacing": {...}, "cultural": {...}, "originality": {...} }`;
}

export function parseScores(
  text: string, count: number,
): { ok: true; scores: Record<ModelDimension, ComponentScore>[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "no JSON found" };
  }
  const arr = z.array(Item).safeParse(raw);
  if (!arr.success) return { ok: false, error: arr.error.message };
  const byIndex = new Map<number, Record<ModelDimension, ComponentScore>>();
  for (const { index, ...rest } of arr.data) byIndex.set(index, rest as Record<ModelDimension, ComponentScore>);
  const scores: Record<ModelDimension, ComponentScore>[] = [];
  for (let i = 0; i < count; i++) {
    const s = byIndex.get(i);
    if (!s) return { ok: false, error: `missing index ${i}` };
    scores.push(s);
  }
  return { ok: true, scores };
}

export async function modelScores(
  analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[],
  deps: { call?: ClaudeCall; timeoutMs?: number } = {},
): Promise<Record<ModelDimension, ComponentScore>[]> {
  const call = deps.call ?? callClaude;
  const timeoutMs = deps.timeoutMs ?? LIMITS.modelTimeoutMs;
  const chunks: VerifiedCandidate[][] = [];
  for (let i = 0; i < cands.length; i += CHUNK_SIZE) chunks.push(cands.slice(i, i + CHUNK_SIZE));
  const started = Date.now();
  const results = await Promise.all(chunks.map((chunk) => scoreChunk(analysis, brief, chunk, call, timeoutMs)));
  logger.info("scoring", { ms: Date.now() - started, candidates: cands.length, chunks: chunks.length });
  return results.flat();
}

async function scoreChunk(
  analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[], call: ClaudeCall, timeoutMs: number,
): Promise<Record<ModelDimension, ComponentScore>[]> {
  const user = buildScoringPrompt(analysis, brief, cands);
  const maxTokens = Math.min(MAX_TOKENS, Math.max(MIN_TOKENS, cands.length * TOKENS_PER_ITEM));
  const first = await call({ model: MODELS.scoring, system: SYSTEM, user, maxTokens, effort: "medium", timeoutMs });
  const r1 = parseScores(first, cands.length);
  if (r1.ok) return r1.scores;
  logger.warn("scoring.retry", { error: r1.error.slice(0, 300) });
  const retryUser = `${user}\n\nPREVIOUS OUTPUT WAS INVALID. Validation error:\n${r1.error.slice(0, 2000)}\nReturn the full corrected JSON array with every index.`;
  const second = await call({ model: MODELS.scoring, system: SYSTEM, user: retryUser, maxTokens, effort: "medium", timeoutMs });
  const r2 = parseScores(second, cands.length);
  if (r2.ok) return r2.scores;
  throw new PipelineError("recommend", `scoring output invalid: ${r2.error.slice(0, 200)}`, second);
}

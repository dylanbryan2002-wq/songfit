import { z } from "zod";
import { ComponentScore, type MusicBrief, type VerifiedCandidate, type VideoAnalysis } from "@/src/shared/types";
import { MODELS, LIMITS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { MODEL_DIMENSIONS, type ModelDimension } from "@/src/engine/scoring/dimensions";

export const PROMPT_VERSION = "scoring-v1";
const TOKENS_PER_ITEM = 90; // 6 dims × (score + ≤12-word reason) ≈ 90 output tokens
const MIN_TOKENS = 2000;
const MAX_TOKENS = 8000;

const SYSTEM = `You are Songfit's music supervisor. You score candidate song sections against a specific
short-form video. Be decisive and discriminating: use the full 0–1 range, do not give everything 0.7.
A 1.0 means "this is exactly the song a great editor would pick"; a 0.2 means "clearly wrong".
Reasons are at most 12 words. You must return one object for EVERY candidate index.`;

const DIMENSION_DEFINITIONS: Record<ModelDimension, string> = {
  semantic: "Does the song make sense for what is literally happening in the video (subject, setting, story)?",
  emotional: "Does the emotional character of this section match or productively contrast the video's feel and the creator's intent?",
  aesthetic: "Does the sound match the visual world (luxury vs raw, modern vs retro, polished vs lo-fi)?",
  pacing: "Do the energy and rhythm of this section fit the edit's pace and cuts, and does its musical moment land near the key moment?",
  cultural: "Would this creator realistically use this song on Instagram or TikTok right now, given their niche and audience?",
  originality: "Is it good without being painfully obvious or exhausted?",
};

const Item = z.object({ index: z.number().int().min(0) }).and(
  z.object(Object.fromEntries(MODEL_DIMENSIONS.map((d) => [d, ComponentScore])) as Record<ModelDimension, typeof ComponentScore>),
);

export function buildScoringPrompt(analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[]): string {
  const defs = MODEL_DIMENSIONS.map((d) => `- ${d}: ${DIMENSION_DEFINITIONS[d]}`).join("\n");
  const list = cands
    .map((c, i) => `${i}. "${c.canonical_title}" — ${c.canonical_artist} | section ${c.proposed_start}s–${c.proposed_end}s, anchor ${c.anchor_seconds}s | ${c.section_reason} | proposed because: ${c.fit_reason}`)
    .join("\n");
  const moments = analysis.important_moments.map((m) => `${m.time}s ${m.type}`).join("; ") || "none";
  return `VIDEO
${analysis.summary}
Category: ${analysis.content_category}. Aesthetic: ${analysis.aesthetic.join(", ")}. Mood: ${analysis.mood.join(", ")}.
Energy ${analysis.energy}, pacing ${analysis.pacing}. Dialogue: ${analysis.dialogue_present ? "yes" : "no"}. Key moments: ${moments}.

MUSIC BRIEF
${brief.text}

DIMENSIONS (score each 0–1, reason ≤ 12 words)
${defs}

CANDIDATES (${cands.length}; return exactly ${cands.length} objects, indexes 0–${cands.length - 1})
${list}

Return ONLY a JSON array with one object per candidate:
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
  const user = buildScoringPrompt(analysis, brief, cands);
  const maxTokens = Math.min(MAX_TOKENS, Math.max(MIN_TOKENS, cands.length * TOKENS_PER_ITEM));
  const started = Date.now();
  const first = await call({ model: MODELS.scoring, system: SYSTEM, user, maxTokens, timeoutMs });
  const r1 = parseScores(first, cands.length);
  if (r1.ok) {
    logger.info("scoring", { ms: Date.now() - started, candidates: cands.length, chars: first.length });
    return r1.scores;
  }
  logger.warn("scoring.retry", { error: r1.error.slice(0, 300) });
  const retryUser = `${user}\n\nPREVIOUS OUTPUT WAS INVALID. Validation error:\n${r1.error.slice(0, 2000)}\nReturn the full corrected JSON array with every index.`;
  const second = await call({ model: MODELS.scoring, system: SYSTEM, user: retryUser, maxTokens, timeoutMs });
  const r2 = parseScores(second, cands.length);
  if (r2.ok) return r2.scores;
  throw new PipelineError("recommend", `scoring output invalid: ${r2.error.slice(0, 200)}`, second);
}

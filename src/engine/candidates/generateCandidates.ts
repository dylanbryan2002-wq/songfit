// src/engine/candidates/generateCandidates.ts
import { z } from "zod";
import {
  GeneratedCandidate, DirectionTag, type MusicBrief, type VideoAnalysis,
} from "@/src/shared/types";
import { MODELS, LIMITS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { remainingBudget, type StageCtx } from "@/src/pipeline/budget";
import { normalizeKey } from "@/src/engine/catalog/normalize";

export const PROMPT_VERSION = "candidates-v1";

export type GenerateOpts = { note?: string; exclude?: string[]; call?: ClaudeCall; ctx?: StageCtx };

const SYSTEM = `You are Songfit's music supervisor for short-form video (Instagram Reels, TikTok).
You know mainstream, independent and viral music across decades, and you know which songs
creators actually use on these platforms. You only ever name REAL, officially released songs by
the original artist that are very likely available in the Instagram and TikTok music libraries
in the United States. Never invent songs. Never suggest AI-generated music, unreleased tracks,
remixes by unknown accounts, or production-library stock music. Name the original studio
recording, not a live, sped-up, slowed, acoustic or remix version.`;

const DIRECTION_BRIEF: Record<DirectionTag, string> = {
  safe: "Recognisable, proven fits for this kind of content: songs a creator in this niche has seen work many times. Mainstream enough to be in both libraries.",
  current: "Songs you believe have been popular on Instagram Reels and TikTok within the last 12 months, or trending-adjacent artists having a moment. Still real, released and easy to find. You are not told what is trending today; use your best knowledge.",
  unexpected: "Less obvious: older songs, niche genres, deep cuts from known artists, genre-crossing picks that a tasteful editor would reach for. Must still be real, released and findable in the libraries.",
};

export function buildCandidatePrompt(
  direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis,
  opts: { note?: string; exclude?: string[] } = {},
): string {
  const moments = analysis.important_moments
    .map((m) => `- ${m.time.toFixed(1)}s: ${m.type}${m.note ? ` (${m.note})` : ""}`)
    .join("\n") || "- none identified";
  const exclude = opts.exclude?.length
    ? `\nDO NOT propose any of these (title|artist keys): ${opts.exclude.join("; ")}\n`
    : "";
  return `DIRECTION: ${direction}
${DIRECTION_BRIEF[direction]}

VIDEO
${analysis.summary}
Content type: ${analysis.content_type} (${analysis.content_category})
Setting: ${analysis.setting ?? "unknown"}
Story: ${analysis.story ?? "none"}
Aesthetic: ${analysis.aesthetic.join(", ")}
Mood: ${analysis.mood.join(", ")}
Energy: ${analysis.energy}. Pacing: ${analysis.pacing}.
Spoken dialogue present: ${analysis.dialogue_present ? "YES — sung vocals will compete with the speech; prefer sections without lead vocals" : "no"}
Key moments:
${moments}

MUSIC BRIEF
${brief.text}
Fields: ${JSON.stringify(brief.fields)}
${opts.note ? `\nNOTE: ${opts.note}\n` : ""}${exclude}
TASK
Propose exactly ${LIMITS.candidatesPerDirection} songs for this direction. For each song choose the single
best ${LIMITS.sectionMin}–${LIMITS.sectionMax} second window of the ORIGINAL studio recording for this video.
- anchor_seconds: the second where the song's defining musical moment happens inside that window
  (chorus entry, drop, the lift). Be as accurate as you can; if unsure, say so in section_reason.
- proposed_start / proposed_end: the window, in seconds, containing anchor_seconds.
- section_is_vocal: true if lead vocals are singing during most of the window.

Return ONLY a JSON array, no prose, each item exactly:
{
  "title": string,
  "artist": string,
  "proposed_start": number,
  "proposed_end": number,
  "anchor_seconds": number,
  "section_is_vocal": boolean,
  "section_reason": string,   // what happens musically at the anchor and across the window (one sentence)
  "fit_reason": string        // why it fits THIS video, referencing something specific in it (one sentence)
}`;
}

const Item = GeneratedCandidate.omit({ directions: true });
// C1: a direction that comes back with far fewer songs than asked is treated as invalid output
// (the model truncated or refused), retried once, then fails the stage. Never silently accept a short list.
const MIN_PER_DIRECTION = LIMITS.candidatesPerDirection - 5;
const ItemList = z.array(Item).min(MIN_PER_DIRECTION, { message: `Array must contain at least ${MIN_PER_DIRECTION} element(s)` });

export function parseCandidateList(
  text: string, direction: DirectionTag,
): { ok: true; items: GeneratedCandidate[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "no JSON found" };
  }
  const parsed = ItemList.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, items: parsed.data.map((i) => ({ ...i, directions: [direction] })) };
}

export function mergeCandidates(lists: GeneratedCandidate[][]): GeneratedCandidate[] {
  const byKey = new Map<string, GeneratedCandidate>();
  for (const list of lists) {
    for (const c of list) {
      const key = normalizeKey(c.title, c.artist);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...c, directions: [...c.directions] });
        continue;
      }
      for (const d of c.directions) if (!existing.directions.includes(d)) existing.directions.push(d);
    }
  }
  return [...byKey.values()];
}

async function generateDirection(
  direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis, opts: GenerateOpts, call: ClaudeCall,
): Promise<GeneratedCandidate[]> {
  const user = buildCandidatePrompt(direction, brief, analysis, opts);
  const timeoutMs = remainingBudget(opts.ctx);
  const started = Date.now();
  const first = await call({ model: MODELS.candidates, system: SYSTEM, user, maxTokens: 6000, timeoutMs });
  const r1 = parseCandidateList(first, direction);
  if (r1.ok) {
    logger.info("candidates.generated", { direction, count: r1.items.length, ms: Date.now() - started });
    return r1.items;
  }
  logger.warn("candidates.retry", { direction, error: r1.error.slice(0, 300) });
  const retryUser = `${user}\n\nPREVIOUS OUTPUT WAS INVALID. Validation error:\n${r1.error.slice(0, 2000)}\nReturn the full corrected JSON array.`;
  const second = await call({ model: MODELS.candidates, system: SYSTEM, user: retryUser, maxTokens: 6000, timeoutMs });
  const r2 = parseCandidateList(second, direction);
  if (r2.ok) {
    logger.info("candidates.generated", { direction, count: r2.items.length, ms: Date.now() - started });
    return r2.items;
  }
  throw new PipelineError("recommend", "candidate output invalid", second);
}

export async function generateCandidates(
  brief: MusicBrief, analysis: VideoAnalysis, opts: GenerateOpts = {},
): Promise<GeneratedCandidate[]> {
  const call = opts.call ?? callClaude;
  const lists = await Promise.all(
    DirectionTag.options.map((direction) => generateDirection(direction, brief, analysis, opts, call)),
  );
  return mergeCandidates(lists);
}

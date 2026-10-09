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
import type { CreatorPick } from "@/src/engine/catalog/creatorLists";

export const PROMPT_VERSION = "candidates-v6";
/** Prompt variant used when creatorPicks are passed (experiment B, docs/review/24 v3). Production does not pass them yet. */
export const CREATOR_PICKS_PROMPT_VERSION = "candidates-v7-picks";

export type GenerateOpts = {
  note?: string; exclude?: string[]; call?: ClaudeCall; ctx?: StageCtx;
  /** Songs creator lists recommend for this kind of video; offered in the safe direction only. */
  creatorPicks?: CreatorPick[];
  /** Generate only these directions (eval harness); default all three. */
  directions?: DirectionTag[];
};

export const SYSTEM_PROMPT = `You are Songfit's music supervisor for short-form video (Instagram Reels, TikTok).
You know mainstream, independent and viral music across decades, and you know which songs
creators actually use on these platforms. You only ever name REAL, officially released songs by
the original artist that are very likely available in the Instagram and TikTok music libraries
in the United States. Never invent songs. Never suggest AI-generated music, unreleased tracks,
remixes by unknown accounts, or production-library stock music. Name the original studio
recording, not a live, sped-up, slowed, acoustic or remix version.
When the caption, the story or the creator's note in the brief names a concrete thing (money, work, birthday, waiting, searching), include several songs whose title or hook says it.
If the brief names a song or artist from the creator, include that exact song if real and use it as the reference; at most 3 songs by a named artist.
Name the songs creators on Reels and TikTok have actually used for this kind of moment in the last two years, including the heavily used ones. Do not swap them for a tasteful cousin.
When the song carries the edit (no spoken dialogue: a punchline, a reveal, a montage), a famous, even overused song that fits the joke or the drop beats a tasteful obscure one; creators pick the obvious song on purpose. "Not overused" only matters when someone is talking.
When someone is talking over the music (spoken dialogue present), the right pick is often a quiet instrumental bed that stays under the voice: lo-fi, ambient, neo-classical, film-score cues. Name real tracks of that kind, e.g. Bliss by klsr, Her by The American Dawn, Every Living Breathing Moment by Grant Steller, On the Nature of Daylight by Max Richter.`;

const DIRECTION_BRIEF: Record<DirectionTag, string> = {
  safe: "Recognisable, proven fits for this kind of content: songs a creator in this niche has seen work many times. Mainstream enough to be in both libraries.",
  current: "Songs released or re-popularised in the most recent ~18 months you have knowledge of. Nothing released before 2024 unless it had a well-known 2024+ TikTok/Reels resurgence. Never older catalogue labelled as current.",
  unexpected: "Less obvious: older songs, niche genres, deep cuts from known artists, genre-crossing picks that a tasteful editor would reach for. Must still be real, released and findable in the libraries. Not meme-standard ironic picks (Careless Whisper, Mad World, Eye of the Tiger, Hallelujah, All By Myself, My Heart Will Go On, I Will Always Love You); a creator has seen those used for this joke hundreds of times, unless the video is a punchline and that exact song is the joke.",
};

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
function humanizeKey(key: string): string {
  const [title = "", artist = "", version] = key.split("|");
  return `${titleCase(title)} — ${titleCase(artist)}${version ? ` (${version})` : ""}`;
}

export function buildCandidatePrompt(
  direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis,
  opts: { note?: string; exclude?: string[]; creatorPicks?: CreatorPick[] } = {},
): string {
  const moments = analysis.important_moments
    .map((m) => `- ${m.time.toFixed(1)}s: ${m.type}${m.note ? ` (${m.note})` : ""}`)
    .join("\n") || "- none identified";
  const exclude = opts.exclude?.length
    ? `\nDo NOT propose these songs (already considered):\n${opts.exclude.map((k) => `- ${humanizeKey(k)}`).join("\n")}\n`
    : "";
  const picks = direction === "safe" && opts.creatorPicks?.length
    ? `\nCREATOR PICKS
Creators who teach background music for Reels recommend these songs for ${[...new Set(opts.creatorPicks.flatMap((p) => p.types))].join(" / ").replace(/_/g, " ")} videos with someone talking:
${opts.creatorPicks.map((p) => `- ${p.title} — ${p.artist}`).join("\n")}
Include the ones that genuinely fit this video, with a truthful window; skip the rest. They count toward the ${LIMITS.candidatesPerDirection}.\n`
    : "";
  return `DIRECTION: ${direction}
${DIRECTION_BRIEF[direction]}

VIDEO
${analysis.summary}
Duration: ${analysis.duration_seconds != null ? `${analysis.duration_seconds.toFixed(1)}s` : "unknown"}
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
${opts.note ? `\nNOTE: ${opts.note}\n` : ""}${exclude}${picks}
TASK
Propose exactly ${LIMITS.candidatesPerDirection} songs for this direction. For each song choose the single
best ${LIMITS.sectionMin}–${LIMITS.sectionMax} second window of the ORIGINAL studio recording for this video.
- anchor_seconds: the second where the song's defining musical moment happens inside that window
  (chorus entry, drop, the lift). Be as accurate as you can; if unsure, say so in section_reason.
- proposed_start / proposed_end: seconds from the start of the track; the window must be ${LIMITS.sectionMin}–${LIMITS.sectionMax} seconds long
  (proposed_end − proposed_start between ${LIMITS.sectionMin} and ${LIMITS.sectionMax}); anchor_seconds must lie inside the window.
- Do not list the same song twice.
- section_is_vocal: true if lead vocals are singing during most of the window.
- section_reason and fit_reason: at most 18 words each. Be specific, not flowery.
- The creator only hears the first part of the window, roughly the video's length (see the brief). For videos under 10 s, the hook, vocal entry or riff must start within 2 s of proposed_start; never pick a window that opens on a long intro or verse. Only name a lyric in section_reason if you are certain it is sung inside the window. If you don't know where a song's chorus sits in the original recording, choose a different song.

Return ONLY a compact JSON array on one line (no indentation, no line breaks), no prose, each item exactly:
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

// 25 items × ~120 compact tokens ≈ 3000; the cap leaves 4× headroom. The first real run (2026-10-07)
// hit 6000 at ~240 tokens/item with pretty-printed JSON and long reasons, which is why the prompt now
// demands compact output and short reasons.
const CANDIDATE_MAX_TOKENS = 12_000;
// Measured 2026-10-07 on the same brief: default effort 76 s / 10.3k output tokens, medium 21 s / 3.2k,
// low 21 s / 3.2k but with lazy 0–14 s windows. Medium keeps the song and timing quality.
const CANDIDATE_EFFORT = "medium" as const;

const Item = GeneratedCandidate.omit({ directions: true });
// C1: a direction that comes back with far fewer songs than asked is treated as invalid output
// (the model truncated or refused), retried once, then fails the stage. Never silently accept a short list.
const MIN_PER_DIRECTION = LIMITS.candidatesPerDirection - 5;

export function parseCandidateList(
  text: string, direction: DirectionTag,
): { ok: true; items: GeneratedCandidate[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "no JSON found" };
  }
  const arr = z.array(z.unknown()).safeParse(raw);
  if (!arr.success) return { ok: false, error: arr.error.message };
  // One malformed row out of 25 cost a full 21 s retry on the first real run. Keep the valid rows and
  // only reject when too few remain (C1 still holds: a short or truncated list is invalid output).
  const items: GeneratedCandidate[] = [];
  const errors: string[] = [];
  arr.data.forEach((row, i) => {
    const p = Item.safeParse(row);
    if (p.success) items.push({ ...p.data, directions: [direction] });
    else errors.push(`item ${i}: ${p.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`);
  });
  if (items.length < MIN_PER_DIRECTION) {
    const detail = errors.length ? `\n${errors.slice(0, 5).join("\n")}` : "";
    return { ok: false, error: `Array must contain at least ${MIN_PER_DIRECTION} element(s); got ${items.length} valid${detail}` };
  }
  if (errors.length) logger.warn("candidates.dropped", { direction, dropped: errors.length, first: errors[0] });
  return { ok: true, items };
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
  const started = Date.now();
  let first: string;
  try {
    first = await call({ model: MODELS.candidates, system: SYSTEM_PROMPT, user, maxTokens: CANDIDATE_MAX_TOKENS, effort: CANDIDATE_EFFORT, timeoutMs: remainingBudget(opts.ctx) });
  } catch (e) {
    // About 1 run in 8 at medium effort spends the whole cap on hidden reasoning (docs/review/19, finding 6).
    // The wrapper throws before parseCandidateList runs; retry this one direction at low effort, same prompt.
    if (!(e instanceof Error && e.message.includes("truncated at max_tokens"))) throw e;
    logger.warn("candidates.truncated_retry", { direction, ms: Date.now() - started });
    first = await call({ model: MODELS.candidates, system: SYSTEM_PROMPT, user, maxTokens: CANDIDATE_MAX_TOKENS, effort: "low", timeoutMs: remainingBudget(opts.ctx) });
  }
  const r1 = parseCandidateList(first, direction);
  if (r1.ok) {
    logger.info("candidates.generated", { direction, count: r1.items.length, ms: Date.now() - started });
    return r1.items;
  }
  logger.warn("candidates.retry", { direction, error: r1.error.slice(0, 300) });
  const retryUser = `${user}\n\nPREVIOUS OUTPUT WAS INVALID. Validation error:\n${r1.error.slice(0, 2000)}\nReturn the full corrected JSON array.`;
  const second = await call({ model: MODELS.candidates, system: SYSTEM_PROMPT, user: retryUser, maxTokens: CANDIDATE_MAX_TOKENS, effort: CANDIDATE_EFFORT, timeoutMs: remainingBudget(opts.ctx) });
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
    (opts.directions ?? DirectionTag.options).map((direction) => generateDirection(direction, brief, analysis, opts, call)),
  );
  return mergeCandidates(lists);
}

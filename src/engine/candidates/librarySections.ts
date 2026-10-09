// Sections for library songs (docs/review/27 follow-up). The library knows WHICH songs suit the video; this one call picks
// WHERE in each song to start. It may not drop songs: the scorer decides which win. Songs it cannot place are left out
// rather than invented (unknown recordings).
import { z } from "zod";
import type { DirectionTag, GeneratedCandidate, MusicBrief, VideoAnalysis } from "@/src/shared/types";
import { LIMITS, MODELS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { logger } from "@/src/shared/logger";
import type { LibrarySong } from "@/src/engine/catalog/libraryMatch";

export const LIBRARY_SECTIONS_PROMPT_VERSION = "library-sections-v1";

const SYSTEM = `You are Songfit's music editor. For each listed song, choose the single best ${LIMITS.sectionMin}–${LIMITS.sectionMax} second window
of the ORIGINAL studio recording for this short-form video. Give a window for every song you know; skip only songs you do not
know well enough to place (never invent a section). Reply with one JSON array only.`;

const Item = z.object({
  i: z.number().int().min(0),
  proposed_start: z.number().min(0),
  proposed_end: z.number().min(0),
  anchor_seconds: z.number().min(0),
  section_is_vocal: z.boolean(),
  section_reason: z.string(),
  fit_reason: z.string(),
});

/** Direction label for the picker: recent songs are "current", niche ones "unexpected", the rest "safe". */
export function directionFor(s: LibrarySong, now = new Date().getFullYear()): DirectionTag {
  if (s.year && s.year >= now - 2) return "current";
  if (s.fam === "niche") return "unexpected";
  return "safe";
}

export function buildLibrarySectionsPrompt(analysis: VideoAnalysis, brief: MusicBrief, songs: LibrarySong[], job: string): string {
  const moments = analysis.important_moments.map((m) => `- ${m.time.toFixed(1)}s: ${m.type}${m.note ? ` (${m.note})` : ""}`).join("\n") || "- none identified";
  return `VIDEO
${analysis.summary}
Duration: ${analysis.duration_seconds != null ? `${analysis.duration_seconds.toFixed(1)}s` : "unknown"}. Energy ${analysis.energy}, pacing ${analysis.pacing}.
Spoken dialogue present: ${analysis.dialogue_present ? "yes" : "no"}. Music's job: ${job}.
Key moments:
${moments}

MUSIC BRIEF
${brief.text}

SONGS
${songs.map((s, i) => `${i}. ${s.title} — ${s.artist}${s.year ? ` (${s.year})` : ""}`).join("\n")}

For each song: proposed_start / proposed_end in seconds from the start of the track (window ${LIMITS.sectionMin}–${LIMITS.sectionMax} s), anchor_seconds = the
song's defining moment inside the window (chorus entry, drop, lift), section_is_vocal = lead vocals during most of the window,
section_reason and fit_reason at most 18 words each. For videos under 10 s the hook must start within 2 s of proposed_start.
Return ONLY a compact JSON array, one object per song you can place: {"i","proposed_start","proposed_end","anchor_seconds","section_is_vocal","section_reason","fit_reason"}`;
}

export async function librarySections(
  analysis: VideoAnalysis, brief: MusicBrief, songs: LibrarySong[], job: string,
  opts: { call?: ClaudeCall; timeoutMs?: number } = {},
): Promise<GeneratedCandidate[]> {
  if (songs.length === 0) return [];
  const call = opts.call ?? callClaude;
  const text = await call({ model: MODELS.candidates, system: SYSTEM, user: buildLibrarySectionsPrompt(analysis, brief, songs, job), maxTokens: 8000, effort: "low", ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
  let raw: unknown;
  try { raw = extractJson(text); } catch (e) { throw new Error(`library sections: no JSON (${e instanceof Error ? e.message : String(e)})\n--- model text ---\n${text}`); }
  const rows = z.array(z.unknown()).safeParse(raw);
  if (!rows.success) throw new Error(`library sections: not an array\n--- model text ---\n${text}`);
  const out: GeneratedCandidate[] = [];
  let bad = 0;
  for (const row of rows.data) {
    const p = Item.safeParse(row);
    const s = p.success ? songs[p.data.i] : undefined;
    if (!p.success || !s) { bad++; continue; }
    const { proposed_start, proposed_end, anchor_seconds, section_is_vocal, section_reason, fit_reason } = p.data;
    out.push({ title: s.title, artist: s.artist, proposed_start, proposed_end, anchor_seconds, section_is_vocal, section_reason, fit_reason, directions: [directionFor(s)], origin: "library" });
  }
  logger.info("candidates.library", { offered: songs.length, placed: out.length, bad, promptVersion: LIBRARY_SECTIONS_PROMPT_VERSION });
  return out;
}

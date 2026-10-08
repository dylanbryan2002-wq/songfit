/* Pure comparison of one clip's truth against our engine's output. See docs/review/18, step 5. */
import { artistsMatchLoose, coreTitle } from "../../src/engine/catalog/normalize";
import { PICKS_TOTAL } from "../../src/shared/config";
import type { MusicBrief, VideoAnalysis } from "../../src/shared/types";
import type { GeminiAnalysis } from "./gemini";

export type Truth = { song: string; artist: string; start_seconds: number };

/** The slices of an engine run that the comparison reads. Candidates are the rows the engine would store (CandidateInsert). */
export type OursSummary = {
  generated: { title: string; artist: string }[];
  candidates: { title: string; artist: string; canonical_title?: string | null; canonical_artist?: string | null; verified?: boolean; total_score?: number | null }[];
  finals: { rank: number; canonical_title: string; canonical_artist: string; start_seconds: number }[];
};

export const STAGES = ["not_generated", "unverified", "scored_out", "diversified_out"] as const;
export type Stage = (typeof STAGES)[number];

export type Verdict = {
  result: "hit" | "artist_hit" | "miss";
  lost_at: Stage | null; // null on a hit
  rank: number | null; // on a hit
  our_start_seconds: number | null; // on a hit
  section_error_seconds: number | null; // |our start − real start| on a hit
  matched: { title: string; artist: string } | null; // the final that made it a hit or artist hit
};

/** Loose: core title (parenthetical descriptors ignored) and at least one shared artist token. */
function sameSong(truth: Truth, c: { title: string; artist: string }): boolean {
  return coreTitle(c.title) === coreTitle(truth.song) && artistsMatchLoose(truth.artist, c.artist);
}

const named = (c: OursSummary["candidates"][number]) =>
  ({ title: c.canonical_title ?? c.title, artist: c.canonical_artist ?? c.artist });

/** First stage where the real song is missing: generated → verified → top 15 by score → finals. */
function lostAt(truth: Truth, ours: OursSummary): Stage | null {
  if (!ours.generated.some((c) => sameSong(truth, c))) return "not_generated";
  const verified = ours.candidates.filter((c) => c.verified);
  if (!verified.some((c) => sameSong(truth, named(c)) || sameSong(truth, c))) return "unverified";
  const byScore = [...verified].sort((a, b) => (b.total_score ?? -1) - (a.total_score ?? -1)).slice(0, PICKS_TOTAL);
  if (!byScore.some((c) => sameSong(truth, named(c)) || sameSong(truth, c))) return "scored_out";
  return "diversified_out";
}

export function compareClip(truth: Truth, ours: OursSummary): Verdict {
  const finals = [...ours.finals].sort((a, b) => a.rank - b.rank);
  const asSong = (f: OursSummary["finals"][number]) => ({ title: f.canonical_title, artist: f.canonical_artist });
  const hit = finals.find((f) => sameSong(truth, asSong(f)));
  if (hit) {
    return {
      result: "hit", lost_at: null, rank: hit.rank, our_start_seconds: hit.start_seconds,
      section_error_seconds: Math.abs(hit.start_seconds - truth.start_seconds), matched: asSong(hit),
    };
  }
  const artistHit = finals.find((f) => artistsMatchLoose(truth.artist, f.canonical_artist));
  return {
    result: artistHit ? "artist_hit" : "miss", lost_at: lostAt(truth, ours), rank: null,
    our_start_seconds: null, section_error_seconds: null, matched: artistHit ? asSong(artistHit) : null,
  };
}

export type Briefed = { analysis: VideoAnalysis; brief: MusicBrief };

export type BriefDiff = ReturnType<typeof briefDiff>;

/** Our analysis beside Gemini's (with sound), field by field. Judgement is left to the reader. */
export function briefDiff(ours: Briefed, gemini: GeminiAnalysis) {
  const geminiMoods = new Set(gemini.mood.map((m) => m.toLowerCase()));
  return {
    energy: { ours: ours.analysis.energy, gemini: gemini.energy },
    pacing: { ours: ours.analysis.pacing, gemini: gemini.pacing },
    category: { ours: ours.analysis.content_category, gemini: gemini.content_category },
    mood: { ours: ours.analysis.mood, gemini: gemini.mood, shared: ours.analysis.mood.filter((m) => geminiMoods.has(m.toLowerCase())) },
    moments: { ours: ours.analysis.important_moments.map((m) => m.time), gemini: gemini.key_moments.map((m) => m.time) },
    brief_energy: { ours: ours.brief.fields.energy, gemini: gemini.brief.energy },
    tempo: { ours: ours.brief.fields.tempo_preference, gemini: gemini.brief.tempo },
    vocals: { ours: ours.brief.fields.vocal_preference, gemini: gemini.brief.vocals },
  };
}

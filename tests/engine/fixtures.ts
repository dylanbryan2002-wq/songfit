// tests/engine/fixtures.ts
import type { MusicBrief, VideoAnalysis, GeneratedCandidate, VerifiedCandidate, ScoredCandidate, Pick } from "@/src/shared/types";

export const analysis: VideoAnalysis = {
  summary: "Creator walks through NYC at night and reveals an outfit.",
  content_type: "fashion lifestyle reel", content_category: "fashion",
  setting: "New York at night", story: "walk then reveal",
  aesthetic: ["luxury", "urban"], mood: ["confident", "mysterious"],
  energy: "medium-high", pacing: "medium", dialogue_present: false,
  important_moments: [{ time: 7.8, type: "main_visual_reveal", note: "outfit reveal" }],
};

export const brief: MusicBrief = {
  text: "Modern NYC fashion montage. Confident and slightly mysterious. Needs a lift around 8 s.",
  fields: {
    moods: ["confident", "cool"], energy: 0.72, tempo_preference: "medium-high",
    vocal_preference: "either", genre_preferences: [], genre_avoid: [],
    dialogue_present: false, desired_cultural_relevance: "high",
    desired_familiarity: "recognizable_not_overused",
  },
};

export const gen = (over: Partial<GeneratedCandidate> = {}): GeneratedCandidate => ({
  title: "Blinding Lights", artist: "The Weeknd", proposed_start: 43, proposed_end: 58,
  anchor_seconds: 45, section_is_vocal: true, section_reason: "chorus entry",
  fit_reason: "fits the night drive", directions: ["safe"], ...over,
});

export const ver = (over: Partial<VerifiedCandidate> = {}): VerifiedCandidate => {
  const base: VerifiedCandidate = {
    ...gen(), verified_via: "deezer", catalog_key: "", deezer_id: "1", itunes_id: null,
    canonical_title: "Blinding Lights", canonical_artist: "The Weeknd",
    duration_seconds: 200, artwork_url: null, deezer_url: "https://www.deezer.com/track/1", preview_url: null, ...over,
  };
  // catalog_key follows the overridden ids unless given explicitly.
  const key = base.verified_via === "itunes" ? `itunes:${base.itunes_id}` : `deezer:${base.deezer_id}`;
  return { ...base, catalog_key: over.catalog_key ?? key };
};

const one = { score: 0.7, reason: "r" };
export const scored = (over: Partial<ScoredCandidate> = {}): ScoredCandidate => ({
  ...ver(over), total_score: 0.7,
  component_scores: { semantic: one, emotional: one, aesthetic: one, pacing: one, dialogue: one, cultural: one, originality: one },
  ...over,
});

export const pick = (over: Partial<Pick> = {}): Pick => ({
  ...scored(over), rank: 1, direction_label: "Best fit", start_seconds: 43, end_seconds: 58, aligned_to_moment: null, ...over,
});

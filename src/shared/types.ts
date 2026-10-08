import { z } from "zod";

export const Energy = z.enum(["low", "medium", "medium-high", "high"]);
export const Pacing = z.enum(["slow", "medium", "fast"]);

export const ImportantMoment = z.object({
  time: z.number().min(0),
  type: z.string(), // e.g. "scene_change", "main_visual_reveal", "climax"
  note: z.string().optional(),
});
export type ImportantMoment = z.infer<typeof ImportantMoment>;

export const VideoAnalysis = z.object({
  summary: z.string(),
  content_type: z.string(), // free text, e.g. "fashion lifestyle reel"
  content_category: z.string(), // one of CONTENT_CATEGORIES in config.ts
  setting: z.string().nullable(),
  story: z.string().nullable(),
  aesthetic: z.array(z.string()),
  mood: z.array(z.string()),
  energy: Energy,
  pacing: Pacing,
  dialogue_present: z.boolean(),
  important_moments: z.array(ImportantMoment),
});
export type VideoAnalysis = z.infer<typeof VideoAnalysis>;

export const MusicBriefFields = z.object({
  moods: z.array(z.string()),
  energy: z.number().min(0).max(1),
  tempo_preference: z.enum(["slow", "medium", "medium-high", "high"]),
  vocal_preference: z.enum(["vocals", "instrumental", "either"]),
  genre_preferences: z.array(z.string()),
  genre_avoid: z.array(z.string()),
  dialogue_present: z.boolean(),
  desired_cultural_relevance: z.enum(["low", "medium", "high"]),
  desired_familiarity: z.enum(["recognizable", "recognizable_not_overused", "unexpected"]),
});
export type MusicBriefFields = z.infer<typeof MusicBriefFields>;

export const MusicBrief = z.object({ text: z.string(), fields: MusicBriefFields });
export type MusicBrief = z.infer<typeof MusicBrief>;

export const AnalysisResult = z.object({
  analysis: VideoAnalysis,
  brief: MusicBrief,
  transcript: z.string(),
  prompt_version: z.string(),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;

export const DirectionTag = z.enum(["safe", "current", "unexpected"]);
export type DirectionTag = z.infer<typeof DirectionTag>;
/** Labels for ranks 2–3 by primary direction. Rank 1 is ALWAYS BEST_FIT_LABEL regardless of direction. */
export const DIRECTION_LABEL: Record<DirectionTag, string> = {
  safe: "Safe bet",
  current: "More current",
  unexpected: "Unexpected",
};
export const BEST_FIT_LABEL = "Best fit";

export const GeneratedCandidate = z.object({
  title: z.string(),
  artist: z.string(),
  proposed_start: z.number().min(0),
  proposed_end: z.number().min(0),
  anchor_seconds: z.number().min(0), // the model's claimed musical hit (chorus entry, drop) inside the window
  section_is_vocal: z.boolean(), // does the proposed section carry lead vocals
  section_reason: z.string(),
  fit_reason: z.string(),
  directions: z.array(DirectionTag).min(1), // every generation direction that proposed it (dedupe keeps all)
});
export type GeneratedCandidate = z.infer<typeof GeneratedCandidate>;

export const VerifiedCandidate = GeneratedCandidate.extend({
  verified_via: z.enum(["deezer", "itunes"]),
  catalog_key: z.string(), // "deezer:<id>" or "itunes:<id>": THE identity of a verified recording
  deezer_id: z.string().nullable(), // null when verified via iTunes
  itunes_id: z.string().nullable(), // set only when verified via iTunes
  canonical_title: z.string(), // provider's title, stored verbatim
  canonical_artist: z.string(),
  duration_seconds: z.number(),
  artwork_url: z.string().nullable(),
  deezer_url: z.string().nullable(),
  preview_url: z.string().nullable(), // Deezer only; null when previews are disabled or verified via iTunes
});
export type VerifiedCandidate = z.infer<typeof VerifiedCandidate>;

export const DIMENSIONS = [
  "semantic",
  "emotional",
  "aesthetic",
  "pacing",
  "dialogue",
  "cultural",
  "originality",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const ComponentScore = z.object({ score: z.number().min(0).max(1), reason: z.string() });
export type ComponentScore = z.infer<typeof ComponentScore>;
export type ComponentScores = Record<Dimension, ComponentScore>;

export const ScoredCandidate = VerifiedCandidate.extend({
  component_scores: z.record(z.enum(DIMENSIONS), ComponentScore),
  total_score: z.number(),
});
export type ScoredCandidate = z.infer<typeof ScoredCandidate>;

export const Pick = ScoredCandidate.extend({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  direction_label: z.string(), // rank 1 is always "Best fit"; ranks 2–3 get DIRECTION_LABEL of their primary direction
  start_seconds: z.number(),
  end_seconds: z.number(),
  aligned_to_moment: z.number().nullable(), // video time T the anchor was aligned to, or null when no alignment was claimed
});
export type Pick = z.infer<typeof Pick>;

export const FinalRecommendation = Pick.extend({
  explanation: z.string(),
  spotify_url: z.string(),
  itunes_id: z.string().nullable(),
});
export type FinalRecommendation = z.infer<typeof FinalRecommendation>;

/** The ONLY shape sent to the browser. No scores, reasons, directions or provider internals. */
export const RecommendationView = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  direction_label: z.string(),
  title: z.string(),
  artist: z.string(),
  start_seconds: z.number(),
  end_seconds: z.number(),
  explanation: z.string(),
  artwork_url: z.string().nullable(),
  preview_url: z.string().nullable(),
  spotify_url: z.string(),
  selected: z.boolean(),
  rejected: z.boolean(),
});
export type RecommendationView = z.infer<typeof RecommendationView>;

/** Song-picker row. `preview_url` is filled per request by loadPicker and never stored (Deezer terms). */
export const PickerRow = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  direction_label: z.string(),
  title: z.string(),
  artist: z.string(),
  start_seconds: z.number(),
  end_seconds: z.number(),
  explanation: z.string(),
  artwork_url: z.string().nullable(),
  spotify_url: z.string(),
  deezer_url: z.string().nullable(),
  deezer_id: z.string().nullable(),
  preview_url: z.string().nullable(),
  selected: z.boolean(),
  rejected: z.boolean(),
});
export type PickerRow = z.infer<typeof PickerRow>;

export const PickerData = z.object({
  submission_id: z.string(),
  video_duration_seconds: z.number().nullable(),
  rows: z.array(PickerRow),
});
export type PickerData = z.infer<typeof PickerData>;

export const SubmissionStatus = z.enum(["uploaded", "analyzing", "recommending", "ready", "failed"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;

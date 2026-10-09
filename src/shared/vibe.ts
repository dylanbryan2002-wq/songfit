import { z } from "zod";

/** Stored "How should it feel?" tags, in display order. Stored verbatim. The UI shows the three
 *  Storytelling tags as sub-chips under one "Storytelling" chip; that chip is never a tag.
 *  "Day in the Life" and "Travel" were removed 2026-10-08; rows written earlier keep them. */
export const STORYTELLING_TAGS = ["Positive Storytelling", "Emotional Storytelling", "Sad Storytelling"] as const;
export const VIBE_TAGS = [
  "Funny", "Emotional", "Motivational", "Energetic", "Romantic", "Deep", "Nostalgic", "Educational", "Challenge",
  ...STORYTELLING_TAGS,
] as const;
export type VibeTag = (typeof VIBE_TAGS)[number];

export const VIBE_MAX_TAGS = 3;
/** The "Anything else?" note, stored in submissions.creator_intent. */
export const VIBE_NOTE_MAX = 140;

const vibeTag = z.string().refine((t) => (VIBE_TAGS as readonly string[]).includes(t), { message: "unknown vibe tag" });

/** Known chips, deduped, at most 3. */
export const VibeTags = z
  .array(vibeTag)
  .default([])
  .transform((tags) => [...new Set(tags)])
  .refine((tags) => tags.length <= VIBE_MAX_TAGS, { message: `at most ${VIBE_MAX_TAGS} vibe tags` });

/** Trimmed note; blank becomes null. */
export const VibeNote = z
  .string()
  .trim()
  .max(VIBE_NOTE_MAX)
  .nullable()
  .optional()
  .transform((n) => n || null);

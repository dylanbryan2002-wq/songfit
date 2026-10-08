import { z } from "zod";

/** "What's the vibe?" chips in display order, in groups separated by spacing only. Stored verbatim. */
export const VIBE_GROUPS = [
  ["Funny", "Emotional", "Motivational", "Energetic", "Romantic", "Deep", "Nostalgic"],
  ["Day in the Life", "Travel", "Educational", "Challenge"],
  ["Positive Storytelling", "Emotional Storytelling", "Sad Storytelling"],
] as const;
export const VIBE_TAGS = VIBE_GROUPS.flat();
export type VibeTag = (typeof VIBE_GROUPS)[number][number];

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

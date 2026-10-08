import { z } from "zod";

/** "What's the vibe?" chips, in display order. Stored verbatim in submissions.vibe_tags. */
export const VIBE_TAGS = [
  "Emotional",
  "Educational",
  "Challenge",
  "Emotional Storytelling",
  "Deep",
  "Funny",
  "Motivational",
  "Day in the Life",
  "Energetic",
  "Positive Storytelling",
  "Sad Storytelling",
  "Romantic",
  "Chill",
  "Nostalgic",
  "Travel",
] as const;
export type VibeTag = (typeof VIBE_TAGS)[number];

export const VIBE_NOTE_MAX = 140;

/** The creator's own description: known chips (deduped) and a trimmed note (blank → null). */
export const VibeInput = z.object({
  vibe_tags: z
    .array(z.enum(VIBE_TAGS))
    .default([])
    .transform((tags): string[] => [...new Set(tags)]),
  vibe_note: z
    .string()
    .trim()
    .max(VIBE_NOTE_MAX)
    .nullable()
    .default(null)
    .transform((n) => n || null),
});
export type VibeInput = z.infer<typeof VibeInput>;

export function hasVibe(v: VibeInput): boolean {
  return v.vibe_tags.length > 0 || v.vibe_note !== null;
}

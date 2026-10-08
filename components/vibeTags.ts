import { VIBE_MAX_TAGS, VIBE_TAGS } from "@/src/shared/vibe";

/**
 * Toggles one chip, keeping display order. When 3 are already picked, tapping another returns the
 * SAME array (the caller shows "Up to 3"); a pick is never swapped out silently.
 */
export function toggleVibeTag(tags: string[], tag: string): string[] {
  if (tags.includes(tag)) return tags.filter((t) => t !== tag);
  if (tags.length >= VIBE_MAX_TAGS) return tags;
  return VIBE_TAGS.filter((t) => t === tag || tags.includes(t));
}

/** Results echo under the video, e.g. "For your Funny · Educational video"; null without tags. */
export function vibeLine(tags: string[]): string | null {
  return tags.length > 0 ? `For your ${tags.join(" · ")} video` : null;
}

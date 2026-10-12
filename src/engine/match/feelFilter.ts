// Feel buttons as a hard filter (Dylan's rule; mapping approved 2026-10-11 from creator evidence and GEMS research).
// Several buttons: a song passes if it matches any of them. Too few songs left: relax step by step and never add
// opposite feelings. Step 1: high/medium labels. Step 2: also low/flagged labels. Step 3: one neighbour feeling per
// button, and unlabelled songs come back in. The caller logs the step when it is above 1.
import type { SongEntry } from "../catalog/dictionary";
import type { VibeTag } from "../../shared/vibe";

type Feeling = keyof SongEntry["feelings"];
export const BUTTON_FEELINGS: Record<VibeTag, Feeling[]> = {
  Funny: ["Funny", "Upbeat"],
  Emotional: ["Heartfelt", "Sad", "Reflective", "Dramatic"],
  Motivational: ["Motivational", "Inspirational", "Hype", "Dramatic"],
  Energetic: ["Hype", "Upbeat", "Motivational"],
  Romantic: ["Heartfelt"], // plus love/longing lyrics (below)
  Deep: ["Reflective", "Heartfelt", "Sad"],
  Nostalgic: ["Nostalgic"],
  Educational: ["Calm/Focused", "Upbeat", "Reflective", "Inspirational"],
  Challenge: ["Hype", "Dramatic", "Motivational"],
  "Positive Storytelling": ["Upbeat", "Inspirational", "Motivational", "Hype"],
  "Emotional Storytelling": ["Heartfelt", "Reflective", "Dramatic", "Sad"],
  "Sad Storytelling": ["Sad", "Heartfelt", "Reflective", "Nostalgic"],
};
/** One neighbour feeling per button for step 3 (Funny, Romantic, Deep, Energetic from the research; the rest are defaults). */
const NEIGHBOUR: Record<VibeTag, Feeling> = {
  Funny: "Heartfelt", Emotional: "Nostalgic", Motivational: "Upbeat", Energetic: "Dramatic", Romantic: "Nostalgic",
  Deep: "Calm/Focused", Nostalgic: "Reflective", Educational: "Heartfelt", Challenge: "Upbeat",
  "Positive Storytelling": "Funny", "Emotional Storytelling": "Nostalgic", "Sad Storytelling": "Dramatic",
};
const OPPOSITE: Partial<Record<VibeTag, Feeling[]>> = {
  Funny: ["Sad"], Energetic: ["Sad", "Calm/Focused"], Motivational: ["Sad"], Challenge: ["Sad", "Calm/Focused"], "Positive Storytelling": ["Sad"],
  Emotional: ["Funny", "Hype"], Deep: ["Funny", "Hype"], "Sad Storytelling": ["Funny", "Hype", "Upbeat"], "Emotional Storytelling": ["Funny", "Hype"],
};
const ROMANTIC_THEMES = new Set(["love", "longing"]);

function matches(s: SongEntry, tag: VibeTag, step: number): boolean {
  const ok = (f: Feeling) => {
    const c = s.feelings[f];
    return !!c && (step >= 2 || c === "high" || c === "medium");
  };
  const opposite = (OPPOSITE[tag] ?? []).some((f) => s.feelings[f] && s.feelings[f] !== "flagged");
  if (step > 1 && opposite) return false;
  if (tag === "Romantic" && s.theme && ROMANTIC_THEMES.has(s.theme)) return true;
  if (tag === "Romantic" && s.vocals !== "instrumental" && step < 3) return false; // Heartfelt counts for Romantic only as an instrumental
  if (BUTTON_FEELINGS[tag].some(ok)) return true;
  if (step >= 3) return ok(NEIGHBOUR[tag]) || Object.keys(s.feelings).length === 0;
  return false;
}

export function feelFilter(tags: string[], songs: SongEntry[], minCount: number): { songs: SongEntry[]; step: number } {
  const buttons = tags.filter((t): t is VibeTag => t in BUTTON_FEELINGS);
  if (!buttons.length) return { songs, step: 0 };
  let last: SongEntry[] = [];
  for (const step of [1, 2, 3]) {
    last = songs.filter((s) => buttons.some((b) => matches(s, b, step)));
    if (last.length >= minCount) return { songs: last, step };
  }
  return { songs: last, step: 3 };
}

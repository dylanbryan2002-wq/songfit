import { describe, it, expect } from "vitest";
import { VIBE_TAGS, VibeInput, hasVibe } from "@/src/shared/vibe";

describe("VibeInput", () => {
  it("lists the 15 chips in Dylan's order", () => {
    expect(VIBE_TAGS).toEqual([
      "Emotional", "Educational", "Challenge", "Emotional Storytelling", "Deep", "Funny", "Motivational",
      "Day in the Life", "Energetic", "Positive Storytelling", "Sad Storytelling", "Romantic", "Chill",
      "Nostalgic", "Travel",
    ]);
  });

  it("defaults to no tags and no note", () => {
    expect(VibeInput.parse({})).toEqual({ vibe_tags: [], vibe_note: null });
  });

  it("accepts known tags and dedupes them", () => {
    expect(VibeInput.parse({ vibe_tags: ["Funny", "Chill", "Funny"] }).vibe_tags).toEqual(["Funny", "Chill"]);
  });

  it("rejects an unknown tag", () => {
    expect(VibeInput.safeParse({ vibe_tags: ["Funny", "Spooky"] }).success).toBe(false);
  });

  it("trims the note, turns blank into null, and rejects over 140 chars", () => {
    expect(VibeInput.parse({ vibe_note: "  the song is the punchline  " }).vibe_note).toBe("the song is the punchline");
    expect(VibeInput.parse({ vibe_note: "   " }).vibe_note).toBeNull();
    expect(VibeInput.parse({ vibe_note: null }).vibe_note).toBeNull();
    expect(VibeInput.parse({ vibe_note: ` ${"a".repeat(140)} ` }).vibe_note).toHaveLength(140);
    expect(VibeInput.safeParse({ vibe_note: "a".repeat(141) }).success).toBe(false);
  });

  it("hasVibe is true only when tags or note are present", () => {
    expect(hasVibe({ vibe_tags: [], vibe_note: null })).toBe(false);
    expect(hasVibe({ vibe_tags: ["Deep"], vibe_note: null })).toBe(true);
    expect(hasVibe({ vibe_tags: [], vibe_note: "x" })).toBe(true);
  });
});

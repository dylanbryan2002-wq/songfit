import { describe, it, expect } from "vitest";
import { VIBE_TAGS, VibeNote, VibeTags } from "@/src/shared/vibe";

describe("vibe schemas", () => {
  it("lists the 14 chips in the mockup's order, without Chill", () => {
    expect(VIBE_TAGS).toEqual([
      "Funny", "Emotional", "Motivational", "Energetic", "Romantic", "Deep", "Nostalgic",
      "Day in the Life", "Travel", "Educational", "Challenge",
      "Positive Storytelling", "Emotional Storytelling", "Sad Storytelling",
    ]);
  });

  it("tags default to none, dedupe, and accept up to 3", () => {
    expect(VibeTags.parse(undefined)).toEqual([]);
    expect(VibeTags.parse(["Funny", "Travel", "Funny"])).toEqual(["Funny", "Travel"]);
    expect(VibeTags.parse(["Funny", "Travel", "Deep"])).toHaveLength(3);
  });

  it("rejects an unknown tag, Chill, and a 4th tag", () => {
    expect(VibeTags.safeParse(["Spooky"]).success).toBe(false);
    expect(VibeTags.safeParse(["Chill"]).success).toBe(false);
    expect(VibeTags.safeParse(["Funny", "Travel", "Deep", "Romantic"]).success).toBe(false);
  });

  it("note is trimmed, blank or missing becomes null, over 140 is rejected", () => {
    expect(VibeNote.parse("  the song is the punchline ")).toBe("the song is the punchline");
    expect(VibeNote.parse("   ")).toBeNull();
    expect(VibeNote.parse(null)).toBeNull();
    expect(VibeNote.parse(undefined)).toBeNull();
    expect(VibeNote.parse(` ${"a".repeat(140)} `)).toHaveLength(140);
    expect(VibeNote.safeParse("a".repeat(141)).success).toBe(false);
  });
});

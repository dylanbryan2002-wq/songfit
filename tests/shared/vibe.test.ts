import { describe, it, expect } from "vitest";
import { VIBE_TAGS, VibeNote, VibeTags } from "@/src/shared/vibe";

describe("vibe schemas", () => {
  it("lists the 12 chips in display order, without Chill, Day in the Life or Travel", () => {
    expect(VIBE_TAGS).toEqual([
      "Funny", "Emotional", "Motivational", "Energetic", "Romantic", "Deep", "Nostalgic",
      "Educational", "Challenge",
      "Positive Storytelling", "Emotional Storytelling", "Sad Storytelling",
    ]);
  });

  it("tags default to none, dedupe, and accept up to 3", () => {
    expect(VibeTags.parse(undefined)).toEqual([]);
    expect(VibeTags.parse(["Funny", "Educational", "Funny"])).toEqual(["Funny", "Educational"]);
    expect(VibeTags.parse(["Funny", "Educational", "Deep"])).toHaveLength(3);
  });

  it("rejects an unknown tag, Chill, removed tags, the Something else chip, and a 4th tag", () => {
    expect(VibeTags.safeParse(["Spooky"]).success).toBe(false);
    expect(VibeTags.safeParse(["Chill"]).success).toBe(false);
    expect(VibeTags.safeParse(["Day in the Life"]).success).toBe(false);
    expect(VibeTags.safeParse(["Travel"]).success).toBe(false);
    expect(VibeTags.safeParse(["Something else…"]).success).toBe(false);
    expect(VibeTags.safeParse(["Funny", "Educational", "Deep", "Romantic"]).success).toBe(false);
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

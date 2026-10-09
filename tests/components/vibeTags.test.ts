import { describe, it, expect } from "vitest";
import { storytellingOn, storytellingOpenAfterTap, toggleVibeTag, vibeLine } from "@/components/vibeTags";

describe("toggleVibeTag", () => {
  it("adds in display order and removes on a second tap", () => {
    const a = toggleVibeTag([], "Educational");
    const b = toggleVibeTag(a, "Funny");
    expect(b).toEqual(["Funny", "Educational"]);
    expect(toggleVibeTag(b, "Funny")).toEqual(["Educational"]);
  });

  it("at 3 picked, a 4th tap changes nothing and returns the same array", () => {
    const three = ["Funny", "Deep", "Educational"];
    expect(toggleVibeTag(three, "Romantic")).toBe(three);
    expect(toggleVibeTag(three, "Deep")).toEqual(["Funny", "Educational"]);
  });
});

describe("Storytelling sub-chips", () => {
  it("count toward the cap like any tag, and Storytelling itself is never a tag", () => {
    const three = ["Funny", "Deep", "Positive Storytelling"];
    expect(toggleVibeTag(three, "Sad Storytelling")).toBe(three);
    expect(toggleVibeTag(["Sad Storytelling"], "Funny")).toEqual(["Funny", "Sad Storytelling"]);
    expect(toggleVibeTag(["Funny"], "Storytelling")).toEqual(["Funny"]);
    expect(toggleVibeTag(["Funny"], "Something else…")).toEqual(["Funny"]);
  });

  it("parent is on while any sub-chip is on", () => {
    expect(storytellingOn([])).toBe(false);
    expect(storytellingOn(["Funny"])).toBe(false);
    expect(storytellingOn(["Emotional Storytelling"])).toBe(true);
  });

  it("tapping the parent opens, tapping again with none picked collapses, and it stays open while one is picked", () => {
    expect(storytellingOpenAfterTap(false, [])).toBe(true);
    expect(storytellingOpenAfterTap(true, [])).toBe(false);
    expect(storytellingOpenAfterTap(true, ["Sad Storytelling"])).toBe(true);
  });
});

describe("vibeLine", () => {
  it("joins tags with a middle dot, and is null without tags", () => {
    expect(vibeLine(["Funny", "Educational"])).toBe("For your Funny · Educational video");
    expect(vibeLine([])).toBeNull();
  });
});

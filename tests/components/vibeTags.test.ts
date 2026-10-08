import { describe, it, expect } from "vitest";
import { toggleVibeTag, vibeLine } from "@/components/vibeTags";

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

describe("vibeLine", () => {
  it("joins tags with a middle dot, and is null without tags", () => {
    expect(vibeLine(["Funny", "Educational"])).toBe("For your Funny · Educational video");
    expect(vibeLine([])).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { toggleVibeTag } from "@/components/vibeTags";

describe("toggleVibeTag", () => {
  it("adds in display order and removes on a second tap", () => {
    const a = toggleVibeTag([], "Travel");
    const b = toggleVibeTag(a, "Funny");
    expect(b).toEqual(["Funny", "Travel"]);
    expect(toggleVibeTag(b, "Funny")).toEqual(["Travel"]);
  });

  it("at 3 picked, a 4th tap changes nothing and returns the same array", () => {
    const three = ["Funny", "Deep", "Travel"];
    expect(toggleVibeTag(three, "Romantic")).toBe(three);
    expect(toggleVibeTag(three, "Deep")).toEqual(["Funny", "Travel"]);
  });
});

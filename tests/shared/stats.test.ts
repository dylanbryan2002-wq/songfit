import { describe, it, expect } from "vitest";
import { median } from "@/src/shared/stats";

describe("median", () => {
  it("returns null for empty input", () => expect(median([])).toBeNull());
  it("returns the middle of an odd list", () => expect(median([5, 1, 3])).toBe(3));
  it("averages the two middles of an even list", () => expect(median([1, 2, 3, 4])).toBe(2.5));
});

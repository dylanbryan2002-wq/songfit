import { describe, expect, it } from "vitest";
import { DEFAULT_MUSIC, DEFAULT_VOICE, clampPercent, percentToGain } from "@/src/picker/mix";

describe("mix defaults", () => {
  it("voice at full level, music under it at half", () => {
    expect(DEFAULT_VOICE).toBe(100);
    expect(DEFAULT_MUSIC).toBe(50);
    expect(percentToGain(DEFAULT_VOICE)).toBe(1);
    expect(percentToGain(DEFAULT_MUSIC)).toBe(0.5);
  });
});

describe("percentToGain", () => {
  it("maps 0..100 linearly to 0..1", () => {
    expect(percentToGain(0)).toBe(0);
    expect(percentToGain(25)).toBe(0.25);
    expect(percentToGain(100)).toBe(1);
  });
  it("clamps out-of-range and non-finite values", () => {
    expect(percentToGain(-10)).toBe(0);
    expect(percentToGain(150)).toBe(1);
    expect(percentToGain(Number.NaN)).toBe(0);
  });
});

describe("clampPercent", () => {
  it("rounds to a whole percent within 0..100", () => {
    expect(clampPercent(49.6)).toBe(50);
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(101)).toBe(100);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

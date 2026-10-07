import { describe, expect, it } from "vitest";
import { loopLength, needsNudge, videoTimeFor } from "@/components/picker/useSyncedPlayback";

describe("loopLength", () => {
  it("is the min of the two durations", () => {
    expect(loopLength(4.5, 30)).toBe(4.5);
    expect(loopLength(60, 29.8)).toBe(29.8);
  });
  it("subtracts the sample start from the preview", () => {
    expect(loopLength(20, 30, 15)).toBe(15);
    expect(loopLength(5, 30, 10)).toBe(5);
  });
  it("is null when under 0.5 s remain", () => {
    expect(loopLength(5, 30, 29.9)).toBeNull();
    expect(loopLength(5, 30, 31)).toBeNull();
  });
  it("is null when either is unknown or not positive", () => {
    expect(loopLength(null, 30)).toBeNull();
    expect(loopLength(10, null)).toBeNull();
    expect(loopLength(0, 30)).toBeNull();
    expect(loopLength(10, -1)).toBeNull();
    expect(loopLength(10, Number.NaN)).toBeNull();
  });
});

describe("videoTimeFor", () => {
  it("is audio time minus sample start", () => {
    expect(videoTimeFor(7, 5, 10)).toBeCloseTo(2);
  });
  it("wraps into [0, loop)", () => {
    expect(videoTimeFor(16, 5, 4.5)).toBeCloseTo(2);
    expect(videoTimeFor(9.5, 5, 4.5)).toBeCloseTo(0);
  });
  it("wraps negatives up", () => {
    expect(videoTimeFor(4, 5, 4.5)).toBeCloseTo(3.5);
  });
});

describe("needsNudge", () => {
  it("is false within the threshold and true beyond it, both directions", () => {
    expect(needsNudge(1.0, 1.1)).toBe(false);
    expect(needsNudge(1.1, 1.0)).toBe(false);
    expect(needsNudge(1.0, 1.2)).toBe(true);
    expect(needsNudge(1.2, 1.0)).toBe(true);
  });
  it("honours a custom threshold", () => {
    expect(needsNudge(1, 1.3, 0.5)).toBe(false);
    expect(needsNudge(1, 1.6, 0.5)).toBe(true);
  });
});

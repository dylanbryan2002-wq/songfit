import { describe, it, expect } from "vitest";
import { pickFps, frameTimestamps, timeoutFor } from "../../src/media/extractHelpers";

describe("pickFps", () => {
  it("uses 1 fps for short videos", () => {
    expect(pickFps(30, 60)).toBe(1);
  });
  it("caps frames at maxFrames for long videos", () => {
    // 180 s video, 60 frames → 1 frame every 3 s
    expect(pickFps(180, 60)).toBeCloseTo(1 / 3, 5);
  });
  it("never exceeds 1 fps", () => {
    expect(pickFps(5, 60)).toBe(1);
  });
  it("throws on non-positive duration", () => {
    expect(() => pickFps(0, 60)).toThrow();
  });
});

describe("frameTimestamps", () => {
  it("maps frame index to seconds at 1 fps", () => {
    expect(frameTimestamps(3, 1)).toEqual([0, 1, 2]);
  });
  it("maps frame index to seconds at fractional fps", () => {
    expect(frameTimestamps(3, 1 / 3)).toEqual([0, 3, 6]);
  });
  it("returns empty for zero frames", () => {
    expect(frameTimestamps(0, 1)).toEqual([]);
  });
});

describe("timeoutFor", () => {
  it("returns the default when there is no deadline", () => {
    expect(timeoutFor(90_000, undefined, 0)).toBe(90_000);
  });
  it("shortens to the remaining time when the deadline is closer", () => {
    expect(timeoutFor(90_000, 50_000, 20_000)).toBe(30_000);
  });
  it("never drops below 1000 ms", () => {
    expect(timeoutFor(90_000, 10, 5)).toBe(1000);
  });
});

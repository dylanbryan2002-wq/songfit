import { describe, it, expect } from "vitest";
import { cutsFromScores, shotStats, videoEnergy, parseSceneScores } from "../../src/media/pacing";

describe("pacing measured on the upload (Dylan approved, 2026-10-11)", () => {
  it("counts cuts above the checked threshold, at most one per 0.3 s", () => {
    expect(cutsFromScores([{ t: 1, score: 0.25 }, { t: 1.1, score: 0.5 }, { t: 3, score: 0.1 }], 0.2)).toEqual([1]);
  });
  it("cuts per minute and median shot", () => {
    expect(shotStats([10, 20, 25], 0, 60)).toEqual({ cutsPerMinute: 3, medianShot: 10 });
  });
  it("energy grows with cuts and motion and caps at 1", () => {
    expect(videoEnergy({ cutsPerMinute: 120, motionPeak: 0.5 })).toBe(1);
    expect(videoEnergy({ cutsPerMinute: 0, motionPeak: 0 })).toBe(0);
  });
  it("reads ffmpeg scene scores", () => {
    expect(parseSceneScores("pts_time:0.5\nlavfi.scene_score=0.3\n")).toEqual([{ t: 0.5, score: 0.3 }]);
  });
});

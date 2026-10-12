import { describe, expect, it } from "vitest";
import { matchCuts, shotStats, parseSceneScores, cutsFromScores, videoEnergy } from "@/scripts/groundtruth/pacing";

describe("video pacing (Dylan approved measures, 2026-10-11)", () => {
  it("matches detected cuts to hand-marked cuts within a tolerance", () => {
    const r = matchCuts([1.0, 5.0, 9.0], [1.05, 5.4, 7.0], 0.15);
    expect(r).toEqual({ hit: 1, missed: 2, falseCuts: 2 });
  });

  it("computes cuts per minute and median shot length inside the reel", () => {
    const s = shotStats([10, 20, 25], 0, 60);
    expect(s.cutsPerMinute).toBe(3);
    expect(s.medianShot).toBe(10); // shots 10, 10, 5, 35 -> median of 5,10,10,35 = 10
  });

  it("reads per-frame scene scores from ffmpeg metadata output", () => {
    const out = "frame:0    pts:0       pts_time:0\nlavfi.scene_score=0.010000\nframe:1    pts:512     pts_time:0.0333\nlavfi.scene_score=0.450000\n";
    expect(parseSceneScores(out)).toEqual([{ t: 0, score: 0.01 }, { t: 0.0333, score: 0.45 }]);
  });

  it("turns scores into cuts above a threshold, at most one per 0.3 s", () => {
    const scores = [{ t: 1, score: 0.5 }, { t: 1.1, score: 0.6 }, { t: 3, score: 0.1 }, { t: 4, score: 0.7 }];
    expect(cutsFromScores(scores, 0.4)).toEqual([1, 4]);
  });

  it("energy rises with cut speed and motion, from 0 to 1", () => {
    const calm = videoEnergy({ cutsPerMinute: 6, motionPeak: 0.02 });
    const busy = videoEnergy({ cutsPerMinute: 70, motionPeak: 0.2 });
    expect(calm).toBeLessThan(0.3);
    expect(busy).toBe(1);
  });
});

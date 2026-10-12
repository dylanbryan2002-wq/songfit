import { describe, expect, it } from "vitest";
import { combineEnergyMood, SOURCE_WEIGHTS } from "@/scripts/groundtruth/video-profile";

describe("video profile: combining sources with Dylan's approved weights", () => {
  it("uses the approved talking / not-talking weights", () => {
    expect(SOURCE_WEIGHTS.talking.energy).toEqual({ words: 15, voice: 40, faces: 15, edit: 20, colour: 10 });
    expect(SOURCE_WEIGHTS.notTalking.mood).toEqual({ edit: 15, faces: 30, words: 25, colour: 30 });
  });

  it("rebalances over the sources that exist", () => {
    // talking, only words + edit + colour for energy: 15/20/10 -> words 1/3, edit 4/9, colour 2/9
    const r = combineEnergyMood({ talking: true, words: { energy: 0.9, mood: 0.5 }, colour: { energy: 0, mood: 0.5 }, editEnergy: 0.45 });
    expect(r.energy).toBeCloseTo((15 * 0.9 + 20 * 0.45 + 10 * 0) / 45, 5);
  });

  it("mood ignores editing because pacing measures energy only", () => {
    const r = combineEnergyMood({ talking: true, words: { energy: 0.5, mood: 1 }, colour: { energy: 0.5, mood: 0 }, editEnergy: 0.9 });
    expect(r.mood).toBeCloseTo((40 * 1 + 15 * 0) / 55, 5);
  });

  it("works with no words at all", () => {
    const r = combineEnergyMood({ talking: false, words: null, colour: { energy: 0.2, mood: 0.8 }, editEnergy: 0.8 });
    expect(r.energy).toBeCloseTo((55 * 0.8 + 20 * 0.2) / 75, 5);
    expect(r.mood).toBeCloseTo(0.8, 5);
  });
});

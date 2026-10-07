import { describe, it, expect } from "vitest";
import { fitWindow, alignToMoment, selectSections } from "@/src/engine/sections/selectSections";
import type { VideoAnalysis } from "@/src/shared/types";
import { analysis, pick } from "../fixtures";

const quiet: VideoAnalysis = { ...analysis, important_moments: [] };

describe("fitWindow", () => {
  it("shortens a long window by moving the end only", () => {
    expect(fitWindow(40, 70, 45, 200)).toEqual({ start: 40, end: 60 });
  });
  it("lengthens a short window by moving the end only", () => {
    expect(fitWindow(50, 54, 51, 200)).toEqual({ start: 50, end: 62 });
  });
  it("caps the end at the track duration", () => {
    expect(fitWindow(85, 110, 90, 100)).toEqual({ start: 85, end: 100 });
  });
  it("keeps a window shorter than sectionMin when the track end forces it", () => {
    expect(fitWindow(90, 100, 92, 100)).toEqual({ start: 90, end: 100 });
  });
  it("moves the window to contain an anchor that fell outside it", () => {
    expect(fitWindow(20, 35, 50, 200)).toEqual({ start: 48, end: 63 });
  });
});

describe("alignToMoment", () => {
  it("shifts the window so the anchor lands on the reveal", () => {
    const r = alignToMoment({ start: 45, end: 60 }, 50, 200, analysis)!;
    expect(r.start).toBeCloseTo(42.2, 5);
    expect(r.end).toBeCloseTo(57.2, 5);
    expect(r.aligned_to_moment).toBe(7.8);
  });
  it("does NOT align (and does not clamp) when the anchor is earlier than the reveal", () => {
    const late: VideoAnalysis = { ...analysis, important_moments: [{ time: 10, type: "main_visual_reveal" }] };
    expect(alignToMoment({ start: 0, end: 15 }, 5, 200, late)).toBeNull();
  });
  it("returns null when there is no key moment", () => {
    expect(alignToMoment({ start: 45, end: 60 }, 50, 200, quiet)).toBeNull();
  });
  it("ignores moment types that are not reveal/climax/transition", () => {
    const other = { ...analysis, important_moments: [{ time: 3, type: "beat_drop" }] } as unknown as VideoAnalysis;
    expect(alignToMoment({ start: 45, end: 60 }, 50, 200, other)).toBeNull();
  });
  it("returns null when the aligned window would run past the track end", () => {
    expect(alignToMoment({ start: 185, end: 200 }, 199.5, 200, { ...analysis, important_moments: [{ time: 2, type: "climax" }] })).toBeNull();
  });
});

describe("selectSections", () => {
  it("H=5, T=10: no alignment, window kept (not clamped to 0)", () => {
    const late: VideoAnalysis = { ...analysis, important_moments: [{ time: 10, type: "main_visual_reveal" }] };
    const [o] = selectSections([pick({ anchor_seconds: 5, duration_seconds: 200, start_seconds: 0, end_seconds: 15 })], late);
    expect(o).toMatchObject({ start_seconds: 0, end_seconds: 15, aligned_to_moment: null });
  });
  it("H=50, T=8: start 42, aligned_to_moment 8", () => {
    const m: VideoAnalysis = { ...analysis, important_moments: [{ time: 8, type: "climax" }] };
    const [o] = selectSections([pick({ anchor_seconds: 50, duration_seconds: 200, start_seconds: 45, end_seconds: 60 })], m);
    expect(o!.start_seconds).toBeCloseTo(42, 5);
    expect(o!.end_seconds).toBeCloseTo(57, 5);
    expect(o!.aligned_to_moment).toBe(8);
  });
  it("shifts the window to contain an anchor outside the proposed one", () => {
    const [o] = selectSections([pick({ anchor_seconds: 80, duration_seconds: 200, start_seconds: 20, end_seconds: 35 })], quiet);
    expect(o!.start_seconds).toBeCloseTo(78, 5);
    expect(o!.end_seconds).toBeCloseTo(93, 5);
    expect(o!.aligned_to_moment).toBeNull();
  });
  it("expands a short window and trims a long one", () => {
    const [a, b] = selectSections([
      pick({ anchor_seconds: 31, duration_seconds: 200, start_seconds: 30, end_seconds: 35 }),
      pick({ anchor_seconds: 31, duration_seconds: 200, start_seconds: 30, end_seconds: 70 }),
    ], quiet);
    expect(a!.end_seconds - a!.start_seconds).toBeCloseTo(12, 5);
    expect(b!.end_seconds - b!.start_seconds).toBeCloseTo(20, 5);
  });
  it("caps at duration, keeping a result shorter than sectionMin", () => {
    const [o] = selectSections([pick({ anchor_seconds: 95, duration_seconds: 100, start_seconds: 90, end_seconds: 100 })], quiet);
    expect(o).toMatchObject({ start_seconds: 90, end_seconds: 100, aligned_to_moment: null });
  });
  it("leaves picks untouched (aside from fitting) when no key moment exists", () => {
    const [o] = selectSections([pick({ anchor_seconds: 50, duration_seconds: 200, start_seconds: 45, end_seconds: 60 })], quiet);
    expect(o).toMatchObject({ start_seconds: 45, end_seconds: 60, aligned_to_moment: null });
  });
  it("fits then aligns each pick independently", () => {
    const out = selectSections([
      pick({ anchor_seconds: 50, duration_seconds: 200, start_seconds: 45, end_seconds: 60 }),
      pick({ anchor_seconds: 22, duration_seconds: 200, start_seconds: 20, end_seconds: 60 }),
    ], analysis);
    expect(out[0]!.start_seconds).toBeCloseTo(42.2, 5);
    expect(out[1]!.start_seconds).toBeCloseTo(14.2, 5);
    expect(out[1]!.end_seconds - out[1]!.start_seconds).toBeCloseTo(20, 5);
  });
});

import { describe, it, expect } from "vitest";
import { etaSeconds, stageMedians, FALLBACK_MEDIANS } from "@/src/shared/eta";

const T0 = Date.parse("2026-10-08T12:00:00Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const run = (analysis: number, recommend: number) => ({
  created_at: at(0),
  analyzed_at: at(analysis),
  recommended_at: at(analysis + recommend),
});

describe("stageMedians", () => {
  it("takes the median of each stage across recent runs", () => {
    expect(stageMedians([run(60, 100), run(80, 120), run(70, 200)])).toEqual({ analysisSeconds: 70, recommendSeconds: 120 });
    expect(stageMedians([run(60, 100), run(80, 120), run(70, 200), run(90, 130)])).toEqual({
      analysisSeconds: 75,
      recommendSeconds: 125,
    });
  });
  it("skips rows missing a timestamp or out of order", () => {
    const rows = [run(60, 100), run(80, 120), run(70, 200), { ...run(1, 1), analyzed_at: null }, run(50, -10)];
    expect(stageMedians(rows)).toEqual({ analysisSeconds: 70, recommendSeconds: 120 });
  });
  it("falls back to 75 s and 110 s with fewer than 3 samples", () => {
    expect(FALLBACK_MEDIANS).toEqual({ analysisSeconds: 75, recommendSeconds: 110 });
    expect(stageMedians([])).toEqual(FALLBACK_MEDIANS);
    expect(stageMedians([run(10, 10), run(20, 20), { ...run(1, 1), recommended_at: null }])).toEqual(FALLBACK_MEDIANS);
  });
});

describe("etaSeconds", () => {
  const m = { analysisSeconds: 80, recommendSeconds: 100 };
  it("analyzing: what is left of analysis plus all of recommend", () => {
    const sub = { status: "analyzing" as const, created_at: at(0), analyzed_at: null };
    expect(etaSeconds(sub, m, T0 + 30_000)).toBe(150);
    expect(etaSeconds(sub, m, T0 + 500_000)).toBe(100); // analysis overran: never negative
    expect(etaSeconds({ ...sub, status: "uploaded" }, m, T0)).toBe(180);
  });
  it("recommending: what is left of recommend", () => {
    const sub = { status: "recommending" as const, created_at: at(0), analyzed_at: at(80) };
    expect(etaSeconds(sub, m, T0 + 120_000)).toBe(60);
    expect(etaSeconds(sub, m, T0 + 900_000)).toBe(0);
  });
  it("ready is 0, failed is null, bad timestamps are null", () => {
    expect(etaSeconds({ status: "ready", created_at: at(0), analyzed_at: at(1) }, m, T0)).toBe(0);
    expect(etaSeconds({ status: "failed", created_at: at(0), analyzed_at: null }, m, T0)).toBeNull();
    expect(etaSeconds({ status: "analyzing", created_at: undefined, analyzed_at: null }, m, T0)).toBeNull();
  });
  it("recommending without analyzed_at counts all of recommend", () => {
    expect(etaSeconds({ status: "recommending", created_at: at(0), analyzed_at: null }, m, T0 + 999_000)).toBe(100);
  });
});

import { describe, it, expect } from "vitest";
import { pickSection } from "@/src/engine/match/section";

const sec = (over: Record<string, unknown>) => ({ instrumental: false, first_vocal: 5, chorus: [40, 90], gaps: [] as [number, number][], ...over });

describe("section picking (Dylan approved rules, 2026-10-11)", () => {
  it("talking + long instrumental intro: start at 0:00", () => {
    expect(pickSection({ talking: true, keyMoment: 10 }, sec({ first_vocal: 18 }))).toEqual({ start: 0, end: 15, rule: "intro" });
  });
  it("talking + gap of 12 s or more: start at the gap", () => {
    expect(pickSection({ talking: true, keyMoment: 10 }, sec({ gaps: [[60, 75]] }))).toEqual({ start: 60, end: 75, rule: "gap" });
  });
  it("talking + only a shorter gap (8–12 s): singing comes back in on the key moment", () => {
    const s = pickSection({ talking: true, keyMoment: 6 }, sec({ gaps: [[50, 59]] }))!;
    expect(s.rule).toBe("short-gap");
    expect(s.start + 6).toBeCloseTo(59, 5); // the gap ends (singing returns) at the video's key moment
  });
  it("talking + no usable gap: use the chorus", () => {
    expect(pickSection({ talking: true, keyMoment: 3 }, sec({}))!.rule).toBe("chorus");
  });
  it("not talking: the first chorus lands on the key moment", () => {
    expect(pickSection({ talking: false, keyMoment: 8 }, sec({}))).toEqual({ start: 32, end: 47, rule: "chorus" });
  });
  it("not talking, no key moment: start 2 s before the chorus", () => {
    expect(pickSection({ talking: false, keyMoment: null }, sec({}))).toEqual({ start: 38, end: 53, rule: "chorus" });
  });
  it("no timings: null, so the existing default section is used", () => {
    expect(pickSection({ talking: true, keyMoment: 5 }, null)).toBeNull();
  });
});

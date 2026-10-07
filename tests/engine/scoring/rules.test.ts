import { describe, it, expect } from "vitest";
import { combine, WEIGHTS } from "@/src/engine/scoring/weights";
import { dialogueScore } from "@/src/engine/scoring/dialogue";
import { overuseScore } from "@/src/engine/scoring/overuse";
import type { ComponentScores, VideoAnalysis } from "@/src/shared/types";
import { analysis, ver } from "../fixtures";

describe("combine", () => {
  it("is a weighted mean", () => {
    const scores = Object.fromEntries(Object.keys(WEIGHTS).map((d) => [d, { score: 0.5, reason: "" }])) as ComponentScores;
    expect(combine(scores)).toBeCloseTo(0.5, 6);
    scores.semantic = { score: 1, reason: "" };
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(combine(scores)).toBeCloseTo((0.5 * (total - WEIGHTS.semantic) + WEIGHTS.semantic) / total, 6);
  });
});

describe("dialogueScore", () => {
  const talky: VideoAnalysis = { ...analysis, dialogue_present: true };
  it("is 1 when there is no dialogue", () => {
    expect(dialogueScore(analysis, ver({ section_is_vocal: true })).score).toBe(1);
  });
  it("penalises vocal sections when there is dialogue", () => {
    expect(dialogueScore(talky, ver({ section_is_vocal: true })).score).toBe(0.3);
  });
  it("passes non-vocal sections under dialogue", () => {
    expect(dialogueScore(talky, ver({ section_is_vocal: false })).score).toBe(1);
  });
});

describe("overuseScore", () => {
  it("flags a known overused song regardless of formatting", () => {
    expect(overuseScore({ title: "Oh No (Remastered)", artist: "Capone" }).score).toBe(0.4);
  });
  it("passes everything else", () => {
    expect(overuseScore({ title: "Obscure Tune", artist: "Nobody" }).score).toBe(1);
  });
});

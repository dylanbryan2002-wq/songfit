import { describe, it, expect, vi } from "vitest";
import { scoreCandidates } from "@/src/engine/scoring/scoreCandidates";
import { modelScores, parseScores, buildScoringPrompt, PROMPT_VERSION } from "@/src/engine/scoring/modelScores";
import { DIMENSIONS, type VerifiedCandidate } from "@/src/shared/types";
import { analysis, brief, ver } from "../fixtures";

const vc = (title: string, id: string) => ver({ title, deezer_id: id });
const six = (s: number) => ({
  semantic: { score: s, reason: "a" }, emotional: { score: s, reason: "b" }, aesthetic: { score: s, reason: "c" },
  pacing: { score: s, reason: "d" }, cultural: { score: s, reason: "e" }, originality: { score: s, reason: "f" },
});

describe("scoreCandidates", () => {
  it("attaches all 7 dimensions and sorts by total descending", async () => {
    const scores = vi.fn(async (_a, _b, cands: VerifiedCandidate[]) => cands.map((c) => six(c.title === "Great" ? 0.9 : 0.4)));
    const out = await scoreCandidates(analysis, brief, [vc("Meh", "1"), vc("Great", "2")], { scores });
    expect(out.map((c) => c.title)).toEqual(["Great", "Meh"]);
    for (const c of out) {
      expect(Object.keys(c.component_scores).sort()).toEqual([...DIMENSIONS].sort());
      expect(c.total_score).toBeGreaterThan(0);
    }
  });
});

describe("scoreCandidates ties", () => {
  it("keeps input order on equal totals", async () => {
    const scores = vi.fn(async (_a, _b, cands: VerifiedCandidate[]) => cands.map(() => six(0.5)));
    const out = await scoreCandidates(analysis, brief, [vc("X", "1"), vc("Y", "2"), vc("Z", "3")], { scores });
    expect(out.map((c) => c.title)).toEqual(["X", "Y", "Z"]);
  });
});

describe("parseScores", () => {
  it("accepts a complete list", () => {
    const r = parseScores(JSON.stringify([{ index: 0, ...six(0.5) }, { index: 1, ...six(0.6) }]), 2);
    expect(r.ok && r.scores[1]!.semantic.score).toBe(0.6);
  });
  it("rejects a list with a missing index", () => {
    const r = parseScores(JSON.stringify([{ index: 0, ...six(0.5) }]), 2);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/missing index 1/);
  });
  it("rejects an item with an invalid score", () => {
    const bad = { index: 0, ...six(0.5), pacing: { score: 1.7, reason: "x" } };
    expect(parseScores(JSON.stringify([bad]), 1).ok).toBe(false);
  });
});

describe("modelScores", () => {
  it("retries once with the error, then throws", async () => {
    const call = vi.fn(async (_a: { user: string }) => JSON.stringify([{ index: 0, ...six(0.5) }])); // always one short
    await expect(modelScores(analysis, brief, [vc("A", "1"), vc("B", "2")], { call })).rejects.toThrow(/scoring output invalid/);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1]![0].user).toMatch(/PREVIOUS OUTPUT WAS INVALID/);
    expect(PROMPT_VERSION).toBe("scoring-v3");
  });
  it("states the video duration in the VIDEO block", () => {
    expect(buildScoringPrompt({ ...analysis, duration_seconds: 4.5 }, brief, [vc("A", "1")])).toContain("Duration: 4.5s.");
  });
});

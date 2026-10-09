import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { judgeClip, PROMPT_VERSION, type JudgeInput } from "../../scripts/groundtruth/judge";
import { parseGeminiReply } from "../../scripts/groundtruth/gemini";
import { MODELS } from "../../src/shared/config";
import type { ClaudeCall } from "../../src/shared/anthropic";
import type { OursResult } from "../../scripts/groundtruth/ours";

const ours = JSON.parse(readFileSync("tests/groundtruth/fixtures/ours.json", "utf8")) as OursResult;
const geminiRaw = readFileSync("tests/groundtruth/fixtures/gemini-reply.md", "utf8");

const input: JudgeInput = {
  truth: { song: "Stereo Love", artist: "Edward Maya", start_seconds: 30 },
  ours,
  gemini: { parsed: parseGeminiReply(geminiRaw), raw: geminiRaw, prompt_version: "gemini-paste-v1" },
};

const answer = (winner: string) => async () => `{"winner": "${winner}", "confidence": "high", "reason": "The hook lands on the flip."}`;

describe("judgeClip", () => {
  it("maps the model's A/B answer back to real/ours through the shuffled order", async () => {
    const realFirst = await judgeClip(input, answer("A"), () => 0);
    expect(realFirst.order).toEqual({ A: "real", B: "ours" });
    expect(realFirst.winner).toBe("real");
    const oursFirst = await judgeClip(input, answer("A"), () => 0.9);
    expect(oursFirst.order).toEqual({ A: "ours", B: "real" });
    expect(oursFirst.winner).toBe("ours");
    const tie = await judgeClip(input, answer("tie"), () => 0);
    expect(tie).toMatchObject({ winner: "tie", confidence: "high", reason: "The hook lands on the flip.", prompt_version: PROMPT_VERSION });
    expect(tie.real).toEqual({ title: "Stereo Love", artist: "Edward Maya", start_seconds: 30 });
    expect(tie.ours).toMatchObject({ rank: 1, title: "Blinding Lights", artist: "The Weeknd", start_seconds: 43, end_seconds: 58 });
  });

  it("sends one call on the analysis model with both candidates, our analysis and Gemini's words", async () => {
    const calls: Parameters<ClaudeCall>[0][] = [];
    await judgeClip(input, async (args) => { calls.push(args); return answer("B")(); }, () => 0);
    expect(calls).toHaveLength(1);
    const { model, user } = calls[0]!;
    expect(model).toBe(MODELS.analysis);
    expect(user).toContain("CANDIDATE A\nStereo Love — Edward Maya\nstarts at 0:30");
    expect(user).toContain("CANDIDATE B\nBlinding Lights — The Weeknd\nsection 0:43–0:58\nwhy: Use 0:43–0:58: the chorus hits on the flip.");
    expect(user).toContain("Colour bars and a counter: a synthetic test clip.");
    expect(user).toContain("role: amplify");
    expect(user).toContain("vocal hook enters exactly as the counter flips");
    expect(user).not.toContain("```json");
  });

  it("works without a Gemini reply", async () => {
    const r = await judgeClip({ ...input, gemini: null }, answer("B"), () => 0);
    expect(r.winner).toBe("ours");
  });

  it("throws with the raw text attached when the answer does not parse", async () => {
    await expect(judgeClip(input, async () => "I prefer A, honestly.", () => 0)).rejects.toThrow(/I prefer A, honestly/);
    await expect(judgeClip(input, async () => '{"winner": "C", "confidence": "high", "reason": "x"}', () => 0)).rejects.toThrow(/winner/);
  });
});

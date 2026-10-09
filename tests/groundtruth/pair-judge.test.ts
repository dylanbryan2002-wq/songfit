import { describe, it, expect, vi } from "vitest";
import { judgePair, signTestP, tally, buildPairPrompt, sameness, type PairResult } from "@/scripts/groundtruth/pair-judge";
import type { OursResult } from "@/scripts/groundtruth/ours";
import { analysis, pick } from "../engine/fixtures";

const run = (title: string, key: string, start = 43): OursResult => ({
  analysis, brief: {} as never, analysis_prompt_version: "", analysis_raw: "", generated: [], generate_calls: 1, candidates: [],
  finals: [{ ...pick({ canonical_title: title, catalog_key: key, start_seconds: start, end_seconds: start + 15 }), explanation: "an explanation the judge must not see", spotify_url: "" }],
  recommend_error: null, elapsed_ms: 0,
});

describe("judgePair", () => {
  it("ties identical song and section without a call", async () => {
    const call = vi.fn();
    expect((await judgePair(analysis, run("X", "deezer:1"), run("X", "deezer:1"), call)).status).toBe("tie_identical");
    expect(call).not.toHaveBeenCalled();
  });
  it("records a missing arm as that arm's failure", async () => {
    expect((await judgePair(analysis, null, run("X", "deezer:1"), vi.fn())).status).toBe("fail_a");
    expect((await judgePair(analysis, run("X", "deezer:1"), null, vi.fn())).status).toBe("fail_b");
  });
  it("maps the shuffled label back to the arm, and never shows explanations", async () => {
    const call = vi.fn().mockResolvedValue('{"winner":"A","confidence":"high","reason":"r"}');
    const r = await judgePair(analysis, run("X", "deezer:1"), run("Y", "deezer:2"), call, () => 0.9); // A label = arm b
    expect(r.status).toBe("win_b");
    expect(call.mock.calls[0]![0].user).not.toContain("explanation");
  });
  it("retries a bad answer once, then records judge_error", async () => {
    const call = vi.fn().mockResolvedValue("not json");
    expect((await judgePair(analysis, run("X", "deezer:1"), run("Y", "deezer:2"), call)).status).toBe("judge_error");
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("gives both options the same fields", () => {
    const p = buildPairPrompt(analysis, { title: "X", artist: "a", start_seconds: 0, end_seconds: 15, catalog_key: "k" }, { title: "Y", artist: "b", start_seconds: 60, end_seconds: 75, catalog_key: "j" });
    expect(p).toContain("OPTION A: X — a, use 0:00–0:15");
    expect(p).toContain("OPTION B: Y — b, use 1:00–1:15");
  });
});

describe("statistics", () => {
  it("sign test", () => {
    expect(signTestP(7, 0)).toBeCloseTo(0.0156, 3);
    expect(signTestP(5, 5)).toBe(1);
    expect(signTestP(0, 0)).toBe(1);
  });
  it("counts a one-arm failure as a loss for that arm", () => {
    const r = (status: PairResult["status"]) => ({ status }) as PairResult;
    const t = tally([r("win_b"), r("fail_a"), r("win_a"), r("tie_identical"), r("fail_both")]);
    expect(t).toMatchObject({ win_b: 2, win_a: 1, tie: 1, decided: 3, net_b: 1, fail_both: 1 });
  });
  it("finds the most repeated recording across top 5s", () => {
    expect(sameness([run("X", "deezer:1"), run("X", "deezer:1"), run("Y", "deezer:2"), null])).toEqual({ key: "deezer:1", title: "X", clips: 2 });
  });
});

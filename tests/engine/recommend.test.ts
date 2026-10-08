import { describe, it, expect, vi } from "vitest";
import { recommendSubmission, type RecommendDeps } from "@/src/engine/recommend";
import { diversify } from "@/src/engine/diversify/diversify";
import type { GeneratedCandidate, VerifiedCandidate, FinalRecommendation, ScoredCandidate, Pick as SPick } from "@/src/shared/types";
import { analysis, brief, gen, ver, scored, pick } from "./fixtures";
import { logger } from "@/src/shared/logger";

vi.mock("server-only", () => ({}));

const row = { id: "sub-1", creator_id: "cre-1" } as never;
const ctx = () => ({ deadlineAt: Date.now() + 200_000 });

function makeDeps(over: Partial<RecommendDeps> = {}) {
  const calls: string[] = [];
  const deps: RecommendDeps = {
    getSubmission: vi.fn(async () => row),
    getAnalysis: vi.fn(async () => ({ analysis, brief, row: {} })),
    generate: vi.fn(async () => { calls.push("generate"); return []; }),
    verify: vi.fn(async () => { calls.push("verify"); return { verified: [], unverified: [], lookupFailed: [] }; }),
    score: vi.fn(async (_a, _b, vs: VerifiedCandidate[]) => { calls.push("score"); return vs.map((v) => scored(v)); }),
    diversify: vi.fn((s: ScoredCandidate[]) => { calls.push("diversify"); return s.slice(0, 3).map((c, i) => pick({ ...c, rank: (i + 1) as 1 | 2 | 3 })); }),
    sections: vi.fn((p) => { calls.push("sections"); return p; }),
    explain: vi.fn(async (p: SPick[]): Promise<FinalRecommendation[]> => {
      calls.push("explain");
      return p.map((x) => ({ ...x, explanation: "e", spotify_url: "s", itunes_id: null }));
    }),
    replaceCandidates: vi.fn(async (_id: string, rows: { deezer_id?: string | null; itunes_id?: string | null; verified?: boolean }[]) => {
      calls.push("replaceCandidates");
      return rows.map((r, i) => ({ id: `cand-${i}`, deezer_id: r.deezer_id ?? null, itunes_id: r.itunes_id ?? null, verified: r.verified })) as never;
    }),
    replaceRecommendations: vi.fn(async () => { calls.push("replaceRecommendations"); return []; }),
    setStatus: vi.fn(async () => { calls.push("setStatus"); }),
    logEvent: vi.fn(async () => {}),
    listNotFound: vi.fn(async () => []),
    ...over,
  };
  return Object.assign(deps, { calls });
}

describe("recommendSubmission", () => {
  it("gives every stage the analysis with the submission's video duration", async () => {
    const generated = [gen({ title: "V1" }), gen({ title: "V2" }), gen({ title: "V3" })];
    const verified = generated.map((c, i) => ver({ ...c, deezer_id: String(i + 1) }));
    const deps = makeDeps({
      getSubmission: vi.fn(async () => ({ id: "sub-1", creator_id: "cre-1", duration_seconds: 4.5 }) as never),
      generate: vi.fn(async () => generated),
      verify: vi.fn(async () => ({ verified, unverified: [], lookupFailed: [] })),
    });
    await recommendSubmission("sub-1", ctx(), deps);
    const arg = (fn: unknown, i: number) => (fn as ReturnType<typeof vi.fn>).mock.calls[0]![i];
    for (const a of [arg(deps.generate, 1), arg(deps.score, 0), arg(deps.sections, 1), arg(deps.explain, 1)]) {
      expect(a).toMatchObject({ duration_seconds: 4.5, summary: analysis.summary });
    }
  });
  it("runs stages in order, persists unverified rows, links recs to candidate ids, logs creatorId", async () => {
    const generated = [gen({ title: "V1" }), gen({ title: "V2" }), gen({ title: "V3" }), gen({ title: "Missing" })];
    const verified = generated.slice(0, 3).map((c, i) => ver({ ...c, deezer_id: String(i + 1), deezer_url: `https://www.deezer.com/track/${i + 1}` }));
    const deps = makeDeps({
      generate: vi.fn(async () => generated),
      verify: vi.fn(async () => ({ verified, unverified: [generated[3]!], lookupFailed: [] })),
    });
    await recommendSubmission("sub-1", ctx(), deps);
    expect(deps.calls).toEqual(["score", "replaceCandidates", "diversify", "sections", "explain", "replaceRecommendations", "setStatus"]);
    const rows = (deps.replaceCandidates as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, unknown>[];
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ source: "model", directions: ["safe"], anchor_seconds: 45, preview_url: "https://cdn.deezer/1.mp3", preview_source: "deezer", itunes_id: null, deezer_id: "1", verified: true, prompt_version: "candidates-v4", total_score: 0.7 });
    expect(rows[3]).toMatchObject({ verified: false, deezer_id: null, canonical_title: null, total_score: null, component_scores: null });
    expect(deps.setStatus).toHaveBeenCalledWith("sub-1", "ready");
    expect(deps.logEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "recommendations_ready", creatorId: "cre-1", submissionId: "sub-1" }));
    const recRows = (deps.replaceRecommendations as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { candidate_id: string; explain_prompt_version: string; selected: boolean }[];
    expect(recRows.map((r) => r.candidate_id)).toEqual(["cand-0", "cand-1", "cand-2"]);
    expect(recRows[0]).toMatchObject({ explain_prompt_version: "explain-v3", selected: false });
  });

  it("regenerates once, excludes seen keys, merges by deezer id, tags only new keys #2, persists all", async () => {
    const first = [gen({ title: "A" }), gen({ title: "B" }), gen({ title: "Gone" }), gen({ title: "Flaky" }), gen({ title: "Silent" })];
    const second = [gen({ title: "A" }), gen({ title: "C" })];
    const generate = vi.fn(async (_b, _a, opts?: { exclude?: string[] }) => (opts?.exclude ? second : first));
    const verify = vi.fn(async (cands: GeneratedCandidate[]) => ({
      verified: cands.filter((c) => !["Gone", "Flaky", "Silent"].includes(c.title)).map((c) => ver({ ...c, deezer_id: c.title === "A" ? "10" : c.title === "B" ? "11" : "12" })),
      unverified: [...cands.filter((c) => c.title === "Gone"), ...cands.filter((c) => c.title === "Silent").map((c) => ({ ...c, deezer_id: "99" }))],
      lookupFailed: cands.filter((c) => c.title === "Flaky"),
    }));
    const deps = makeDeps({ generate, verify });
    await recommendSubmission("sub-1", ctx(), deps);
    expect(generate).toHaveBeenCalledTimes(2);
    const opts = (generate.mock.calls[1] as unknown[])[2] as { exclude: string[]; note: string };
    // A Deezer match without a sample stays excluded: the model must not propose it again.
    expect(opts.exclude).toEqual(expect.arrayContaining(["a|the weeknd", "b|the weeknd", "gone|the weeknd", "flaky|the weeknd", "silent|the weeknd"]));
    expect(opts.note).toMatch(/well-known studio recordings/);
    const scoredArg = (deps.score as ReturnType<typeof vi.fn>).mock.calls[0]![2] as VerifiedCandidate[];
    expect(scoredArg.map((v) => v.deezer_id).sort()).toEqual(["10", "11", "12"]);
    const rows = (deps.replaceCandidates as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { title: string; verified: boolean; prompt_version: string }[];
    expect(rows).toHaveLength(6);
    expect(rows.find((r) => r.title === "A")!.prompt_version).toBe("candidates-v4");
    expect(rows.find((r) => r.title === "C")!.prompt_version).toBe("candidates-v4#2");
    expect(rows.find((r) => r.title === "Gone")).toMatchObject({ verified: false });
    expect(rows.find((r) => r.title === "Flaky")).toMatchObject({ verified: false });
  });

  it("bans reported songs: excluded from generation, dropped after verification, logged", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const names = ["A", "B", "C", "D", "Banned1", "Banned2"];
    const generate = vi.fn(async () => names.map((t) => gen({ title: t })));
    const verify = vi.fn(async (cands: GeneratedCandidate[]) => ({
      verified: cands.map((c, i) => ver({ ...c, deezer_id: c.title === "Banned2" ? "777" : String(i + 1) })),
      unverified: [], lookupFailed: [],
    }));
    const deps = makeDeps({
      generate, verify,
      listNotFound: vi.fn(async () => [
        { title: "Banned1", artist: "The Weeknd", catalog_key: null, creator_id: "u1" }, // banned by name
        { title: "Something else", artist: "Nobody", catalog_key: "deezer:777", creator_id: "u1" }, // banned by catalog key
      ]),
    });
    await recommendSubmission("sub-1", ctx(), deps);
    const opts = (generate.mock.calls[0] as unknown[])[2] as { exclude: string[] };
    expect(opts.exclude).toEqual(expect.arrayContaining(["banned1|the weeknd", "something else|nobody"]));
    const scoredArg = (deps.score as ReturnType<typeof vi.fn>).mock.calls[0]![2] as VerifiedCandidate[];
    expect(scoredArg.map((v) => v.title)).toEqual(["A", "B", "C", "D"]);
    expect(info).toHaveBeenCalledWith("recommend.banned_dropped", expect.objectContaining({ count: 2 }));
    info.mockRestore();
  });

  it("caps generation exclusions at 50 banned names, most reported first, but drops every banned song after verification", async () => {
    const reports = Array.from({ length: 60 }, (_, i) => ({ title: `Rare${i}`, artist: "X", catalog_key: null, creator_id: "u1" }));
    const hot = { title: "Hot", artist: "X", catalog_key: null, creator_id: "u2" };
    const generate = vi.fn(async () => ["A", "B", "C", "Rare59"].map((t) => gen({ title: t, artist: "X" })));
    const deps = makeDeps({
      generate,
      verify: vi.fn(async (c: GeneratedCandidate[]) => ({ verified: c.map((x, i) => ver({ ...x, deezer_id: String(i + 1) })), unverified: [], lookupFailed: [] })),
      listNotFound: vi.fn(async () => [...reports, hot, hot, hot]),
    });
    await recommendSubmission("sub-1", ctx(), deps);
    const opts = (generate.mock.calls[0] as unknown[])[2] as { exclude: string[] };
    expect(opts.exclude).toHaveLength(50);
    expect(opts.exclude[0]).toBe("hot|x");
    const scoredArg = (deps.score as ReturnType<typeof vi.fn>).mock.calls[0]![2] as VerifiedCandidate[];
    expect(scoredArg.map((v) => v.title)).toEqual(["A", "B", "C"]);
  });

  it("continues with no bans when the reports lookup fails", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const gen3 = ["A", "B", "C"].map((t) => gen({ title: t }));
    const generate = vi.fn(async () => gen3);
    const deps = makeDeps({
      generate,
      verify: vi.fn(async (c: GeneratedCandidate[]) => ({ verified: c.map((x, i) => ver({ ...x, deezer_id: String(i + 1) })), unverified: [], lookupFailed: [] })),
      listNotFound: vi.fn(async () => { throw new Error("db down"); }),
    });
    await recommendSubmission("sub-1", ctx(), deps);
    expect(deps.setStatus).toHaveBeenCalledWith("sub-1", "ready");
    expect((generate.mock.calls[0] as unknown[])[2]).not.toHaveProperty("exclude");
    expect(warn).toHaveBeenCalledWith("recommend.not_found_lookup_failed", expect.objectContaining({ reason: expect.stringContaining("db down") }));
    warn.mockRestore();
  });

  it("keeps banned keys in the regeneration exclusions", async () => {
    const generate = vi.fn(async () => [gen({ title: "X" })]);
    const deps = makeDeps({
      generate,
      verify: vi.fn(async (c: GeneratedCandidate[]) => ({ verified: c.map((x) => ver({ ...x, deezer_id: "1" })), unverified: [], lookupFailed: [] })),
      listNotFound: vi.fn(async () => [{ title: "Banned1", artist: "The Weeknd", catalog_key: null, creator_id: "u1" }]),
    });
    await expect(recommendSubmission("sub-1", ctx(), deps)).rejects.toThrow();
    const second = (generate.mock.calls[1] as unknown[])[2] as { exclude: string[] };
    expect(second.exclude).toEqual(expect.arrayContaining(["x|the weeknd", "banned1|the weeknd"]));
  });

  it("fails with fewer than 3 distinct recordings after regeneration, still persisting what was seen", async () => {
    const deps = makeDeps({
      generate: vi.fn(async () => [gen({ title: "X" })]),
      verify: vi.fn(async (c: GeneratedCandidate[]) => ({ verified: c.map((x) => ver({ ...x, deezer_id: "1" })), unverified: [], lookupFailed: [] })),
    });
    await expect(recommendSubmission("sub-1", ctx(), deps)).rejects.toThrow(/fewer than 3 verified candidates/);
    expect(deps.replaceCandidates).toHaveBeenCalled();
    expect(deps.setStatus).not.toHaveBeenCalled();
  });

  it("persists a no-sample match unverified with its deezer id, links recs only to verified rows, reports noSample", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const generated = [gen({ title: "V1" }), gen({ title: "V2" }), gen({ title: "V3" }), gen({ title: "Silent" })];
    const verified = generated.slice(0, 3).map((c, i) => ver({ ...c, deezer_id: String(i + 1) }));
    // Same Deezer id as V1: the unverified row must never steal V1's candidate link.
    const verify = vi.fn(async () => ({ verified, unverified: [{ ...generated[3]!, deezer_id: "1" }], lookupFailed: [] }));
    const deps = makeDeps({ generate: vi.fn(async () => generated), verify });
    const c = ctx();
    await recommendSubmission("sub-1", c, deps);
    expect(verify).toHaveBeenCalledWith(generated, { ctx: c });
    const rows = (deps.replaceCandidates as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, unknown>[];
    expect(rows[3]).toMatchObject({ title: "Silent", verified: false, deezer_id: "1", itunes_id: null, preview_url: null, canonical_title: null });
    const recRows = (deps.replaceRecommendations as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { candidate_id: string }[];
    expect(recRows.map((r) => r.candidate_id)).toEqual(["cand-0", "cand-1", "cand-2"]);
    expect(info).toHaveBeenCalledWith("recommend.summary", expect.objectContaining({ unverified: 1, noSample: 1, picks: 3 }));
    info.mockRestore();
  });

  it("persists all fifteen picks, ranks 1..15, from twenty verified recordings", async () => {
    const generated = Array.from({ length: 20 }, (_, i) => gen({ title: `T${i}`, artist: `A${i}`, directions: [(["safe", "current", "unexpected"] as const)[i % 3]!] }));
    const verified = generated.map((c, i) => ver({ ...c, canonical_artist: c.artist, deezer_id: String(i + 1) }));
    const deps = makeDeps({
      generate: vi.fn(async () => generated),
      verify: vi.fn(async () => ({ verified, unverified: [], lookupFailed: [] })),
      score: vi.fn(async (_a, _b, vs: VerifiedCandidate[]) => vs.map((v, i) => scored({ ...v, total_score: 0.9 - i * 0.01 }))),
      diversify: (s) => diversify(s),
    });
    await recommendSubmission("sub-1", ctx(), deps);
    const recRows = (deps.replaceRecommendations as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { rank: number }[];
    expect(recRows.map((r) => r.rank)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
  it("fails when no analysis is stored", async () => {
    const deps = makeDeps({ getAnalysis: vi.fn(async () => null) });
    await expect(recommendSubmission("sub-1", ctx(), deps)).rejects.toThrow(/no analysis stored/);
  });
});

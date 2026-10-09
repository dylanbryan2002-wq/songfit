import { describe, it, expect, vi } from "vitest";
import { rebuild, firstDifference, withoutSafe } from "@/scripts/groundtruth/treatment-lib";
import { needsRun, type TreatmentResult } from "@/scripts/groundtruth/treatment";
import { diversify } from "@/src/engine/diversify/diversify";
import { selectSections } from "@/src/engine/sections/selectSections";
import { toCandidateInsert } from "@/src/engine/recommend";
import { CREATOR_LISTS_VERSION } from "@/src/engine/catalog/creatorLists";
import { CREATOR_PICKS_PROMPT_VERSION } from "@/src/engine/candidates/generateCandidates";
import type { GeneratedCandidate, ScoredCandidate, VerifiedCandidate } from "@/src/shared/types";
import type { OursResult } from "@/scripts/groundtruth/ours";
import { analysis, brief, gen, scored } from "../engine/fixtures";

const A = { ...analysis, dialogue_present: true, duration_seconds: 20 };
const DIRS = ["safe", "current", "unexpected"] as const;

/** A control run built the way production builds it: verified (generated order) → scored (stable sort) → rows → diversify → sections. */
function control(extraRows: ReturnType<typeof toCandidateInsert>[] = []): OursResult {
  const songs = Array.from({ length: 8 }, (_, i) => ({ title: `Song ${i}`, artist: `Artist ${i}`, dir: DIRS[i % 3]! }));
  const generated: GeneratedCandidate[] = songs.map((s) => gen({ title: s.title, artist: s.artist, directions: [s.dir] }));
  const sc: ScoredCandidate[] = songs.map((s, i) => scored({
    title: s.title, artist: s.artist, canonical_title: s.title, canonical_artist: s.artist, deezer_id: String(100 + i),
    catalog_key: `deezer:${100 + i}`, directions: [s.dir], total_score: i === 3 || i === 4 ? 0.6 : 0.9 - i * 0.05, // a tie at 0.6
  })).sort((a, b) => b.total_score - a.total_score);
  const finals = selectSections(diversify(sc), A).map((p) => ({ ...p, explanation: "x", spotify_url: "" }));
  return {
    analysis, brief, analysis_prompt_version: "v", analysis_raw: "", generated, generate_calls: 1,
    candidates: [...sc.map((c) => toCandidateInsert("s", c, true, "candidates-v6")), ...extraRows], finals, recommend_error: null, elapsed_ms: 0,
  };
}
const fail = async () => { throw new Error("unexpected call"); };
const verifyAs = (id: string) => vi.fn(async (c: GeneratedCandidate[]) => ({
  verified: c.map((x): VerifiedCandidate => scored({ ...x, deezer_id: id, catalog_key: `deezer:${id}`, canonical_title: x.title, canonical_artist: x.artist })),
  unverified: [], lookupFailed: [],
}));
const scoreAs = (total: number) => vi.fn(async (v: VerifiedCandidate[]) => v.map((x) => scored({ ...x, total_score: total })));

describe("rebuild", () => {
  it("replay reproduces the control's picks and sections exactly, with no calls", async () => {
    const base = control();
    const r = await rebuild(base, A, "replay", { verify: fail, score: fail });
    expect(firstDifference(r.picks, base.finals)).toBeNull();
    expect(r.newly_scored + r.newly_verified).toBe(0);
  });
  it("drops safe-only control songs, reuses unchanged ones, verifies and scores only what is new", async () => {
    const base = control();
    const verify = verifyAs("999");
    const score = scoreAs(0.95);
    const r = await rebuild(base, A, [
      gen({ title: "Song 3", artist: "Artist 3", directions: ["safe"] }), // identical scoring inputs → cached score
      gen({ title: "Fresh", artist: "New", directions: ["safe"] }),
    ], { verify, score }, [{ title: "Fresh", artist: "New", deezer_id: "999", groups: 2, types: ["emotional"] }]);
    expect(verify.mock.calls[0]![0].map((c) => c.title)).toEqual(["Fresh"]);
    expect(score.mock.calls[0]![0].map((c) => c.title)).toEqual(["Fresh"]);
    const titles = r.picks.map((p) => p.canonical_title);
    expect(titles).not.toContain("Song 0"); // safe-only in the control and not re-proposed
    expect(titles).toContain("Song 3");
    expect(r.picks[0]!.canonical_title).toBe("Fresh");
    expect(r.funnel).toEqual({ offered: 1, safe_generated: 1, in_pool: 1, top15: 1, top5: 1 });
    expect(r.scored.length).toBe(r.reused_scores + r.newly_scored);
  });
  it("rescores when any scoring input changed: window, vocal flag or reasons", async () => {
    const base = control();
    for (const over of [{ proposed_start: 60, proposed_end: 75, anchor_seconds: 62 }, { section_is_vocal: false }, { fit_reason: "new reason" }]) {
      const score = scoreAs(0.1);
      await rebuild(base, A, [gen({ title: "Song 3", artist: "Artist 3", directions: ["safe"], ...over })], { verify: fail, score });
      expect(score.mock.calls[0]![0].map((c) => c.title)).toEqual(["Song 3"]);
    }
  });
  it("verifies again a song the control could not verify", async () => {
    const unverifiedRow = toCandidateInsert("s", gen({ title: "Missed", artist: "Before" }), false, "candidates-v6");
    const base = control([unverifiedRow]);
    const verify = verifyAs("555");
    await rebuild(base, A, [gen({ title: "Missed", artist: "Before", directions: ["safe"] })], { verify, score: scoreAs(0.2) });
    expect(verify.mock.calls[0]![0].map((c) => c.title)).toEqual(["Missed"]);
  });
  it("keeps production's precedence: the new safe candidate wins a recording shared with a reused one", async () => {
    const base = control();
    // the new safe song verifies to Song 1's recording (deezer:101), which the control has under "current"
    const r = await rebuild(base, A, [gen({ title: "Song One Alt", artist: "Artist 1", proposed_start: 70, proposed_end: 85, anchor_seconds: 72, directions: ["safe"] })],
      { verify: verifyAs("101"), score: scoreAs(0.99) });
    const s1 = r.scored.find((c) => c.catalog_key === "deezer:101")!;
    expect(s1.proposed_start).toBe(70);
    expect(s1.directions).toEqual(["safe", "current"]);
  });
});

describe("withoutSafe", () => {
  it("removes the safe direction and drops songs that had only safe", () => {
    expect(withoutSafe([gen({ directions: ["safe"] }), gen({ title: "B", directions: ["safe", "current"] })]).map((g) => [g.title, g.directions])).toEqual([["B", ["current"]]]);
  });
});

describe("needsRun", () => {
  const art = (over: Partial<TreatmentResult["treatment"]>) => ({ treatment: {
    status: "ok", attempts: 1, base_sha: "s", lists_version: CREATOR_LISTS_VERSION, prompt_version: CREATOR_PICKS_PROMPT_VERSION, ...over,
  } }) as TreatmentResult;
  it("keeps final results, retries a failure once, rebuilds stale ones", () => {
    expect(needsRun(null, "s")).toBe(true);
    expect(needsRun(art({}), "s")).toBe(false);
    expect(needsRun(art({ status: "failed", attempts: 1 }), "s")).toBe(true);
    expect(needsRun(art({ status: "failed", attempts: 2 }), "s")).toBe(false);
    expect(needsRun(art({}), "changed")).toBe(true);
    expect(needsRun(art({ lists_version: "old" }), "s")).toBe(true);
  });
});

import { withoutDirections } from "@/scripts/groundtruth/treatment-lib";
import { MODELS } from "@/src/shared/config";
import { PROMPT_VERSION } from "@/src/engine/candidates/generateCandidates";
describe("model run (docs/review/24 §13)", () => {
  it("regenerating every direction keeps nothing from the control's lists", () => {
    expect(withoutDirections([gen({ directions: ["safe", "current"] }), gen({ title: "U", directions: ["unexpected"] })], ["safe", "current", "unexpected"])).toEqual([]);
  });
  it("a cached artifact is stale when the model, directions or picks setting changes", () => {
    const t = { treatment: { status: "ok", attempts: 1, base_sha: "s", lists_version: CREATOR_LISTS_VERSION, prompt_version: PROMPT_VERSION, model: MODELS.candidates, directions: ["safe", "current", "unexpected"], picks: false } } as unknown as TreatmentResult;
    const run = { prompt_version: PROMPT_VERSION, model: MODELS.candidates, directions: ["safe", "current", "unexpected"] as ("safe" | "current" | "unexpected")[], picks: false };
    expect(needsRun(t, "s", run)).toBe(false);
    expect(needsRun(t, "s", { ...run, model: MODELS.candidatesStrong })).toBe(true);
    expect(needsRun(t, "s", { ...run, directions: ["safe"] })).toBe(true);
    expect(needsRun(t, "s", { ...run, picks: true })).toBe(true);
  });
});

import { spentDollars } from "@/scripts/groundtruth/treatment";
describe("spending cap", () => {
  it("prices Sonnet tokens and refuses unknown models", () => {
    expect(spentDollars(new Map([["claude-sonnet-5-5", { input: 1_000_000, output: 100_000 }]]))).toBeCloseTo(4.5, 5);
    expect(() => spentDollars(new Map([["claude-fable-5-1", { input: 1, output: 1 }]]))).toThrow(/no price/);
  });
});

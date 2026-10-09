import { describe, it, expect, vi } from "vitest";
import { rebuild, firstDifference, withoutSafe } from "@/scripts/groundtruth/treatment-lib";
import { diversify } from "@/src/engine/diversify/diversify";
import { selectSections } from "@/src/engine/sections/selectSections";
import { toCandidateInsert } from "@/src/engine/recommend";
import type { GeneratedCandidate, ScoredCandidate } from "@/src/shared/types";
import type { OursResult } from "@/scripts/groundtruth/ours";
import { analysis, brief, gen, scored } from "../engine/fixtures";

const A = { ...analysis, dialogue_present: true, duration_seconds: 20 };

/** A control run built the way production builds it: scored (sorted) → rows → diversify → sections. */
function control(): OursResult {
  const songs = Array.from({ length: 8 }, (_, i) => ({ title: `Song ${i}`, artist: `Artist ${i}`, dir: (["safe", "current", "unexpected"] as const)[i % 3]! }));
  const generated: GeneratedCandidate[] = songs.map((s) => gen({ title: s.title, artist: s.artist, directions: [s.dir] }));
  const sc: ScoredCandidate[] = songs.map((s, i) => scored({
    title: s.title, artist: s.artist, canonical_title: s.title, canonical_artist: s.artist, deezer_id: String(100 + i),
    catalog_key: `deezer:${100 + i}`, directions: [s.dir], total_score: i === 3 || i === 4 ? 0.6 : 0.9 - i * 0.05, // a tie at 0.6
  })).sort((a, b) => b.total_score - a.total_score);
  const finals = selectSections(diversify(sc), A).map((p) => ({ ...p, explanation: "x", spotify_url: "" }));
  return {
    analysis, brief, analysis_prompt_version: "v", analysis_raw: "", generated, generate_calls: 1,
    candidates: sc.map((c) => toCandidateInsert("s", c, true, "candidates-v6")), finals, recommend_error: null, elapsed_ms: 0,
  };
}
const noCalls = { verify: vi.fn(async () => { throw new Error("verify called"); }), score: vi.fn(async () => { throw new Error("score called"); }) };

describe("rebuild", () => {
  it("replay reproduces the control's picks and sections exactly, with no calls", async () => {
    const base = control();
    const r = await rebuild(base, A, "replay", noCalls);
    expect(firstDifference(r.picks, base.finals)).toBeNull();
    expect(r.newly_scored + r.newly_verified).toBe(0);
  });
  it("drops safe-only control songs, reuses the rest, verifies and scores only what is new", async () => {
    const base = control();
    const newSafe = [
      gen({ title: "Song 3", artist: "Artist 3", directions: ["safe"] }), // control had it under safe: same window → cached score
      gen({ title: "Fresh", artist: "New", directions: ["safe"] }),
    ];
    const verify = vi.fn(async (c: GeneratedCandidate[]) => ({ verified: c.map((x) => scored({ ...x, deezer_id: "999", catalog_key: "deezer:999", canonical_title: x.title, canonical_artist: x.artist })) }));
    const score = vi.fn(async (v: unknown[]) => (v as ScoredCandidate[]).map((x) => ({ ...x, total_score: 0.95 })));
    const r = await rebuild(base, A, newSafe, { verify, score }, [{ title: "Fresh", artist: "New", deezer_id: "999", groups: 2, types: ["emotional"] }]);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0]![0].map((c) => c.title)).toEqual(["Fresh"]);
    expect((score.mock.calls[0]![0] as ScoredCandidate[]).map((c) => c.title)).toEqual(["Fresh"]);
    const titles = r.picks.map((p) => p.canonical_title);
    expect(titles).not.toContain("Song 0"); // safe-only in control, not re-proposed
    expect(titles).toContain("Song 3");
    expect(r.picks[0]!.canonical_title).toBe("Fresh");
    expect(r.funnel).toEqual({ offered: 1, generated: 1, verified: 1, top15: 1, top5: 1 });
  });
  it("rescores a reused song when its window changed", async () => {
    const base = control();
    const score = vi.fn(async (v: unknown[]) => (v as ScoredCandidate[]).map((x) => ({ ...x, total_score: 0.1 })));
    const r = await rebuild(base, A, [gen({ title: "Song 3", artist: "Artist 3", proposed_start: 60, proposed_end: 75, anchor_seconds: 62, directions: ["safe"] })], { verify: noCalls.verify, score });
    expect((score.mock.calls[0]![0] as ScoredCandidate[]).map((c) => c.proposed_start)).toEqual([60]);
    expect(r.reused_scores).toBeGreaterThan(0);
  });
});

describe("withoutSafe", () => {
  it("removes the safe direction and drops songs that had only safe", () => {
    expect(withoutSafe([gen({ directions: ["safe"] }), gen({ title: "B", directions: ["safe", "current"] })]).map((g) => [g.title, g.directions])).toEqual([["B", ["current"]]]);
  });
});

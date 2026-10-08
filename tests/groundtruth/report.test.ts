import { describe, it, expect } from "vitest";
import { buildReport, type ClipReport } from "../../scripts/groundtruth/report";

const base = (over: Partial<ClipReport>): ClipReport => ({
  id: "c", file: "c.mp4", link: "", niche: "", notes: "", truth: { song: "S", artist: "A", start_seconds: 10 },
  duration_seconds: 20, verdict: null, ours: null, gemini: null, brief_diff: null, errors: [], ...over,
});
const verdict = (over: Partial<NonNullable<ClipReport["verdict"]>>): NonNullable<ClipReport["verdict"]> => ({
  result: "miss", lost_at: "not_generated", rank: null, our_start_seconds: null, section_error_seconds: null, matched: null, ...over,
});

const clips: ClipReport[] = [
  base({ id: "a", verdict: verdict({ result: "hit", lost_at: null, rank: 1, our_start_seconds: 12, section_error_seconds: 2, matched: { title: "S", artist: "A" } }) }),
  base({ id: "b", verdict: verdict({ result: "hit", lost_at: null, rank: 4, our_start_seconds: 20, section_error_seconds: 10, matched: { title: "S", artist: "A" } }) }),
  base({ id: "c", verdict: verdict({ result: "artist_hit", lost_at: "scored_out", matched: { title: "T", artist: "A" } }) }),
  base({ id: "d", verdict: verdict({ result: "miss", lost_at: "unverified" }) }),
  base({ id: "e", verdict: null, errors: ["ours: boom"] }),
];

describe("buildReport", () => {
  const { json, markdown } = buildReport({ tag: "t1", date: "2026-10-08", gemini_prompt_version: "gemini-paste-v1" }, clips);

  it("counts hits, artist hits, misses by stage and the median section error", () => {
    expect(json.summary).toEqual({
      clips: 5, compared: 4, hits: 2, artist_hits: 1, misses: 1, errors: 1,
      hit_rate: 0.5, artist_hit_rate: 0.25, median_section_error_seconds: 6, median_hit_rank: 2.5,
      misses_by_stage: { not_generated: 0, unverified: 1, scored_out: 1, diversified_out: 0 },
    });
  });

  it("writes the summary table and one section per clip", () => {
    expect(markdown).toContain("| Clips | 5 |");
    expect(markdown).toContain("| Hit rate | 2/4 (50%) |");
    expect(markdown).toContain("| Median section error | 6.0 s |");
    expect(markdown).toContain("| Misses by stage | unverified 1, scored_out 1 |");
    for (const id of ["a", "b", "c", "d", "e"]) expect(markdown).toContain(`## ${id}`);
    expect(markdown).toContain("ours: boom");
    expect(markdown).toContain("no Gemini analysis yet");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildReport, musicRole, type ClipReport } from "../../scripts/groundtruth/report";
import { parseGeminiReply } from "../../scripts/groundtruth/gemini";
import type { OursResult } from "../../scripts/groundtruth/ours";

const base = (over: Partial<ClipReport>): ClipReport => ({
  id: "c", file: "c.mp4", link: "", niche: "", notes: "", truth: { song: "S", artist: "A", start_seconds: 10 }, split: null,
  duration_seconds: 20, verdict: null, ours: null, gemini: null, brief_diff: null, judge: null, rating: null, errors: [], ...over,
});
const verdict = (over: Partial<NonNullable<ClipReport["verdict"]>>): NonNullable<ClipReport["verdict"]> => ({
  result: "miss", lost_at: "not_generated", rank: null, our_start_seconds: null, section_error_seconds: null, matched: null, ...over,
});
const hit = (rank: number, section_error_seconds: number) =>
  verdict({ result: "hit", lost_at: null, rank, our_start_seconds: 12, section_error_seconds, matched: { title: "S", artist: "A" } });

const clips: ClipReport[] = [
  base({ id: "a", verdict: hit(1, 2) }),
  base({ id: "b", verdict: hit(4, 10) }),
  base({ id: "c", verdict: verdict({ result: "artist_hit", lost_at: "scored_out", matched: { title: "T", artist: "A" } }) }),
  base({ id: "d", verdict: verdict({ result: "miss", lost_at: "unverified" }) }),
  base({ id: "e", verdict: null, errors: ["ours: boom"] }),
];

describe("buildReport", () => {
  const { json, markdown } = buildReport({ tag: "t1", date: "2026-10-08", gemini_prompt_version: "gemini-paste-v1" }, clips);

  it("counts hits, artist hits, misses by stage and the median section error", () => {
    expect(json.summary).toEqual({
      clips: 5, compared: 4, without_truth: 0, hits: 2, artist_hits: 1, misses: 1, errors: 1,
      hit_rate: 0.5, artist_hit_rate: 0.25, median_section_error_seconds: 6, median_hit_rank: 2.5,
      misses_by_stage: { not_generated: 0, unverified: 1, scored_out: 1, diversified_out: 0 },
      judge: { ours: 0, real: 0, tie: 0 }, rated: { clips: 0, picks: 0, good: 0 },
    });
  });

  it("writes the summary table and one section per clip", () => {
    expect(markdown).toContain("| Clips | 5 | 0 | 0 | 0 | 0 |");
    expect(markdown).toContain("| Hit rate | 2/4 (50%) | 0/0 (-) | 0/0 (-) | 0/0 (-) | 0/0 (-) |");
    expect(markdown).toContain("| Median section error | 6.0 s |");
    expect(markdown).toContain("| Misses by stage | unverified 1, scored_out 1 |");
    for (const id of ["a", "b", "c", "d", "e"]) expect(markdown).toContain(`## ${id}`);
    expect(markdown).toContain("ours: boom");
    expect(markdown).toContain("no Gemini analysis yet");
  });
});

describe("buildReport split by test/tune and by music role", () => {
  const ours = JSON.parse(readFileSync("tests/groundtruth/fixtures/ours.json", "utf8")) as OursResult;
  const geminiRaw = readFileSync("tests/groundtruth/fixtures/gemini-reply.md", "utf8");
  const gemini = (role: "amplify" | "punchline" | "narration" | "contrast") => {
    const parsed = parseGeminiReply(geminiRaw);
    return { parsed: { ...parsed, music: { ...parsed.music, role } }, raw: geminiRaw, prompt_version: "gemini-paste-v1" };
  };
  const judge = (winner: "ours" | "real" | "tie"): NonNullable<ClipReport["judge"]> => ({
    real: { title: "S", artist: "A", start_seconds: 10 }, ours: { rank: 1, title: "O", artist: "B", start_seconds: 0, end_seconds: 15, explanation: "e" },
    winner, confidence: "medium", reason: `judge says ${winner}`, order: { A: "real", B: "ours" }, prompt_version: "judge-v1", model: "m",
  });
  const clips: ClipReport[] = [
    base({ id: "t-amp", split: "test", gemini: gemini("amplify"), verdict: hit(1, 0), judge: judge("ours") }),
    base({ id: "t-narr", split: "test", gemini: gemini("narration"), verdict: verdict({}), judge: judge("real"), rating: { tag: "t1", picks: [{ rank: 1, title: "O", artist: "B", start: 0, end: 15, rating: "good" }, { rank: 2, title: "P", artist: "C", start: 0, end: 15, rating: "no" }] } }),
    base({ id: "u-punch", split: "tune", gemini: gemini("punchline"), verdict: hit(3, 5), judge: judge("tie") }),
    base({ id: "u-speech", split: "tune", ours: { ...ours, analysis: { ...ours.analysis, dialogue_present: true } }, verdict: verdict({}) }),
    base({ id: "u-silent", split: "tune", ours, verdict: hit(2, 1) }),
    base({ id: "u-contrast-speech", split: "tune", gemini: gemini("contrast"), ours: { ...ours, analysis: { ...ours.analysis, dialogue_present: true } }, verdict: verdict({}) }),
    base({ id: "unsplit", split: null, truth: null }),
  ];
  const { json, markdown } = buildReport({ tag: "t1", date: "2026-10-08", gemini_prompt_version: "gemini-paste-v1" }, clips);

  it("classifies the music role from Gemini first, else from our dialogue flag", () => {
    expect(clips.map(musicRole)).toEqual(["carries", "bed", "carries", "bed", "carries", "bed", null]);
  });

  it("puts the held-out test clips first as the headline, then splits the full table by split and role", () => {
    const headline = markdown.indexOf("## Headline (held-out test clips)");
    const full = markdown.indexOf("## All clips");
    expect(headline).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(headline);
    expect(markdown.slice(headline, full)).toContain("| Metric | Test | Test · song carries the edit | Test · quiet bed under speech |");
    expect(markdown.slice(headline, full)).toContain("| Hit rate | 1/2 (50%) | 1/1 (100%) | 0/1 (0%) |");
    expect(markdown.slice(headline, full)).toContain("| Judge prefers ours / real / tie | 1 / 1 / 0 | 1 / 0 / 0 | 0 / 1 / 0 |");
    expect(markdown.slice(full)).toContain("| Metric | All | Test | Tune | Song carries the edit | Quiet bed under speech |");
    expect(markdown.slice(full)).toContain("| Hit rate | 3/6 (50%) | 1/2 (50%) | 2/4 (50%) | 3/3 (100%) | 0/3 (0%) |");
    expect(markdown.slice(full)).toContain("| Dylan rated good | 1 of 2 picks on 1 clip | 1 of 2 picks on 1 clip | 0 of 0 picks on 0 clips |");
    expect(json.summary.judge).toEqual({ ours: 1, real: 1, tie: 1 });
    expect(json.by["test"]?.hits).toBe(1);
    expect(json.by["quiet bed under speech"]?.compared).toBe(3);
  });

  it("shows split, role, judge and rating on each clip", () => {
    const section = markdown.slice(markdown.indexOf("## t-narr"), markdown.indexOf("## u-punch"));
    expect(section).toContain("- split: test · music role: quiet bed under speech (Gemini: narration)");
    expect(section).toContain("- judge: prefers real (medium): judge says real");
    expect(section).toContain("- Dylan rated 1 of 2 good");
    expect(markdown.slice(markdown.indexOf("## u-silent"), markdown.indexOf("## u-contrast-speech"))).toContain("- split: tune · music role: song carries the edit (no speech)");
  });
});

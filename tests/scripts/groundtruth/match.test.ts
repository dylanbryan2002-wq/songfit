import { describe, expect, it } from "vitest";
import { feelingsCloseness, matchScore } from "@/scripts/groundtruth/match";

const ctx = { lyrics: new Map(), sections: {} as Record<string, unknown>, rankPct: new Map<string, number>(), songEnergy: new Map<string, { energy: number | null; valence: number | null }>() };
const song = (id: string, families: Record<string, string>, vocals = "instrumental") => ({ deezer_id: id, title: id, artist: "a", families, vocals, creator_uses: [] });
const zero = { Motivational: 0, Inspirational: 0, Reflective: 0, Heartfelt: 0, Sad: 0, Nostalgic: 0, Funny: 0, Upbeat: 0, Hype: 0, "Calm/Focused": 0, Dramatic: 0 };
const profile = (feelings: Partial<typeof zero>, extra: Record<string, unknown> = {}) => ({
  talking: "none", words: null, colour: { energy: 0.5, mood: 0.5 }, feelings: { ...zero, ...feelings }, vocals: "vocals OK",
  themes_fit: [], themes_avoid: [], content_type: "Aesthetic/Montage", story_feeling: null, ...extra,
});

describe("closeness matching (Dylan approved, 2026-10-11)", () => {
  it("feelings closeness is highest when the song has the feelings the video wants", () => {
    expect(feelingsCloseness({ ...zero, Sad: 1 }, { Sad: "high" })).toBeCloseTo(1, 5);
    expect(feelingsCloseness({ ...zero, Sad: 1 }, { Hype: "high" })).toBe(0);
  });

  it("low-confidence or flagged song labels count less", () => {
    const want = { ...zero, Sad: 1, Heartfelt: 1 };
    expect(feelingsCloseness(want, { Sad: "high", Heartfelt: "high" })).toBeGreaterThan(feelingsCloseness(want, { Sad: "high", Heartfelt: "flagged" }));
  });

  it("the song closer to the video's profile scores higher", () => {
    const p = profile({ "Calm/Focused": 0.9 });
    const near = matchScore(p, 0.2, song("near", { "Calm/Focused": "high" }), ctx);
    const far = matchScore(p, 0.2, song("far", { Hype: "high" }), ctx);
    expect(near.total).toBeGreaterThan(far.total);
  });

  it("a song with vocals loses the vocals signal when instrumental is preferred", () => {
    const p = profile({ Upbeat: 1 }, { vocals: "instrumental preferred", talking: "on camera" });
    expect(matchScore(p, 0.5, song("v", { Upbeat: "high" }, "vocals"), ctx).signals.talking).toBe(0);
  });

  it("lyric themes: fit beats neutral beats avoid", () => {
    const lyrics = new Map([["f", { theme: { main: "love" } }], ["n", { theme: { main: "partying" } }], ["x", { theme: { main: "grief/loss" } }]]);
    const p = profile({ Heartfelt: 1 }, { themes_fit: ["love"], themes_avoid: ["grief/loss"] });
    const s = (id: string) => matchScore(p, 0.3, song(id, { Heartfelt: "high" }), { ...ctx, lyrics }).signals.lyrics;
    expect([s("f"), s("n"), s("x")]).toEqual([1, 0.5, 0]);
  });
});

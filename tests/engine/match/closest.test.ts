import { describe, it, expect } from "vitest";
import { rankSongs, feelingsCloseness, applyExposure } from "@/src/engine/match/closest";
import { MATCH_WEIGHTS, EXPOSURE } from "@/src/engine/scoring/weights";
import type { SongEntry } from "@/src/engine/catalog/dictionary";

const zero = { Motivational: 0, Inspirational: 0, Reflective: 0, Heartfelt: 0, Sad: 0, Nostalgic: 0, Funny: 0, Upbeat: 0, Hype: 0, "Calm/Focused": 0, Dramatic: 0 };
const song = (id: string, over: Partial<SongEntry> = {}): SongEntry => ({
  id, title: id, artist: "a", year: 2020, feelings: {}, energy: 0.5, valence: 0.5, tempo: 100, vocals: "instrumental",
  explicit: false, theme: null, flags: [], sections: null, creator_types: [], rank_pct: 0.6, ...over,
});
const profile = (feelings: Partial<typeof zero>, over: Record<string, unknown> = {}) => ({
  reading: {
    talking: "none", words: null, colour: { energy: 0.5, mood: 0.5 }, feelings: { ...zero, ...feelings },
    vocals: "vocals OK", themes_fit: [], themes_avoid: [], content_type: "Aesthetic/Montage", story_feeling: null,
    key_moments: [], confidence: { feelings: "high", energy: "high", mood: "high", themes: "high" }, ...over,
  },
  pacing: null, energy: 0.5, mood: 0.5,
}) as any;

describe("closeness matching in the app (Dylan's design and weights, 2026-10-11)", () => {
  it("weights are the approved ones and add to 100", () => {
    expect(MATCH_WEIGHTS).toEqual({ type: 25, mood: 25, creator: 15, lyrics: 10, vocals: 10, familiarity: 10, section: 5 });
  });

  it("the song closest in feeling ranks first", () => {
    const songs = [song("hype", { feelings: { Hype: "high" } }), song("calm", { feelings: { "Calm/Focused": "high" } })];
    expect(rankSongs(profile({ "Calm/Focused": 1 }), songs)[0]!.song.id).toBe("calm");
  });

  it("creator evidence only counts for the same content type (repeating-songs fix)", () => {
    const p = profile({ Hype: 1 }, { content_type: "Motivational" });
    const same = rankSongs(p, [song("s", { feelings: { Hype: "high" }, creator_types: ["Motivational"] })])[0]!;
    const other = rankSongs(p, [song("o", { feelings: { Hype: "high" }, creator_types: ["Vlog"] })])[0]!;
    expect(same.signals.creator).toBe(1);
    expect(other.signals.creator).toBe(0);
  });

  it("feelings closeness is stretched per video: best match 1, worst 0 (repeating-songs fix)", () => {
    const songs = [song("a", { feelings: { Sad: "high" } }), song("b", { feelings: { Sad: "low", Funny: "high" } }), song("c", { feelings: { Funny: "high" } })];
    const r = rankSongs(profile({ Sad: 1 }), songs);
    const byId = Object.fromEntries(r.map((x) => [x.song.id, x.signals.feelings]));
    expect(byId.a).toBe(1);
    expect(byId.c).toBe(0);
  });

  it("raw feelings closeness: low-confidence labels count less", () => {
    const want = { ...zero, Sad: 1, Heartfelt: 1 };
    expect(feelingsCloseness(want, { Sad: "high", Heartfelt: "high" })).toBeGreaterThan(feelingsCloseness(want, { Sad: "high", Heartfelt: "flagged" }));
  });

  it("instrumental preferred: a vocal song loses the vocals signal but stays in", () => {
    const p = profile({ Upbeat: 1 }, { vocals: "instrumental preferred", talking: "on camera" });
    const r = rankSongs(p, [song("v", { feelings: { Upbeat: "high" }, vocals: "vocals" })]);
    expect(r).toHaveLength(1);
    expect(r[0]!.signals.vocals).toBe(0);
  });

  it("an instrumental is counted once (vocals), not again under lyrics (Dylan approved fix, 2026-10-11)", () => {
    const p = profile({ "Calm/Focused": 1 }, { vocals: "instrumental preferred", talking: "on camera" });
    const r = rankSongs(p, [song("i", { feelings: { "Calm/Focused": "high" }, theme: "none" })])[0]!;
    expect(r.signals.vocals).toBe(1);
    expect(r.signals.lyrics).toBe(0.5);
  });

  it("songs shown often to other creators recently rank a little lower, capped (Dylan, 2026-10-11)", () => {
    const ranked = rankSongs(profile({ Sad: 1 }), [song("often", { feelings: { Sad: "high" } }), song("fresh", { feelings: { Sad: "high" } })]);
    const out = applyExposure(ranked, new Map([["often", 3]]));
    expect(out[0]!.song.id).toBe("fresh");
    const capped = applyExposure(ranked, new Map([["often", 1000]]));
    expect(ranked[0]!.total - capped.find((x) => x.song.id === "often")!.total).toBeLessThanOrEqual(EXPOSURE.maxPoints + 1e-9);
  });
});

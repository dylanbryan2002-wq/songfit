import { describe, expect, it } from "vitest";
import { scoreSong, WEIGHTS } from "@/scripts/groundtruth/rank-test";

const base = { deezer_id: "s", title: "s", artist: "a", families: {}, vocals: "instrumental", creator_uses: [] as { type: string | null }[] };
const ctx = { lyrics: new Map(), sections: {} as Record<string, unknown>, rankPct: new Map<string, number>() };

describe("ranking signals (weights approved by Dylan, 2026-10-11)", () => {
  it("weights add to 100 with content type and mood equal", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(WEIGHTS.type).toBe(WEIGHTS.mood);
  });

  it("a song creators used for this content type beats an otherwise equal song", () => {
    const v = { type: "Motivational", format: "montage", mood_by_section: [] };
    const used = { ...base, deezer_id: "u", creator_uses: [{ type: "Motivational" }] };
    expect(scoreSong(v, used, ctx).total).toBeGreaterThan(scoreSong(v, base, ctx).total);
  });

  it("matching the video's mood words scores higher", () => {
    const v = { type: "Aesthetic/Montage", format: "montage", mood_by_section: [{ start: 0, end: 9, mood: ["calm", "dreamy"] }] };
    const calm = { ...base, families: { "Calm/Focused": "high" } };
    const hype = { ...base, families: { Hype: "high" } };
    expect(scoreSong(v, calm, ctx).signals.mood).toBeGreaterThan(scoreSong(v, hype, ctx).signals.mood);
  });

  it("vocals under talking lose the talking signal but keep the rest", () => {
    const v = { type: "Advice", format: "talking to camera", mood_by_section: [] };
    const s = scoreSong(v, { ...base, vocals: "vocals" }, ctx);
    expect(s.signals.talking).toBe(0);
    expect(s.total).toBeGreaterThan(0);
  });

  it("a lyric theme that suits the type beats a clash", () => {
    const v = { type: "Motivational", format: "montage", mood_by_section: [] };
    const lyrics = new Map([["fit", { deezer_id: "fit", theme: { main: "self-belief/empowerment" } }], ["clash", { deezer_id: "clash", theme: { main: "breakup/heartbreak" } }]]);
    const c = { ...ctx, lyrics };
    expect(scoreSong(v, { ...base, deezer_id: "fit" }, c).signals.lyrics).toBeGreaterThan(scoreSong(v, { ...base, deezer_id: "clash" }, c).signals.lyrics);
  });
});

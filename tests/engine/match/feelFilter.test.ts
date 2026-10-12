import { describe, it, expect } from "vitest";
import { feelFilter, BUTTON_FEELINGS } from "@/src/engine/match/feelFilter";
import { VIBE_TAGS } from "@/src/shared/vibe";

const song = (id: string, feelings: Record<string, string>, theme: string | null = null, vocals = "vocals") =>
  ({ id, title: id, artist: "a", year: null, feelings, energy: null, valence: null, tempo: null, vocals, explicit: false, theme, flags: [], sections: null, creator_types: [], rank_pct: null, film_score: false }) as never;

describe("feel buttons as a hard filter (Dylan approved, 2026-10-11)", () => {
  it("every button in the app has a mapping", () => {
    for (const t of VIBE_TAGS) expect(BUTTON_FEELINGS[t]).toBeDefined();
  });
  it("keeps only songs with the button's feelings (any of several buttons)", () => {
    const songs = [song("f", { Funny: "high" }), song("s", { Sad: "high" }), song("n", { Nostalgic: "medium" })];
    const r = feelFilter(["Funny", "Nostalgic"], songs, 1);
    expect(r.songs.map((s: { id: string }) => s.id).sort()).toEqual(["f", "n"]);
    expect(r.step).toBe(1);
  });
  it("Romantic: love or longing lyrics, or a Heartfelt instrumental", () => {
    const songs = [song("love", {}, "love"), song("inst", { Heartfelt: "high" }, "none", "instrumental"), song("party", { Upbeat: "high" }, "partying")];
    expect(feelFilter(["Romantic"], songs, 1).songs.map((s: { id: string }) => s.id).sort()).toEqual(["inst", "love"]);
  });
  it("relaxes step by step when too few songs survive, never adding opposite feelings", () => {
    const songs = [song("low", { Funny: "low" }), song("warm", { Heartfelt: "high" }), song("sad", { Sad: "high" }), song("blank", {})];
    const r = feelFilter(["Funny"], songs, 3);
    const ids = r.songs.map((s: { id: string }) => s.id);
    expect(ids).toContain("low");
    expect(ids).toContain("warm");
    expect(ids).not.toContain("sad");
    expect(r.step).toBeGreaterThan(1);
  });
  it("no buttons: nothing is filtered", () => {
    const songs = [song("a", { Sad: "high" })];
    expect(feelFilter([], songs, 3)).toEqual({ songs, step: 0 });
  });
});

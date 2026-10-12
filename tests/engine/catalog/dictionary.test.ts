import { describe, expect, it } from "vitest";
import { DICTIONARY, SongEntrySchema, FEELINGS } from "@/src/engine/catalog/dictionary";
import RAW from "@/src/engine/catalog/dictionary.data.json";

describe("song dictionary (new engine phase 1, Dylan 2026-10-11)", () => {
  it("holds all 5,589 songs (5,032 + 557 beats, 2026-10-12), each valid and unique", () => {
    expect(DICTIONARY.length).toBe(5589);
    expect(new Set(DICTIONARY.map((s) => s.id)).size).toBe(5589);
  });

  it("every row matches the schema", () => {
    for (const row of RAW as unknown[]) expect(SongEntrySchema.safeParse(row).success).toBe(true);
  });

  it("uses only the 11 feeling families", () => {
    for (const s of DICTIONARY) for (const f of Object.keys(s.feelings)) expect(FEELINGS).toContain(f);
  });

  it("never stores lyric text", () => {
    const text = JSON.stringify(RAW);
    expect(text).not.toMatch(/"(lyrics|plainLyrics|syncedLyrics|chorus_gist|lyric_text)"/);
  });

  it("only songs every source agrees are instrumental count as instrumental (Dylan: no lyrics under talking, 2026-10-12)", () => {
    const byTitle = (t: string) => DICTIONARY.find((s) => s.title === t)!;
    for (const t of ["Unfair", "Flow Joe", "Sun Models (feat. Madelyn Grant)"]) expect(byTitle(t).vocals).toBe("vocals");
    expect(DICTIONARY.filter((s) => s.vocals === "instrumental" && /\b(feat|ft)\.?\s/i.test(s.title))).toEqual([]);
    expect(byTitle("Voyager").vocals).toBe("instrumental");
  });

  it("film and game scores are marked from Deezer's genres (Dylan, 2026-10-12)", () => {
    const byTitle = (t: string) => DICTIONARY.find((s) => s.title.startsWith(t))!;
    for (const t of ["Top Gun Anthem", "Autobots", "Field of Hopes and Dreams", "Assassin's Creed IV Black Flag Main Theme"]) expect(byTitle(t).film_score).toBe(true);
    for (const t of ["Chimes", "Voyager", "In Motion"]) expect(byTitle(t).film_score).toBe(false);
  });

  it("no song is both instrumental and carrying a lyric theme (Dylan, 2026-10-11)", () => {
    const bad = DICTIONARY.filter((s) => s.vocals === "instrumental" && s.theme !== null && s.theme !== "none");
    expect(bad).toEqual([]);
  });
});

import { findDeezerTrackById } from "@/src/engine/catalog/deezer";
describe("Deezer lookup by known id (new engine)", () => {
  it("returns the track, or null when Deezer has no such track", async () => {
    const ok = async () => new Response(JSON.stringify({ id: 1, title: "T", duration: 200, preview: "p", link: "l", artist: { name: "A" } }));
    expect((await findDeezerTrackById("1", ok as never))?.title).toBe("T");
    const none = async () => new Response(JSON.stringify({ error: { code: 800, message: "no data" } }));
    expect(await findDeezerTrackById("2", none as never)).toBeNull();
  });
});

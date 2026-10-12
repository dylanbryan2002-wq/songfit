import { describe, expect, it } from "vitest";
import { DICTIONARY, SongEntrySchema, FEELINGS } from "@/src/engine/catalog/dictionary";
import RAW from "@/src/engine/catalog/dictionary.data.json";

describe("song dictionary (new engine phase 1, Dylan 2026-10-11)", () => {
  it("holds all 5,032 songs, each valid and unique", () => {
    expect(DICTIONARY.length).toBe(5032);
    expect(new Set(DICTIONARY.map((s) => s.id)).size).toBe(5032);
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
});

import { describe, expect, it } from "vitest";
import { rankPool } from "@/scripts/groundtruth/filter-test";

const song = (id: string, families: Record<string, string>, vocals = "instrumental") => ({ deezer_id: id, title: id, artist: "x", families, vocals });
const noLyrics = new Map();

describe("rankPool (Dylan's filter decisions, 2026-10-11)", () => {
  it("keeps every song when no feel button is tapped, matching feelings first", () => {
    const pool = [song("sad", { Sad: "high" }), song("hype", { Hype: "high" })];
    const out = rankPool({ type: "Motivational", format: "montage" }, pool, noLyrics);
    expect(out.map((r) => r.song.deezer_id)).toEqual(["hype", "sad"]);
  });

  it("feel button is a hard filter", () => {
    const pool = [song("sad", { Sad: "high" }), song("funny", { Funny: "medium" })];
    const out = rankPool({ type: "Motivational", format: "montage" }, pool, noLyrics, ["Funny"]);
    expect(out.map((r) => r.song.deezer_id)).toEqual(["funny"]);
  });

  it("talking puts vocal songs below instrumental ones but keeps them", () => {
    const pool = [song("vocal", { Hype: "high" }, "vocals"), song("inst", { Hype: "high" })];
    const out = rankPool({ type: "Motivational", format: "talking to camera" }, pool, noLyrics);
    expect(out.map((r) => r.song.deezer_id)).toEqual(["inst", "vocal"]);
  });

  it("unlabelled songs sit below matches and above labelled non-matches", () => {
    const pool = [song("off", { Sad: "high" }), song("blank", {}), song("on", { Hype: "high" })];
    const out = rankPool({ type: "Motivational", format: "montage" }, pool, noLyrics);
    expect(out.map((r) => r.song.deezer_id)).toEqual(["on", "blank", "off"]);
  });

  it("a lyric clash ranks a song lower without removing it", () => {
    const pool = [song("breakup", { Upbeat: "high" }), song("fine", { Upbeat: "high" })];
    const lyrics = new Map([["breakup", { deezer_id: "breakup", theme: { main: "breakup/heartbreak" } }]]);
    const out = rankPool({ type: "Funny/Upbeat", format: "montage" }, pool, lyrics);
    expect(out.map((r) => r.song.deezer_id)).toEqual(["fine", "breakup"]);
  });

  it("storytelling uses its feeling to pick allowed songs (Dylan, 2026-10-11)", () => {
    const pool = [song("funny", { Funny: "high" }), song("sad", { Sad: "high" })];
    const sad = rankPool({ type: "Storytelling", story_feeling: "sad", format: "montage" }, pool, noLyrics);
    expect(sad[0]!.song.deezer_id).toBe("sad");
    const funny = rankPool({ type: "Storytelling", story_feeling: "funny", format: "montage" }, pool, noLyrics);
    expect(funny[0]!.song.deezer_id).toBe("funny");
  });

  it("old v1 story types still map to the new storytelling feelings", () => {
    const pool = [song("insp", { Inspirational: "high" }), song("funny", { Funny: "high" })];
    const out = rankPool({ type: "Inspirational storytelling", format: "montage" }, pool, noLyrics);
    expect(out[0]!.song.deezer_id).toBe("insp");
  });

  it("building in public prefers inspirational and motivational songs", () => {
    const pool = [song("sad", { Sad: "high" }), song("drive", { Motivational: "high" })];
    const out = rankPool({ type: "Building in public", format: "talking to camera" }, pool, noLyrics);
    expect(out[0]!.song.deezer_id).toBe("drive");
  });
});

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
});

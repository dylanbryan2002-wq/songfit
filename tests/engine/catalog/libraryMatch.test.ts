import { describe, it, expect } from "vitest";
import { libraryPicks, matchScore, jobFor, LIBRARY_SONGS, type LibrarySong } from "@/src/engine/catalog/libraryMatch";
import { analysis, brief } from "../fixtures";

const song = (over: Partial<LibrarySong>): LibrarySong => ({
  id: "1", title: "T", artist: "A", jobs: ["drive_energy"], energy: 5, era: "2010s", year: 2015, fam: "known",
  vocals: "yes", rank: 500000, mood: [], hook: "", proven: false, ...over,
});
const withJob = (music_job: "quiet_bed" | "drive_energy" | "familiar_anthem") => ({ ...brief, fields: { ...brief.fields, music_job } });

describe("library data", () => {
  it("ships confident songs only, each with at least one job", () => {
    expect(LIBRARY_SONGS.length).toBeGreaterThan(1000);
    expect(LIBRARY_SONGS.every((s) => s.jobs.length > 0 && s.fam !== "unknown")).toBe(true);
  });
});

describe("matching", () => {
  it("only matches songs that can do the video's job", () => {
    expect(matchScore(song({ jobs: ["quiet_bed"] }), "drive_energy", analysis, brief)).toBe(-1);
    expect(matchScore(song({}), "drive_energy", analysis, brief)).toBeGreaterThan(0);
  });
  it("prefers instrumentals for a quiet bed under speech", () => {
    const talking = { ...analysis, dialogue_present: true, energy: "low" as const };
    const inst = matchScore(song({ jobs: ["quiet_bed"], energy: 1, vocals: "no" }), "quiet_bed", talking, withJob("quiet_bed"));
    const voc = matchScore(song({ jobs: ["quiet_bed"], energy: 1, vocals: "yes" }), "quiet_bed", talking, withJob("quiet_bed"));
    expect(inst).toBeGreaterThan(voc);
  });
  it("falls back to a job for older briefs", () => {
    expect(jobFor({ ...analysis, dialogue_present: true, energy: "low" }, brief)).toBe("quiet_bed");
    expect(jobFor({ ...analysis, dialogue_present: false, energy: "high" }, brief)).toBe("drive_energy");
    expect(jobFor(analysis, withJob("familiar_anthem"))).toBe("familiar_anthem");
  });
  it("picks one song per artist, caps any era at half, and rotates between videos", () => {
    const songs = Array.from({ length: 60 }, (_, i) => song({ id: String(i), artist: `A${i % 30}`, era: i % 2 ? "2010s" : "2020s" }));
    const a = libraryPicks(analysis, withJob("drive_energy"), { songs, n: 10, seed: "video-1" }).picks;
    const b = libraryPicks(analysis, withJob("drive_energy"), { songs, n: 10, seed: "video-2" }).picks;
    expect(new Set(a.map((s) => s.artist)).size).toBe(10);
    expect(a.filter((s) => s.era === "2010s").length).toBeLessThanOrEqual(5);
    expect(a.map((s) => s.id).join()).not.toBe(b.map((s) => s.id).join());
    expect(libraryPicks(analysis, withJob("drive_energy"), { songs, n: 10, seed: "video-1" }).picks.map((s) => s.id)).toEqual(a.map((s) => s.id));
  });
});

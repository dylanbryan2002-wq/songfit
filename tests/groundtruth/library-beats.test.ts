import { describe, expect, it } from "vitest";
import { beatPlaylist, selectBeats } from "../../scripts/groundtruth/library-expand";

const t = (id: number, rank: number, title: string, artist: string) => ({ id, rank, title, preview: "p", artist: { id: id * 10, name: artist } });

describe("energetic beats for talking videos (Dylan, 2026-10-12: fix both)", () => {
  it("keeps beat and instrumental playlists, skips calm ones", () => {
    expect(beatPlaylist("Gym Beats | Motivational Instrumentals")).toBe(true);
    expect(beatPlaylist("GYM PHONK 2025")).toBe(true);
    expect(beatPlaylist("Lofi beats to study to")).toBe(false);
    expect(beatPlaylist("Chill Rap Instrumentals")).toBe(false);
    expect(beatPlaylist("80s mixtape type beat")).toBe(false);
  });

  it("takes the most popular per style, skips featured artists, re-edits, songs already in, and caps each artist", () => {
    const tracks = [
      t(1, 900_000, "Big Beat", "A"), t(2, 800_000, "Big Beat (Slowed)", "A"), t(3, 700_000, "Song (feat. X)", "B"),
      t(4, 600_000, "Two", "A"), t(5, 500_000, "Three", "A"), t(6, 400_000, "Four", "A"), t(7, 300_000, "Five", "A"),
      t(8, 30_000, "Too small", "C"), t(9, 200_000, "Already", "D"),
    ];
    const picked = selectBeats(tracks, { have: new Set(["9"]), perStyle: 10, minRank: 40_000, artistCap: 4 });
    expect(picked.map((x) => x.id)).toEqual([1, 4, 5, 6]);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { compareClip, briefDiff, type OursSummary } from "../../scripts/groundtruth/compare";
import { parseGeminiReply } from "../../scripts/groundtruth/gemini";
import { analysis, brief } from "../engine/fixtures";

const truth = { song: "Blinding Lights", artist: "The Weeknd", start_seconds: 40 };

const cand = (title: string, artist: string, verified: boolean, total_score: number | null) => ({
  title, artist, canonical_title: verified ? title : null, canonical_artist: verified ? artist : null, verified, total_score,
});
const final = (rank: number, title: string, artist: string, start_seconds: number) =>
  ({ rank, canonical_title: title, canonical_artist: artist, start_seconds });

/** 20 verified decoys scored 0.9..0.71 so a lower-scored real song falls outside the top 15. */
const decoys = Array.from({ length: 20 }, (_, i) => cand(`Decoy ${i}`, `Artist ${i}`, true, 0.9 - i * 0.01));
const decoyFinals = decoys.slice(0, 15).map((c, i) => final(i + 1, c.title, c.artist, 10));

function ours(over: Partial<OursSummary> = {}): OursSummary {
  return { generated: decoys.map(({ title, artist }) => ({ title, artist })), candidates: decoys, finals: decoyFinals, ...over };
}

describe("compareClip", () => {
  it("is a hit with rank and section error when the real song is in the finals", () => {
    const o = ours({
      generated: [...ours().generated, { title: "Blinding Lights", artist: "The Weeknd" }],
      candidates: [...decoys, cand("Blinding Lights (Official)", "The Weeknd", true, 0.95)],
      finals: [final(1, "Blinding Lights (Official)", "The Weeknd", 43), ...decoyFinals.slice(1)],
    });
    expect(compareClip(truth, o)).toEqual({
      result: "hit", lost_at: null, rank: 1, our_start_seconds: 43, section_error_seconds: 3,
      matched: { title: "Blinding Lights (Official)", artist: "The Weeknd" },
    });
  });

  it("is an artist hit when only a different song by a credited artist is in the finals", () => {
    const o = ours({ finals: [final(3, "Starboy", "The Weeknd feat. Daft Punk", 20), ...decoyFinals.slice(1)] });
    const v = compareClip(truth, o);
    expect(v.result).toBe("artist_hit");
    expect(v.lost_at).toBe("not_generated");
    expect(v.matched).toEqual({ title: "Starboy", artist: "The Weeknd feat. Daft Punk" });
    expect(v.rank).toBeNull();
  });

  it("names not_generated when the song never appeared in the candidate list", () => {
    expect(compareClip(truth, ours())).toMatchObject({ result: "miss", lost_at: "not_generated", rank: null, section_error_seconds: null });
  });

  it("names unverified when it was generated but dropped by verification", () => {
    const o = ours({
      generated: [...ours().generated, { title: "blinding lights", artist: "the weeknd" }],
      candidates: [...decoys, cand("blinding lights", "The Weeknd", false, null)],
    });
    expect(compareClip(truth, o)).toMatchObject({ result: "miss", lost_at: "unverified" });
  });

  it("names scored_out when verified but below the top 15 by score", () => {
    const o = ours({
      generated: [...ours().generated, { title: "Blinding Lights", artist: "The Weeknd" }],
      candidates: [...decoys, cand("Blinding Lights", "The Weeknd", true, 0.5)],
    });
    expect(compareClip(truth, o)).toMatchObject({ result: "miss", lost_at: "scored_out" });
  });

  it("names diversified_out when in the top 15 by score but not in the finals", () => {
    const o = ours({
      generated: [...ours().generated, { title: "Blinding Lights", artist: "The Weeknd" }],
      candidates: [...decoys, cand("Blinding Lights", "The Weeknd", true, 0.85)],
    });
    expect(compareClip(truth, o)).toMatchObject({ result: "miss", lost_at: "diversified_out" });
  });

  it("matches the core title and any shared artist token", () => {
    const t = { song: "Sunflower", artist: "Post Malone & Swae Lee", start_seconds: 0 };
    const o = ours({ finals: [final(2, "Sunflower (Spider-Man: Into the Spider-Verse)", "Swae Lee", 0), ...decoyFinals.slice(1)] });
    expect(compareClip(t, o).result).toBe("hit");
  });
});

describe("briefDiff", () => {
  it("lists ours against gemini field by field", () => {
    const g = {
      ...parseGeminiReply(readFileSync("tests/groundtruth/fixtures/gemini-reply.md", "utf8")),
      content_category: "fashion" as const, energy: "high" as const, pacing: "medium" as const, mood: ["confident", "playful"],
      key_moments: [{ time: 8, type: "climax" }],
      brief: { text: "t", moods: [], energy: 0.72, tempo: "medium-high" as const, vocals: "either" as const, genres: [], familiarity: "unexpected" as const },
    };
    expect(briefDiff({ analysis, brief }, g)).toEqual({
      energy: { ours: "medium-high", gemini: "high" },
      pacing: { ours: "medium", gemini: "medium" },
      category: { ours: "fashion", gemini: "fashion" },
      mood: { ours: ["confident", "mysterious"], gemini: ["confident", "playful"], shared: ["confident"] },
      moments: { ours: [7.8], gemini: [8] },
      brief_energy: { ours: 0.72, gemini: 0.72 },
      tempo: { ours: "medium-high", gemini: "medium-high" },
      vocals: { ours: "either", gemini: "either" },
    });
  });
});

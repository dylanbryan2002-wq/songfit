import { describe, it, expect } from "vitest";
import { VideoAnalysis, MusicBrief, GeneratedCandidate, RecommendationView, DIRECTION_LABEL, BEST_FIT_LABEL, RankSchema } from "@/src/shared/types";

const validAnalysis = {
  summary: "Creator walks through NYC at night and reveals an outfit.",
  content_type: "fashion lifestyle reel",
  content_category: "fashion",
  setting: "New York at night",
  story: "walk then reveal",
  aesthetic: ["luxury", "urban"],
  mood: ["confident", "mysterious"],
  energy: "medium-high",
  pacing: "medium",
  dialogue_present: false,
  important_moments: [{ time: 7.8, type: "main_visual_reveal", note: "outfit reveal" }],
};

describe("VideoAnalysis schema", () => {
  it("accepts a valid analysis", () => {
    expect(VideoAnalysis.parse(validAnalysis)).toEqual(validAnalysis);
  });

  it("rejects an unknown energy value", () => {
    expect(() => VideoAnalysis.parse({ ...validAnalysis, energy: "extreme" })).toThrow();
  });

  it("rejects negative moment times", () => {
    expect(() =>
      VideoAnalysis.parse({ ...validAnalysis, important_moments: [{ time: -1, type: "x" }] }),
    ).toThrow();
  });
});

describe("MusicBrief schema", () => {
  it("rejects energy outside 0..1", () => {
    expect(() =>
      MusicBrief.parse({
        text: "brief",
        fields: {
          moods: ["cool"],
          energy: 1.4,
          tempo_preference: "medium-high",
          vocal_preference: "either",
          genre_preferences: [],
          genre_avoid: [],
          dialogue_present: false,
          desired_cultural_relevance: "high",
          desired_familiarity: "recognizable_not_overused",
        },
      }),
    ).toThrow();
  });
});

describe("GeneratedCandidate schema", () => {
  const valid = {
    title: "Blinding Lights",
    artist: "The Weeknd",
    proposed_start: 40,
    proposed_end: 55,
    anchor_seconds: 43,
    section_is_vocal: true,
    section_reason: "chorus enters at 0:43",
    fit_reason: "neon night-drive energy matches the city walk",
    directions: ["safe", "current"],
  };
  it("accepts a candidate with anchor, vocal flag and directions", () => {
    expect(GeneratedCandidate.parse(valid)).toEqual(valid);
  });
  it("rejects an empty directions list", () => {
    expect(() => GeneratedCandidate.parse({ ...valid, directions: [] })).toThrow();
  });
  it("rejects a missing anchor", () => {
    const { anchor_seconds: _omit, ...noAnchor } = valid;
    expect(() => GeneratedCandidate.parse(noAnchor)).toThrow();
  });
});

describe("RecommendationView schema", () => {
  it("has no score or reason fields", () => {
    const keys = Object.keys(RecommendationView.shape).sort();
    expect(keys).toEqual(
      [
        "artwork_url",
        "artist",
        "direction_label",
        "end_seconds",
        "explanation",
        "preview_url",
        "rank",
        "rejected",
        "selected",
        "spotify_url",
        "start_seconds",
        "title",
      ].sort(),
    );
  });
});

describe("DIRECTION_LABEL", () => {
  it("maps runner-up directions to creator-facing labels and reserves Best fit for rank 1", () => {
    expect(DIRECTION_LABEL).toEqual({
      safe: "Safe bet",
      current: "More current",
      unexpected: "Unexpected",
    });
    expect(BEST_FIT_LABEL).toBe("Best fit");
    expect(Object.values(DIRECTION_LABEL)).not.toContain(BEST_FIT_LABEL);
  });
  it("ranks run 1..15, integers only", () => {
    for (const r of [1, 8, 15]) expect(RankSchema.safeParse(r).success).toBe(true);
    for (const r of [0, 16, 1.5, "1"]) expect(RankSchema.safeParse(r).success).toBe(false);
  });
});

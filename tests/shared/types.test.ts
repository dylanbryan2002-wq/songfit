import { describe, it, expect } from "vitest";
import { VideoAnalysis, MusicBrief, GeneratedCandidate, VerifiedCandidate, PickerRow, DIRECTION_LABEL, BEST_FIT_LABEL, RankSchema } from "@/src/shared/types";
import { PICKS_TOTAL } from "@/src/shared/config";

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

describe("VerifiedCandidate schema (samples-only rule)", () => {
  const verified = {
    title: "Found", artist: "A", proposed_start: 43, proposed_end: 58, anchor_seconds: 45, section_is_vocal: true,
    section_reason: "chorus", fit_reason: "fits", directions: ["safe"], verified_via: "deezer", catalog_key: "deezer:7", deezer_id: "7", itunes_id: null,
    canonical_title: "Found", canonical_artist: "A", duration_seconds: 200, artwork_url: null,
    deezer_url: "https://d/7", preview_url: "https://p.mp3",
  };
  it("accepts a Deezer candidate with a preview", () => {
    expect(VerifiedCandidate.parse(verified)).toMatchObject({ preview_url: "https://p.mp3" });
  });
  it("rejects a missing preview and iTunes verification", () => {
    expect(() => VerifiedCandidate.parse({ ...verified, preview_url: null })).toThrow();
    expect(() => VerifiedCandidate.parse({ ...verified, verified_via: "itunes" })).toThrow();
  });
});

describe("PickerRow schema (the browser shape)", () => {
  it("has no score or reason fields", () => {
    const keys = Object.keys(PickerRow.shape).sort();
    expect(keys).toEqual(
      [
        "artwork_url",
        "artist",
        "deezer_id",
        "deezer_url",
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
  it("ranks run 1..PICKS_TOTAL, integers only", () => {
    expect(PICKS_TOTAL).toBe(15);
    for (const r of [1, 8, 15]) expect(RankSchema.safeParse(r).success).toBe(true);
    for (const r of [0, 16, 1.5, "1"]) expect(RankSchema.safeParse(r).success).toBe(false);
  });
});

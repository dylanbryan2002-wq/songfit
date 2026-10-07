import { describe, expect, it } from "vitest";
import { toRecommendationView } from "../../src/feedback/recommendationView";

describe("toRecommendationView", () => {
  it("exposes only creator-facing fields", () => {
    const row = {
      id: "r1", submission_id: "s1", candidate_id: "c1", rank: 1, direction_label: "Best fit",
      title: "Song", artist: "Artist", start_seconds: 43, end_seconds: 58, explanation: "Why.",
      spotify_url: "https://open.spotify.com/search/Song%20Artist", deezer_url: "https://deezer.com/track/1",
      artwork_url: null, preview_url: null, selected: false, rejected: false, created_at: "2026-10-06T00:00:00Z",
      explain_prompt_version: "explain-v1",
    };
    expect(toRecommendationView(row as never)).toEqual({
      rank: 1, direction_label: "Best fit", title: "Song", artist: "Artist",
      start_seconds: 43, end_seconds: 58, explanation: "Why.", artwork_url: null, preview_url: null,
      spotify_url: "https://open.spotify.com/search/Song%20Artist", selected: false, rejected: false,
    });
  });
});

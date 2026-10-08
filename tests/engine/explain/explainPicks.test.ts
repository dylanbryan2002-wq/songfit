import { describe, it, expect, vi } from "vitest";

import { explainPicks, spotifySearchUrl, buildExplainPrompt } from "@/src/engine/explain/explainPicks";
import { analysis, brief, pick } from "../fixtures";

const three = () => [
  pick({ rank: 1, title: "Song 1", canonical_title: "Song 1", canonical_artist: "Canon Artist", aligned_to_moment: 7.8 }),
  pick({ rank: 2, deezer_id: "2", title: "Song 2", canonical_title: "Song 2", direction_label: "More current" }),
  pick({ rank: 3, deezer_id: "3", title: "Song 3", canonical_title: "Song 3", direction_label: "Unexpected", preview_url: "https://d.mp3" }),
];
const ok = JSON.stringify([{ rank: 1, explanation: "One." }, { rank: 2, explanation: "Two." }, { rank: 3, explanation: "Three." }]);

describe("explainPicks", () => {
  it("attaches three explanations and spotify urls from canonical names", async () => {
    const call = vi.fn(async () => ok);
    const out = await explainPicks(three(), analysis, brief, { call });
    expect(out.map((r) => r.explanation)).toEqual(["One.", "Two.", "Three."]);
    expect(out[0]!.spotify_url).toBe("https://open.spotify.com/search/" + encodeURIComponent("Song 1 Canon Artist"));
    expect(out[0]!.spotify_url).toBe(spotifySearchUrl("Song 1", "Canon Artist"));
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("passes the pick's Deezer preview and verification itunes_id through unchanged (previews are Deezer-only)", async () => {
    const picks = [
      ...three().slice(0, 2),
      pick({ rank: 3, verified_via: "itunes", deezer_id: null, itunes_id: "55", deezer_url: null, preview_url: null, title: "Hello", canonical_title: "Hello" }),
    ];
    const out = await explainPicks(picks, analysis, brief, { call: async () => ok });
    expect(out.map((r) => r.preview_url)).toEqual([null, null, null]);
    expect(out.map((r) => r.itunes_id)).toEqual([null, null, "55"]);
    const withPreview = await explainPicks(three(), analysis, brief, { call: async () => ok });
    expect(withPreview[2]).toMatchObject({ preview_url: "https://d.mp3", itunes_id: null });
  });
  it("retries once when a rank is missing, then throws", async () => {
    const call = vi.fn(async () => JSON.stringify([{ rank: 1, explanation: "One." }]));
    await expect(explainPicks(three(), analysis, brief, { call })).rejects.toThrow(/explanation output invalid/);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("recovers when the retry is valid", async () => {
    const call = vi.fn().mockResolvedValueOnce("[]").mockResolvedValueOnce(ok);
    const out = await explainPicks(three(), analysis, brief, { call });
    expect(out).toHaveLength(3);
  });
  it("tells the model about alignment only where it happened", () => {
    const p = buildExplainPrompt(three(), analysis, brief);
    expect(p).toMatch(/#1 .*aligned: the song's moment lands at 0:07/);
    expect(p).toMatch(/#2 .*aligned: no/);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const flags = vi.hoisted(() => ({ previews: false }));
vi.mock("@/src/shared/config", async (orig) => {
  const m = await orig<typeof import("@/src/shared/config")>();
  return { ...m, get PREVIEWS_ENABLED() { return flags.previews; } };
});

import { explainPicks, spotifySearchUrl, buildExplainPrompt } from "@/src/engine/explain/explainPicks";
import { analysis, brief, pick } from "../fixtures";

const three = () => [
  pick({ rank: 1, title: "Song 1", canonical_title: "Song 1", canonical_artist: "Canon Artist", aligned_to_moment: 7.8 }),
  pick({ rank: 2, deezer_id: "2", title: "Song 2", canonical_title: "Song 2", direction_label: "More current" }),
  pick({ rank: 3, deezer_id: "3", title: "Song 3", canonical_title: "Song 3", direction_label: "Unexpected", preview_url: "https://d.mp3" }),
];
const ok = JSON.stringify([{ rank: 1, explanation: "One." }, { rank: 2, explanation: "Two." }, { rank: 3, explanation: "Three." }]);

beforeEach(() => { flags.previews = false; });

describe("explainPicks", () => {
  it("attaches three explanations and spotify urls from canonical names; no iTunes calls when previews are off", async () => {
    const call = vi.fn(async () => ok);
    const itunes = vi.fn(async () => null);
    const out = await explainPicks(three(), analysis, brief, { call, itunes });
    expect(out.map((r) => r.explanation)).toEqual(["One.", "Two.", "Three."]);
    expect(out[0]!.spotify_url).toBe("https://open.spotify.com/search/" + encodeURIComponent("Song 1 Canon Artist"));
    expect(out[0]!.spotify_url).toBe(spotifySearchUrl("Song 1", "Canon Artist"));
    expect(itunes).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("asks iTunes only for picks missing a preview when enabled; failures never block", async () => {
    flags.previews = true;
    const itunes = vi.fn(async (title: string) => {
      if (title === "Song 2") return { itunesId: "99", previewUrl: "https://i.m4a" };
      throw new Error("boom");
    });
    const out = await explainPicks(three(), analysis, brief, { call: async () => ok, itunes });
    expect(out[1]).toMatchObject({ preview_url: "https://i.m4a", itunes_id: "99" });
    expect(out[2]).toMatchObject({ preview_url: "https://d.mp3", itunes_id: null });
    expect(itunes.mock.calls.map((c) => c[0])).toEqual(["Song 1", "Song 2"]);
  });
  it("retries once when a rank is missing, then throws", async () => {
    const call = vi.fn(async () => JSON.stringify([{ rank: 1, explanation: "One." }]));
    await expect(explainPicks(three(), analysis, brief, { call, itunes: async () => null })).rejects.toThrow(/explanation output invalid/);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("recovers when the retry is valid", async () => {
    const call = vi.fn().mockResolvedValueOnce("[]").mockResolvedValueOnce(ok);
    const out = await explainPicks(three(), analysis, brief, { call, itunes: async () => null });
    expect(out).toHaveLength(3);
  });
  it("tells the model about alignment only where it happened", () => {
    const p = buildExplainPrompt(three(), analysis, brief);
    expect(p).toMatch(/#1 .*aligned: the song's moment lands at 0:07/);
    expect(p).toMatch(/#2 .*aligned: no/);
  });
});

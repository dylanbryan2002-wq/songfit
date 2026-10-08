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
  it("calls with low effort and a 3000-token cap, first try and retry", async () => {
    const call = vi.fn().mockResolvedValueOnce("[]").mockResolvedValueOnce(ok);
    await explainPicks(three(), analysis, brief, { call });
    for (const c of call.mock.calls) expect(c[0]).toMatchObject({ effort: "low", maxTokens: 3000 });
  });
  it("passes the pick's Deezer preview through unchanged, with no iTunes id", async () => {
    const out = await explainPicks(three(), analysis, brief, { call: async () => ok });
    expect(out[2]).toMatchObject({ preview_url: "https://d.mp3", itunes_id: null });
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
  it("explains 15 picks in three parallel calls of five, each listing only its own picks", async () => {
    const picks = Array.from({ length: 15 }, (_, i) => pick({ rank: i + 1, deezer_id: String(i + 1), title: `Song ${i + 1}`, canonical_title: `Song ${i + 1}` }));
    const call = vi.fn(async ({ user }: { user: string }) => {
      const ranks = [...user.matchAll(/^#(\d+) /gm)].map((m) => Number(m[1]));
      return JSON.stringify(ranks.map((rank) => ({ rank, explanation: `E${rank}.` })));
    });
    const out = await explainPicks(picks, analysis, brief, { call });
    expect(call).toHaveBeenCalledTimes(3);
    const users = call.mock.calls.map((c) => c[0].user);
    expect(users[1]).toMatch(/these 5 picks/);
    expect(users[1]).toMatch(/^#6 /m);
    expect(users[1]).not.toMatch(/^#5 /m);
    expect(out.map((r) => r.explanation)).toEqual(picks.map((p) => `E${p.rank}.`));
  });
  it("retries only the batch that missed a rank", async () => {
    const picks = Array.from({ length: 10 }, (_, i) => pick({ rank: i + 1, deezer_id: String(i + 1) }));
    let secondBatchTries = 0;
    const call = vi.fn(async ({ user }: { user: string }) => {
      const ranks = [...user.matchAll(/^#(\d+) /gm)].map((m) => Number(m[1]));
      if (ranks[0] === 6 && ++secondBatchTries === 1) ranks.pop();
      return JSON.stringify(ranks.map((rank) => ({ rank, explanation: `E${rank}.` })));
    });
    const out = await explainPicks(picks, analysis, brief, { call });
    expect(call).toHaveBeenCalledTimes(3);
    expect(secondBatchTries).toBe(2);
    expect(out).toHaveLength(10);
  });
  it("tells the model about alignment only where it happened", () => {
    const p = buildExplainPrompt(three(), analysis, brief);
    expect(p).toMatch(/#1 .*aligned: the song's moment lands at 0:07/);
    expect(p).toMatch(/#2 .*aligned: no/);
  });
});

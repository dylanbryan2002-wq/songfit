import { describe, it, expect, vi } from "vitest";
import { validateSection, verifyCandidates } from "@/src/engine/catalog/verifyCandidates";
import { ProviderError, type DeezerTrack } from "@/src/engine/catalog/deezer";
import { gen } from "../fixtures";

describe("validateSection", () => {
  it("leaves a valid window alone", () => {
    const c = gen({ proposed_start: 43, proposed_end: 58, anchor_seconds: 45 });
    expect(validateSection(c, 200)).toEqual(c);
  });
  it("clamps an end overshoot of at most 1 s", () => {
    const r = validateSection(gen({ proposed_start: 186, proposed_end: 201, anchor_seconds: 190 }), 200);
    expect(r).toMatchObject({ proposed_start: 186, proposed_end: 200 });
  });
  it("drops a window that overshoots the track by more than 1 s", () => {
    expect(validateSection(gen({ proposed_start: 190, proposed_end: 215, anchor_seconds: 195 }), 200)).toBeNull();
  });
  it("drops an anchor within 2 s of the end or beyond it", () => {
    expect(validateSection(gen({ proposed_start: 180, proposed_end: 195, anchor_seconds: 199 }), 200)).toBeNull();
    expect(validateSection(gen({ proposed_start: 180, proposed_end: 195, anchor_seconds: 250 }), 200)).toBeNull();
  });
  it("drops a track too short to hold a section", () => {
    const c = gen({ proposed_start: 0, proposed_end: 12, anchor_seconds: 3 });
    expect(validateSection(c, 13)).toBeNull(); // < sectionMin (12) + 2
    expect(validateSection(c, 14)).toEqual(c);
  });
});

const hit = (over: Partial<DeezerTrack> = {}): DeezerTrack => ({
  id: 7, title: "Found", duration: 200, preview: "https://p.mp3", link: "https://d/7",
  artist: { name: "The Weeknd" }, album: { cover_medium: "m.jpg", cover_big: "b.jpg" }, ...over,
});

describe("verifyCandidates", () => {
  it("splits verified/unverified, attaches canonical fields, dedupes by deezer id and merges directions", async () => {
    const find = vi.fn(async (c: { title: string }) => (c.title.startsWith("Found") ? hit() : null));
    const { verified, unverified, lookupFailed } = await verifyCandidates(
      [gen({ title: "Found", directions: ["safe"] }), gen({ title: "Found - Remastered", directions: ["current"] }), gen({ title: "Missing" })], { find },
    );
    expect(unverified.map((c) => c.title)).toEqual(["Missing"]);
    expect(lookupFailed).toEqual([]);
    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatchObject({
      deezer_id: "7", canonical_title: "Found", canonical_artist: "The Weeknd", duration_seconds: 200,
      artwork_url: "b.jpg", deezer_url: "https://d/7", preview_url: null, proposed_start: 43, proposed_end: 58,
      directions: ["safe", "current"],
    });
  });
  it("drops a verified song whose section is impossible for the real track", async () => {
    const find = vi.fn(async () => hit({ duration: 40 }));
    const { verified, unverified } = await verifyCandidates([gen({ anchor_seconds: 45 })], { find });
    expect(verified).toHaveLength(0);
    expect(unverified).toHaveLength(1);
  });
  it("throws when the provider is still failing for 30% or more of lookups after the retry", async () => {
    const find = vi.fn(async (c: { title: string }) => {
      if (c.title === "A") throw new ProviderError("deezer 503", 503);
      return hit();
    });
    await expect(verifyCandidates([gen({ title: "A" }), gen({ title: "B" }), gen({ title: "C" })], { find }))
      .rejects.toBeInstanceOf(ProviderError);
    expect(find.mock.calls.filter((c) => (c[0] as { title: string }).title === "A")).toHaveLength(2);
  });
  it("retries a transient provider failure and keeps the candidate when the retry succeeds", async () => {
    let aCalls = 0;
    const find = vi.fn(async (c: { title: string }) => {
      if (c.title === "A" && aCalls++ === 0) throw new ProviderError("deezer 503", 503);
      return hit({ id: Number(c.title.charCodeAt(0)) });
    });
    const { verified, lookupFailed } = await verifyCandidates(["A", "B", "C", "D"].map((t) => gen({ title: t })), { find });
    expect(verified).toHaveLength(4);
    expect(lookupFailed).toEqual([]);
  });
  it("drops a persistently failing lookup as lookupFailed, not unverified", async () => {
    const find = vi.fn(async (c: { title: string }) => {
      if (c.title === "A") throw new ProviderError("deezer 503", 503);
      return hit({ id: Number(c.title.charCodeAt(0)) });
    });
    const { verified, unverified, lookupFailed } = await verifyCandidates(["A", "B", "C", "D"].map((t) => gen({ title: t })), { find });
    expect(verified).toHaveLength(3);
    expect(unverified).toEqual([]);
    expect(lookupFailed.map((c) => c.title)).toEqual(["A"]);
  });
});

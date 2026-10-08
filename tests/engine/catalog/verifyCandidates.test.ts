import { describe, it, expect, vi, afterEach } from "vitest";
import { validateSection, verifyCandidates } from "@/src/engine/catalog/verifyCandidates";
import { ProviderError, type DeezerTrack } from "@/src/engine/catalog/deezer";
import type { ItunesTrackMatch } from "@/src/engine/catalog/itunes";
import { logger } from "@/src/shared/logger";
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
      [gen({ title: "Found", directions: ["safe"] }), gen({ title: "Found - Remastered", directions: ["current"] }), gen({ title: "Missing" })], { find, findItunes: async () => null },
    );
    expect(unverified.map((c) => c.title)).toEqual(["Missing"]);
    expect(lookupFailed).toEqual([]);
    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatchObject({
      verified_via: "deezer", catalog_key: "deezer:7", itunes_id: null,
      deezer_id: "7", canonical_title: "Found", canonical_artist: "The Weeknd", duration_seconds: 200,
      artwork_url: "b.jpg", deezer_url: "https://d/7", preview_url: "https://p.mp3", proposed_start: 43, proposed_end: 58,
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

const it_ = (over: Partial<ItunesTrackMatch> = {}): ItunesTrackMatch => ({
  itunesId: "55", title: "Hello", artist: "Adele", durationSeconds: 295, artworkUrl: "https://a/600x600bb.jpg", ...over,
});
const live = () => ({ deadlineAt: Date.now() + 200_000 });

describe("verifyCandidates iTunes fallback", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("verifies a Deezer miss on iTunes, with no Deezer fields and no preview", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => {});
    const find = vi.fn(async (c: { title: string }) => (c.title === "Found" ? hit() : null));
    const findItunes = vi.fn(async () => it_());
    const { verified, unverified } = await verifyCandidates(
      [gen({ title: "Found" }), gen({ title: "Hello", artist: "Adele" })], { find, findItunes, ctx: live() },
    );
    expect(findItunes).toHaveBeenCalledTimes(1);
    expect(findItunes).toHaveBeenCalledWith("Hello", "Adele");
    expect(unverified).toEqual([]);
    expect(verified.map((v) => v.catalog_key)).toEqual(["deezer:7", "itunes:55"]);
    expect(verified[1]).toMatchObject({
      verified_via: "itunes", itunes_id: "55", deezer_id: null, deezer_url: null, preview_url: null,
      canonical_title: "Hello", canonical_artist: "Adele", duration_seconds: 295, artwork_url: "https://a/600x600bb.jpg",
    });
    expect(info).toHaveBeenCalledWith("verify.summary", expect.objectContaining({ verified: 2, viaDeezer: 1, viaItunes: 1 }));
  });
  it("never asks iTunes about Deezer hits or Deezer lookup failures", async () => {
    const find = vi.fn(async (c: { title: string }) => {
      if (c.title === "Down") throw new ProviderError("deezer 503", 503);
      return hit({ id: c.title.charCodeAt(0) });
    });
    const findItunes = vi.fn(async () => it_());
    const { lookupFailed } = await verifyCandidates(["A", "B", "C", "Down"].map((t) => gen({ title: t })), { find, findItunes, ctx: live() });
    expect(findItunes).not.toHaveBeenCalled();
    expect(lookupFailed.map((c) => c.title)).toEqual(["Down"]);
  });
  it("caps the fallback at LIMITS.itunesFallbackMax misses, taken in candidate order", async () => {
    const find = vi.fn(async () => null);
    const findItunes = vi.fn(async () => null);
    const cands = Array.from({ length: 14 }, (_, i) => gen({ title: `M${i}` }));
    const { unverified } = await verifyCandidates(cands, { find, findItunes, ctx: live() });
    expect(findItunes.mock.calls.map((c) => (c as unknown[])[0])).toEqual(cands.slice(0, 12).map((c) => c.title));
    expect(unverified).toHaveLength(14);
  });
  it("stops when less than 30 s of pipeline budget remain", async () => {
    const find = vi.fn(async () => null);
    const findItunes = vi.fn(async () => it_());
    const { verified, unverified } = await verifyCandidates([gen({ title: "Hello" })], {
      find, findItunes, ctx: { deadlineAt: Date.now() + 20_000 },
    });
    expect(findItunes).not.toHaveBeenCalled();
    expect(verified).toEqual([]);
    expect(unverified).toHaveLength(1);
  });
  it("counts an iTunes ProviderError as lookupFailed and carries on", async () => {
    const find = vi.fn(async () => null);
    const findItunes = vi.fn(async (t: string) => {
      if (t === "A") throw new ProviderError("itunes 500", 500);
      return it_({ itunesId: t });
    });
    const { verified, lookupFailed } = await verifyCandidates(["A", "B"].map((t) => gen({ title: t })), { find, findItunes, ctx: live() });
    expect(lookupFailed.map((c) => c.title)).toEqual(["A"]);
    expect(verified.map((v) => v.catalog_key)).toEqual(["itunes:B"]);
  });
  it.each([403, 429])("aborts the fallback (never the stage) on iTunes %i and logs once", async (status) => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const find = vi.fn(async () => null);
    const findItunes = vi.fn(async () => { throw new ProviderError(`itunes ${status}`, status); });
    const { lookupFailed, unverified } = await verifyCandidates(["A", "B", "C"].map((t) => gen({ title: t })), { find, findItunes, ctx: live() });
    expect(findItunes).toHaveBeenCalledTimes(1);
    expect(lookupFailed.map((c) => c.title)).toEqual(["A"]);
    expect(unverified.map((c) => c.title)).toEqual(["B", "C"]);
    expect(warn.mock.calls.filter((c) => c[0] === "verify.itunes_aborted")).toHaveLength(1);
  });
  it("drops an iTunes match whose section cannot fit, and merges two spellings of one iTunes recording", async () => {
    const find = vi.fn(async () => null);
    const findItunes = vi.fn(async (t: string) => (t === "Short" ? it_({ itunesId: "9", durationSeconds: 30 }) : it_()));
    const { verified, unverified } = await verifyCandidates(
      [gen({ title: "Hello", directions: ["safe"] }), gen({ title: "Hello!", directions: ["current"] }), gen({ title: "Short" })],
      { find, findItunes, ctx: live() },
    );
    expect(verified).toHaveLength(1);
    expect(verified[0]!.directions).toEqual(["safe", "current"]);
    expect(unverified.map((c) => c.title)).toEqual(["Short"]);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const body = {
  results: [
    { trackId: 11, trackName: "Blinding Lights (Karaoke)", artistName: "Karaoke Co", previewUrl: "https://k.m4a" },
    { trackId: 12, trackName: "Blinding Lights", artistName: "The Weeknd", previewUrl: "https://w.m4a" },
  ],
};

describe("findItunesPreview", () => {
  it("returns the matching track's id and preview when previews are enabled", async () => {
    vi.doMock("@/src/shared/config", async (orig) => ({ ...(await orig<object>()), PREVIEWS_ENABLED: true }));
    const { findItunesPreview } = await import("@/src/engine/catalog/itunes");
    const fetchImpl = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status: 200 }));
    const out = await findItunesPreview("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch);
    expect(out).toEqual({ itunesId: "12", previewUrl: "https://w.m4a" });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("country=US");
    vi.doUnmock("@/src/shared/config");
    vi.resetModules();
  });
  it("returns null on no match or error, and never throws", async () => {
    vi.doMock("@/src/shared/config", async (orig) => ({ ...(await orig<object>()), PREVIEWS_ENABLED: true }));
    const { findItunesPreview } = await import("@/src/engine/catalog/itunes");
    const bad = vi.fn(async () => new Response("nope", { status: 403 }));
    expect(await findItunesPreview("X", "Y", bad as unknown as typeof fetch)).toBeNull();
    const boom = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await findItunesPreview("X", "Y", boom as unknown as typeof fetch)).toBeNull();
    const malformed = vi.fn(async () => new Response("not json", { status: 200 }));
    expect(await findItunesPreview("X", "Y", malformed as unknown as typeof fetch)).toBeNull();
    const nomatch = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    expect(await findItunesPreview("Other Song", "Nobody", nomatch as unknown as typeof fetch)).toBeNull();
    vi.doUnmock("@/src/shared/config");
    vi.resetModules();
  });
  it("logs a structured warning when fetch throws", async () => {
    vi.doMock("@/src/shared/config", async (orig) => ({ ...(await orig<object>()), PREVIEWS_ENABLED: true }));
    const { logger } = await import("@/src/shared/logger");
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const { findItunesPreview } = await import("@/src/engine/catalog/itunes");
    const boom = vi.fn(async (_url: string) => { throw new TypeError("fetch failed"); });
    expect(await findItunesPreview("X", "Y", boom as unknown as typeof fetch)).toBeNull();
    expect(warn).toHaveBeenCalledWith("itunes.lookup_failed", expect.objectContaining({ title: "X", artist: "Y" }));
    warn.mockRestore();
    vi.doUnmock("@/src/shared/config");
    vi.resetModules();
  });
  it("does not call the network when previews are disabled", async () => {
    vi.doMock("@/src/shared/config", async (orig) => ({ ...(await orig<object>()), PREVIEWS_ENABLED: false }));
    const { findItunesPreview } = await import("@/src/engine/catalog/itunes");
    const fetchImpl = vi.fn();
    expect(await findItunesPreview("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.doUnmock("@/src/shared/config");
    vi.resetModules();
  });
});

describe("findItunesTrack", () => {
  beforeEach(() => { vi.resetModules(); }); // fresh pacing slot per test
  const song = (over: Record<string, unknown> = {}) => ({
    trackId: 12, trackName: "Hello", artistName: "Adele", trackTimeMillis: 295_502,
    artworkUrl100: "https://is1.mzstatic.com/a/100x100bb.jpg", previewUrl: "https://audio.m4a", ...over,
  });
  const ok = (results: unknown[]) => vi.fn(async (_url: string) => new Response(JSON.stringify({ resultCount: results.length, results }), { status: 200 }));

  it("queries the US song catalogue and returns the match without any preview", async () => {
    vi.useFakeTimers();
    const { findItunesTrack } = await import("@/src/engine/catalog/itunes");
    const fetchImpl = ok([song({ trackId: 1, artistName: "Hello I'm Adele" }), song()]);
    const p = findItunesTrack("Hello", "Adele", fetchImpl as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toEqual({
      itunesId: "12", title: "Hello", artist: "Adele", durationSeconds: 296,
      artworkUrl: "https://is1.mzstatic.com/a/600x600bb.jpg",
    });
    const url = String(fetchImpl.mock.calls[0]![0]);
    expect(url).toContain("https://itunes.apple.com/search?term=Hello%20Adele");
    expect(url).toContain("entity=song");
    expect(url).toContain("country=US");
    expect(url).toContain("limit=10");
    vi.useRealTimers();
  });
  it("accepts a loose match: descriptor in the title, lead artist of a duo", async () => {
    vi.useFakeTimers();
    const { findItunesTrack } = await import("@/src/engine/catalog/itunes");
    const fetchImpl = ok([
      song({ trackId: 2, trackName: "Somebody That I Used to Know (Remix)", artistName: "Gotye" }),
      song({ trackId: 3, trackName: "Somebody That I Used to Know (feat. Kimbra)", artistName: "Gotye", artworkUrl100: undefined }),
    ]);
    const p = findItunesTrack("Somebody That I Used to Know", "Gotye & Kimbra", fetchImpl as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toMatchObject({ itunesId: "3", artworkUrl: null });
    vi.useRealTimers();
  });
  it("returns null when nothing matches", async () => {
    vi.useFakeTimers();
    const { findItunesTrack } = await import("@/src/engine/catalog/itunes");
    const p = findItunesTrack("Hello", "Adele", ok([song({ trackName: "Hello (Live)" })]) as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });
  it("throws ProviderError (with status) on HTTP failure, network failure and a malformed body", async () => {
    vi.useFakeTimers();
    const { findItunesTrack } = await import("@/src/engine/catalog/itunes");
    const { ProviderError } = await import("@/src/engine/catalog/deezer");
    const run = async (f: unknown) => {
      const p = findItunesTrack("Hello", "Adele", f as typeof fetch).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(10_000);
      return p;
    };
    const e403 = await run(vi.fn(async () => new Response("no", { status: 403 })));
    expect(e403).toBeInstanceOf(ProviderError);
    expect((e403 as InstanceType<typeof ProviderError>).status).toBe(403);
    expect(await run(vi.fn(async () => { throw new TypeError("fetch failed"); }))).toBeInstanceOf(ProviderError);
    expect(await run(vi.fn(async () => new Response(JSON.stringify({ results: [{ nope: 1 }] }), { status: 200 })))).toBeInstanceOf(ProviderError);
    vi.useRealTimers();
  });
  it("spaces requests by LIMITS.itunesMinIntervalMs", async () => {
    vi.useFakeTimers();
    const { findItunesTrack } = await import("@/src/engine/catalog/itunes");
    const fetchImpl = ok([]);
    const c = findItunesTrack("E", "F", fetchImpl as unknown as typeof fetch);
    const d = findItunesTrack("G", "H", fetchImpl as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await Promise.all([c, d]);
    vi.useRealTimers();
  });
});

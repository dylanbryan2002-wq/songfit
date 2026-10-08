import { describe, it, expect, vi, beforeEach } from "vitest";

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

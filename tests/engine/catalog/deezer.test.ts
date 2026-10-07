import { describe, it, expect, vi, afterEach } from "vitest";
import {
  deezerGet, pickDeezerMatch, searchDeezer, findDeezerMatch, ProviderError, type DeezerTrack,
} from "@/src/engine/catalog/deezer";

const track = (over: Partial<DeezerTrack> = {}): DeezerTrack => ({
  id: 1, title: "Blinding Lights", duration: 200, preview: "https://p/1.mp3",
  link: "https://www.deezer.com/track/1", artist: { name: "The Weeknd" },
  album: { cover_medium: "m.jpg", cover_big: "b.jpg" }, ...over,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => { vi.useRealTimers(); });

describe("deezerGet", () => {
  it("retries 429 and 5xx with backoff, then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ data: [] }));
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const out = await deezerGet("https://api.deezer.com/x", fetchImpl as unknown as typeof fetch, sleep);
    expect(out).toEqual({ data: [] });
    expect(sleeps).toEqual([500, 1500]);
  });
  it("retries a quota error delivered as HTTP 200 { error: { code: 4 } }", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ error: { code: 4, message: "Quota limit exceeded" } }))
      .mockResolvedValueOnce(json({ ok: true }));
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const out = await deezerGet("https://api.deezer.com/x", fetchImpl as unknown as typeof fetch, sleep);
    expect(out).toEqual({ ok: true });
    expect(sleeps).toEqual([500]);
  });
  it("gives up on a quota error after 4 attempts with the quota code attached", async () => {
    const fetchImpl = vi.fn(async () => json({ error: { code: 4, message: "Quota limit exceeded" } }));
    const sleep = async () => {};
    await expect(deezerGet("https://api.deezer.com/x", fetchImpl as unknown as typeof fetch, sleep))
      .rejects.toMatchObject({ name: "ProviderError", code: 4 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
  it("waits 500, 1500 then 4000 ms of real (fake) time between attempts", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({}, 500))
      .mockResolvedValueOnce(json({ ok: true }));
    const p = deezerGet("https://api.deezer.com/x", fetchImpl as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    await expect(p).resolves.toEqual({ ok: true });
  });
  it("throws ProviderError after 4 failed attempts (3 retries)", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => json({}, 500));
    await expect(deezerGet("https://api.deezer.com/x", fetchImpl as unknown as typeof fetch, async () => {}))
      .rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
  it("wraps network errors as ProviderError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(deezerGet("https://api.deezer.com/x", fetchImpl as unknown as typeof fetch, async () => {}))
      .rejects.toBeInstanceOf(ProviderError);
  });
});

describe("searchDeezer", () => {
  it("treats an error-shaped 200 body (Deezer quota) as a ProviderError, never as no results", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockImplementation(() => json({ error: { type: "Exception", message: "Quota limit exceeded", code: 4 } }));
    const p = searchDeezer("A", "B", fetchImpl as unknown as typeof fetch).catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_000); // quota is retried with backoff (500 + 1500 + 4000 ms)
    const err = await p;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.status).toBeUndefined();
    expect(err.code).toBe(4);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
  it("tries the plain query first and stops when it yields an acceptable match", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => { urls.push(String(url)); return json({ data: [track()] }); });
    const out = await searchDeezer("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch);
    expect(out[0]?.id).toBe(1);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("q=Blinding%20Lights%20The%20Weeknd");
    expect(urls[0]).not.toContain("artist%3A");
  });
  it("falls back to the structured query when plain has no acceptable match", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url); urls.push(u);
      return json({ data: u.includes("artist%3A") ? [track({ id: 7 })] : [track({ id: 3, title: "Blinding Lights (Live)" })] });
    });
    const out = await searchDeezer("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch);
    expect(urls).toHaveLength(2);
    expect(urls[0]).not.toContain("artist%3A");
    expect(urls[1]).toContain("artist%3A");
    expect(out.map((t) => t.id)).toContain(7);
  });
  it("dedupes plain and structured results by id", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      json({ data: String(url).includes("artist%3A") ? [track({ id: 3, title: "Blinding Lights (Live)" }), track({ id: 7 })] : [track({ id: 3, title: "Blinding Lights (Live)" })] }));
    const out = await searchDeezer("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch);
    expect(out.map((t) => t.id)).toEqual([3, 7]);
  });
});

describe("pickDeezerMatch", () => {
  it("returns the first ACCEPTABLE result (same version, same primary artist)", () => {
    const results = [
      track({ id: 9, title: "Blinding Lights", artist: { name: "Karaoke Hits" } }),
      track({ id: 3, title: "Blinding Lights (Live)", artist: { name: "The Weeknd" } }),
      track({ id: 2, title: "Blinding Lights - Remastered", artist: { name: "The Weeknd" } }),
    ];
    expect(pickDeezerMatch({ title: "Blinding Lights", artist: "The Weeknd" }, results)?.id).toBe(2);
  });
  it("returns null when nothing is acceptable", () => {
    expect(pickDeezerMatch({ title: "Stay", artist: "The Kid LAROI" }, [track({ title: "Stay With Me", artist: { name: "The Kid LAROI" } })])).toBeNull();
  });
});

describe("findDeezerMatch", () => {
  it("returns the match found by the structured fallback, plain first", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url); urls.push(u);
      return json({ data: u.includes("artist%3A") ? [track({})] : [track({ id: 5, title: "Blinding Lights (Live)" })] });
    });
    const out = await findDeezerMatch({ title: "Blinding Lights", artist: "The Weeknd" }, fetchImpl as unknown as typeof fetch);
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("artist%3A");
    expect(out?.id).toBe(1);
  });
  it("returns null when neither query has an acceptable match", async () => {
    const fetchImpl = vi.fn(async () => json({ data: [] }));
    expect(await findDeezerMatch({ title: "A", artist: "B" }, fetchImpl as unknown as typeof fetch)).toBeNull();
  });
  it("propagates ProviderError", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn().mockImplementation(() => json({}, 503));
    const p = expect(findDeezerMatch({ title: "A", artist: "B" }, fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(ProviderError);
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
  });
});

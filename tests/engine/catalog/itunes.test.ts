import { describe, it, expect, vi } from "vitest";

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

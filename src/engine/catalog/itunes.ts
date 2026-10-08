// iTunes Search API: free, no auth, ~20 calls/min. Two uses: findItunesPreview for a final pick
// missing a preview (only when PREVIEWS_ENABLED, ruling C8; failure never blocks a result), and
// findItunesTrack to verify Deezer misses (C1; Deezer's US catalogue lacks some originals).
import { z } from "zod";
import { LIMITS, PREVIEWS_ENABLED } from "@/src/shared/config";
import { logger } from "@/src/shared/logger";
import { titlesMatch, artistsMatch, pickBestMatch } from "@/src/engine/catalog/normalize";
import { ProviderError } from "@/src/engine/catalog/deezer";

const ItunesResult = z.object({
  trackId: z.number(),
  trackName: z.string(),
  artistName: z.string(),
  previewUrl: z.string().optional(),
});
const ItunesSearch = z.object({ results: z.array(ItunesResult).default([]) });

export async function findItunesPreview(
  title: string, artist: string, fetchImpl: typeof fetch = fetch,
): Promise<{ itunesId: string; previewUrl: string | null } | null> {
  if (!PREVIEWS_ENABLED) return null;
  try {
    const term = encodeURIComponent(`${title} ${artist}`);
    const res = await fetchImpl(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=5&country=US`,
      { signal: AbortSignal.timeout(LIMITS.deezerTimeoutMs) },
    );
    if (!res.ok) {
      logger.warn("itunes.lookup_failed", { reason: "http_status", status: res.status, title, artist });
      return null;
    }
    const parsed = ItunesSearch.safeParse(await res.json());
    if (!parsed.success) {
      logger.warn("itunes.lookup_failed", { reason: "malformed_response", title, artist });
      return null;
    }
    const hit = parsed.data.results.find((r) => titlesMatch(title, r.trackName) && artistsMatch(artist, r.artistName));
    if (!hit) {
      logger.info("itunes.no_match", { title, artist });
      return null;
    }
    return { itunesId: String(hit.trackId), previewUrl: hit.previewUrl ?? null };
  } catch (e) {
    logger.warn("itunes.lookup_failed", { reason: e instanceof Error ? e.message : String(e), title, artist });
    return null;
  }
}

// Verification shape: previewUrl is deliberately absent (Apple: previews are promotional only).
const ItunesTrack = z.object({
  trackId: z.number(),
  trackName: z.string(),
  artistName: z.string(),
  trackTimeMillis: z.number().optional(),
  artworkUrl100: z.string().optional(),
});
const ItunesTrackSearch = z.object({ results: z.array(ItunesTrack) });

export type ItunesTrackMatch = {
  itunesId: string; title: string; artist: string; durationSeconds: number; artworkUrl: string | null;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// One request start per LIMITS.itunesMinIntervalMs, process-wide (same scheme as deezer.ts paced).
let nextSlot = 0;
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + LIMITS.itunesMinIntervalMs;
  if (wait > 0) await defaultSleep(wait);
  return fn();
}

/**
 * Verify one song against the iTunes US catalogue by the same exact-then-loose rules as Deezer.
 * null = no acceptable match. Throws ProviderError (with HTTP status when there is one) on failure.
 */
export async function findItunesTrack(
  title: string, artist: string, fetchImpl: typeof fetch = fetch,
): Promise<ItunesTrackMatch | null> {
  const term = encodeURIComponent(`${title} ${artist}`);
  const url = `https://itunes.apple.com/search?term=${term}&entity=song&country=US&limit=10`;
  let body: unknown;
  try {
    const res = await paced(() => fetchImpl(url, { signal: AbortSignal.timeout(LIMITS.deezerTimeoutMs) }));
    if (!res.ok) throw new ProviderError(`itunes ${res.status}`, res.status);
    body = await res.json();
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(`itunes: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = ItunesTrackSearch.safeParse(body);
  if (!parsed.success) throw new ProviderError("itunes: unexpected response shape");
  const withDuration = parsed.data.results.filter((r) => r.trackTimeMillis !== undefined);
  const hit = pickBestMatch({ title, artist }, withDuration, (r) => ({ title: r.trackName, artist: r.artistName }));
  if (!hit) return null;
  return {
    itunesId: String(hit.trackId),
    title: hit.trackName,
    artist: hit.artistName,
    durationSeconds: Math.round(hit.trackTimeMillis! / 1000),
    artworkUrl: hit.artworkUrl100 ? hit.artworkUrl100.replace("100x100", "600x600") : null,
  };
}

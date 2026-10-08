// iTunes Search API: free, no auth, ~20 calls/min. Verification only (C1): Deezer's US catalogue
// lacks some originals. Never a preview source: previews are Deezer-only (Apple: promotional use only).
import { z } from "zod";
import { LIMITS } from "@/src/shared/config";
import { pickBestMatch } from "@/src/engine/catalog/normalize";
import { ProviderError } from "@/src/engine/catalog/deezer";

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

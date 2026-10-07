// iTunes Search API: free, no auth, ~20 calls/min. Only called for a final pick missing a preview,
// and only when PREVIEWS_ENABLED (ruling C8). Failure never blocks a result.
import { z } from "zod";
import { LIMITS, PREVIEWS_ENABLED } from "@/src/shared/config";
import { logger } from "@/src/shared/logger";
import { titlesMatch, artistsMatch } from "@/src/engine/catalog/normalize";

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

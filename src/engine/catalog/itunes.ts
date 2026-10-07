// iTunes Search API: free, no auth, ~20 calls/min. Only called for a final pick missing a preview,
// and only when PREVIEWS_ENABLED (ruling C8). Failure never blocks a result.
import { z } from "zod";
import { LIMITS, PREVIEWS_ENABLED } from "@/src/shared/config";
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
      console.warn(`itunes preview lookup failed: ${res.status}`);
      return null;
    }
    const parsed = ItunesSearch.safeParse(await res.json());
    if (!parsed.success) {
      console.warn("itunes preview lookup: malformed response");
      return null;
    }
    const hit = parsed.data.results.find((r) => titlesMatch(title, r.trackName) && artistsMatch(artist, r.artistName));
    return hit ? { itunesId: String(hit.trackId), previewUrl: hit.previewUrl ?? null } : null;
  } catch (e) {
    console.warn("itunes preview lookup failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

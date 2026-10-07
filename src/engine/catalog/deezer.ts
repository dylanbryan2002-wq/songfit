// Deezer's public search API: no auth, community-documented ~50 req / 5 s per IP (docs/RESEARCH.md).
// We treat that as an assumption, not an SLA: bounded concurrency, timeouts, backoff on 429/5xx.
import { z } from "zod";
import pLimit from "p-limit";
import { LIMITS } from "@/src/shared/config";
import { titlesMatch, artistsMatch } from "@/src/engine/catalog/normalize";

const DeezerTrackSchema = z.object({
  id: z.number(),
  title: z.string(),
  duration: z.number(),
  preview: z.string().nullable().optional().transform((v) => v || null),
  link: z.string(),
  artist: z.object({ name: z.string() }),
  album: z
    .object({ cover_medium: z.string().nullable().optional(), cover_big: z.string().nullable().optional() })
    .optional(),
});
const DeezerSearchSchema = z.object({ data: z.array(DeezerTrackSchema).default([]) });
export type DeezerTrack = z.infer<typeof DeezerTrackSchema>;

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

export const deezerLimit = pLimit(LIMITS.deezerConcurrency);

const BACKOFF_MS = [500, 1500, 4000];
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET with timeout and retry on 429/5xx/network. Resolves the parsed JSON or throws ProviderError. */
export async function deezerGet(
  url: string, fetchImpl: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<unknown> {
  let last: ProviderError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(LIMITS.deezerTimeoutMs) });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) {
        last = new ProviderError(`deezer ${res.status}`, res.status);
      } else {
        throw new ProviderError(`deezer ${res.status}`, res.status); // 4xx other than 429: do not retry
      }
    } catch (e) {
      if (e instanceof ProviderError && e.status && e.status < 500 && e.status !== 429) throw e;
      last = e instanceof ProviderError ? e : new ProviderError(e instanceof Error ? e.message : String(e));
    }
    if (attempt < 2) await sleep(BACKOFF_MS[attempt]!);
  }
  throw last ?? new ProviderError("deezer: unknown failure");
}

const DeezerErrorSchema = z.object({ error: z.object({ message: z.string().optional(), code: z.number().optional() }) });

async function query(q: string, fetchImpl: typeof fetch): Promise<DeezerTrack[]> {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`;
  const body = await deezerLimit(() => deezerGet(url, fetchImpl));
  const parsed = DeezerSearchSchema.safeParse(body);
  if (parsed.success) return parsed.data.data;
  // Deezer reports quota/outage as HTTP 200 with { error: {...} }. That is a provider failure (I4),
  // not "no such song": it must never be reported as an empty result.
  const err = DeezerErrorSchema.safeParse(body);
  if (err.success) throw new ProviderError(`deezer error ${err.data.error.code ?? ""}: ${err.data.error.message ?? "unknown"}`.trim(), err.data.error.code);
  throw new ProviderError("deezer: unexpected response shape");
}

export function pickDeezerMatch(cand: { title: string; artist: string }, results: DeezerTrack[]): DeezerTrack | null {
  for (const r of results) {
    if (titlesMatch(cand.title, r.title) && artistsMatch(cand.artist, r.artist.name)) return r;
  }
  return null;
}

/**
 * Plain query FIRST, structured query only as a fallback. Smoke test finding: the structured query
 * `artist:"The Weeknd" track:"Blinding Lights"` returned ZERO results, while the plain query
 * `Blinding Lights The Weeknd` worked. The structured query is tried only when the plain results
 * contain no ACCEPTABLE match (titlesMatch && artistsMatch). Returns plain results followed by
 * structured results (when the fallback ran).
 */
export async function searchDeezer(title: string, artist: string, fetchImpl: typeof fetch = fetch): Promise<DeezerTrack[]> {
  const plain = await query(`${title} ${artist}`, fetchImpl);
  if (pickDeezerMatch({ title, artist }, plain)) return plain;
  const structured = await query(`artist:"${artist}" track:"${title}"`, fetchImpl);
  return [...plain, ...structured];
}

/** First acceptable Deezer result, or null. Throws ProviderError on outage (distinct from no match). */
export async function findDeezerMatch(
  cand: { title: string; artist: string }, fetchImpl: typeof fetch = fetch,
): Promise<DeezerTrack | null> {
  return pickDeezerMatch(cand, await searchDeezer(cand.title, cand.artist, fetchImpl));
}

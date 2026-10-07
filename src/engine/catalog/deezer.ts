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
const DeezerSearchSchema = z.object({ data: z.array(DeezerTrackSchema) });
export type DeezerTrack = z.infer<typeof DeezerTrackSchema>;

export class ProviderError extends Error {
  /** `status` is an HTTP status only; Deezer's in-body error code goes in `code`. */
  constructor(message: string, readonly status?: number, readonly code?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const deezerLimit = pLimit(LIMITS.deezerConcurrency);

// Concurrency alone blew Deezer's quota on the first real run (68 lookups in 4.6 s → "error 4:
// Quota limit exceeded" on 29 of them). Space request starts by LIMITS.deezerMinIntervalMs as well.
let nextSlot = 0;
export async function paced<T>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void> = defaultSleep): Promise<T> {
  return deezerLimit(async () => {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + LIMITS.deezerMinIntervalMs;
    if (wait > 0) await sleep(wait);
    return fn();
  });
}

const DeezerErrorSchema = z.object({ error: z.object({ message: z.string().optional(), code: z.number().optional() }) });
const DEEZER_QUOTA_CODE = 4;
const BACKOFF_MS = [500, 1500, 4000];

/** GET with timeout and retry on 429/5xx/network. Resolves the parsed JSON or throws ProviderError. */
export async function deezerGet(
  url: string, fetchImpl: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<unknown> {
  let last: ProviderError | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(LIMITS.deezerTimeoutMs) });
      if (res.ok) {
        const body: unknown = await res.json();
        const err = DeezerErrorSchema.safeParse(body);
        if (err.success && err.data.error.code === DEEZER_QUOTA_CODE) {
          last = new ProviderError("deezer error 4: Quota limit exceeded", undefined, DEEZER_QUOTA_CODE);
        } else {
          return body;
        }
      } else if (res.status === 429 || res.status >= 500) {
        last = new ProviderError(`deezer ${res.status}`, res.status);
      } else {
        throw new ProviderError(`deezer ${res.status}`, res.status); // 4xx other than 429: do not retry
      }
    } catch (e) {
      if (e instanceof ProviderError && e.status && e.status < 500 && e.status !== 429) throw e;
      last = e instanceof ProviderError ? e : new ProviderError(e instanceof Error ? e.message : String(e));
    }
    if (attempt < 3) await sleep(BACKOFF_MS[attempt]!);
  }
  throw last ?? new ProviderError("deezer: unknown failure");
}


async function query(q: string, fetchImpl: typeof fetch): Promise<DeezerTrack[]> {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`;
  const body = await paced(() => deezerGet(url, fetchImpl));
  // Deezer reports quota/outage as HTTP 200 with { error: {...} }. That is a provider failure (I4),
  // not "no such song": check it FIRST so it can never be reported as an empty result.
  const err = DeezerErrorSchema.safeParse(body);
  if (err.success) throw new ProviderError(`deezer error ${err.data.error.code ?? ""}: ${err.data.error.message ?? "unknown"}`.trim(), undefined, err.data.error.code);
  const parsed = DeezerSearchSchema.safeParse(body);
  if (parsed.success) return parsed.data.data;
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
  const seen = new Set<number>();
  return [...plain, ...structured].filter((t) => !seen.has(t.id) && !!seen.add(t.id));
}

/** First acceptable Deezer result, or null. Throws ProviderError on outage (distinct from no match). */
export async function findDeezerMatch(
  cand: { title: string; artist: string }, fetchImpl: typeof fetch = fetch,
): Promise<DeezerTrack | null> {
  return pickDeezerMatch(cand, await searchDeezer(cand.title, cand.artist, fetchImpl));
}

export type DeezerTrackLookup = { kind: "ok"; previewUrl: string } | { kind: "none" };

const DeezerTrackLookupSchema = z.object({
  id: z.number(),
  title: z.string(),
  preview: z.string().nullable().optional(),
  duration: z.number(),
});

/**
 * Fresh preview url for one Deezer track (urls are signed and expire, so they are never stored).
 * "none" = Deezer has no such track (error body, e.g. code 800) or no preview. Throws ProviderError
 * on outage or an unexpected shape.
 */
export async function getDeezerTrack(id: string, fetchImpl: typeof fetch = fetch): Promise<DeezerTrackLookup> {
  const url = `https://api.deezer.com/track/${encodeURIComponent(id)}`;
  const body = await paced(() => deezerGet(url, fetchImpl));
  if (DeezerErrorSchema.safeParse(body).success) return { kind: "none" }; // quota (code 4) was retried and thrown inside deezerGet
  const parsed = DeezerTrackLookupSchema.safeParse(body);
  if (!parsed.success) throw new ProviderError("deezer: unexpected response shape");
  return parsed.data.preview ? { kind: "ok", previewUrl: parsed.data.preview } : { kind: "none" };
}

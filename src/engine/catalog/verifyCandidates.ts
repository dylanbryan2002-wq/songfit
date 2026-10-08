import type { GeneratedCandidate, VerifiedCandidate } from "@/src/shared/types";
import { LIMITS, PREVIEWS_ENABLED } from "@/src/shared/config";
import { findDeezerMatch, ProviderError, type DeezerTrack } from "@/src/engine/catalog/deezer";
import { findItunesTrack } from "@/src/engine/catalog/itunes";
import { remainingBudget, type StageCtx } from "@/src/pipeline/budget";
import { logger } from "@/src/shared/logger";

const OUTAGE_RATIO = 0.3;
const ITUNES_MIN_BUDGET_MS = 30_000;

/**
 * A section is valid only if it fits the real track. We never invent a new musical moment (C6):
 * if the model's anchor cannot exist in this recording, the candidate is wrong, so it is dropped.
 * Only a tiny end overshoot (<= 1 s) is clamped to the track end.
 */
export function validateSection<T extends GeneratedCandidate>(cand: T, duration: number): T | null {
  if (duration < LIMITS.sectionMin + 2) return null;
  if (cand.anchor_seconds >= duration - 2) return null;
  if (cand.proposed_end > duration + 1) return null;
  if (cand.proposed_end > duration) return { ...cand, proposed_end: duration };
  return cand;
}

type Lookup = { ok: true; hit: DeezerTrack | null } | { ok: false; error: unknown };

async function lookup(find: typeof findDeezerMatch, c: GeneratedCandidate): Promise<Lookup> {
  try {
    return { ok: true, hit: await find(c) };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function verifyCandidates(
  cands: GeneratedCandidate[],
  deps: { find?: typeof findDeezerMatch; findItunes?: typeof findItunesTrack; ctx?: StageCtx } = {},
): Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[]; lookupFailed: GeneratedCandidate[] }> {
  const t0 = Date.now();
  const find = deps.find ?? findDeezerMatch;
  const findItunes = deps.findItunes ?? findItunesTrack;
  const verified: VerifiedCandidate[] = [];
  const unverified: GeneratedCandidate[] = [];
  const lookupFailed: GeneratedCandidate[] = [];
  const deezerMisses: GeneratedCandidate[] = [];
  const byKey = new Map<string, VerifiedCandidate>();

  /** Dedupe by catalog_key (same recording under different spellings: keep the first, merge directions, I9). */
  const accept = (c: GeneratedCandidate, duration: number, fields: Omit<VerifiedCandidate, keyof GeneratedCandidate>) => {
    const existing = byKey.get(fields.catalog_key);
    if (existing) {
      for (const d of c.directions) if (!existing.directions.includes(d)) existing.directions.push(d);
      return;
    }
    const valid = validateSection(c, duration);
    if (!valid) {
      logger.info("verify.section_impossible", { title: c.title, anchor: c.anchor_seconds, duration });
      unverified.push(c);
      return;
    }
    const v: VerifiedCandidate = { ...valid, directions: [...valid.directions], ...fields };
    byKey.set(v.catalog_key, v);
    verified.push(v);
  };

  // Concurrency is bounded inside deezer.ts; one failure never hides the rest.
  const results = await Promise.all(cands.map((c) => lookup(find, c)));

  // I4/I5: a provider failure is not a "no". Retry those once, after the batch.
  await Promise.all(
    results.map(async (r, i) => {
      if (!r.ok && r.error instanceof ProviderError) results[i] = await lookup(find, cands[i]!);
    }),
  );

  let lastProviderError: ProviderError | null = null;
  let providerFailures = 0;
  results.forEach((r, i) => {
    const c = cands[i]!;
    if (!r.ok) {
      if (!(r.error instanceof ProviderError)) throw r.error; // a bug, not an outage: do not swallow
      lastProviderError = r.error;
      providerFailures++;
      logger.warn("verify.lookup_failed", { title: c.title, artist: c.artist, err: r.error.message });
      lookupFailed.push(c);
      return;
    }
    const hit = r.hit;
    if (!hit) {
      deezerMisses.push(c);
      return;
    }
    const id = String(hit.id);
    accept(c, hit.duration, {
      verified_via: "deezer",
      catalog_key: `deezer:${id}`,
      deezer_id: id,
      itunes_id: null,
      canonical_title: hit.title,
      canonical_artist: hit.artist.name,
      duration_seconds: hit.duration,
      artwork_url: hit.album?.cover_big ?? hit.album?.cover_medium ?? null,
      deezer_url: hit.link,
      preview_url: PREVIEWS_ENABLED ? hit.preview || null : null,
    });
  });
  const viaDeezer = verified.length;
  const outage = cands.length > 0 && lastProviderError !== null && providerFailures / cands.length >= OUTAGE_RATIO;

  // C1: Deezer's US catalogue lacks some originals (Adele, Hozier, Robyn...). Re-check the first
  // LIMITS.itunesFallbackMax misses on iTunes, paced inside itunes.ts. Never fails the stage.
  if (!outage) {
    for (const [i, c] of deezerMisses.entries()) {
      if (i >= LIMITS.itunesFallbackMax) {
        logger.info("verify.itunes_capped", { skipped: deezerMisses.length - i });
        unverified.push(...deezerMisses.slice(i));
        break;
      }
      if (remainingBudget(deps.ctx, Number.POSITIVE_INFINITY) < ITUNES_MIN_BUDGET_MS) {
        logger.info("verify.itunes_budget", { skipped: deezerMisses.length - i });
        unverified.push(...deezerMisses.slice(i));
        break;
      }
      let found: Awaited<ReturnType<typeof findItunesTrack>>;
      try {
        found = await findItunes(c.title, c.artist);
      } catch (e) {
        if (!(e instanceof ProviderError)) throw e;
        logger.warn("verify.lookup_failed", { title: c.title, artist: c.artist, err: e.message, provider: "itunes" });
        lookupFailed.push(c);
        if (e.status === 403 || e.status === 429) {
          logger.warn("verify.itunes_aborted", { status: e.status, skipped: deezerMisses.length - i - 1 });
          unverified.push(...deezerMisses.slice(i + 1));
          break;
        }
        continue;
      }
      if (!found) {
        unverified.push(c);
        continue;
      }
      accept(c, found.durationSeconds, {
        verified_via: "itunes",
        catalog_key: `itunes:${found.itunesId}`,
        deezer_id: null,
        itunes_id: found.itunesId,
        canonical_title: found.title,
        canonical_artist: found.artist,
        duration_seconds: found.durationSeconds,
        artwork_url: found.artworkUrl,
        deezer_url: null,
        preview_url: null, // previews are Deezer-only (Apple: promotional use only)
      });
    }
  } else {
    unverified.push(...deezerMisses);
  }

  const ms = Date.now() - t0;
  logger.info("verify.summary", {
    total: cands.length, verified: verified.length, unverified: unverified.length, lookupFailed: lookupFailed.length,
    viaDeezer, viaItunes: verified.length - viaDeezer, ms,
  });
  if (outage) throw lastProviderError!; // outage: fail the stage rather than regenerate songs
  return { verified, unverified, lookupFailed };
}

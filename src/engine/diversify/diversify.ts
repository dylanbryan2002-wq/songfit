import { DIRECTION_LABEL, BEST_FIT_LABEL, DirectionTag, type Pick, type ScoredCandidate } from "@/src/shared/types";
import { PipelineError } from "@/src/shared/errors";
import { PICKS_MIN, PICKS_PER_BATCH, PICKS_TOTAL } from "@/src/shared/config";
import { normalizeArtist } from "@/src/engine/catalog/normalize";

const ARTIST_TOLERANCE = 0.1;
/** The first picks are the best matches by score (artist variety only); direction balancing starts after them.
 *  Codex review 2026-10-09: forcing safe/recent/unexpected into the top 3 pushed better-scored matches down. */
export const TOP_BY_SCORE = 3;
const DIRECTIONS = DirectionTag.options; // safe → current → unexpected

export function primaryDirection(c: { directions: DirectionTag[] }): DirectionTag {
  return c.directions[0] ?? "safe";
}

/**
 * Ranks 1–TOP_BY_SCORE = best totals, preferring a new artist within 0.1 (rank 1 = "Best fit"). Then batch by batch, each slot asks for the
 * direction least covered in its batch (ties: safe → current → unexpected) and takes the best unused
 * candidate whose primary direction is that one, then any whose directions include it, then next best
 * overall. Coverage counts primary directions because that is the label the creator sees.
 */
export function diversify(scored: ScoredCandidate[], total = PICKS_TOTAL, batch = PICKS_PER_BATCH): Pick[] {
  const seen = new Set<string>();
  const sorted = [...scored]
    .sort((a, b) => b.total_score - a.total_score)
    .filter((c) => (seen.has(c.catalog_key) ? false : (seen.add(c.catalog_key), true)));
  if (sorted.length < PICKS_MIN) throw new PipelineError("recommend", `fewer than 3 verified candidates (${sorted.length})`);

  const picks: ScoredCandidate[] = [];
  const usedIds = new Set<string>();
  const usedArtists = new Set<string>();
  let batchPicks: ScoredCandidate[] = [];

  const take = (c: ScoredCandidate) => {
    if (picks.length % batch === 0) batchPicks = [];
    picks.push(c);
    batchPicks.push(c);
    usedIds.add(c.catalog_key);
    usedArtists.add(normalizeArtist(c.canonical_artist));
  };
  /** Within 0.1 of the pool's best: prefer an artist not used at all, then one not used in this batch. */
  const preferNewArtist = (pool: ScoredCandidate[]): ScoredCandidate | undefined => {
    const first = pool[0];
    if (!first) return undefined;
    const close = pool.filter((c) => first.total_score - c.total_score <= ARTIST_TOLERANCE + 1e-9);
    const batchArtists = new Set(batchPicks.map((c) => normalizeArtist(c.canonical_artist)));
    return close.find((c) => !usedArtists.has(normalizeArtist(c.canonical_artist)))
      ?? close.find((c) => !batchArtists.has(normalizeArtist(c.canonical_artist)))
      ?? first;
  };

  const n = Math.min(total, sorted.length);
  while (picks.length < Math.min(TOP_BY_SCORE, n)) {
    const choice = preferNewArtist(sorted.filter((c) => !usedIds.has(c.catalog_key)));
    if (!choice) break;
    take(choice);
  }
  while (picks.length < n) {
    if (picks.length % batch === 0) batchPicks = [];
    const count = (d: DirectionTag) => batchPicks.filter((c) => primaryDirection(c) === d).length;
    const want = DIRECTIONS.reduce((best, d) => (count(d) < count(best) ? d : best));
    const available = sorted.filter((c) => !usedIds.has(c.catalog_key));
    const primary = available.filter((c) => primaryDirection(c) === want);
    const forWant = available.filter((c) => c.directions.includes(want));
    const choice = preferNewArtist(primary.length ? primary : forWant.length ? forWant : available);
    if (!choice) break;
    take(choice);
  }

  return picks.map((c, i) => ({
    ...c,
    rank: i + 1,
    direction_label: i === 0 ? BEST_FIT_LABEL : DIRECTION_LABEL[primaryDirection(c)],
    start_seconds: c.proposed_start,
    end_seconds: c.proposed_end,
    aligned_to_moment: null,
  }));
}

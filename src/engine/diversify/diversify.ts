import { DIRECTION_LABEL, BEST_FIT_LABEL, type DirectionTag, type Pick, type ScoredCandidate } from "@/src/shared/types";
import { PipelineError } from "@/src/shared/errors";
import { normalizeArtist } from "@/src/engine/catalog/normalize";

const ARTIST_TOLERANCE = 0.1;

export function primaryDirection(c: { directions: DirectionTag[] }): DirectionTag {
  return c.directions[0] ?? "safe";
}

/** Rank 1 = top total ("Best fit"); ranks 2-3 prefer unused directions, then fall back to next best overall. */
export function diversify(scored: ScoredCandidate[]): Pick[] {
  const seen = new Set<string>();
  const sorted = [...scored]
    .sort((a, b) => b.total_score - a.total_score)
    .filter((c) => (seen.has(c.deezer_id) ? false : (seen.add(c.deezer_id), true)));
  if (sorted.length < 3) throw new PipelineError("recommend", `fewer than 3 verified candidates (${sorted.length})`);

  const picks: ScoredCandidate[] = [];
  const usedIds = new Set<string>();
  const usedArtists = new Set<string>();
  const usedDirections = new Set<DirectionTag>();

  const take = (c: ScoredCandidate) => {
    picks.push(c);
    usedIds.add(c.deezer_id);
    usedArtists.add(normalizeArtist(c.canonical_artist));
    usedDirections.add(primaryDirection(c));
  };
  const preferNewArtist = (pool: ScoredCandidate[]): ScoredCandidate | undefined => {
    const first = pool[0];
    if (!first || !usedArtists.has(normalizeArtist(first.canonical_artist))) return first;
    const alt = pool.find(
      (c) => !usedArtists.has(normalizeArtist(c.canonical_artist)) && first.total_score - c.total_score <= ARTIST_TOLERANCE,
    );
    return alt ?? first;
  };

  take(sorted[0]!);
  while (picks.length < 3) {
    const available = sorted.filter((c) => !usedIds.has(c.deezer_id));
    const fresh = available.filter((c) => c.directions.every((d) => !usedDirections.has(d)));
    const choice = preferNewArtist(fresh.length ? fresh : available);
    if (!choice) break;
    take(choice);
  }

  return picks.map((c, i) => ({
    ...c,
    rank: (i + 1) as 1 | 2 | 3,
    direction_label: i === 0 ? BEST_FIT_LABEL : DIRECTION_LABEL[primaryDirection(c)],
    start_seconds: c.proposed_start,
    end_seconds: c.proposed_end,
    aligned_to_moment: null,
  }));
}

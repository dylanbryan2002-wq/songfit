import type { RecommendationRow } from "@/src/db/queries/recommendations";
import { RecommendationView } from "@/src/shared/types";

/** The ONLY shape that reaches the browser. Validated with Zod so a schema drift fails loudly. */
export function toRecommendationView(row: RecommendationRow): RecommendationView {
  // `selected` / `rejected` columns arrive with Phase 4's migration; until then the generated
  // Row type lacks them. Remove this cast in Task 4.1.
  const flags = row as { selected?: boolean | null; rejected?: boolean | null };
  return RecommendationView.parse({
    rank: row.rank,
    direction_label: row.direction_label,
    title: row.title,
    artist: row.artist,
    start_seconds: Number(row.start_seconds),
    end_seconds: Number(row.end_seconds),
    explanation: row.explanation,
    artwork_url: row.artwork_url,
    preview_url: row.preview_url,
    spotify_url: row.spotify_url,
    selected: flags.selected ?? false,
    rejected: flags.rejected ?? false,
  });
}

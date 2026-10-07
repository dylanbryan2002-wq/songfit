import "server-only";
import { PREVIEWS_ENABLED } from "@/src/shared/config";
import { getDeezerTrack, ProviderError } from "@/src/engine/catalog/deezer";
import { listPickerRows, type PickerRecommendationRow } from "@/src/db/queries/recommendations";
import { getSubmission } from "@/src/db/queries/submissions";
import { PickerData, PickerRow } from "@/src/shared/types";
import { logger } from "@/src/shared/logger";

/** The ONLY row shape the picker sends to the browser. `previewUrl` is passed in, never read from the stored column. */
export function toPickerRow(row: PickerRecommendationRow, previewUrl: string | null): PickerRow {
  const flags = row as { selected?: boolean | null; rejected?: boolean | null };
  return PickerRow.parse({
    rank: row.rank,
    direction_label: row.direction_label,
    title: row.title,
    artist: row.artist,
    start_seconds: Number(row.start_seconds),
    end_seconds: Number(row.end_seconds),
    explanation: row.explanation,
    artwork_url: row.artwork_url,
    spotify_url: row.spotify_url,
    deezer_url: row.deezer_url,
    deezer_id: row.candidates?.deezer_id ?? null,
    preview_url: previewUrl,
    selected: flags.selected ?? false,
    rejected: flags.rejected ?? false,
  });
}

type Lookup = typeof getDeezerTrack;

/** Lookup for one row. "none" and no deezer id give null; ProviderError propagates to the caller. */
async function previewFor(row: PickerRecommendationRow, lookup: Lookup): Promise<string | null> {
  const deezerId = row.candidates?.deezer_id;
  if (!PREVIEWS_ENABLED || !deezerId) return null;
  const res = await lookup(deezerId);
  if (res.kind === "none") {
    logger.warn("picker.preview_unavailable", { rank: row.rank, reason: "none" });
    return null;
  }
  return res.previewUrl;
}

/** Never throws for previews: a failed lookup leaves that row's preview_url null. */
export async function loadPicker(submissionId: string, deps: { lookup?: Lookup } = {}): Promise<PickerData> {
  const lookup = deps.lookup ?? getDeezerTrack;
  const [submission, rows] = await Promise.all([getSubmission(submissionId), listPickerRows(submissionId)]);
  const previews = await Promise.all(
    rows.map((row) =>
      previewFor(row, lookup).catch((e: unknown) => {
        logger.warn("picker.preview_unavailable", {
          rank: row.rank,
          reason: e instanceof ProviderError ? "provider" : "error",
        });
        return null;
      }),
    ),
  );
  return PickerData.parse({
    submission_id: submissionId,
    video_duration_seconds: submission?.duration_seconds ?? null,
    rows: rows.map((row, i) => toPickerRow(row, previews[i] ?? null)),
  });
}

/**
 * One fresh preview url for the refresh route. null = none available (or previews off).
 * Unlike loadPicker, a ProviderError propagates so the route can answer 503.
 */
export async function refreshPreview(submissionId: string, rank: 1 | 2 | 3): Promise<string | null> {
  const row = (await listPickerRows(submissionId)).find((r) => r.rank === rank);
  return row ? previewFor(row, getDeezerTrack) : null;
}

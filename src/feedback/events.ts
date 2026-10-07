import { insertEvent } from "@/src/db/queries/events";
import type { Json } from "@/src/db/types";
import { logger } from "@/src/shared/logger";

/** Keep in sync with docs/DATA_MODEL.md → events → "Allowed event names". The test enforces it. */
export const EVENT_NAMES = [
  "signed_up",
  "submission_created",
  "upload_completed",
  "analysis_completed",
  "recommendations_ready",
  "recommendations_viewed",
  "recommendation_selected",
  "recommendation_rejected",
  "all_rejected",
  "more_like_this_requested",
  "paid_offer_viewed",
  "paid_offer_clicked",
  "paid",
  "returned_with_second_submission",
  "pipeline_failed",
  "song_previewed",
  "explanation_opened",
  "title_copied",
  "open_app",
  "song_not_found",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export function isEventName(x: unknown): x is EventName {
  return typeof x === "string" && (EVENT_NAMES as readonly string[]).includes(x);
}

/**
 * Writes one row to `events`. Never throws: a failed metric must not fail the
 * creator's request. Errors are logged. Always pass creatorId when known —
 * the funnel counts distinct creators per milestone (I7 ruling).
 */
export async function logEvent(e: {
  name: EventName;
  creatorId?: string | null;
  submissionId?: string | null;
  metadata?: Json; // the generated Json type, so the insert typechecks under strict mode
}): Promise<void> {
  try {
    await insertEvent({
      name: e.name,
      creator_id: e.creatorId ?? null,
      submission_id: e.submissionId ?? null,
      metadata: e.metadata ?? null,
    });
  } catch (err) {
    logger.error("logEvent failed", { name: e.name, error: String(err) });
  }
}

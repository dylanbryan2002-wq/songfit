import { z } from "zod";
import { markRecommendationFeedback } from "@/src/db/queries/recommendations";
import { logEvent } from "@/src/feedback/events";
import { RankSchema, type Rank } from "@/src/shared/types";

export const FeedbackAction = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["select", "reject"]), rank: RankSchema }),
  z.object({ action: z.literal("all_rejected") }),
]);
export type FeedbackAction = { action: "select" | "reject"; rank: Rank } | { action: "all_rejected" };

/**
 * Writes the creator's choice, then logs the event. The event only follows a successful write,
 * so a retried request after a failed write never double-counts.
 */
export async function applyFeedback(
  creatorId: string,
  submissionId: string,
  input: FeedbackAction,
): Promise<"ok" | "not_found"> {
  if (input.action === "all_rejected") {
    await logEvent({ name: "all_rejected", creatorId, submissionId });
    return "ok";
  }
  const select = input.action === "select";
  const rows = await markRecommendationFeedback(
    submissionId,
    input.rank,
    select ? { selected: true, rejected: false } : { rejected: true, selected: false },
  );
  if (rows === 0) return "not_found";
  await logEvent({
    name: select ? "recommendation_selected" : "recommendation_rejected",
    creatorId,
    submissionId,
    metadata: { rank: input.rank },
  });
  return "ok";
}

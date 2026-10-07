import { claimSubmissionRun } from "@/src/db/queries/submissions";
import { logger } from "@/src/shared/logger";

/**
 * Runs the full pipeline for a submission. Entered only through claimSubmissionRun(),
 * an atomic conditional update, so two concurrent callers cannot both run it.
 * Phase 1 stub: claim, log, return (status is now 'analyzing'). Phase 2 adds the
 * analyze stage, Phase 3 adds recommend. Never throws.
 */
export async function runSubmission(submissionId: string): Promise<void> {
  const claimed = await claimSubmissionRun(submissionId);
  if (!claimed) {
    logger.info("pipeline.claim_refused", { submissionId });
    return;
  }
  logger.info("pipeline.start", { submissionId });
}

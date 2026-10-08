import { claimSubmissionRun, setSubmissionStatus } from "../db/queries/submissions";
import { getAnalysisRow } from "../db/queries/analyses";
import { listRecommendations } from "../db/queries/recommendations";
import { analyzeSubmission } from "../analysis";
import { recommendSubmission } from "../engine/recommend";
import { logEvent } from "../feedback/events";
import { LIMITS } from "../shared/config";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";
import { nextStage, type Stage } from "./stages";
import type { StageCtx } from "./budget";
import type { SubmissionStatus } from "../shared/types";
import type { Json } from "../db/types";

export type { StageCtx } from "./budget";

export type RunDeps = {
  claimSubmissionRun: (id: string) => Promise<{ id: string; creator_id: string } | null>;
  getAnalysisRow: (submissionId: string) => Promise<unknown | null>;
  listRecommendations: (submissionId: string) => Promise<unknown[]>;
  setSubmissionStatus: (id: string, status: SubmissionStatus, error?: string | null) => Promise<void>;
  analyze: (id: string, ctx: StageCtx) => Promise<void>;
  recommend: (id: string, ctx: StageCtx) => Promise<void>;
  logEvent: typeof logEvent;
  now: () => number;
};

const RAW_MAX_CHARS = 4000;

export const defaultDeps: RunDeps = {
  claimSubmissionRun,
  getAnalysisRow,
  listRecommendations,
  setSubmissionStatus,
  analyze: (id, ctx) => analyzeSubmission(id, ctx),
  recommend: (id, ctx) => recommendSubmission(id, ctx),
  logEvent,
  now: () => Date.now(),
};

const STAGE_STATUS: Record<Exclude<Stage, "done">, SubmissionStatus> = {
  analyze: "analyzing",
  recommend: "recommending",
};

/**
 * The one and only pipeline runner. Safe to call from the submit route, the run route
 * and the admin retry action concurrently: the atomic claim admits exactly one run.
 * Resumes from stored outputs. Never throws.
 */
export async function runSubmission(submissionId: string, overrides: Partial<RunDeps> = {}): Promise<void> {
  const d: RunDeps = { ...defaultDeps, ...overrides };

  const started = d.now();
  const ctx: StageCtx = { deadlineAt: started + LIMITS.pipelineBudgetMs };

  // Until a stage is chosen, blame "analyze": it is the first thing that would have run.
  let current: Exclude<Stage, "done"> = "analyze";
  let creatorId: string | null = null;

  try {
    // Claim and stored-output reads live inside the try so a database failure here is
    // recorded exactly like a stage failure (ruling C3).
    const claimed = await d.claimSubmissionRun(submissionId);
    if (!claimed) {
      logger.info("run.skipped_in_flight", { submissionId });
      return;
    }
    creatorId = claimed.creator_id;

    let stage: Stage = nextStage(
      (await d.getAnalysisRow(submissionId)) !== null,
      (await d.listRecommendations(submissionId)).length > 0,
    );
    if (stage !== "done") current = stage;

    while (stage !== "done") {
      current = stage;
      if (d.now() >= ctx.deadlineAt) {
        throw new PipelineError(current, `budget exceeded before ${current}`);
      }
      await d.setSubmissionStatus(submissionId, STAGE_STATUS[current], null);
      logger.info("pipeline.stage", { submissionId, stage: current, remainingMs: ctx.deadlineAt - d.now() });

      if (current === "analyze") {
        await d.analyze(submissionId, ctx);
        stage = "recommend";
      } else {
        await d.recommend(submissionId, ctx);
        stage = "done";
      }
    }
    await d.setSubmissionStatus(submissionId, "ready", null);
    logger.info("pipeline.ready", { submissionId, ms: d.now() - started });
  } catch (err) {
    const e = err as Error;
    const failedStage = e instanceof PipelineError ? e.stage : current;
    const message = err instanceof Error ? err.message : String(err);
    const raw = e instanceof PipelineError && e.raw ? e.raw.slice(0, RAW_MAX_CHARS) : null;
    logger.error("pipeline.failed", { submissionId, stage: failedStage, message });
    try {
      await d.setSubmissionStatus(submissionId, "failed", message);
    } catch (writeErr) {
      logger.error("pipeline.failed_write", { submissionId, error: String(writeErr) });
    }
    try {
      const metadata: Json = { stage: failedStage, error: message, raw };
      await d.logEvent({
        name: "pipeline_failed",
        submissionId,
        creatorId,
        metadata,
      });
    } catch (eventErr) {
      logger.error("pipeline.failed_event", { submissionId, error: String(eventErr) });
    }
  }
}

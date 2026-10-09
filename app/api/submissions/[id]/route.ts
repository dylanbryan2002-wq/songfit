import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { getViewer, isAdmin } from "@/src/auth/session";
import { countEventsForSubmission } from "@/src/db/queries/events";
import { getSubmission, listRecentReadyTimings } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";
import { runSubmission } from "@/src/pipeline/run";
import { LIMITS } from "@/src/shared/config";
import { etaSeconds, stageMedians, type StageMedians } from "@/src/shared/eta";
import { isUuid } from "@/src/shared/ids";
import { isStaleInFlight } from "@/src/shared/inFlight";
import { logger } from "@/src/shared/logger";
import { SubmissionStatus } from "@/src/shared/types";

// A stale run is restarted inside this request via waitUntil, so the poll needs the full budget.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Stage medians from recent runs, kept for a minute so every poll doesn't re-read them.
const MEDIANS_TTL_MS = 60_000;
let medians: { at: number; value: StageMedians } | null = null;

async function recentMedians(now: number): Promise<StageMedians> {
  if (medians && now - medians.at < MEDIANS_TTL_MS) return medians.value;
  medians = { at: now, value: stageMedians(await listRecentReadyTimings(20)) };
  return medians.value;
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await getViewer(); // an anonymous owner polls while the run goes
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const submission = await getSubmission(id);
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.creator_id !== creator.id && !isAdmin(creator)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Self-heal: the run died (function killed, deploy). The atomic claim makes a concurrent second run a no-op.
  // Capped per submission: a video that kills the function every time must not re-pay the models forever.
  if (isStaleInFlight(submission.status, submission.updated_at)) {
    if ((await countEventsForSubmission(id, "stale_restart")) < LIMITS.maxStaleRestarts) {
      logger.warn("pipeline.stale_restart", { submissionId: id, status: submission.status });
      await logEvent({
        name: "stale_restart",
        creatorId: submission.creator_id,
        submissionId: id,
        metadata: { status: submission.status },
      });
      waitUntil(runSubmission(id).catch((err) => logger.error("pipeline.unhandled", { submissionId: id, err: String(err) })));
    } else {
      logger.warn("pipeline.stale_restart_capped", { submissionId: id, status: submission.status });
    }
  }

  // A time-left estimate is a nicety: if it can't be computed the poll still answers.
  let eta: number | null = null;
  try {
    const now = Date.now();
    const status = SubmissionStatus.parse(submission.status);
    eta = etaSeconds({ ...submission, status }, await recentMedians(now), now);
  } catch (err) {
    logger.warn("eta.failed", { submissionId: id, err: String(err) });
  }

  // Status only: the results page loads the picker server-side once ready.
  return NextResponse.json({
    status: submission.status,
    error: submission.status === "failed" ? "failed" : null, // never the raw message
    etaSeconds: eta,
  });
}

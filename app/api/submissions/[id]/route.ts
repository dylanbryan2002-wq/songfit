import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { getCreator, isAdmin } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { runSubmission } from "@/src/pipeline/run";
import { isUuid } from "@/src/shared/ids";
import { isStaleInFlight } from "@/src/shared/inFlight";
import { logger } from "@/src/shared/logger";

// A stale run is restarted inside this request via waitUntil, so the poll needs the full budget.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const submission = await getSubmission(id);
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.creator_id !== creator.id && !isAdmin(creator)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Self-heal: the run died (function killed, deploy). The atomic claim makes a concurrent second run a no-op.
  if (isStaleInFlight(submission.status, submission.updated_at)) {
    logger.warn("pipeline.stale_restart", { submissionId: id, status: submission.status });
    waitUntil(runSubmission(id).catch((err) => logger.error("pipeline.unhandled", { submissionId: id, err: String(err) })));
  }

  // Status only: the results page loads the picker server-side once ready.
  return NextResponse.json({
    status: submission.status,
    error: submission.status === "failed" ? "failed" : null, // never the raw message
  });
}

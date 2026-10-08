import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { getCreator } from "@/src/auth/session";
import { countEventsForSubmission } from "@/src/db/queries/events";
import { getSubmission } from "@/src/db/queries/submissions";
import { runSubmission } from "@/src/pipeline/run";
import { LIMITS } from "@/src/shared/config";
import { isUuid } from "@/src/shared/ids";
import { isStaleInFlight } from "@/src/shared/inFlight";
import { logger } from "@/src/shared/logger";

// The pipeline runs inside this request via waitUntil, so this route needs the full budget.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Creator retry of their own failed (or stuck) run. Resumes from the failed stage via the atomic claim. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const submission = await getSubmission(id);
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.creator_id !== creator.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  if (submission.status !== "failed" && !isStaleInFlight(submission.status, submission.updated_at)) {
    return NextResponse.json({ error: "not_retryable" }, { status: 409 });
  }

  if ((await countEventsForSubmission(id, "pipeline_failed")) >= LIMITS.maxRetriesPerSubmission) {
    return NextResponse.json({ error: "retry_limit" }, { status: 429 });
  }

  waitUntil(runSubmission(id).catch((err) => logger.error("pipeline.unhandled", { submissionId: id, err: String(err) })));
  return NextResponse.json({ ok: true }, { status: 202 });
}

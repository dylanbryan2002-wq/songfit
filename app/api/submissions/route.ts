import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { createSubmission, countSubmissionsForCreator, getSubmission } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";
import { isExactStoragePath, objectInfo } from "@/src/media/storage";
import { runSubmission } from "@/src/pipeline/run";
import { LIMITS } from "@/src/shared/config";
import { PaywallError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";

// The pipeline runs inside this request via waitUntil, so this route needs the full budget.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const Body = z.object({
  submissionId: z.string().uuid(),
  path: z.string().min(1).max(200),
  ext: z.enum(["mp4", "mov", "webm", "m4v"]),
  creatorIntent: z.string().trim().max(300).nullable().optional(),
});

export async function POST(request: Request) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { submissionId, path, ext, creatorIntent } = parsed.data;

  // Idempotent: a retried POST for an id this creator already owns returns it unchanged.
  const existing = await getSubmission(submissionId);
  if (existing) {
    if (existing.creator_id !== creator.id) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ id: existing.id }, { status: 200 });
  }

  // The path must be exactly the one the server issued for this creator + id + ext.
  if (!isExactStoragePath(path, creator.id, submissionId, ext)) {
    return NextResponse.json({ error: "forbidden_path" }, { status: 403 });
  }
  const info = await objectInfo(path);
  if (!info) return NextResponse.json({ error: "upload_not_found" }, { status: 400 });
  if (info.sizeBytes > LIMITS.maxUploadBytes) return NextResponse.json({ error: "too_large" }, { status: 400 });

  let submission;
  try {
    submission = await createSubmission({
      id: submissionId,
      creatorId: creator.id,
      videoPath: path,
      creatorIntent: creatorIntent?.length ? creatorIntent : null,
    });
  } catch (err) {
    if (err instanceof PaywallError) return NextResponse.json({ reason: err.reason }, { status: 402 });
    logger.error("submission.create_failed", { submissionId, err: String(err) });
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }

  await logEvent({ name: "submission_created", creatorId: creator.id, submissionId: submission.id });
  await logEvent({ name: "upload_completed", creatorId: creator.id, submissionId: submission.id });
  if ((await countSubmissionsForCreator(creator.id)) >= 2) {
    await logEvent({ name: "returned_with_second_submission", creatorId: creator.id, submissionId: submission.id });
  }

  // Run the pipeline in this function. waitUntil keeps the instance alive after the
  // response is sent (Vercel); locally it resolves like a normal background promise.
  waitUntil(
    runSubmission(submission.id).catch((err) =>
      logger.error("pipeline.unhandled", { submissionId: submission.id, err: String(err) }),
    ),
  );

  return NextResponse.json({ id: submission.id }, { status: 201 });
}

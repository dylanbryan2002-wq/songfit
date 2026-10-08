import { NextResponse } from "next/server";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { applyFeedback, FeedbackAction } from "@/src/feedback/actions";
import { isUuid } from "@/src/shared/ids";

export const dynamic = "force-dynamic";

/** Select or reject one song, or record that every pick was rejected. Owner only (admins too are refused). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await ctx.params;
  const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isUuid(id)) return notFound();

  const body = FeedbackAction.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const submission = await getSubmission(id);
  if (!submission) return notFound();
  if (submission.creator_id !== creator.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (submission.status !== "ready") return notFound();

  if ((await applyFeedback(creator.id, id, body.data)) === "not_found") return notFound();
  return new Response(null, { status: 204 });
}

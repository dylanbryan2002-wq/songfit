import { NextResponse } from "next/server";
import { getCreator, isAdmin } from "@/src/auth/session";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { getSubmission } from "@/src/db/queries/submissions";
import { toRecommendationView } from "@/src/feedback/recommendationView";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await ctx.params;
  const submission = await getSubmission(id);
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.creator_id !== creator.id && !isAdmin(creator)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const recommendations =
    submission.status === "ready" ? (await listRecommendations(id)).map(toRecommendationView) : [];

  return NextResponse.json({
    status: submission.status,
    error: submission.status === "failed" ? "failed" : null, // never the raw message
    recommendations,
  });
}

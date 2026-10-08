import { NextResponse } from "next/server";
import { getCreator, isAdmin } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { ProviderError } from "@/src/engine/catalog/deezer";
import { refreshPreview } from "@/src/feedback/picker";
import { isUuid } from "@/src/shared/ids";

export const dynamic = "force-dynamic";

/** One-time refresh of an expired preview url. Fresh urls are never stored. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string; rank: string }> }) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id, rank } = await ctx.params;
  const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isUuid(id) || (rank !== "1" && rank !== "2" && rank !== "3")) return notFound();
  const submission = await getSubmission(id);
  if (!submission) return notFound();
  if (submission.creator_id !== creator.id && !isAdmin(creator)) return notFound();
  if (submission.status !== "ready") return notFound();

  try {
    return NextResponse.json({ preview_url: await refreshPreview(id, Number(rank)) });
  } catch (e) {
    if (e instanceof ProviderError) return NextResponse.json({ error: "provider" }, { status: 503 });
    throw e;
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";
import { isUuid } from "@/src/shared/ids";

export const dynamic = "force-dynamic";

const Rank = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** The only events the browser may log. Everything else is written server-side. */
const UiEvent = z.discriminatedUnion("name", [
  z.object({
    name: z.enum(["song_previewed", "explanation_opened", "title_copied", "song_not_found"]),
    rank: Rank,
  }),
  z.object({ name: z.literal("open_app"), rank: Rank, destination: z.enum(["tiktok", "instagram", "spotify"]) }),
]);

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await ctx.params;
  const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isUuid(id)) return notFound();

  const body = UiEvent.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const submission = await getSubmission(id);
  if (!submission) return notFound();
  if (submission.creator_id !== creator.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (submission.status !== "ready") return notFound();

  const e = body.data;
  await logEvent({
    name: e.name,
    creatorId: creator.id,
    submissionId: id,
    metadata: e.name === "open_app" ? { rank: e.rank, destination: e.destination } : { rank: e.rank },
  });
  return new Response(null, { status: 204 });
}

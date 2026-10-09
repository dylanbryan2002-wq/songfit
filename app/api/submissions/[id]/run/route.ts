import { NextResponse } from "next/server";
import { getSubmission } from "@/src/db/queries/submissions";
import { runSubmission } from "@/src/pipeline/run";
import { isInternalToken } from "@/src/auth/internalToken";
import { isUuid } from "@/src/shared/ids";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Admin retry entry point. Protected by the shared INTERNAL_TOKEN; goes through the same atomic claim. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isInternalToken(request.headers.get("x-internal-token"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const before = await getSubmission(id);
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await runSubmission(id); // never throws; refuses internally when the claim fails
  const after = await getSubmission(id);
  if (after && before.status === after.status && before.updated_at === after.updated_at) {
    return NextResponse.json({ ok: false, error: "claim_refused" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteAccount, takeDeleteToken } from "@/src/account/deletion";
import { isSameOrigin } from "@/src/auth/sameOrigin";
import { getCreator } from "@/src/auth/session";
import { createServerClient, createServiceClient } from "@/src/db/client";
import { logEvent } from "@/src/feedback/events";
import { logger } from "@/src/shared/logger";

export const dynamic = "force-dynamic";

const Body = z.object({ confirm: z.literal("DELETE") });

/** Clears the session cookies without calling Auth: the user may already be gone. */
async function signOutHere(): Promise<void> {
  try {
    await (await createServerClient()).auth.signOut({ scope: "local" });
  } catch (err) {
    logger.warn("account.signout_failed", { err: String(err) });
  }
}

/** "Delete my account": Google creators only, typed DELETE, nothing in flight. Logs only after success. */
export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!takeDeleteToken(creator.id)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  let result: Awaited<ReturnType<typeof deleteAccount>>;
  try {
    result = await deleteAccount(createServiceClient(), creator.id);
  } catch (err) {
    logger.error("account.delete_failed", { creatorId: creator.id, err: String(err) });
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }
  if (result === "in_progress") return NextResponse.json({ error: "in_progress" }, { status: 409 });
  if (result !== "gone") {
    // creator_id null: the creator row is gone, and this row must not point back at a person.
    await logEvent({ name: "account_deleted", creatorId: null, metadata: { submissions: result.submissions } });
  }
  await signOutHere();
  return new NextResponse(null, { status: 204 });
}

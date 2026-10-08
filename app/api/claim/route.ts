import { NextResponse } from "next/server";
import { CLAIM_COOKIE, CLAIM_COOKIE_OPTIONS, hashClaimToken, newClaimToken } from "@/src/auth/claim";
import { getViewer } from "@/src/auth/session";
import { setClaimTokenHash } from "@/src/db/queries/creators";

export const dynamic = "force-dynamic";

/** Results gate tap, before Google: marks this anonymous creator as claimable by the sign-in that follows. */
export async function POST() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!viewer.anonymous) return NextResponse.json({ error: "not_anonymous" }, { status: 403 });

  const token = newClaimToken();
  await setClaimTokenHash(viewer.id, hashClaimToken(token));
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(CLAIM_COOKIE, token, CLAIM_COOKIE_OPTIONS);
  return res;
}

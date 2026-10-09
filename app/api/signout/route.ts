import { NextResponse } from "next/server";
import { getViewer } from "@/src/auth/session";
import { createServerClient } from "@/src/db/client";
import { logEvent } from "@/src/feedback/events";

export const dynamic = "force-dynamic";

/** Signs the current session out (cookies cleared by the SSR client) and logs `signed_out`. */
export async function POST() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  await logEvent({ name: "signed_out", creatorId: viewer.id });
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  return new NextResponse(null, { status: 204 });
}

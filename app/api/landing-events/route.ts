import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator, getViewer } from "@/src/auth/session";
import { takeToken } from "@/src/billing/rateLimit";
import { logEvent } from "@/src/feedback/events";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 200;
const PER_MINUTE = 30;

/** Landing funnel only. A flow_id ties landed → chose → signed in; nothing else is accepted (no
 *  filename, size or duration). sign_in_completed needs a session and is logged with the creator. */
const Body = z
  .object({
    name: z.enum(["landing_viewed", "video_chosen", "sign_in_started", "sign_in_completed", "anon_session_started"]),
    flow_id: z.string().uuid(),
  })
  .strict();

/** Per server instance, best effort (see takeToken). */
const byIp = new Map<string, number[]>();

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export async function POST(request: Request) {
  if (!takeToken(byIp, clientIp(request), PER_MINUTE, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // stays null → 400
  }
  const body = Body.safeParse(json);
  if (!body.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const { name, flow_id } = body.data;
  let creatorId: string | null = null;
  if (name === "sign_in_completed") {
    const creator = await getCreator();
    if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    creatorId = creator.id;
  }
  if (name === "anon_session_started") {
    const viewer = await getViewer();
    if (!viewer?.anonymous) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    creatorId = viewer.id;
  }
  await logEvent({ name, creatorId, metadata: { flow_id } });
  return new Response(null, { status: 204 });
}

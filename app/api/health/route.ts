import { NextResponse } from "next/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** GET /api/health?sleep=65 → waits that many seconds then returns 200. Proves maxDuration is honoured. */
export async function GET(request: Request) {
  const sleep = Math.min(Number(new URL(request.url).searchParams.get("sleep") ?? "0"), 290);
  if (sleep > 0) await new Promise((r) => setTimeout(r, sleep * 1000));
  return NextResponse.json({ ok: true, slept: sleep });
}

import { access } from "node:fs/promises";
import { constants } from "node:fs";
import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { NextResponse } from "next/server";
import { isInternalToken } from "@/src/auth/internalToken";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function probe(path: string | null) {
  if (!path) return { path, exists: false, executable: false };
  const exists = await access(path, constants.F_OK).then(() => true, () => false);
  const executable = await access(path, constants.X_OK).then(() => true, () => false);
  return { path, exists, executable };
}

/** INTERNAL_TOKEN unset: never honour sleep. */
function isInternal(request: Request): boolean {
  return isInternalToken(request.headers.get("x-internal-token"));
}

/**
 * GET /api/health?sleep=65 → waits that many seconds then returns 200. Proves maxDuration is honoured.
 *   Only with the x-internal-token header (same check as the run route); otherwise sleep is ignored.
 * GET /api/health?binaries=1 → reports whether the ffmpeg/ffprobe binaries are present and executable.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (params.get("binaries") === "1") {
    return NextResponse.json({
      ok: true,
      ffmpeg: await probe(ffmpegPath),
      ffprobe: await probe(ffprobe.path),
    });
  }
  const sleep = isInternal(request) ? Math.min(Number(params.get("sleep") ?? "0"), 290) : 0;
  if (sleep > 0) await new Promise((r) => setTimeout(r, sleep * 1000));
  return NextResponse.json({ ok: true, slept: sleep });
}

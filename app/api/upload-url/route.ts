import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { canSubmit } from "@/src/billing/paywall";
import { checkUploadRate } from "@/src/billing/rateLimit";
import { getSignedUploadUrl } from "@/src/media/storage";
import { LIMITS } from "@/src/shared/config";

export const dynamic = "force-dynamic";

const Body = z.object({
  ext: z.enum(["mp4", "mov", "webm", "m4v"]),
  sizeBytes: z.number().int().positive().max(LIMITS.maxUploadBytes),
});

export async function POST(request: Request) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!(await checkUploadRate(creator.id))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const gate = await canSubmit(creator.id);
  if (!gate.ok) return NextResponse.json({ reason: gate.reason }, { status: 402 });

  const submissionId = randomUUID();
  const { path, token, signedUrl } = await getSignedUploadUrl(creator.id, submissionId, parsed.data.ext);
  return NextResponse.json({ submissionId, path, token, signedUrl });
}

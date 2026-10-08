import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@/src/db/client";
import { claimAnonymous, ensureCreator } from "@/src/db/queries/creators";
import { CLAIM_COOKIE, CLAIM_COOKIE_OPTIONS, hashClaimToken } from "@/src/auth/claim";
import { safeNext } from "@/src/auth/redirect";
import { logEvent } from "@/src/feedback/events";
import { logger } from "@/src/shared/logger";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // Only allow same-origin paths to avoid open redirects.
  const next = safeNext(url.searchParams.get("next"), url.origin);

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const claimToken = request.cookies.get(CLAIM_COOKIE)?.value;
      // Mirror the user into public.creators and log signed_up the first time we see them.
      const { data } = await supabase.auth.getUser();
      if (data.user?.email) {
        const row = await ensureCreator(
          data.user.id,
          data.user.email,
          (data.user.user_metadata?.full_name as string | undefined) ?? null,
        );
        if (Date.now() - Date.parse(row.created_at) < 60_000) {
          await logEvent({ name: "signed_up", creatorId: row.id });
        }
        // Back from the results gate: move the anonymous runs to this creator (new or returning).
        if (claimToken) {
          try {
            const moved = await claimAnonymous(hashClaimToken(claimToken), row.id);
            await logEvent({ name: "results_gate_signed_in", creatorId: row.id, metadata: { moved } });
          } catch (err) {
            logger.error("auth.claim_failed", { creatorId: row.id, err: String(err) });
          }
        }
      }
      const res = NextResponse.redirect(new URL(next, url.origin));
      // Same attributes (path=/) as when set, so the browser drops that cookie.
      if (claimToken) res.cookies.set(CLAIM_COOKIE, "", { ...CLAIM_COOKIE_OPTIONS, maxAge: 0 });
      return res;
    }
  }
  return NextResponse.redirect(new URL("/?auth=failed", url.origin));
}

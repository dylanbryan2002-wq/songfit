import { NextResponse } from "next/server";
import { createServerClient } from "@/src/db/client";
import { ensureCreator } from "@/src/db/queries/creators";
import { safeNext } from "@/src/auth/redirect";
import { logEvent } from "@/src/feedback/events";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  // Only allow same-origin paths to avoid open redirects.
  const next = safeNext(url.searchParams.get("next"), url.origin);

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
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
      }
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }
  return NextResponse.redirect(new URL("/?auth=failed", url.origin));
}

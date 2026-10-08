import { redirect } from "next/navigation";
import { createServerClient } from "@/src/db/client";
import { ensureCreator } from "@/src/db/queries/creators";
import { isAdminEmail } from "./admin";

export type Creator = { id: string; email: string };
/** Anyone with a session: a Google creator, or an anonymous visitor (email null, no picker until sign-in). */
export type Viewer = { id: string; anonymous: boolean; email: string | null };

export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  // The auth trigger creates the anonymous creators row (email null, 0009).
  if (data.user.is_anonymous) return { id: data.user.id, anonymous: true, email: null };
  if (!data.user.email) return null;
  // Idempotent mirror into public.creators so FK targets exist.
  await ensureCreator(
    data.user.id,
    data.user.email,
    (data.user.user_metadata?.full_name as string | undefined) ?? null,
  );
  return { id: data.user.id, anonymous: false, email: data.user.email };
}

/** Google creators only: null for anonymous sessions, so every route using it rejects them. */
export async function getCreator(): Promise<Creator | null> {
  const viewer = await getViewer();
  return viewer && !viewer.anonymous && viewer.email ? { id: viewer.id, email: viewer.email } : null;
}

export async function requireCreator(): Promise<Creator> {
  const creator = await getCreator();
  if (!creator) redirect("/");
  return creator;
}

/** Call this in EVERY admin page, route handler and server action, not only in the admin layout. */
export async function requireAdmin(): Promise<Creator> {
  const creator = await getCreator();
  if (!creator || !isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "")) {
    redirect("/");
  }
  return creator;
}

export function isAdmin(creator: { email: string | null } | null): boolean {
  return !!creator && isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "");
}

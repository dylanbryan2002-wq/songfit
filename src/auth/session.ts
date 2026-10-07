import { redirect } from "next/navigation";
import { createServerClient } from "@/src/db/client";
import { ensureCreator } from "@/src/db/queries/creators";
import { isAdminEmail } from "./admin";

export type Creator = { id: string; email: string };

export async function getCreator(): Promise<Creator | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !data.user.email) return null;
  const creator = { id: data.user.id, email: data.user.email };
  // Idempotent mirror into public.creators so FK targets exist.
  await ensureCreator(
    creator.id,
    creator.email,
    (data.user.user_metadata?.full_name as string | undefined) ?? null,
  );
  return creator;
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

export function isAdmin(creator: Creator | null): boolean {
  return !!creator && isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "");
}

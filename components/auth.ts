"use client";
import { createBrowserClient } from "@/src/db/browser";

export async function signInWithGoogle(next: string): Promise<void> {
  const supabase = createBrowserClient();
  const origin = window.location.origin;
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const supabase = createBrowserClient();
  await supabase.auth.signOut();
  window.location.assign("/");
}

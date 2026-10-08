"use client";
import { createBrowserClient } from "@/src/db/browser";
import { FLOW_ID_KEY, clearPendingUpload } from "@/src/upload/pendingUpload";

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
  // Drop a video still kept on this device from the landing page, and this tab's flow id.
  try {
    const flowId = sessionStorage.getItem(FLOW_ID_KEY);
    sessionStorage.removeItem(FLOW_ID_KEY);
    if (flowId) clearPendingUpload(flowId).catch(() => {}); // never wait on IndexedDB to sign out
  } catch {
    // storage unavailable: nothing was kept
  }
  const supabase = createBrowserClient();
  await supabase.auth.signOut();
  window.location.assign("/");
}

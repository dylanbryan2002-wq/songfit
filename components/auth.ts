"use client";
import { FLOW_ID_KEY } from "@/src/upload/flowId";

/** supabase-js loads on first use, not with the page: keeps it off the landing page's first paint. */
const browserClient = async () => (await import("@/src/db/browser")).createBrowserClient();

export async function signInWithGoogle(next: string): Promise<void> {
  const supabase = await browserClient();
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
    if (flowId) {
      // never wait on IndexedDB to sign out
      import("@/src/upload/pendingUpload").then((m) => m.clearPendingUpload(flowId)).catch(() => {});
    }
  } catch {
    // storage unavailable: nothing was kept
  }
  const supabase = await browserClient();
  await supabase.auth.signOut();
  window.location.assign("/");
}

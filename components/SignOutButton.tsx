"use client";
import { signOut } from "./auth";

/** "Sign out": logs the event server-side, clears the session, and returns to the landing page. */
export function SignOutButton({ className = "" }: { className?: string }) {
  async function onClick() {
    await fetch("/api/signout", { method: "POST", keepalive: true }).catch(() => {});
    await signOut();
  }
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className={`min-h-11 rounded-full px-3 text-sm font-semibold text-steel-dark ${className}`}
    >
      Sign out
    </button>
  );
}

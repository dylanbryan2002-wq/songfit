"use client";
import { useState } from "react";
import { signInWithGoogle } from "./auth";
import { GoogleButton } from "./landing/GoogleButton";
import { InAppNotice, useInAppBrowser } from "./landing/InAppNotice";

/** Sign-in-first fallback (used when the chosen video can't be kept on this device). */
export function SignIn({ message }: { message?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inApp = useInAppBrowser();
  if (inApp) {
    return (
      <div className="flex w-full max-w-md flex-col items-center gap-3">
        <InAppNotice />
      </div>
    );
  }
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3">
      {message && <p className="text-center text-sm font-semibold text-ink">{message}</p>}
      <GoogleButton
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await signInWithGoogle("/");
          } catch {
            setError("Couldn't sign you in. Try again.");
            setBusy(false);
          }
        }}
      />
      {error && <p className="text-center text-sm text-red-600">{error}</p>}
    </div>
  );
}

"use client";
import { useState } from "react";
import { signInWithGoogle } from "./auth";

export function SignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-10 flex w-full max-w-md flex-col items-center gap-4">
      <button
        type="button"
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
        className="steel-gradient w-full rounded-2xl px-6 py-4 text-base font-semibold text-white disabled:opacity-60"
      >
        Continue with Google
      </button>
      {error && <p className="text-center text-sm text-red-600">{error}</p>}
      <p className="text-center text-xs text-muted">
        Your video is processed by AI services to find songs and kept so you can come back to your results.
      </p>
    </div>
  );
}

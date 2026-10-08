"use client";
import { useState } from "react";
import { signInWithGoogle } from "./auth";
import { GoogleButton } from "./landing/GoogleButton";

/** Anonymous viewer, run ready: sign in to see the songs. Nothing from the list reaches this page. */
export function ResultsGate({ submissionId }: { submissionId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onContinue() {
    setBusy(true);
    setError(null);
    try {
      // Marks this anonymous session claimable (sf_claim cookie); the callback moves the run.
      const res = await fetch("/api/claim", { method: "POST" });
      if (!res.ok) throw new Error("claim_failed");
      await signInWithGoogle(`/results/${submissionId}`);
    } catch {
      setError("Couldn't sign you in. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-center gap-3 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your songs are ready</h1>
      <p className="text-sm text-muted">Sign in to see them and keep them.</p>
      <GoogleButton onClick={onContinue} disabled={busy} />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

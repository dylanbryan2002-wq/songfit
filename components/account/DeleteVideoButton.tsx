"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export const DELETE_FAILED = "Deletion didn't finish. Try again.";
export const WAIT_FOR_VIDEO = "Wait for this video to finish.";

export function deleteVideoError(status: number): string {
  return status === 409 ? WAIT_FOR_VIDEO : DELETE_FAILED;
}

type Phase = "idle" | "confirm" | "busy";

/** Stateless: the label, or "Delete for good? · Yes, delete · Keep", plus an error line. */
export function DeleteVideoView({
  label,
  phase,
  error,
  onAsk,
  onConfirm,
  onKeep,
}: {
  label: string;
  phase: Phase;
  error: string | null;
  onAsk: () => void;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  const btn = "min-h-11 px-1 text-xs font-semibold";
  return (
    <div className="flex flex-col items-end gap-1 text-xs">
      {phase === "idle" ? (
        <button type="button" onClick={onAsk} className={`${btn} text-muted underline underline-offset-2`}>
          {label}
        </button>
      ) : (
        <p className="flex flex-wrap items-center justify-end gap-x-1 text-ink">
          <span>Delete for good?</span>
          <span aria-hidden>·</span>
          <button type="button" onClick={onConfirm} disabled={phase === "busy"} className={`${btn} text-red-600 disabled:opacity-50`}>
            Yes, delete
          </button>
          <span aria-hidden>·</span>
          <button type="button" onClick={onKeep} disabled={phase === "busy"} className={`${btn} text-ink disabled:opacity-50`}>
            Keep
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * "Delete" on a My Songfits row, "Delete this video" on its results page. Inline confirm, no dialog.
 * After deletion the account list refreshes; the results page goes to /account.
 */
export function DeleteVideoButton({
  submissionId,
  label,
  after,
}: {
  submissionId: string;
  label: string;
  after: "refresh" | "account";
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPhase("busy");
    setError(null);
    const status = await fetch(`/api/submissions/${submissionId}`, { method: "DELETE" })
      .then((r) => r.status)
      .catch(() => 0);
    // 404: already gone (a double tap or another tab).
    if (status === 204 || status === 404) {
      if (after === "account") router.replace("/account");
      else router.refresh();
      return;
    }
    setError(deleteVideoError(status));
    setPhase("confirm");
  }

  return (
    <DeleteVideoView
      label={label}
      phase={phase}
      error={error}
      onAsk={() => setPhase("confirm")}
      onConfirm={() => void confirm()}
      onKeep={() => {
        setPhase("idle");
        setError(null);
      }}
    />
  );
}

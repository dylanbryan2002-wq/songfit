"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SubmissionStatus } from "@/src/shared/types";
import { waitingView } from "./waitingView";

const LINES = ["Watching your video", "Understanding the feel", "Finding your songs"];
const POLL_MS = 3000;
const LINE_MS = 4000;

export function WaitingState({
  submissionId,
  initialStatus,
}: {
  submissionId: string;
  initialStatus: SubmissionStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<SubmissionStatus>(initialStatus);
  const [lineIdx, setLineIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [retried, setRetried] = useState(false);
  const startedAt = useRef(Date.now());
  const view = waitingView(status, elapsed);
  const failed = view === "failed";

  useEffect(() => {
    if (failed) return;
    const t = setInterval(() => setLineIdx((i) => (i + 1) % LINES.length), LINE_MS);
    return () => clearInterval(t);
  }, [failed]);

  useEffect(() => {
    if (failed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      try {
        const res = await fetch(`/api/submissions/${submissionId}`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { status: SubmissionStatus };
          if (cancelled) return;
          if (body.status === "ready") {
            router.refresh();
            return;
          }
          setStatus(body.status);
          if (body.status === "failed") return;
        }
      } catch {
        /* transient network error: keep polling */
      }
      if (cancelled) return;
      setElapsed(Date.now() - startedAt.current);
      timer = setTimeout(tick, POLL_MS);
    }
    // After a retry, give the new run a moment to claim the row before the first poll.
    timer = setTimeout(tick, retried ? POLL_MS : 0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [submissionId, router, failed, retried]);

  async function retry() {
    setRetried(true); // one retry per visit
    const res = await fetch(`/api/submissions/${submissionId}/retry`, { method: "POST" }).catch(() => null);
    // 409: already running or done. Either way polling shows the truth.
    if (res && (res.status === 202 || res.status === 409)) {
      startedAt.current = Date.now();
      setElapsed(0);
      setStatus("analyzing");
    }
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-lg font-medium text-neutral-900">
          Something went wrong on our side. We&apos;re on it.
        </p>
        {!retried && (
          <button
            type="button"
            onClick={() => void retry()}
            className="steel-gradient min-h-11 rounded-2xl px-6 py-3 text-base font-semibold text-white"
          >
            Try again
          </button>
        )}
        <Link href="/" className="min-h-11 px-3 py-2 text-sm font-semibold text-steel-dark underline underline-offset-2">
          Try another video
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-neutral-900" />
      </div>
      <p className="text-lg font-medium text-neutral-900" aria-live="polite">
        {LINES[lineIdx]}
      </p>
      {view === "slow" && (
        <p className="text-sm text-neutral-500">This is taking longer than usual, we&apos;ll keep trying.</p>
      )}
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SubmissionStatus } from "@/src/shared/types";

const LINES = ["Watching your video", "Understanding the feel", "Finding your songs"];
const POLL_MS = 3000;
const LINE_MS = 4000;
const SLOW_AFTER_MS = 240_000;

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
  const [slow, setSlow] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (status === "failed") return;
    const t = setInterval(() => setLineIdx((i) => (i + 1) % LINES.length), LINE_MS);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (status === "failed") return;
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
          if (body.status === "failed") {
            setStatus("failed");
            return;
          }
        }
      } catch {
        /* transient network error: keep polling */
      }
      if (cancelled) return;
      if (Date.now() - startedAt.current > SLOW_AFTER_MS) setSlow(true);
      timer = setTimeout(tick, POLL_MS);
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [submissionId, router, status]);

  if (status === "failed") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-lg font-medium text-neutral-900">
          Something went wrong on our side. We&apos;re on it.
        </p>
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
      {slow && (
        <p className="text-sm text-neutral-500">This is taking longer than usual, we&apos;ll keep trying.</p>
      )}
    </div>
  );
}

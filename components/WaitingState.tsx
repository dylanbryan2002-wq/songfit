"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SubmissionStatus } from "@/src/shared/types";
import { waitingView } from "./waitingView";
import { etaLabel, nextEta, tickEta, uploadFill, waitingFill, type Eta } from "./etaDisplay";
import { FAILURE_COPY, type FailureReason } from "@/src/shared/failureReason";

const LINES = ["Watching your video", "Understanding the feel", "Finding your songs"];
const POLL_MS = 3000;
const LINE_MS = 4000;

/** The upload stage, before the submission exists. Shown by UploadForm; the results page never passes it. */
export type UploadStage = { progress: number; error: string | null; onRetry: () => void };

export function WaitingState({
  submissionId,
  initialStatus = "uploaded",
  upload = null,
  anonymous = false,
  initialReason = null,
}: {
  submissionId: string | null;
  initialStatus?: SubmissionStatus;
  upload?: UploadStage | null;
  /** Anonymous owners can't retry (the retry route is signed-in only); they get "Try another video". */
  anonymous?: boolean;
  /** Why a failed run failed, when it was the file's fault (no retry offered). */
  initialReason?: FailureReason | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<SubmissionStatus>(initialStatus);
  const [lineIdx, setLineIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [retried, setRetried] = useState(false);
  const [limited, setLimited] = useState(false);
  const [reason, setReason] = useState<FailureReason | null>(initialReason);
  const [restartFailed, setRestartFailed] = useState(false);
  const [eta, setEta] = useState<Eta | null>(null);
  const startedAt = useRef(Date.now());
  const lastStatus = useRef<SubmissionStatus>(initialStatus);
  const view = waitingView(status, elapsed);
  const failed = view === "failed";
  const polling = !upload && submissionId !== null && !failed;

  useEffect(() => {
    if (failed) return;
    const t = setInterval(() => setLineIdx((i) => (i + 1) % LINES.length), LINE_MS);
    return () => clearInterval(t);
  }, [failed]);

  // Between polls the estimate counts down on its own.
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(() => setEta(tickEta), 1000);
    return () => clearInterval(t);
  }, [polling]);

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      try {
        const res = await fetch(`/api/submissions/${submissionId}`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as {
            status: SubmissionStatus;
            etaSeconds?: number | null;
            reason?: FailureReason | null;
          };
          if (cancelled) return;
          setEta((prev) => nextEta(prev, body.etaSeconds ?? null));
          if (body.status === "ready") {
            router.refresh();
            return;
          }
          // Progress (or a server self-heal) restarts the clock: the give-up applies per stage.
          if (body.status !== lastStatus.current) {
            lastStatus.current = body.status;
            startedAt.current = Date.now();
          }
          setStatus(body.status);
          if (body.status === "failed") {
            setReason(body.reason ?? null);
            return;
          }
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
  }, [submissionId, router, polling, retried]);

  async function retry() {
    setRetried(true); // one retry per visit
    const res = await fetch(`/api/submissions/${submissionId}/retry`, { method: "POST" }).catch(() => null);
    // 409: already running or done. Either way polling shows the truth.
    if (res && (res.status === 202 || res.status === 409)) {
      startedAt.current = Date.now();
      setElapsed(0);
      setEta(null); // a new run gets a fresh estimate
      lastStatus.current = "analyzing";
      setStatus("analyzing");
    } else if (res?.status === 429) {
      setLimited(true);
    } else {
      setRestartFailed(true);
    }
  }

  if (upload?.error) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-lg font-medium text-neutral-900">{upload.error}</p>
        <button
          type="button"
          onClick={upload.onRetry}
          className="steel-gradient min-h-11 rounded-2xl px-6 py-3 text-base font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-lg font-medium text-neutral-900">
          {reason
            ? FAILURE_COPY[reason]
            : limited
              ? "This video keeps failing. Try another video."
              : restartFailed
                ? "Couldn't restart. Try another video."
                : "Something went wrong on our side. We're on it."}
        </p>
        {!retried && !anonymous && !reason && (
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

  const fill = upload ? uploadFill(upload.progress) : waitingFill(eta);
  // Upload first; then the time left, with the rotating lines underneath once an estimate is in.
  const line = upload ? `Uploading ${upload.progress}%` : eta ? etaLabel(eta.eta) : LINES[lineIdx];
  const subline = !upload && eta ? LINES[lineIdx] : null;

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div
        className="h-1.5 w-40 overflow-hidden rounded-full bg-neutral-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fill * 100)}
      >
        <div
          className="h-full rounded-full bg-neutral-900 transition-[width] duration-1000 ease-linear"
          style={{ width: `${fill * 100}%` }}
        />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-lg font-medium text-neutral-900" aria-live="polite">
          {line}
        </p>
        {subline && <p className="text-sm text-neutral-500">{subline}</p>}
      </div>
      {view === "slow" && (
        <p className="text-sm text-neutral-500">This is taking longer than usual, we&apos;ll keep trying.</p>
      )}
    </div>
  );
}

import type { SubmissionStatus } from "@/src/shared/types";

export const SLOW_AFTER_MS = 240_000;
/** Past the 6-minute stale window plus a poll or two: the self-heal had its chance, offer Retry. */
export const GIVE_UP_AFTER_MS = 7 * 60_000;

export type WaitingView = "waiting" | "slow" | "failed";

/** What the waiting screen shows after `elapsedMs` of polling a run with this status. */
export function waitingView(status: SubmissionStatus, elapsedMs: number): WaitingView {
  if (status === "failed" || elapsedMs > GIVE_UP_AFTER_MS) return "failed";
  return elapsedMs > SLOW_AFTER_MS ? "slow" : "waiting";
}

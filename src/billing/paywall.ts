import { countInFlightSubmissions, countReadySubmissions } from "@/src/db/queries/submissions";
import { getActiveSubscription } from "@/src/db/queries/subscriptions";
import { FREE_RESULTS_PER_CREATOR, LIMITS } from "@/src/shared/config";

/** in_flight: the allowance is only taken by a run still being worked on (the client says so). */
export type CanSubmit = { ok: true } | { ok: false; reason: "needs_subscription" | "in_flight" };

/**
 * UX pre-check. The database function create_submission() applies the same
 * rule atomically at insert time; this only exists so the client can show the
 * paywall before uploading 100 MB.
 */
export function decideCanSubmit(readyCount: number, inFlightCount: number, hasActiveSub: boolean): CanSubmit {
  if (hasActiveSub) return { ok: true };
  if (readyCount >= FREE_RESULTS_PER_CREATOR) return { ok: false, reason: "needs_subscription" };
  if (readyCount + inFlightCount >= FREE_RESULTS_PER_CREATOR) return { ok: false, reason: "in_flight" };
  return { ok: true };
}

export async function canSubmit(creatorId: string): Promise<CanSubmit> {
  const [readyCount, inFlight, sub] = await Promise.all([
    countReadySubmissions(creatorId),
    countInFlightSubmissions(creatorId, LIMITS.inFlightStaleMinutes),
    getActiveSubscription(creatorId),
  ]);
  return decideCanSubmit(readyCount, inFlight, sub !== null);
}

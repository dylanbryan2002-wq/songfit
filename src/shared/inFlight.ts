import { LIMITS } from "./config";

const IN_FLIGHT = new Set(["uploaded", "analyzing", "recommending"]);

/** In flight and untouched past the stale window: the run died. Mirrors claim_submission_run(). */
export function isStaleInFlight(status: string, updatedAt: string, now = Date.now()): boolean {
  return IN_FLIGHT.has(status) && now - Date.parse(updatedAt) > LIMITS.inFlightStaleMinutes * 60_000;
}

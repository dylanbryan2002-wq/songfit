import { countSubmissionsSince } from "@/src/db/queries/submissions";
import { LIMITS } from "@/src/shared/config";

export const UPLOAD_URL_LIMIT = 5;
export const UPLOAD_URL_WINDOW_MS = 60_000;
const DAY_MS = 24 * 3_600_000;

/**
 * Sliding-window token take. Pure over the store it is given so it is testable.
 * The module-level store is PER SERVER INSTANCE: on Vercel each function
 * instance has its own map, so this is a best-effort second guard. The
 * database count in checkUploadRate() is the one that holds across instances.
 */
export function takeToken(
  store: Map<string, number[]>,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  const recent = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    store.set(key, recent);
    return false;
  }
  recent.push(now);
  store.set(key, recent);
  return true;
}

const issuances = new Map<string, number[]>();

export type UploadRate = "ok" | "rate_limited" | "daily_limit";

/** Daily submissions cap: lower for an anonymous viewer (no Google sign-in yet). */
export function dailyUploadLimit(anonymous: boolean): number {
  return anonymous ? LIMITS.dailyUploadsAnonymous : LIMITS.dailyUploadsPerCreator;
}

/** True when this creator already created `limit` submissions in the last 24 h. */
export async function overDailyLimit(creatorId: string, limit: number, now = Date.now()): Promise<boolean> {
  return (await countSubmissionsSince(creatorId, new Date(now - DAY_MS).toISOString())) >= limit;
}

/** Whether this creator may be issued another upload URL right now: daily spend cap, then the burst limit. */
export async function checkUploadRate(creatorId: string, dailyLimit: number, now = Date.now()): Promise<UploadRate> {
  if (await overDailyLimit(creatorId, dailyLimit, now)) return "daily_limit";
  const created = await countSubmissionsSince(creatorId, new Date(now - UPLOAD_URL_WINDOW_MS).toISOString());
  if (created >= UPLOAD_URL_LIMIT) return "rate_limited";
  return takeToken(issuances, creatorId, UPLOAD_URL_LIMIT, UPLOAD_URL_WINDOW_MS, now) ? "ok" : "rate_limited";
}

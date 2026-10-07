import { countSubmissionsSince } from "@/src/db/queries/submissions";

export const UPLOAD_URL_LIMIT = 5;
export const UPLOAD_URL_WINDOW_MS = 60_000;

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

/** True when this creator may be issued another upload URL right now. */
export async function checkUploadRate(creatorId: string): Promise<boolean> {
  const since = new Date(Date.now() - UPLOAD_URL_WINDOW_MS).toISOString();
  const created = await countSubmissionsSince(creatorId, since);
  if (created >= UPLOAD_URL_LIMIT) return false;
  return takeToken(issuances, creatorId, UPLOAD_URL_LIMIT, UPLOAD_URL_WINDOW_MS);
}

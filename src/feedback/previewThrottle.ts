/**
 * At most one Deezer preview refresh per pick per 60 s, so a reload loop cannot burn the shared Deezer
 * quota. Keyed by submission + rank: the picker refreshes each expired pick once, and several picks can
 * expire together. The module-level Map is PER SERVER INSTANCE on Vercel (best effort, no shared store).
 */
export const PREVIEW_REFRESH_WINDOW_MS = 60_000;
const lastRefresh = new Map<string, number>();

/** Pure over the store it is given: true (and records `now`) when this key may refresh again. */
export function takeRefresh(store: Map<string, number>, key: string, now: number): boolean {
  const last = store.get(key);
  if (last !== undefined && now - last < PREVIEW_REFRESH_WINDOW_MS) return false;
  store.set(key, now);
  return true;
}

export function mayRefreshPreview(submissionId: string, rank: number, now = Date.now()): boolean {
  return takeRefresh(lastRefresh, `${submissionId}:${rank}`, now);
}

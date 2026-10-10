import "server-only";
import { createServiceClient } from "../client";

export const READY_COUNT_TTL_MS = 10 * 60_000;
/** The landing page waits on this count; a slow or unreachable database must not hold the page. */
export const READY_COUNT_TIMEOUT_MS = 1_500;

let cached: { value: number; at: number } | null = null;

/** How many submissions reached `ready` (the landing's "N videos matched so far"). Cached per server
 *  instance for 10 minutes so the landing page does at most one count per instance per 10 minutes. */
export async function countReadySubmissions(now = Date.now()): Promise<number> {
  if (cached && now - cached.at < READY_COUNT_TTL_MS) return cached.value;
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("status", "ready")
    .abortSignal(AbortSignal.timeout(READY_COUNT_TIMEOUT_MS));
  if (error) throw error;
  cached = { value: count ?? 0, at: now };
  return cached.value;
}

/** Tests only. */
export function resetReadyCountCache(): void {
  cached = null;
}

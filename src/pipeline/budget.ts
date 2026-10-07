import { LIMITS } from "../shared/config";

export type StageCtx = { deadlineAt: number };

const PERSIST_RESERVE_MS = 5_000;
const FLOOR_MS = 5_000;

/**
 * Timeout to give an external call so it cannot run past the pipeline deadline.
 * Reserves 5 s at the end so the runner can still persist `failed`.
 * Floors at 5 s so a nearly-exhausted budget fails with a real timeout error, not a zero.
 */
export function remainingBudget(
  ctx: { deadlineAt?: number } | undefined,
  defaultMs: number = LIMITS.modelTimeoutMs,
  now: number = Date.now(),
): number {
  if (ctx?.deadlineAt === undefined) return defaultMs;
  return Math.max(FLOOR_MS, Math.min(defaultMs, ctx.deadlineAt - now - PERSIST_RESERVE_MS));
}

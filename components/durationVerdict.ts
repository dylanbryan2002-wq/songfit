import { LIMITS } from "@/src/shared/config";

/** null means the browser couldn't tell; the server enforces the limit then. */
export function durationVerdict(seconds: number | null): "ok" | "too_long" {
  return seconds !== null && seconds > LIMITS.maxDurationSeconds ? "too_long" : "ok";
}

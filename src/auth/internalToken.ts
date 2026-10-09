import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/src/shared/config";

/**
 * Constant-time check of the `x-internal-token` header against INTERNAL_TOKEN. Both sides are hashed
 * first so the compared buffers always have equal length. False when the header or the env var is
 * missing or empty, so an unset token never matches.
 */
export function isInternalToken(header: string | null): boolean {
  if (!header) return false;
  let expected: string;
  try {
    expected = env("INTERNAL_TOKEN");
  } catch {
    return false;
  }
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(header), digest(expected));
}

import { createHash, randomBytes } from "node:crypto";

/** One-time token tying an anonymous creator to the Google sign-in that follows the results gate. */
export const CLAIM_COOKIE = "sf_claim";

export const CLAIM_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax", // sent on the top-level redirect back from Google
  path: "/",
  maxAge: 3600,
} as const;

export function newClaimToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only the hash is stored (creators.claim_token_hash). */
export function hashClaimToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

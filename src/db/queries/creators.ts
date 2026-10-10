import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type CreatorRow = Database["public"]["Tables"]["creators"]["Row"];

export async function getCreator(id: string): Promise<CreatorRow | null> {
  const { data, error } = await createServiceClient().from("creators").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCreatorByEmail(email: string): Promise<CreatorRow | null> {
  const { data, error } = await createServiceClient()
    .from("creators")
    .select("*")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** A row this young counts as new. The auth trigger inserts the row at sign-up, before the upsert below runs,
 *  so "inserted by this call" can't be observed; age is the signal (the signed_up rule since launch). */
export const NEW_CREATOR_WINDOW_MS = 60_000;

/** Idempotent. The auth trigger normally creates the row; this covers users created before the trigger existed.
 *  `isNew`: the row was created within NEW_CREATOR_WINDOW_MS, i.e. this is the creator's first sign-in. */
export async function ensureCreator(
  id: string,
  email: string,
  displayName?: string | null,
  now = Date.now(),
): Promise<CreatorRow & { isNew: boolean }> {
  const { data, error } = await createServiceClient()
    .from("creators")
    .upsert({ id, email: email.toLowerCase(), display_name: displayName ?? null }, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw error;
  return { ...data, isNew: now - Date.parse(data.created_at) < NEW_CREATOR_WINDOW_MS };
}

/** Stores the sha256 of an anonymous creator's claim token (the token itself only lives in the sf_claim cookie). */
export async function setClaimTokenHash(creatorId: string, tokenHash: string): Promise<void> {
  const { error } = await createServiceClient()
    .from("creators")
    .update({ claim_token_hash: tokenHash })
    .eq("id", creatorId);
  if (error) throw error;
}

/** Moves the anonymous creator's submissions and events to `creatorId`. Returns submissions moved (0 if none). */
export async function claimAnonymous(tokenHash: string, creatorId: string): Promise<number> {
  const { data, error } = await createServiceClient().rpc("claim_anonymous", { p_token_hash: tokenHash, p_creator_id: creatorId });
  if (error) throw error;
  return data ?? 0;
}

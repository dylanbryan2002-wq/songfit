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

/** Idempotent. The auth trigger normally creates the row; this covers users created before the trigger existed. */
export async function ensureCreator(id: string, email: string, displayName?: string | null): Promise<CreatorRow> {
  const { data, error } = await createServiceClient()
    .from("creators")
    .upsert({ id, email: email.toLowerCase(), display_name: displayName ?? null }, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
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

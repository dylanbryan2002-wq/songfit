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

/** Column and function from 0009_anonymous.sql. Not yet in the generated types: drop these casts after `pnpm db:types`. */
type CreatorUpdate = Database["public"]["Tables"]["creators"]["Update"];
type ClaimRpc = (fn: "claim_anonymous", args: { p_token_hash: string; p_creator_id: string }) => PromiseLike<{
  data: number | null;
  error: Error | null;
}>;

/** Stores the sha256 of an anonymous creator's claim token (the token itself only lives in the sf_claim cookie). */
export async function setClaimTokenHash(creatorId: string, tokenHash: string): Promise<void> {
  const { error } = await createServiceClient()
    .from("creators")
    .update({ claim_token_hash: tokenHash } as CreatorUpdate)
    .eq("id", creatorId);
  if (error) throw error;
}

/** Moves the anonymous creator's submissions and events to `creatorId`. Returns submissions moved (0 if none). */
export async function claimAnonymous(tokenHash: string, creatorId: string): Promise<number> {
  const db = createServiceClient();
  const rpc = db.rpc.bind(db) as unknown as ClaimRpc;
  const { data, error } = await rpc("claim_anonymous", { p_token_hash: tokenHash, p_creator_id: creatorId });
  if (error) throw error;
  return data ?? 0;
}

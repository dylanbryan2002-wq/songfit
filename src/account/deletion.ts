import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/db/types";
import { takeToken } from "@/src/billing/rateLimit";
import { deleteCreators, planCleanup, removeObjects } from "@/scripts/lib/creatorCleanup";

type Client = SupabaseClient<Database>;

/** A run in any other status may still be writing rows or files: deleting under it races the pipeline. */
const DELETABLE = new Set(["ready", "failed"]);

export const DELETE_LIMIT = 10;
export const DELETE_WINDOW_MS = 60_000;

// Per server instance, like the upload burst limit: a best-effort brake, separate from upload tokens.
const deletes = new Map<string, number[]>();

export function takeDeleteToken(creatorId: string, now = Date.now()): boolean {
  return takeToken(deletes, creatorId, DELETE_LIMIT, DELETE_WINDOW_MS, now);
}

/** Tests only. */
export function resetDeleteTokens(): void {
  deletes.clear();
}

/**
 * Deletes one of the creator's videos, in order: its storage objects (never one another submission
 * references), its events holding free text (`wanted_instead`), then the row (cascades analyses,
 * candidates, recommendations; other events keep their row with submission_id nulled). Throws at
 * the first failure, before the row is touched when storage fails.
 */
export async function deleteSubmission(
  db: Client,
  creatorId: string,
  submissionId: string,
): Promise<"not_found" | "in_progress" | { hadChoice: boolean }> {
  const { data: sub, error } = await db
    .from("submissions")
    .select("id, creator_id, status")
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw new Error(`submission: ${error.message}`);
  if (!sub || sub.creator_id !== creatorId) return "not_found";
  if (!DELETABLE.has(sub.status)) return "in_progress";

  const { data: chosen, error: recError } = await db
    .from("recommendations")
    .select("id")
    .eq("submission_id", submissionId)
    .eq("selected", true);
  if (recError) throw new Error(`recommendations: ${recError.message}`);

  const plan = await planCleanup(db, [creatorId], [], [submissionId]);
  await removeObjects(db, plan.paths);
  const events = await db.from("events").delete().eq("submission_id", submissionId).eq("name", "wanted_instead");
  if (events.error) throw new Error(`events delete: ${events.error.message}`);
  const row = await db.from("submissions").delete().eq("id", submissionId).eq("creator_id", creatorId);
  if (row.error) throw new Error(`submission delete: ${row.error.message}`);
  return { hadChoice: (chosen ?? []).length > 0 };
}

/**
 * Deletes the creator's account with the operator script's steps (scripts/lib/creatorCleanup.ts):
 * storage (incl. runs claimed from an anonymous folder), their events and their submissions' events,
 * the anonymous users those runs came from when `anonymousUserDeletable`, then the auth user, which
 * cascades the rest. `usage` rows stay (no FK). "gone" when the creator no longer exists (a retry).
 */
export async function deleteAccount(
  db: Client,
  creatorId: string,
): Promise<"gone" | "in_progress" | { submissions: number }> {
  const { data: creator, error } = await db.from("creators").select("id").eq("id", creatorId).maybeSingle();
  if (error) throw new Error(`creator: ${error.message}`);
  if (!creator) return "gone";

  const { data: subs, error: subError } = await db.from("submissions").select("id, status").eq("creator_id", creatorId);
  if (subError) throw new Error(`submissions: ${subError.message}`);
  if ((subs ?? []).some((s) => !DELETABLE.has(s.status))) return "in_progress";

  const plan = await planCleanup(db, [creatorId]);
  // Folders other than the creator's own may be anonymous ids their claimed runs came from;
  // deleteCreators deletes such a user only if it is anonymous with nothing left.
  const anonymousIds = plan.folders.filter((f) => f !== creatorId);
  await deleteCreators(db, plan, { creatorIds: [creatorId], anonymousIds });
  return { submissions: plan.submissionIds.length };
}

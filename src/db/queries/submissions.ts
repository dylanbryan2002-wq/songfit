import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";
import type { SubmissionStatus } from "@/src/shared/types";
import { PaywallError } from "@/src/shared/errors";

export type SubmissionRow = Database["public"]["Tables"]["submissions"]["Row"];
export type SubmissionUpdate = Database["public"]["Tables"]["submissions"]["Update"];

export async function getSubmission(id: string): Promise<SubmissionRow | null> {
  const { data, error } = await createServiceClient().from("submissions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Creates the submission through the create_submission() SQL function, which
 * enforces the paywall atomically (one free result per creator unless
 * subscribed) and is idempotent on `id` for the same creator.
 * Throws PaywallError when the database raises `needs_subscription`.
 */
export async function createSubmission(input: {
  id: string;
  creatorId: string;
  videoPath: string;
  creatorIntent: string | null;
}): Promise<SubmissionRow> {
  const { data, error } = await createServiceClient().rpc("create_submission", {
    p_id: input.id,
    p_creator_id: input.creatorId,
    p_video_path: input.videoPath,
    // Generated type marks p_intent as non-null, but the SQL function accepts null.
    p_intent: input.creatorIntent as string,
  });
  if (error) {
    if (error.message.includes("needs_subscription")) throw new PaywallError();
    throw error;
  }
  if (!data) throw new Error("create_submission returned no row");
  return data as SubmissionRow;
}

/**
 * Atomically claims the submission for a pipeline run via claim_submission_run().
 * Returns the claimed row, or null when another run holds it (or it is already ready).
 */
export async function claimSubmissionRun(id: string): Promise<SubmissionRow | null> {
  const { data, error } = await createServiceClient().rpc("claim_submission_run", { p_id: id });
  if (error) throw error;
  // A composite-returning function yields null (or a row with null id) when nothing matched.
  if (!data || !(data as SubmissionRow).id) return null;
  return data as SubmissionRow;
}

export async function setSubmissionStatus(
  id: string,
  status: SubmissionStatus,
  error?: string | null,
): Promise<void> {
  const patch: Database["public"]["Tables"]["submissions"]["Update"] = { status, error: error ?? null };
  const db = createServiceClient();
  if (status === "ready") {
    // Preserve the first readiness timestamp across retries (I7 ruling).
    const { data } = await db.from("submissions").select("recommended_at").eq("id", id).maybeSingle();
    if (!data?.recommended_at) patch.recommended_at = new Date().toISOString();
  }
  const { error: dbError } = await db.from("submissions").update(patch).eq("id", id);
  if (dbError) throw dbError;
}

export async function setSubmissionAnalyzed(
  id: string,
  input: { durationSeconds: number; contentCategory: string },
): Promise<void> {
  const { error } = await createServiceClient()
    .from("submissions")
    .update({
      duration_seconds: input.durationSeconds,
      content_category: input.contentCategory,
      analyzed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/** Narrow patch used by the analysis stage and admin tooling. */
export async function updateSubmission(
  id: string,
  patch: Partial<Pick<SubmissionUpdate, "content_category" | "duration_seconds" | "playback_path" | "analyzed_at" | "recommended_at" | "viewed_at">>,
): Promise<void> {
  const { error } = await createServiceClient().from("submissions").update(patch).eq("id", id);
  if (error) throw error;
}

/** Columns from 0008_vibe.sql. Not yet in the generated types: drop this after `pnpm db:types`. */
export type SubmissionVibeColumns = { vibe_tags: string[] };

/** Stores the creator's "How should it feel?" chips on the submission. */
export async function setSubmissionVibe(id: string, vibeTags: string[]): Promise<void> {
  const { error } = await createServiceClient()
    .from("submissions")
    .update({ vibe_tags: vibeTags } as SubmissionUpdate)
    .eq("id", id);
  if (error) throw error;
}

/** Sets viewed_at only the first time. Returns true if this call set it. */
export async function markSubmissionViewed(id: string): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from("submissions")
    .update({ viewed_at: new Date().toISOString() })
    .eq("id", id)
    .is("viewed_at", null)
    .select("id");
  if (error) throw error;
  return data.length > 0;
}

export type SubmissionWithCreator = SubmissionRow & { creator: { email: string } | null };

/** Admin queue: every submission, newest first, with the creator's email joined. */
export async function listSubmissions(limit = 200): Promise<SubmissionWithCreator[]> {
  const { data, error } = await createServiceClient()
    .from("submissions")
    .select("*, creator:creators(email)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function listSubmissionsForCreator(creatorId: string): Promise<SubmissionRow[]> {
  const { data, error } = await createServiceClient()
    .from("submissions")
    .select("*")
    .eq("creator_id", creatorId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** UX-only paywall preview (the database enforces the real rule): finished results for this creator. */
export async function countReadySubmissions(creatorId: string): Promise<number> {
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .eq("status", "ready");
  if (error) throw error;
  return count ?? 0;
}

export async function countSubmissionsForCreator(creatorId: string): Promise<number> {
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId);
  if (error) throw error;
  return count ?? 0;
}

/** In-flight = uploaded/analyzing/recommending and touched within the stale window. Mirrors create_submission(). */
export async function countInFlightSubmissions(creatorId: string, staleMinutes: number): Promise<number> {
  const since = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .in("status", ["uploaded", "analyzing", "recommending"])
    .gte("updated_at", since);
  if (error) throw error;
  return count ?? 0;
}

export async function countSubmissionsSince(creatorId: string, sinceIso: string): Promise<number> {
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .gte("created_at", sinceIso);
  if (error) throw error;
  return count ?? 0;
}

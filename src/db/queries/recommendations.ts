import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";
import type { Rank } from "@/src/shared/types";

export type RecommendationRow = Database["public"]["Tables"]["recommendations"]["Row"];
export type RecommendationInsert = Database["public"]["Tables"]["recommendations"]["Insert"];

/** Idempotent per stage run: replaces the submission's recommendations (up to 15). */
export async function replaceRecommendations(
  submissionId: string,
  rows: RecommendationInsert[],
): Promise<RecommendationRow[]> {
  const db = createServiceClient();
  const { error: delError } = await db.from("recommendations").delete().eq("submission_id", submissionId);
  if (delError) throw delError;
  if (rows.length === 0) return [];
  const { data, error } = await db
    .from("recommendations")
    .insert(rows.map((r) => ({ ...r, submission_id: submissionId })))
    .select("*")
    .order("rank", { ascending: true });
  if (error) throw error;
  return data;
}

export async function listRecommendations(submissionId: string): Promise<RecommendationRow[]> {
  const { data, error } = await createServiceClient()
    .from("recommendations")
    .select("*")
    .eq("submission_id", submissionId)
    .order("rank", { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Records creator feedback on one rank through the `set_recommendation_feedback`
 * SQL function: one statement, so selection is exclusive even under concurrent
 * taps. Returns the number of rows that exist for the target rank (0 = no such rank).
 */
export async function markRecommendationFeedback(
  submissionId: string,
  rank: Rank,
  patch: { selected?: boolean; rejected?: boolean },
): Promise<number> {
  const { data, error } = await createServiceClient().rpc("set_recommendation_feedback", {
    p_submission_id: submissionId,
    p_rank: rank,
    p_selected: patch.selected === true,
    p_rejected: patch.rejected === true,
  });
  if (error) throw error;
  return data ?? 0;
}

/** Picker projection: the recommendation plus its candidate's Deezer id (needed to refresh previews). */
export type PickerRecommendationRow = RecommendationRow & { candidates: { deezer_id: string | null } | null };

export async function listPickerRows(submissionId: string): Promise<PickerRecommendationRow[]> {
  const { data, error } = await createServiceClient()
    .from("recommendations")
    .select("*, candidates(deezer_id)")
    .eq("submission_id", submissionId)
    .order("rank", { ascending: true });
  if (error) throw error;
  return data;
}

/** New engine repeat limit: title + artist of songs in other submissions' top 3 within the last `days`. */
export async function recentTopPicks(excludeSubmissionId: string, days: number): Promise<{ title: string; artist: string }[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await createServiceClient()
    .from("recommendations")
    .select("title, artist")
    .lte("rank", 3)
    .gte("created_at", since)
    .neq("submission_id", excludeSubmissionId);
  if (error) throw error;
  return data;
}

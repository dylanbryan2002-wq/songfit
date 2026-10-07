import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];
export type CandidateInsert = Database["public"]["Tables"]["candidates"]["Insert"];

/** Idempotent per stage run: deletes the submission's candidates and inserts the new set. Returns the inserted rows (with ids). */
export async function replaceCandidates(submissionId: string, rows: CandidateInsert[]): Promise<CandidateRow[]> {
  const db = createServiceClient();
  const { error: delError } = await db.from("candidates").delete().eq("submission_id", submissionId);
  if (delError) throw delError;
  if (rows.length === 0) return [];
  const { data, error } = await db
    .from("candidates")
    .insert(rows.map((r) => ({ ...r, submission_id: submissionId })))
    .select("*");
  if (error) throw error;
  return data;
}

export async function listCandidates(submissionId: string): Promise<CandidateRow[]> {
  const { data, error } = await createServiceClient()
    .from("candidates")
    .select("*")
    .eq("submission_id", submissionId)
    .order("total_score", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data;
}

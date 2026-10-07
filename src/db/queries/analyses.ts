import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";
import { VideoAnalysis, MusicBrief } from "@/src/shared/types";

export type AnalysisRow = Database["public"]["Tables"]["video_analyses"]["Row"];
export type AnalysisInsert = Database["public"]["Tables"]["video_analyses"]["Insert"];

/** One analysis per submission; re-running the stage overwrites it. */
export async function upsertAnalysis(row: AnalysisInsert): Promise<AnalysisRow> {
  const { data, error } = await createServiceClient()
    .from("video_analyses")
    .upsert(row, { onConflict: "submission_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getAnalysisRow(submissionId: string): Promise<AnalysisRow | null> {
  const { data, error } = await createServiceClient()
    .from("video_analyses")
    .select("*")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Typed view used by the engine: rebuilds VideoAnalysis + MusicBrief from the
 * stored columns and validates them with Zod, so a hand-edited row fails loudly.
 */
export async function getAnalysis(
  submissionId: string,
): Promise<{ analysis: VideoAnalysis; brief: MusicBrief; row: AnalysisRow } | null> {
  const row = await getAnalysisRow(submissionId);
  if (!row) return null;
  const analysis = VideoAnalysis.parse({
    summary: row.summary,
    content_type: row.content_type,
    content_category: row.content_category ?? "other",
    setting: row.setting,
    story: row.story,
    aesthetic: row.aesthetic,
    mood: row.mood,
    energy: row.energy,
    pacing: row.pacing,
    dialogue_present: row.dialogue_present,
    important_moments: row.important_moments,
  });
  const brief = MusicBrief.parse({ text: row.music_brief, fields: row.music_brief_fields });
  return { analysis, brief, row };
}

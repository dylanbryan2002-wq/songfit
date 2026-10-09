import type { ComponentScore, MusicBrief, VerifiedCandidate, VideoAnalysis } from "@/src/shared/types";

/** Vocals under speech (ruling I9: the generator's section_is_vocal flag, never prose matching).
 *  Full penalty when the music's job is a quiet bed (or the brief predates music_job); a light one for every other job,
 *  where creators often lay a well-known vocal song low under the voice (scoring-v7, 2026-10-09). */
export function dialogueScore(analysis: VideoAnalysis, cand: VerifiedCandidate, brief?: MusicBrief): ComponentScore {
  if (!analysis.dialogue_present) return { score: 1, reason: "no dialogue" };
  if (!cand.section_is_vocal) return { score: 1, reason: "no lead vocals under the dialogue" };
  const job = brief?.fields.music_job;
  if (job && job !== "quiet_bed") return { score: 0.75, reason: "vocals sit under the speech; fine mixed low for this job" };
  return { score: 0.3, reason: "vocals will fight the dialogue" };
}

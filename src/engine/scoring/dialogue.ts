import type { ComponentScore, VerifiedCandidate, VideoAnalysis } from "@/src/shared/types";

/** Uses the generator's explicit section_is_vocal flag (ruling I9), never prose matching. */
export function dialogueScore(analysis: VideoAnalysis, cand: VerifiedCandidate): ComponentScore {
  if (!analysis.dialogue_present) return { score: 1, reason: "no dialogue" };
  if (cand.section_is_vocal) return { score: 0.3, reason: "vocals will fight the dialogue" };
  return { score: 1, reason: "no lead vocals under the dialogue" };
}

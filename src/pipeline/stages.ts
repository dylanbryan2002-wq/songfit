export type Stage = "analyze" | "recommend" | "done";

/**
 * Which stage to run next, derived ONLY from persisted outputs (ruling C3): a row in
 * video_analyses means analyze is done; rows in recommendations mean recommend is done.
 * The status string is never consulted, so a crash between "write output" and
 * "update status" resumes correctly.
 */
export function nextStage(hasAnalysis: boolean, hasRecommendations: boolean): Stage {
  if (!hasAnalysis) return "analyze";
  if (!hasRecommendations) return "recommend";
  return "done";
}

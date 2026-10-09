import type { ComponentScore, ComponentScores, MusicBrief, ScoredCandidate, VerifiedCandidate, VideoAnalysis } from "@/src/shared/types";
import { modelScores } from "@/src/engine/scoring/modelScores";
import { dialogueScore } from "@/src/engine/scoring/dialogue";
import { overuseScore } from "@/src/engine/scoring/overuse";
import { combine } from "@/src/engine/scoring/weights";
import { remainingBudget, type StageCtx } from "@/src/pipeline/budget";
import { logger } from "@/src/shared/logger";

export async function scoreCandidates(
  analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[],
  deps: { scores?: typeof modelScores; ctx?: StageCtx } = {},
): Promise<ScoredCandidate[]> {
  if (cands.length === 0) return [];
  const started = Date.now();
  const scores = deps.scores ?? modelScores;
  const fromModel = await scores(analysis, brief, cands, { timeoutMs: remainingBudget(deps.ctx) });
  const scored: ScoredCandidate[] = cands.map((c, i) => {
    const component_scores: ComponentScores = {
      ...fromModel[i]!,
      dialogue: dialogueScore(analysis, c),
      originality: lower(fromModel[i]!.originality, overuseScore(analysis, c, brief)),
    };
    return { ...c, component_scores, total_score: combine(component_scores) };
  });
  // Array.prototype.sort is stable, so ties keep input order.
  scored.sort((a, b) => b.total_score - a.total_score);
  logger.info("scoring.done", { count: scored.length, ms: Date.now() - started });
  return scored;
}

/** The overuse rule caps originality: a saturated song cannot score high on originality. */
function lower(a: ComponentScore, b: ComponentScore): ComponentScore {
  return a.score <= b.score ? a : b;
}

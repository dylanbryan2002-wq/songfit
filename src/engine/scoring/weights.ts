// The ONLY place weights live. Ask before changing (CLAUDE.md).
import type { ComponentScores, Dimension } from "@/src/shared/types";
import { DIMENSIONS } from "@/src/shared/types";

export const WEIGHTS: Record<Dimension, number> = {
  semantic: 1.5,
  pacing: 1.25,
  emotional: 1,
  aesthetic: 1,
  cultural: 1,
  originality: 0.75,
  dialogue: 1,
};

export function combine(scores: ComponentScores): number {
  let num = 0;
  let den = 0;
  for (const d of DIMENSIONS) {
    num += WEIGHTS[d] * scores[d].score;
    den += WEIGHTS[d];
  }
  return den === 0 ? 0 : num / den;
}

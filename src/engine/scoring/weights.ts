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

/** New engine (Dylan, 2026-10-11): how much each source counts toward the video's energy and mood (voice-feeling rubric,
    approved 2026-10-10). Missing sources are dropped and the rest rebalanced. Editing measures energy only. */
export const SOURCE_WEIGHTS = {
  talking: { energy: { words: 15, voice: 40, faces: 15, edit: 20, colour: 10 }, mood: { words: 40, voice: 20, faces: 20, edit: 5, colour: 15 } },
  notTalking: { energy: { edit: 55, faces: 20, words: 5, colour: 20 }, mood: { edit: 15, faces: 30, words: 25, colour: 30 } },
} as const;

/** New engine closeness weights (Dylan approved, 2026-10-11): content-type fit and mood + delivery fit count equally. */
export const MATCH_WEIGHTS = { type: 25, mood: 25, creator: 15, lyrics: 10, vocals: 10, familiarity: 10, section: 5 } as const;
/** How much a song's feeling label counts in the feelings match (Dylan: low-confidence and flagged labels count less). */
export const LABEL_WEIGHT = { high: 1, medium: 0.8, low: 0.6, flagged: 0.4 } as const;

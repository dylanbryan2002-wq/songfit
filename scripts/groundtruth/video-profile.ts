/* Video target profile (Dylan approved the 8 fields, 2026-10-11): combines each source's energy and mood reading with the
   approved source weights (voice-feeling rubric, 2026-10-10). Sources that are missing are dropped and the rest rebalanced.
   Editing gives energy only (measured pacing), so it is not used for mood. */
import { SOURCE_WEIGHTS } from "../../src/engine/scoring/weights";
export { SOURCE_WEIGHTS };

type Reading = { energy: number; mood: number };
export type Sources = { talking: boolean; words: Reading | null; colour: Reading | null; editEnergy: number | null; voice?: Reading | null; faces?: Reading | null };

function blend(weights: Record<string, number>, values: Record<string, number | null | undefined>) {
  let sum = 0, total = 0;
  for (const [k, w] of Object.entries(weights)) {
    const v = values[k];
    if (v === null || v === undefined) continue;
    sum += w * v; total += w;
  }
  return total ? sum / total : null;
}

export function combineEnergyMood(s: Sources) {
  const w = s.talking ? SOURCE_WEIGHTS.talking : SOURCE_WEIGHTS.notTalking;
  const energy = blend(w.energy, { words: s.words?.energy, voice: s.voice?.energy, faces: s.faces?.energy, edit: s.editEnergy, colour: s.colour?.energy });
  const mood = blend(w.mood, { words: s.words?.mood, voice: s.voice?.mood, faces: s.faces?.mood, colour: s.colour?.mood });
  return { energy, mood };
}

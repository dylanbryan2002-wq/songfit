import type { ComponentScore, VideoAnalysis } from "@/src/shared/types";
import { normalizeKey } from "@/src/engine/catalog/normalize";
import { OVERUSED } from "@/src/engine/scoring/config/overused";

const KEYS = new Set(OVERUSED.map((s) => normalizeKey(s.title, s.artist)));

/** Heavy use only counts against a song under speech; when the song carries the edit, creators pick the overused one on purpose (round 1). */
export function overuseScore(analysis: VideoAnalysis, cand: { title: string; artist: string }): ComponentScore {
  if (!KEYS.has(normalizeKey(cand.title, cand.artist))) return { score: 1, reason: "not on the overused list" };
  if (!analysis.dialogue_present) return { score: 1, reason: "widely used, and the song carries this edit" };
  return { score: 0.4, reason: "overused on social right now" };
}

import type { ComponentScore } from "@/src/shared/types";
import { normalizeKey } from "@/src/engine/catalog/normalize";
import { OVERUSED } from "@/src/engine/scoring/config/overused";

const KEYS = new Set(OVERUSED.map((s) => normalizeKey(s.title, s.artist)));

export function overuseScore(cand: { title: string; artist: string }): ComponentScore {
  if (KEYS.has(normalizeKey(cand.title, cand.artist))) return { score: 0.4, reason: "overused on social right now" };
  return { score: 1, reason: "not on the overused list" };
}

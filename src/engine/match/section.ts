// Section picking for the new engine (Dylan approved rules, 2026-10-11). Uses chorus timings and gaps between lyric
// lines from the song dictionary. Talking videos: the 15 s with the fewest sung seconds (long intro, then a gap of
// 12 s+, then an 8–12 s gap timed so the singing returns on the key moment), else the chorus. Non-talking videos:
// the first chorus lands on the video's key moment. No timings: null, and the existing default section is used.
import { LIMITS } from "../../shared/config";
import type { SongEntry } from "../catalog/dictionary";

export type Section = { start: number; end: number; rule: "intro" | "gap" | "short-gap" | "chorus" };
const LEN = LIMITS.sectionDefault;

export function pickSection(v: { talking: boolean; keyMoment: number | null }, s: SongEntry["sections"]): Section | null {
  if (!s || s.instrumental) return null;
  const at = (start: number, rule: Section["rule"]): Section => ({ start: Math.max(0, Math.round(start * 10) / 10), end: Math.max(0, Math.round(start * 10) / 10) + LEN, rule });
  const chorus = s.chorus[0];
  if (v.talking) {
    if (s.first_vocal !== null && s.first_vocal >= LEN) return at(0, "intro");
    const long = s.gaps.find(([a, b]) => a > 0 && b - a >= 12);
    if (long) return at(long[0], "gap");
    const short = s.gaps.find(([a, b]) => a > 0 && b - a >= 8);
    if (short) return at(Math.max(short[0], short[1] - (v.keyMoment ?? LEN / 2)), "short-gap");
    return chorus !== undefined ? at(chorus - 2, "chorus") : null;
  }
  return chorus !== undefined ? at(chorus - (v.keyMoment ?? 2), "chorus") : null;
}

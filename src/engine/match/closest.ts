// Closeness matching (new engine, Dylan 2026-10-11): songs are pre-mapped into the dictionary, the video is read into the
// same dictionary, and the closest songs win. Weights live in weights.ts. Two fixes from the 2026-10-11 review keep the
// same few songs from winning every video: creator evidence counts only for the same content type, and the feelings
// match is stretched per video (best song 1, worst 0). Pure: no model call, no I/O.
import { MATCH_WEIGHTS, LABEL_WEIGHT } from "../scoring/weights";
import { FEELINGS, type SongEntry } from "../catalog/dictionary";
import type { VideoProfile } from "../../analysis/videoProfile";
import { TYPE_FEELINGS, typeKey } from "./typeFeelings";

export type Signals = Record<keyof typeof MATCH_WEIGHTS, number> & { feelings: number };
export type Ranked = { song: SongEntry; total: number; signals: Signals };

export function feelingsCloseness(want: Record<string, number>, songFeelings: SongEntry["feelings"]) {
  let dot = 0, a = 0, b = 0;
  for (const f of FEELINGS) {
    const x = want[f] ?? 0, c = songFeelings[f], y = c ? LABEL_WEIGHT[c] : 0;
    dot += x * y; a += x * x; b += y * y;
  }
  return a && b ? dot / Math.sqrt(a * b) : 0;
}

export function rankSongs(p: VideoProfile, songs: SongEntry[]): Ranked[] {
  const r = p.reading, key = typeKey(r.content_type, r.story_feeling), allowed = TYPE_FEELINGS[key];
  const raw = songs.map((s) => (Object.keys(s.feelings).length ? feelingsCloseness(r.feelings, s.feelings) : null));
  const known = raw.filter((x): x is number => x !== null);
  const lo = known.length ? Math.min(...known) : 0, hi = known.length ? Math.max(...known) : 1;
  const out = songs.map((s, i) => {
    const labelled = Object.keys(s.feelings);
    const type = !labelled.length ? 0.5 : !allowed || !allowed.length ? 1
      : allowed.some((f) => s.feelings[f as keyof SongEntry["feelings"]] && s.feelings[f as keyof SongEntry["feelings"]] !== "flagged") ? 1
      : allowed.some((f) => s.feelings[f as keyof SongEntry["feelings"]]) ? 0.75 : 0;
    const feelings = raw[i] === null ? 0.5 : hi > lo ? (raw[i]! - lo) / (hi - lo) : 1;
    const parts = [feelings];
    if (p.energy !== null && s.energy !== null) parts.push(1 - Math.abs(p.energy - s.energy));
    if (p.mood !== null && s.valence !== null) parts.push(1 - Math.abs(p.mood - s.valence));
    const mood = parts.reduce((x, y) => x + y, 0) / parts.length;
    const creator = s.creator_types.includes(key) ? 1 : 0;
    const lyrics = s.theme && r.themes_fit.includes(s.theme as never) ? 1 : s.theme && r.themes_avoid.includes(s.theme as never) ? 0
      : s.theme === "none" && r.vocals === "instrumental preferred" ? 1 : 0.5;
    const vocals = r.vocals !== "instrumental preferred" ? 1 : s.vocals === "vocals" ? 0 : s.vocals === "instrumental" ? 1 : 0.5;
    // Known but not overused: the most popular 10% count a little less, the less known half less again.
    const familiarity = s.rank_pct === null ? 0.4 : s.rank_pct >= 0.9 ? 0.6 : s.rank_pct >= 0.5 ? 1 : 0.4;
    const section = s.sections && (s.sections.chorus.length || s.sections.instrumental) ? 1 : s.sections ? 0.5 : 0;
    const signals: Signals = { type, mood, creator, lyrics, vocals, familiarity, section, feelings };
    const total = (Object.keys(MATCH_WEIGHTS) as (keyof typeof MATCH_WEIGHTS)[]).reduce((t, k) => t + MATCH_WEIGHTS[k] * signals[k], 0);
    return { song: s, total, signals };
  });
  return out.sort((a, b) => b.total - a.total);
}

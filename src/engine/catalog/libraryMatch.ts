// Library matching (docs/review/27 follow-up): place the video on the library's map (the music's job, energy, how
// familiar the song should be, speech) and pull a varied set of songs from that spot. Pure and free: no model call.
// The songs then get sections from one small model call and compete in scoring like every other candidate.
import type { MusicBrief, MusicJob, VideoAnalysis } from "@/src/shared/types";
import LIBRARY from "@/src/engine/catalog/library.data.json";

export type LibrarySong = {
  id: string; title: string; artist: string; jobs: string[]; energy: number; era: string; year: number | null;
  fam: string; vocals: string; rank: number; mood: string[]; hook: string; proven: boolean;
};
export const LIBRARY_SONGS = LIBRARY as LibrarySong[];
export const LIBRARY_PICKS = 25;

const band = (e: number) => (e <= 2 ? 0 : e === 3 ? 1 : 2);
const VIDEO_BAND: Record<VideoAnalysis["energy"], number> = { low: 0, medium: 1, "medium-high": 2, high: 2 };
const FAM_WANTED: Record<MusicBrief["fields"]["desired_familiarity"], string[]> = {
  recognizable: ["household", "known"],
  recognizable_not_overused: ["known", "household"],
  unexpected: ["niche", "known"],
};

/** The job used for matching: the brief's, or a fallback for briefs written before analyze-v6. */
export function jobFor(analysis: VideoAnalysis, brief: MusicBrief): MusicJob {
  if (brief.fields.music_job) return brief.fields.music_job;
  if (analysis.dialogue_present && (analysis.energy === "low" || analysis.energy === "medium")) return "quiet_bed";
  return analysis.energy === "low" ? "emotional_lift" : "drive_energy";
}

/** Score of one song for this video: job is required; energy, familiarity, vocals and proven creator use add to it. */
export function matchScore(s: LibrarySong, job: MusicJob, analysis: VideoAnalysis, brief: MusicBrief): number {
  if (!s.jobs.includes(job)) return -1;
  const gap = Math.abs(band(s.energy) - VIDEO_BAND[analysis.energy]);
  let score = gap === 0 ? 1 : gap === 1 ? 0.4 : 0;
  const fam = FAM_WANTED[brief.fields.desired_familiarity];
  score += s.fam === fam[0] ? 0.6 : s.fam === fam[1] ? 0.3 : 0;
  if (job === "familiar_anthem" && s.fam === "household") score += 0.4;
  if (analysis.dialogue_present && job === "quiet_bed") score += s.vocals === "no" ? 0.5 : s.vocals === "yes" ? -0.6 : 0;
  if (s.proven) score += 0.3;
  score += Math.min(0.3, Math.log10(Math.max(1, s.rank)) / 20); // popularity, small
  return score;
}

/** Deterministic per-video randomness so equal matches rotate between videos instead of everyone getting the same songs. */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

export function libraryPicks(
  analysis: VideoAnalysis, brief: MusicBrief,
  opts: { n?: number; songs?: LibrarySong[]; seed?: string } = {},
): { job: MusicJob; picks: LibrarySong[] } {
  const job = jobFor(analysis, brief);
  const rand = seeded(opts.seed ?? analysis.summary);
  const ranked = (opts.songs ?? LIBRARY_SONGS)
    .map((s) => ({ s, score: matchScore(s, job, analysis, brief) }))
    .filter((x) => x.score >= 0)
    .map((x) => ({ ...x, score: x.score + rand() * 0.5 })) // rotation among near-equal matches
    .sort((a, b) => b.score - a.score);
  const picks: LibrarySong[] = [];
  const artists = new Set<string>();
  const eras = new Map<string, number>();
  const n = opts.n ?? LIBRARY_PICKS;
  for (const { s } of ranked) {
    if (picks.length >= n) break;
    const a = s.artist.toLowerCase();
    if (artists.has(a)) continue; // one song per artist
    if ((eras.get(s.era) ?? 0) >= Math.ceil(n / 2)) continue; // no single era takes more than half
    picks.push(s); artists.add(a); eras.set(s.era, (eras.get(s.era) ?? 0) + 1);
  }
  return { job, picks };
}

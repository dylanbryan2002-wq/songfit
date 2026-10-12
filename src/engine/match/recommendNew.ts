// New engine recommend step (Dylan, 2026-10-11), chosen by ENGINE in config. Feel buttons filter (hard), the closest
// songs win (closeness), each is checked on Deezer for a playable sample, the section comes from chorus
// timings and lyric gaps, then the existing diversify and explain steps run unchanged. Rows are marked engine "new".
// To keep the stored score shape (and the explain step) unchanged, the closeness signals are written into the existing
// 7 dimensions: semantic = lyrics fit, emotional = mood + delivery fit, aesthetic = content-type fit, pacing = mood +
// delivery fit, dialogue = vocals fit, cultural = familiarity, originality = creator evidence.
import type { FinalRecommendation, GeneratedCandidate, MusicBrief, Pick, ScoredCandidate, SubmissionStatus, VerifiedCandidate, VideoAnalysis, DirectionTag } from "@/src/shared/types";
import { PICKS_MIN, LIMITS } from "@/src/shared/config";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { normalizeKey } from "@/src/engine/catalog/normalize";
import { diversify } from "@/src/engine/diversify/diversify";
import { PROMPT_VERSION as EXPLAIN_VERSION } from "@/src/engine/explain/explainPicks";
import { toCandidateInsert } from "@/src/engine/recommend";
import type { SongEntry } from "@/src/engine/catalog/dictionary";
import type { VideoProfile } from "@/src/analysis/videoProfile";
import { PROMPT_VERSION as PROFILE_VERSION } from "@/src/analysis/videoProfile";
import { rankSongs, type Ranked } from "./closest";
import { feelFilter } from "./feelFilter";
import { pickSection } from "./section";
import { REMOVED_SONG_IDS } from "@/src/engine/catalog/removed";
import type { CandidateInsert, CandidateRow } from "@/src/db/queries/candidates";
import type { RecommendationInsert, RecommendationRow } from "@/src/db/queries/recommendations";
import type { NotFoundSong } from "@/src/db/queries/notFound";
import type { logEvent } from "@/src/feedback/events";
import type { StageCtx } from "@/src/pipeline/budget";

/** How many of the closest songs are checked on Deezer (≈8 lookups per second). */
export const SHORTLIST = 40;
export const NEW_ENGINE_VERSION = `match-v1+${PROFILE_VERSION}`;

const SECTION_REASON: Record<string, string> = {
  intro: "the instrumental intro, so nothing sung sits over the talking",
  gap: "a break in the singing, so nothing sung sits over the talking",
  "short-gap": "a short break in the singing that comes back in on the big moment",
  chorus: "the chorus, timed to the video's big moment",
  default: "the start of the song",
};

function direction(s: SongEntry): DirectionTag {
  if (s.rank_pct !== null && s.rank_pct >= 0.9) return "safe";
  if (s.year !== null && s.year >= new Date().getFullYear() - 1) return "current";
  return "unexpected";
}

export function toCandidate(r: Ranked, p: VideoProfile): GeneratedCandidate {
  const talking = p.reading.talking !== "none";
  const sec = pickSection({ talking, keyMoment: p.reading.key_moments[0]?.time ?? null }, r.song.sections);
  const start = sec?.start ?? 0, end = sec?.end ?? LIMITS.sectionDefault, rule = sec?.rule ?? "default";
  const feels = Object.keys(r.song.feelings).slice(0, 3).join(", ").toLowerCase();
  return {
    title: r.song.title, artist: r.song.artist,
    proposed_start: start, proposed_end: end, anchor_seconds: start,
    section_is_vocal: rule === "chorus" || rule === "default" ? r.song.vocals !== "instrumental" : false,
    section_reason: SECTION_REASON[rule]!,
    fit_reason: feels ? `It feels ${feels}, close to what this video needs.` : "Close in energy and mood to this video.",
    directions: [direction(r.song)], origin: "library",
  };
}

export function toScored(r: Ranked, v: VerifiedCandidate): ScoredCandidate {
  const s = r.signals, why = (score: number, reason: string) => ({ score: Math.max(0, Math.min(1, score)), reason });
  return {
    ...v,
    component_scores: {
      semantic: why(s.lyrics, "how the lyrics fit the message"),
      emotional: why(s.mood, "how close the song's feeling, energy and mood are"),
      aesthetic: why(s.type, "whether the song's feelings suit this kind of video"),
      pacing: why(s.mood, "how close the song's energy is"),
      dialogue: why(s.vocals, "whether singing would sit over the talking"),
      cultural: why(s.familiarity, "known but not overused"),
      originality: why(s.creator, "creators have used it for this kind of video"),
    },
    total_score: r.total / 100,
  };
}

export type NewDeps = {
  songs: SongEntry[];
  getSubmission: (id: string) => Promise<{ id: string; creator_id: string; duration_seconds: number | null; vibe_tags?: string[] | null } | null>;
  getStored: (submissionId: string) => Promise<{ analysis: VideoAnalysis; brief: MusicBrief; profile: VideoProfile | null } | null>;
  listNotFound: () => Promise<NotFoundSong[]>;
  verify: (cands: GeneratedCandidate[], deps?: { ctx?: StageCtx }) => Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[]; lookupFailed: GeneratedCandidate[] }>;
  explain: (picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief, deps?: { ctx?: StageCtx }) => Promise<FinalRecommendation[]>;
  replaceCandidates: (submissionId: string, rows: CandidateInsert[]) => Promise<CandidateRow[]>;
  replaceRecommendations: (submissionId: string, rows: RecommendationInsert[]) => Promise<RecommendationRow[]>;
  setStatus: (id: string, status: SubmissionStatus, error?: string | null) => Promise<void>;
  logEvent: typeof logEvent;
};

const keyOf = (c: { title: string; artist: string }) => normalizeKey(c.title, c.artist);

export async function recommendSubmissionNew(submissionId: string, ctx: StageCtx, deps: NewDeps): Promise<void> {
  const started = Date.now();
  // Independent reads run together (same results, less waiting).
  const [sub, stored, notFound] = await Promise.all([
    deps.getSubmission(submissionId),
    deps.getStored(submissionId),
    deps.listNotFound().catch((err: unknown) => { logger.warn("recommend.not_found_lookup_failed", { submissionId, reason: String(err) }); return null; }),
  ]);
  if (!sub) throw new PipelineError("recommend", "submission not found");
  if (!stored?.profile) throw new PipelineError("recommend", "no video profile stored for submission (new engine)");
  const { analysis, brief, profile } = stored;

  const banned = new Set((notFound ?? []).map(keyOf));
  // Dylan's rule (2026-10-12): no lyrics under talking. Any video where someone talks (on camera or voice-over) gets
  // only songs confirmed instrumental; songs with singing or unknown vocals are out.
  const talking = profile.reading.talking !== "none";
  const pool = deps.songs.filter((s) => !banned.has(keyOf(s)) && !REMOVED_SONG_IDS.has(s.id) && (!talking || s.vocals === "instrumental"));

  const tags = sub.vibe_tags ?? [];
  const filtered = feelFilter(tags, pool, PICKS_MIN);
  if (filtered.step > 1) await deps.logEvent({ name: "feel_filter_relaxed", creatorId: sub.creator_id, submissionId, metadata: { tags, step: filtered.step, count: filtered.songs.length } });

  const ranked = rankSongs(profile, filtered.songs).slice(0, SHORTLIST);
  const rankedByKey = new Map(ranked.map((r) => [keyOf(r.song), r]));
  const v = await deps.verify(ranked.map((r) => toCandidate(r, profile)), { ctx });
  const scored = v.verified.flatMap((c) => { const r = rankedByKey.get(keyOf(c)); return r ? [toScored(r, c)] : []; });

  const rows: CandidateInsert[] = [
    ...scored.map((c) => ({ ...toCandidateInsert(submissionId, c, true, NEW_ENGINE_VERSION), engine: "new" })),
    ...[...v.unverified, ...v.lookupFailed].map((c) => ({ ...toCandidateInsert(submissionId, c, false, NEW_ENGINE_VERSION), engine: "new" })),
  ] as CandidateInsert[]; // engine column: cast until `pnpm db:types` includes 0012_new_engine.sql
  const inserted = await deps.replaceCandidates(submissionId, rows);
  if (scored.length < PICKS_MIN) throw new PipelineError("recommend", `fewer than ${PICKS_MIN} playable songs after the Deezer check (${scored.length})`);

  const finals = await deps.explain(diversify(scored), analysis, brief, { ctx });
  const idByKey = new Map(inserted.flatMap((r) => (r.verified && r.deezer_id ? [[`deezer:${r.deezer_id}`, r.id] as const] : [])));
  await deps.replaceRecommendations(submissionId, finals.map((r) => ({
    submission_id: submissionId, candidate_id: idByKey.get(r.catalog_key as `deezer:${string}`) ?? null, rank: r.rank, direction_label: r.direction_label,
    title: r.canonical_title, artist: r.canonical_artist, start_seconds: r.start_seconds, end_seconds: r.end_seconds,
    aligned_to_moment: r.aligned_to_moment, explanation: r.explanation, explain_prompt_version: EXPLAIN_VERSION,
    spotify_url: r.spotify_url, deezer_url: r.deezer_url || null, artwork_url: r.artwork_url, preview_url: r.preview_url,
    selected: false, rejected: false, engine: "new",
  })) as RecommendationInsert[]); // engine column: cast until db:types
  await deps.setStatus(submissionId, "ready");
  await deps.logEvent({ name: "recommendations_ready", creatorId: sub.creator_id, submissionId });
  logger.info("recommend.summary", { submissionId, engine: "new", instrumentalOnly: talking, filtered: filtered.songs.length, filterStep: filtered.step, shortlist: ranked.length, playable: scored.length, picks: finals.length, ms: Date.now() - started });
}

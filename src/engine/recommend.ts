import type {
  FinalRecommendation, GeneratedCandidate, MusicBrief, Pick, ScoredCandidate, SubmissionStatus,
  VerifiedCandidate, VideoAnalysis,
} from "@/src/shared/types";
import type { Json } from "@/src/db/types";
import { PipelineError } from "@/src/shared/errors";
import { PICKS_MIN } from "@/src/shared/config";
import { logger } from "@/src/shared/logger";
import { generateCandidates, LESSONS_PROMPT_VERSION as CANDIDATES_VERSION, type GenerateOpts } from "@/src/engine/candidates/generateCandidates";
import { LIBRARY_SECTIONS_PROMPT_VERSION } from "@/src/engine/candidates/librarySections";
import { normalizeKey } from "@/src/engine/catalog/normalize";
import { verifyCandidates, type UnverifiedCandidate } from "@/src/engine/catalog/verifyCandidates";
import { scoreCandidates } from "@/src/engine/scoring/scoreCandidates";
import { diversify } from "@/src/engine/diversify/diversify";
import { selectSections } from "@/src/engine/sections/selectSections";
import { explainPicks, PROMPT_VERSION as EXPLAIN_VERSION } from "@/src/engine/explain/explainPicks";
import { getAnalysis } from "@/src/db/queries/analyses";
import { getSubmission, setSubmissionStatus, type SubmissionRow } from "@/src/db/queries/submissions";
import { replaceCandidates, type CandidateInsert, type CandidateRow } from "@/src/db/queries/candidates";
import { replaceRecommendations, type RecommendationInsert, type RecommendationRow } from "@/src/db/queries/recommendations";
import { listNotFoundSongs, type NotFoundSong } from "@/src/db/queries/notFound";
import { logEvent } from "@/src/feedback/events";
import type { StageCtx } from "@/src/pipeline/budget";

type VerifyResult = { verified: VerifiedCandidate[]; unverified: UnverifiedCandidate[]; lookupFailed: GeneratedCandidate[] };

export type RecommendDeps = {
  getSubmission: (id: string) => Promise<SubmissionRow | null>;
  getAnalysis: (submissionId: string) => Promise<{ analysis: VideoAnalysis; brief: MusicBrief; row: unknown } | null>;
  generate: (brief: MusicBrief, analysis: VideoAnalysis, opts?: GenerateOpts) => Promise<GeneratedCandidate[]>;
  verify: (cands: GeneratedCandidate[], deps?: { ctx?: StageCtx }) => Promise<VerifyResult>;
  score: (analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[], deps?: { ctx?: StageCtx }) => Promise<ScoredCandidate[]>;
  diversify: (scored: ScoredCandidate[]) => Pick[];
  sections: (picks: Pick[], analysis: VideoAnalysis) => Pick[];
  explain: (picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief, deps?: { ctx?: StageCtx }) => Promise<FinalRecommendation[]>;
  replaceCandidates: (submissionId: string, rows: CandidateInsert[]) => Promise<CandidateRow[]>;
  replaceRecommendations: (submissionId: string, rows: RecommendationInsert[]) => Promise<RecommendationRow[]>;
  setStatus: (id: string, status: SubmissionStatus, error?: string | null) => Promise<void>;
  logEvent: typeof logEvent;
  listNotFound: () => Promise<NotFoundSong[]>;
};

const defaultDeps: RecommendDeps = {
  getSubmission, getAnalysis,
  // Live since 2026-10-09 (docs/review/27): creator lessons in the song-idea prompt and songs matched from the library.
  generate: (brief, analysis, opts) => generateCandidates(brief, analysis, { ...opts, lessons: true, library: true }),
  verify: verifyCandidates, score: scoreCandidates,
  diversify, sections: selectSections, explain: explainPicks,
  replaceCandidates, replaceRecommendations, setStatus: setSubmissionStatus, logEvent, listNotFound: listNotFoundSongs,
};

/** Banned names sent to the model as exclusions; the post-verification drop still uses the full set. */
const EXCLUDE_CAP = 50;

const RETRY_NOTE =
  "previous suggestions could not be found with a playable sample; propose different, well-known studio recordings (original releases, not live versions, covers or remixes)";

export function toCandidateInsert(
  submissionId: string, c: UnverifiedCandidate | ScoredCandidate | VerifiedCandidate, verified: boolean, promptVersion: string,
): CandidateInsert {
  const s = c as Partial<ScoredCandidate>;
  return {
    submission_id: submissionId,
    title: c.title,
    artist: c.artist,
    canonical_title: verified ? s.canonical_title ?? null : null,
    canonical_artist: verified ? s.canonical_artist ?? null : null,
    deezer_id: s.deezer_id ?? null, // on an unverified row: a Deezer match with no sample (no_sample)
    itunes_id: verified ? s.itunes_id ?? null : null,
    artwork_url: s.artwork_url ?? null,
    deezer_url: s.deezer_url ?? null,
    preview_url: s.preview_url ?? null,
    preview_source: s.preview_url ? "deezer" : null,
    aligned_to_moment: null,
    duration_seconds: s.duration_seconds ?? null,
    verified,
    proposed_start: c.proposed_start,
    proposed_end: c.proposed_end,
    anchor_seconds: c.anchor_seconds,
    section_is_vocal: c.section_is_vocal,
    directions: c.directions,
    section_reason: c.section_reason,
    fit_reason: c.fit_reason,
    source: c.origin === "library" ? "catalog" : "model",
    song_id: null,
    segment_id: null,
    component_scores: (s.component_scores as unknown as Json) ?? null,
    total_score: s.total_score ?? null,
    prompt_version: promptVersion,
  };
}

const distinct = (vs: VerifiedCandidate[]) => new Set(vs.map((v) => v.catalog_key)).size;
/** Same identity as VerifiedCandidate.catalog_key, rebuilt from a stored row (recommendations hold no catalogue id). */
const rowKey = (r: CandidateRow) => (r.verified && r.deezer_id ? `deezer:${r.deezer_id}` : null);
const keyOf = (c: { title: string; artist: string }) => normalizeKey(c.title, c.artist);

export async function recommendSubmission(
  submissionId: string, ctx: StageCtx, deps: RecommendDeps = defaultDeps,
): Promise<void> {
  const started = Date.now();
  const sub = await deps.getSubmission(submissionId);
  if (!sub) throw new PipelineError("recommend", "submission not found");
  const stored = await deps.getAnalysis(submissionId);
  if (!stored) throw new PipelineError("recommend", "no analysis stored for submission");
  const { brief } = stored;
  const analysis: VideoAnalysis = { ...stored.analysis, duration_seconds: sub.duration_seconds };

  // Reports ("couldn't find it in TikTok or Instagram") from two creators ban the song for everyone.
  let reported: NotFoundSong[] = [];
  try {
    reported = await deps.listNotFound();
  } catch (err) {
    logger.warn("recommend.not_found_lookup_failed", { submissionId, reason: String(err) });
  }
  const bannedNames = new Set(reported.map(keyOf));
  const reportsByName = new Map<string, number>();
  for (const r of reported) reportsByName.set(keyOf(r), (reportsByName.get(keyOf(r)) ?? 0) + 1);
  const excludeBanned = [...reportsByName.entries()].sort((a, b) => b[1] - a[1]).slice(0, EXCLUDE_CAP).map(([k]) => k);
  const bannedCatalog = new Set(reported.flatMap((r) => (r.catalog_key ? [r.catalog_key] : [])));
  let bannedDropped = 0;
  const notBanned = (vs: VerifiedCandidate[]) => vs.filter((v) => {
    const banned = bannedCatalog.has(v.catalog_key) || bannedNames.has(keyOf(v));
    if (banned) bannedDropped += 1;
    return !banned;
  });

  const gen1 = await deps.generate(brief, analysis, { ctx, ...(excludeBanned.length ? { exclude: excludeBanned } : {}) });
  const v1 = await deps.verify(gen1, { ctx });
  const verified = notBanned(v1.verified);
  let unverified = [...v1.unverified];
  let lookupFailed = [...v1.lookupFailed];
  let generated = gen1.length;
  const firstSeen = new Set(gen1.map(keyOf));
  const seenKeys = [...new Set([...firstSeen, ...excludeBanned])];

  if (distinct(verified) < PICKS_MIN) {
    logger.warn("recommend.regenerate", { submissionId, verified: distinct(verified) });
    const gen2 = await deps.generate(brief, analysis, { note: RETRY_NOTE, exclude: seenKeys, ctx });
    generated += gen2.length;
    const v2 = await deps.verify(gen2, { ctx });
    const have = new Set(verified.map((v) => v.catalog_key));
    for (const v of notBanned(v2.verified)) if (!have.has(v.catalog_key)) { verified.push(v); have.add(v.catalog_key); }
    unverified = [...unverified, ...v2.unverified];
    lookupFailed = [...lookupFailed, ...v2.lookupFailed];
  }

  if (bannedDropped > 0) logger.info("recommend.banned_dropped", { submissionId, count: bannedDropped });

  const enough = distinct(verified) >= PICKS_MIN;
  const scored = enough ? await deps.score(analysis, brief, verified, { ctx }) : [];
  const version = (c: { title: string; artist: string; origin?: string }) => {
    const v = c.origin === "library" ? LIBRARY_SECTIONS_PROMPT_VERSION : CANDIDATES_VERSION;
    return firstSeen.has(keyOf(c)) ? v : `${v}#2`;
  };
  const rows: CandidateInsert[] = [
    ...(enough ? scored : verified).map((c) => toCandidateInsert(submissionId, c, true, version(c))),
    ...[...unverified, ...lookupFailed].map((c) => toCandidateInsert(submissionId, c, false, version(c))),
  ];
  // Persisted even when we fail below, so the inspector can show what was seen.
  const inserted = await deps.replaceCandidates(submissionId, rows);
  if (!enough) throw new PipelineError("recommend", "fewer than 3 verified candidates");

  const picks = deps.sections(deps.diversify(scored), analysis);
  const finals = await deps.explain(picks, analysis, brief, { ctx });
  const idByKey = new Map(inserted.flatMap((r) => { const k = rowKey(r); return k ? [[k, r.id] as const] : []; }));

  await deps.replaceRecommendations(submissionId, finals.map((r): RecommendationInsert => ({
    submission_id: submissionId,
    candidate_id: idByKey.get(r.catalog_key) ?? null,
    rank: r.rank,
    direction_label: r.direction_label,
    title: r.canonical_title,
    artist: r.canonical_artist,
    start_seconds: r.start_seconds,
    end_seconds: r.end_seconds,
    aligned_to_moment: r.aligned_to_moment,
    explanation: r.explanation,
    explain_prompt_version: EXPLAIN_VERSION,
    spotify_url: r.spotify_url,
    deezer_url: r.deezer_url || null,
    artwork_url: r.artwork_url,
    preview_url: r.preview_url,
    selected: false,
    rejected: false,
  })));
  await deps.setStatus(submissionId, "ready");
  await deps.logEvent({ name: "recommendations_ready", creatorId: sub.creator_id, submissionId });
  logger.info("recommend.summary", {
    submissionId, generated, verified: distinct(verified), unverified: unverified.length,
    noSample: unverified.filter((u) => u.deezer_id).length, lookupFailed: lookupFailed.length, picks: finals.length,
    ms: Date.now() - started,
  });
}

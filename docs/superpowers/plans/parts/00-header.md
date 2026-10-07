# Songfit MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A creator uploads a video from their phone and, about 90 seconds later, sees 3 real songs with exact sections and reasons, can pick one, and is offered a $9.99/month subscription for the next one.

**Architecture:** One Next.js App Router app. Thin routes in `app/` call modules in `src/`: media extraction → Claude video analysis → engine (candidate generation → Deezer verification → scoring → diversification → section selection → explanation) → Supabase rows → results page. Every engine stage is a pure-ish function over Zod-typed records so each can be replaced later.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind, Supabase (Postgres, Auth with Google, Storage), `@anthropic-ai/sdk`, `openai` (Whisper), Deezer public API, iTunes Search API, Stripe Payment Link + webhook, `ffmpeg-static` + `ffprobe-static`, Zod, Vitest, pnpm, Vercel.

**Spec:** `docs/superpowers/specs/2026-10-06-songfit-mvp-design.md`. Also required reading before any task: `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/RESEARCH.md`.

## Global Constraints

- Node 20+, pnpm. TypeScript `strict: true`, no `any` without a comment.
- Routes in `app/` are thin. `src/engine` and `src/analysis` never import from `app/` or `next`.
- Every model call: one function in one file, prompt beside it, exported `PROMPT_VERSION` string stamped on produced rows. Parse with Zod; on failure throw with raw text attached. Model ids only from `src/shared/config.ts`.
- Every candidate is verified via Deezer before scoring. Unverified rows stay with `verified = false` and are never shown.
- Recommendations are segments: song + start + end. Sections 12–20 s, inside the track.
- Status values: `uploaded → analyzing → recommending → ready | failed`. Stages idempotent, retry from failed stage.
- Event names only from `src/feedback/events.ts`, which mirrors `docs/DATA_MODEL.md`.
- Creator-facing copy: no scores, confidence, model names or jargon. Voice: sharp friend who edits video, second person, no hype, no emojis.
- Mobile first. Upload accepts `video/*`, max 150 MB, max 180 s.
- Paywall: one free result per creator; a second submission requires `subscriptions.status = 'active'`.
- Price $9.99/month via Stripe Payment Link. Domain thissongfits.com. `ADMIN_EMAILS` gates `/admin`.
- Deezer: bounded concurrency 6, 8 s timeout per request, 429/5xx retried with backoff. iTunes only for a missing preview, and only when `PREVIEWS_ENABLED`.
- Previews are optional and never block a result. `PREVIEWS_ENABLED = false` at launch (C8).
- Candidate matching: normalised title EQUALITY (no prefix matching); version markers (live, remix, acoustic, sped up, slowed, instrumental, karaoke, cover, demo) must match on both sides; featuring credits stripped before artist comparison; no splitting on "and". Store provider canonical title/artist. Dedupe verified by deezer_id.
- Sections: candidates carry `anchor_seconds`. Alignment to a video moment T is claimed only when the final window contains the anchor and `anchor − start = T` is feasible; otherwise keep the window and set `aligned_to_moment = null`. Anchor ≥ track duration drops the candidate. No clamping-and-pretending.
- Rank 1 is always labeled "Best fit". Browser receives only `RecommendationView`.
- Paywall is enforced atomically in the `create_submission()` SQL function (ready + in-flight < FREE_RESULTS_PER_CREATOR unless subscribed). The submissions table has NO authenticated insert policy.
- One runner (`runSubmission`), entered via an atomic claim (`claimSubmissionRun`). The submit route runs it with `waitUntil` and `maxDuration = 300`; the run route exists for admin retry only.
- Stripe: process → activate/update from the Stripe object's current status → record event id. Never record before processing. Validate price id against `STRIPE_PRICE_ID`. No email fallback.
- Every milestone event carries `creatorId` and `submissionId` when known.
- End of every phase: `pnpm typecheck && pnpm test && pnpm build` must pass before the next phase starts. Phases 1 and 2 end with a DEPLOYED phone test.
- Run `pnpm typecheck && pnpm test` before every commit. Commit after every task with an imperative message.
- Do not build: carousels, "more like this" beyond an event, catalog retrieval, trend feeds, queues, cron, charts.

## Phases (tracer bullets, each demoable)

| phase | demo when done |
|---|---|
| 0 Foundations | `pnpm dev` serves the upload screen shell; migrations apply; types generate; tests run. |
| 1 Upload → stored submission | From a phone: sign in with Google, upload a Reel, land on a waiting page that polls a real submission row. |
| 2 Analysis | Admin inspector shows the structured analysis, transcript and music brief for a real uploaded video. |
| 3 Engine → results | Full loop: upload → 3 real songs with sections and reasons on the results page, previews play. |
| 4 Feedback, paywall, admin, launch | Use this / Not for me recorded; second upload hits the $9.99 paywall; Stripe webhook activates; metrics page shows the funnel; live on thissongfits.com. |

Codex reviewed this plan on 2026-10-06 (`docs/review/02-codex-review.md`); the rulings in `docs/review/03-claude-rulings.md` are applied throughout. Where a task's text and the Global Constraints disagree, the constraints win.

---

## File structure

```
songfit/
  package.json  tsconfig.json  next.config.ts  tailwind.config.ts  postcss.config.mjs
  vitest.config.ts  .env.example  .gitignore  middleware.ts
  app/
    layout.tsx  globals.css  page.tsx                    upload screen
    results/[id]/page.tsx                                waiting + results (client polling)
    subscribe/page.tsx  subscribe/thanks/page.tsx        paywall
    auth/callback/route.ts                               Supabase OAuth code exchange
    admin/layout.tsx  admin/page.tsx                     queue
    admin/submissions/[id]/page.tsx                      inspector
    admin/metrics/page.tsx                               funnel
    api/submissions/route.ts                             POST create submission (after upload)
    api/submissions/[id]/route.ts                        GET status + recommendations
    api/submissions/[id]/run/route.ts                    POST run pipeline (maxDuration 300)
    api/submissions/[id]/feedback/route.ts               POST select / reject / all_rejected
    api/upload-url/route.ts                              POST signed upload URL
    api/stripe/webhook/route.ts                          POST Stripe events
  src/
    shared/
      config.ts        model ids, limits, candidate counts, env access
      types.ts         Zod schemas + inferred types used by every stage
      logger.ts        tiny structured logger
      errors.ts        PipelineError(stage, message, raw?)
    db/
      client.ts        createBrowserClient / createServerClient / createServiceClient
      types.ts         generated by `pnpm db:types` (committed)
      queries/
        creators.ts  submissions.ts  analyses.ts  candidates.ts
        recommendations.ts  events.ts  subscriptions.ts
    media/
      storage.ts       signed upload URL, download to tmp, signed playback URL
      extract.ts       ffprobe duration; ffmpeg frames (1/s, cap 60, 512px) + wav
    analysis/
      transcribe.ts    Whisper → transcript
      analyzeVideo.ts  Claude: frames + transcript + intent → VideoAnalysis + MusicBrief
      index.ts         analyzeSubmission(submissionId)
    engine/
      candidates/generateCandidates.ts   3 parallel Claude calls, dedupe
      catalog/deezer.ts                  search + match + throttle
      catalog/itunes.ts                  preview fallback
      catalog/verifyCandidates.ts
      catalog/normalize.ts               title/artist normalisation
      scoring/dimensions.ts              list + types
      scoring/modelScores.ts             one batched Claude call → 6 dimensions
      scoring/dialogue.ts                rule
      scoring/overuse.ts                 rule + config/overused.ts list
      scoring/weights.ts                 weights + combine()
      scoring/scoreCandidates.ts
      diversify/diversify.ts
      sections/selectSections.ts
      explain/explainPicks.ts            Claude rewrite in Songfit voice
      recommend.ts                       orchestrates engine stages, persists
    pipeline/run.ts                      runSubmission(id): analyze → recommend with status handling
    feedback/events.ts                   EVENT_NAMES + logEvent()
    feedback/actions.ts                  select / reject / allRejected
    billing/stripe.ts                    payment link URL, webhook verify, activate
    billing/paywall.ts                   canSubmit(creatorId)
    auth/session.ts                      getCreator() from cookies, requireAdmin()
  components/
    UploadForm.tsx  WaitingState.tsx  RecommendationCard.tsx  Offer.tsx  Logo.tsx
  supabase/
    config.toml
    migrations/0001_init.sql  0002_catalog.sql  0003_rls.sql
  tests/                                   mirrors src/, vitest
  docs/                                    existing
```

## Shared interfaces (every task uses these exact names)

`src/shared/types.ts`:

```ts
import { z } from "zod";

export const Energy = z.enum(["low", "medium", "medium-high", "high"]);
export const Pacing = z.enum(["slow", "medium", "fast"]);

export const ImportantMoment = z.object({
  time: z.number().min(0),
  type: z.string(),            // e.g. "scene_change", "main_visual_reveal", "climax"
  note: z.string().optional(),
});

export const VideoAnalysis = z.object({
  summary: z.string(),
  content_type: z.string(),     // free text, e.g. "fashion lifestyle reel"
  content_category: z.string(), // one of CONTENT_CATEGORIES in config.ts
  setting: z.string().nullable(),
  story: z.string().nullable(),
  aesthetic: z.array(z.string()),
  mood: z.array(z.string()),
  energy: Energy,
  pacing: Pacing,
  dialogue_present: z.boolean(),
  important_moments: z.array(ImportantMoment),
});
export type VideoAnalysis = z.infer<typeof VideoAnalysis>;

export const MusicBriefFields = z.object({
  moods: z.array(z.string()),
  energy: z.number().min(0).max(1),
  tempo_preference: z.enum(["slow", "medium", "medium-high", "high"]),
  vocal_preference: z.enum(["vocals", "instrumental", "either"]),
  genre_preferences: z.array(z.string()),
  genre_avoid: z.array(z.string()),
  dialogue_present: z.boolean(),
  desired_cultural_relevance: z.enum(["low", "medium", "high"]),
  desired_familiarity: z.enum(["recognizable", "recognizable_not_overused", "unexpected"]),
});
export const MusicBrief = z.object({ text: z.string(), fields: MusicBriefFields });
export type MusicBrief = z.infer<typeof MusicBrief>;

export const AnalysisResult = z.object({
  analysis: VideoAnalysis,
  brief: MusicBrief,
  transcript: z.string(),
  prompt_version: z.string(),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;

export const DirectionTag = z.enum(["safe", "current", "unexpected"]);
export type DirectionTag = z.infer<typeof DirectionTag>;
/** Labels for ranks 2–3 by primary direction. Rank 1 is ALWAYS "Best fit" regardless of direction. */
export const DIRECTION_LABEL: Record<DirectionTag, string> = {
  safe: "Safe bet", current: "More current", unexpected: "Unexpected",
};
export const BEST_FIT_LABEL = "Best fit";

export const GeneratedCandidate = z.object({
  title: z.string(),
  artist: z.string(),
  proposed_start: z.number().min(0),
  proposed_end: z.number().min(0),
  anchor_seconds: z.number().min(0),   // the model's claimed musical hit (chorus entry, drop) inside the window
  section_is_vocal: z.boolean(),       // does the proposed section carry lead vocals
  section_reason: z.string(),
  fit_reason: z.string(),
  directions: z.array(DirectionTag).min(1), // every generation direction that proposed it (dedupe keeps all)
});
export type GeneratedCandidate = z.infer<typeof GeneratedCandidate>;

export const VerifiedCandidate = GeneratedCandidate.extend({
  deezer_id: z.string(),
  canonical_title: z.string(),        // provider's title, stored verbatim
  canonical_artist: z.string(),
  duration_seconds: z.number(),
  artwork_url: z.string().nullable(),
  deezer_url: z.string(),
  preview_url: z.string().nullable(), // null when previews are disabled (config.PREVIEWS_ENABLED)
});
export type VerifiedCandidate = z.infer<typeof VerifiedCandidate>;

export const DIMENSIONS = ["semantic","emotional","aesthetic","pacing","dialogue","cultural","originality"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const ComponentScore = z.object({ score: z.number().min(0).max(1), reason: z.string() });
export type ComponentScore = z.infer<typeof ComponentScore>;
export type ComponentScores = Record<Dimension, ComponentScore>;

export const ScoredCandidate = VerifiedCandidate.extend({
  component_scores: z.record(z.enum(DIMENSIONS), ComponentScore),
  total_score: z.number(),
});
export type ScoredCandidate = z.infer<typeof ScoredCandidate>;

export const Pick = ScoredCandidate.extend({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  direction_label: z.string(),        // rank 1 is always "Best fit"; ranks 2–3 get DIRECTION_LABEL of their primary direction
  start_seconds: z.number(),
  end_seconds: z.number(),
  aligned_to_moment: z.number().nullable(), // video time T the anchor was aligned to, or null when no alignment was claimed
});
export type Pick = z.infer<typeof Pick>;

export const FinalRecommendation = Pick.extend({
  explanation: z.string(),
  spotify_url: z.string(),
  itunes_id: z.string().nullable(),
});
export type FinalRecommendation = z.infer<typeof FinalRecommendation>;

/** The ONLY shape sent to the browser. No scores, reasons, directions or provider internals. */
export const RecommendationView = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  direction_label: z.string(),
  title: z.string(),
  artist: z.string(),
  start_seconds: z.number(),
  end_seconds: z.number(),
  explanation: z.string(),
  artwork_url: z.string().nullable(),
  preview_url: z.string().nullable(),
  spotify_url: z.string(),
  selected: z.boolean(),
  rejected: z.boolean(),
});
export type RecommendationView = z.infer<typeof RecommendationView>;

export const SubmissionStatus = z.enum(["uploaded","analyzing","recommending","ready","failed"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;
```

`src/shared/config.ts` exports:

```ts
export const MODELS = { analysis: "claude-fable-5-1", candidates: "claude-sonnet-5-5", scoring: "claude-sonnet-5-5", explain: "claude-sonnet-5-5", whisper: "whisper-1" } as const;
export const LIMITS = { maxUploadBytes: 150 * 1024 * 1024, maxDurationSeconds: 180, maxFrames: 60, frameWidth: 512, candidatesPerDirection: 25, deezerConcurrency: 6, deezerTimeoutMs: 8_000, sectionMin: 12, sectionMax: 20, sectionDefault: 15, pipelineBudgetMs: 280_000, modelTimeoutMs: 120_000, inFlightStaleMinutes: 6 } as const;
export const PREVIEWS_ENABLED = false; // C8 ruling: no audio previews at launch unless Dylan enables
export const FREE_RESULTS_PER_CREATOR = 1;
export const CONTENT_CATEGORIES = ["fashion","beauty","fitness","travel","food","lifestyle","comedy","music","dance","education","business","gaming","pets","family","other"] as const;
export function env(name: string): string; // throws if missing
```

Stage signatures (each in the file named in the structure):

```ts
// media
export async function extractMedia(videoPath: string): Promise<{ durationSeconds: number; frames: { time: number; path: string }[]; audioPath: string | null }>;
export async function getSignedUploadUrl(creatorId: string, submissionId: string, ext: string): Promise<{ path: string; token: string; signedUrl: string }>;
export async function downloadToTmp(storagePath: string): Promise<string>;
// analysis
export async function transcribe(audioPath: string | null): Promise<string>;
export async function analyzeVideo(input: { frames: { time: number; base64: string }[]; transcript: string; creatorIntent: string | null; durationSeconds: number }): Promise<AnalysisResult>;
export async function analyzeSubmission(submissionId: string): Promise<void>;
// engine
export async function generateCandidates(brief: MusicBrief, analysis: VideoAnalysis): Promise<GeneratedCandidate[]>;
export async function verifyCandidates(cands: GeneratedCandidate[]): Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }>;
export async function scoreCandidates(analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[]): Promise<ScoredCandidate[]>;
export function diversify(scored: ScoredCandidate[]): Pick[];
export function selectSections(picks: Pick[], analysis: VideoAnalysis): Pick[];
export async function explainPicks(picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief): Promise<FinalRecommendation[]>;
export async function recommendSubmission(submissionId: string): Promise<void>;
// pipeline
export async function runSubmission(submissionId: string): Promise<void>; // sets statuses, catches PipelineError
// feedback
export const EVENT_NAMES = [...] as const; export type EventName = (typeof EVENT_NAMES)[number];
export async function logEvent(e: { name: EventName; creatorId?: string | null; submissionId?: string | null; metadata?: Record<string, unknown> }): Promise<void>;
// billing
export async function canSubmit(creatorId: string): Promise<{ ok: true } | { ok: false; reason: "needs_subscription" }>;
// auth
export async function getCreator(): Promise<{ id: string; email: string } | null>;
export async function requireAdmin(): Promise<{ id: string; email: string }>; // throws/redirects if not in ADMIN_EMAILS
// db queries follow the pattern: getSubmission(id), createSubmission({ id, creatorId, videoPath, creatorIntent }) [calls the create_submission() SQL function which enforces the paywall atomically and throws "needs_subscription"], claimSubmissionRun(id) [atomic conditional status update, returns row or null], setSubmissionStatus(id, status, error?), upsertAnalysis(...), getAnalysisRow(id), getAnalysis(id) → { analysis, brief, row }, replaceCandidates(submissionId, rows: CandidateInsert[]), replaceRecommendations(submissionId, rows: RecommendationInsert[]), listRecommendations(submissionId), listSubmissions() → SubmissionWithCreator[], insertEvent(...), getActiveSubscription(creatorId), activateSubscription(...), recordStripeEvent(id, type) [AFTER successful processing]
// logger: `export const logger = { info, warn, error }` — the name is `logger` everywhere.
// json: `export function extractJson(text: string): unknown` — strips fences, finds first `{` or `[`, JSON.parse, throws with raw text attached. Callers pass the result to Zod.
```

---

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
## Phase 0 — Foundations

**Demo when done:** `pnpm dev` serves the upload screen shell with the headline; the hosted Supabase project has every table, function and bucket from `docs/DATA_MODEL.md`; `pnpm db:types` produces `src/db/types.ts`; `pnpm typecheck && pnpm test && pnpm build` pass; `pnpm smoke` reports OK for Claude, Whisper, Deezer and the database.

Notes for the implementer:
- This phase was revised after the Codex review (`docs/review/02-codex-review.md`, rulings in `docs/review/03-claude-rulings.md`). Where this file and the plan header's Global Constraints disagree, the constraints win.
- There is no Docker, Homebrew or system Supabase CLI on this Mac. Supabase is **hosted**: migrations are pushed with `supabase db push` and types are generated with `--project-id`. The `supabase` CLI is installed as a dev dependency so `pnpm` scripts can call it.
- `candidates` and `recommendations` carry more columns than the original `docs/DATA_MODEL.md` because the engine types require them (anchor, vocal flag, directions, canonical provider strings, provenance, feedback flags). Task 0.3 step 1 updates the doc first, per CLAUDE.md.
- `src/db/client.ts` imports `next/headers`, so the browser client lives in its own file `src/db/browser.ts`. Client components import only from `src/db/browser.ts`.
- All `src/db/queries/*` functions use the service-role client and are `server-only`. Ownership checks (is this the caller's submission?) happen in the route/page that calls them. RLS still protects any direct Supabase access from the browser.
- The paywall is enforced **in the database** by the `create_submission()` function, and pipeline runs are claimed atomically by `claim_submission_run()`. Routes never implement either rule themselves.

---

### Task 0.1: Scaffold the Next.js app

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json`
- Modify (both already exist and are committed): `.gitignore`, `.env.example`
- Create (temporary, replaced in Task 0.6): `app/layout.tsx`, `app/page.tsx`, `app/globals.css`

**Interfaces:**
- Produces: the `@/*` path alias mapping to the repo root (so `@/src/shared/types` resolves), the scripts every later task runs (`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:types`, `pnpm db:push`, `pnpm smoke`), pinned dependency versions, and `serverExternalPackages` for the ffmpeg binaries (Task 4.7 must preserve it).

- [ ] **Step 1: Scaffold with create-next-app via a temp dir**

`README.md`, `CLAUDE.md`, `docs/`, `.gitignore` and `.env.example` already exist, so scaffold into a temp dir and copy back everything except the files we already own. `CI=1` stops create-next-app prompting.

```bash
CI=1 pnpm create next-app@15 /tmp/songfit-scaffold --ts --eslint --app --no-src-dir --no-tailwind --import-alias "@/*" --use-pnpm --yes
rsync -a --exclude README.md --exclude .git --exclude .gitignore /tmp/songfit-scaffold/ /Users/dylanbryan/Songfit/
rm -rf /tmp/songfit-scaffold
```

Expected: the folder now contains `app/`, `public/`, `next.config.ts`, `tsconfig.json`, `package.json`, `.eslintrc.json` (or `eslint.config.mjs`), `next-env.d.ts`. `README.md`, `.gitignore` and `.env.example` are unchanged.

- [ ] **Step 2: Install pinned runtime and dev dependencies**

```bash
pnpm add next@15 react@19 react-dom@19 @supabase/supabase-js@2 @supabase/ssr@0.5 @anthropic-ai/sdk@0.52 openai@4 zod@3 ffmpeg-static@5 ffprobe-static@3 stripe@17 p-limit@6 @vercel/functions@1 server-only@0.0.1
pnpm add -D typescript@5 vitest@2 tsx@4 supabase@2 @types/node@22 @types/react@19 @types/react-dom@19 tailwindcss@3 postcss@8 autoprefixer@10 eslint@9 eslint-config-next@15
```

Expected: `pnpm-lock.yaml` updated, no peer-dependency errors. `ffmpeg-static` and `ffprobe-static` download binaries on install (~70 MB); if a download fails, re-run `pnpm install`. `supabase` installs the CLI binary so `pnpm supabase --version` works. If any exact major above is unavailable, use the newest release of that major and note it in the report; never use an unpinned `latest`.

- [ ] **Step 3: Replace `package.json` scripts**

Edit `package.json` so the `scripts` block is exactly:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:push": "supabase db push",
    "db:types": "supabase gen types typescript --project-id $SUPABASE_PROJECT_REF --schema public > src/db/types.ts",
    "smoke": "node --env-file=.env.local --import tsx scripts/smoke.ts"
  }
}
```

`db:types` reads `SUPABASE_PROJECT_REF` from the shell. Before running it: `set -a; source .env.local; set +a`.

- [ ] **Step 4: Write `tsconfig.json`**

Overwrite with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "supabase/functions"]
}
```

- [ ] **Step 5: Write Tailwind v3 config and PostCSS config**

`tailwind.config.ts`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0F1419",
        steel: { light: "#8FA8C8", DEFAULT: "#5B7190", dark: "#2E3A4A" },
        canvas: "#F7F8FA",
        muted: "#6B7280",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Inter", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
```

`postcss.config.mjs`:

```js
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
```

- [ ] **Step 6: Write `next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static / ffprobe-static ship native binaries; they must not be bundled.
  // Task 4.7 edits this file and MUST keep this line.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net" },
      { protocol: "https", hostname: "cdn-images.dzcdn.net" },
      { protocol: "https", hostname: "**.mzstatic.com" },
    ],
  },
};

export default nextConfig;
```

- [ ] **Step 7: Merge missing keys into `.env.example`**

`.env.example` already exists with Supabase, AI, Stripe and app keys. Do not replace it. Add only the keys below that are missing, each under the matching section:

```bash
# --- Supabase (Project Settings → General / Database) ---
SUPABASE_PROJECT_REF=your-project-ref
SUPABASE_DB_PASSWORD=the-database-password-you-set-when-creating-the-project

# --- Stripe (Wednesday) ---
STRIPE_PRICE_ID=price_...
```

Then verify the final file lists exactly these keys: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PAYMENT_LINK_URL`, `STRIPE_PRICE_ID`, `ADMIN_EMAILS`, `INTERNAL_TOKEN`, `NEXT_PUBLIC_SITE_URL`.

```bash
grep -oE '^[A-Z_]+=' .env.example | sort
```

Expected: 14 lines. Never read, print or edit `.env.local`.

- [ ] **Step 8: Merge `.gitignore`**

`.gitignore` already ignores `node_modules/`, `.next/`, `.env*`, `.superpowers/` and more. Append only what is missing:

```
# supabase local state
supabase/.branches
supabase/.temp

# media scratch
tmp/
```

Keep every existing line (`.env.local`, `.env*.local`, `.superpowers/` in particular).

- [ ] **Step 9: Verify typecheck and build run**

```bash
pnpm typecheck
pnpm build
```

Expected: `pnpm typecheck` exits 0 with no output. `pnpm build` prints the route table with `○ /` and exits 0, with no warning about `serverExternalPackages`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app with pinned deps, Tailwind, scripts and env template"
```

---

### Task 0.2: Shared config, types, errors, logger, JSON extraction, Claude caller

**Files:**
- Create: `src/shared/config.ts`, `src/shared/types.ts`, `src/shared/errors.ts`, `src/shared/logger.ts`, `src/shared/json.ts`, `src/shared/anthropic.ts`, `vitest.config.ts`
- Test: `tests/shared/types.test.ts`, `tests/shared/config.test.ts`, `tests/shared/json.test.ts`, `tests/shared/anthropic.test.ts`

**Interfaces:**
- Produces: everything in the "Shared interfaces" block of the header: `VideoAnalysis`, `MusicBrief`, `AnalysisResult`, `DirectionTag`, `DIRECTION_LABEL`, `GeneratedCandidate`, `VerifiedCandidate`, `DIMENSIONS`, `Dimension`, `ComponentScore`, `ComponentScores`, `ScoredCandidate`, `Pick`, `FinalRecommendation`, `RecommendationView`, `SubmissionStatus`; `MODELS`, `LIMITS`, `CONTENT_CATEGORIES`, `PREVIEWS_ENABLED`, `FREE_RESULTS_PER_CREATOR`, `env()`, `adminEmails()`, `siteUrl()`; `PipelineError`, `PaywallError`; `logger`; `extractJson(text): unknown`, `JsonExtractError`; `ClaudeCall`, `makeClaudeCall(client, opts?)`, `callClaude`.

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": process.cwd(),
      // The real package throws outside Next's server runtime.
      "server-only": path.join(process.cwd(), "tests", "stubs", "server-only.ts"),
    },
  },
});
```

Create `tests/stubs/server-only.ts`:

```ts
// Vitest stub: the real package throws outside Next's server runtime.
export {};
```

- [ ] **Step 2: Write the failing tests**

`tests/shared/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { VideoAnalysis, MusicBrief, GeneratedCandidate, RecommendationView, DIRECTION_LABEL } from "@/src/shared/types";

const validAnalysis = {
  summary: "Creator walks through NYC at night and reveals an outfit.",
  content_type: "fashion lifestyle reel",
  content_category: "fashion",
  setting: "New York at night",
  story: "walk then reveal",
  aesthetic: ["luxury", "urban"],
  mood: ["confident", "mysterious"],
  energy: "medium-high",
  pacing: "medium",
  dialogue_present: false,
  important_moments: [{ time: 7.8, type: "main_visual_reveal", note: "outfit reveal" }],
};

describe("VideoAnalysis schema", () => {
  it("accepts a valid analysis", () => {
    expect(VideoAnalysis.parse(validAnalysis)).toEqual(validAnalysis);
  });

  it("rejects an unknown energy value", () => {
    expect(() => VideoAnalysis.parse({ ...validAnalysis, energy: "extreme" })).toThrow();
  });

  it("rejects negative moment times", () => {
    expect(() =>
      VideoAnalysis.parse({ ...validAnalysis, important_moments: [{ time: -1, type: "x" }] }),
    ).toThrow();
  });
});

describe("MusicBrief schema", () => {
  it("rejects energy outside 0..1", () => {
    expect(() =>
      MusicBrief.parse({
        text: "brief",
        fields: {
          moods: ["cool"],
          energy: 1.4,
          tempo_preference: "medium-high",
          vocal_preference: "either",
          genre_preferences: [],
          genre_avoid: [],
          dialogue_present: false,
          desired_cultural_relevance: "high",
          desired_familiarity: "recognizable_not_overused",
        },
      }),
    ).toThrow();
  });
});

describe("GeneratedCandidate schema", () => {
  const valid = {
    title: "Blinding Lights",
    artist: "The Weeknd",
    proposed_start: 40,
    proposed_end: 55,
    anchor_seconds: 43,
    section_is_vocal: true,
    section_reason: "chorus enters at 0:43",
    fit_reason: "neon night-drive energy matches the city walk",
    directions: ["safe", "current"],
  };
  it("accepts a candidate with anchor, vocal flag and directions", () => {
    expect(GeneratedCandidate.parse(valid)).toEqual(valid);
  });
  it("rejects an empty directions list", () => {
    expect(() => GeneratedCandidate.parse({ ...valid, directions: [] })).toThrow();
  });
  it("rejects a missing anchor", () => {
    const { anchor_seconds: _omit, ...noAnchor } = valid;
    expect(() => GeneratedCandidate.parse(noAnchor)).toThrow();
  });
});

describe("RecommendationView schema", () => {
  it("has no score or reason fields", () => {
    const keys = Object.keys(RecommendationView.shape).sort();
    expect(keys).toEqual(
      [
        "artwork_url",
        "artist",
        "direction_label",
        "end_seconds",
        "explanation",
        "preview_url",
        "rank",
        "rejected",
        "selected",
        "spotify_url",
        "start_seconds",
        "title",
      ].sort(),
    );
  });
});

describe("DIRECTION_LABEL", () => {
  it("maps every direction to a creator-facing label", () => {
    expect(DIRECTION_LABEL).toEqual({
      safe: "Best fit",
      current: "More current",
      unexpected: "Unexpected",
    });
  });
});
```

`tests/shared/config.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env, LIMITS, MODELS, CONTENT_CATEGORIES, PREVIEWS_ENABLED, FREE_RESULTS_PER_CREATOR } from "@/src/shared/config";

describe("env()", () => {
  const KEY = "SONGFIT_TEST_ENV_VAR";
  beforeEach(() => {
    delete process.env[KEY];
  });
  afterEach(() => {
    delete process.env[KEY];
  });

  it("returns the value when set", () => {
    process.env[KEY] = "hello";
    expect(env(KEY)).toBe("hello");
  });

  it("throws a clear error when missing", () => {
    expect(() => env(KEY)).toThrow(/SONGFIT_TEST_ENV_VAR/);
  });

  it("throws when set to an empty string", () => {
    process.env[KEY] = "";
    expect(() => env(KEY)).toThrow();
  });
});

describe("LIMITS and MODELS", () => {
  it("keeps section bounds sane", () => {
    expect(LIMITS.sectionMin).toBeLessThan(LIMITS.sectionDefault);
    expect(LIMITS.sectionDefault).toBeLessThan(LIMITS.sectionMax);
    expect(LIMITS.maxDurationSeconds).toBe(180);
  });
  it("has 'other' as a content category", () => {
    expect(CONTENT_CATEGORIES).toContain("other");
  });
  it("uses Fable only for video analysis", () => {
    expect(MODELS.analysis).toBe("claude-fable-5-1");
    expect(MODELS.candidates).toBe("claude-sonnet-5-5");
    expect(MODELS.scoring).toBe("claude-sonnet-5-5");
    expect(MODELS.explain).toBe("claude-sonnet-5-5");
  });
  it("ships with previews off and one free result", () => {
    expect(PREVIEWS_ENABLED).toBe(false);
    expect(FREE_RESULTS_PER_CREATOR).toBe(1);
  });
});
```

`tests/shared/json.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractJson, JsonExtractError } from "@/src/shared/json";

describe("extractJson", () => {
  it("parses a bare object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a bare array", () => {
    expect(extractJson('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("strips a ```json fence", () => {
    expect(extractJson('```json\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  it("finds JSON wrapped in prose", () => {
    expect(extractJson('Sure! Here it is:\n{"ok":true}\nLet me know.')).toEqual({ ok: true });
  });

  it("throws JsonExtractError carrying the raw text on invalid JSON", () => {
    const raw = "{not json";
    try {
      extractJson(raw);
      throw new Error("expected extractJson to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(JsonExtractError);
      expect((e as JsonExtractError).raw).toBe(raw);
      expect((e as JsonExtractError).message).toMatch(/invalid JSON/);
    }
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractJson("")).toThrow(JsonExtractError);
    expect(() => extractJson("no braces here")).toThrow(/no JSON value/);
  });
});
```

`tests/shared/anthropic.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeClaudeCall } from "@/src/shared/anthropic";
import { LIMITS } from "@/src/shared/config";

describe("makeClaudeCall", () => {
  it("sends system + user with the default timeout and returns concatenated text blocks", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }],
    });
    const call = makeClaudeCall({ messages: { create } } as never);
    const out = await call({ model: "m", system: "S", user: "U", maxTokens: 10 });
    expect(out).toBe("hello world");
    expect(create).toHaveBeenCalledWith(
      { model: "m", max_tokens: 10, system: "S", messages: [{ role: "user", content: "U" }] },
      { timeout: LIMITS.modelTimeoutMs },
    );
  });

  it("throws when the output was truncated at max_tokens", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "partial" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const call = makeClaudeCall({ messages: { create } } as never);
    await expect(call({ model: "m", system: "S", user: "U" })).rejects.toThrow(/truncated/);
  });

  it("throws when the response has no text", async () => {
    const create = vi.fn().mockResolvedValue({ content: [] });
    const call = makeClaudeCall({ messages: { create } } as never);
    await expect(call({ model: "m", system: "S", user: "U" })).rejects.toThrow(/no text/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm test
```

Expected: FAIL with `Cannot find module '@/src/shared/types'` (and the same for config, json, anthropic).

- [ ] **Step 4: Write `src/shared/types.ts`** (exact copy of the header block)

```ts
import { z } from "zod";

export const Energy = z.enum(["low", "medium", "medium-high", "high"]);
export const Pacing = z.enum(["slow", "medium", "fast"]);

export const ImportantMoment = z.object({
  time: z.number().min(0),
  type: z.string(), // e.g. "scene_change", "main_visual_reveal", "climax"
  note: z.string().optional(),
});
export type ImportantMoment = z.infer<typeof ImportantMoment>;

export const VideoAnalysis = z.object({
  summary: z.string(),
  content_type: z.string(), // free text, e.g. "fashion lifestyle reel"
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
export type MusicBriefFields = z.infer<typeof MusicBriefFields>;

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
export const DIRECTION_LABEL: Record<DirectionTag, string> = {
  safe: "Best fit",
  current: "More current",
  unexpected: "Unexpected",
};

export const GeneratedCandidate = z.object({
  title: z.string(),
  artist: z.string(),
  proposed_start: z.number().min(0),
  proposed_end: z.number().min(0),
  anchor_seconds: z.number().min(0), // the model's claimed musical hit (chorus entry, drop) inside the window
  section_is_vocal: z.boolean(), // does the proposed section carry lead vocals
  section_reason: z.string(),
  fit_reason: z.string(),
  directions: z.array(DirectionTag).min(1), // every generation direction that proposed it (dedupe keeps all)
});
export type GeneratedCandidate = z.infer<typeof GeneratedCandidate>;

export const VerifiedCandidate = GeneratedCandidate.extend({
  deezer_id: z.string(),
  canonical_title: z.string(), // provider's title, stored verbatim
  canonical_artist: z.string(),
  duration_seconds: z.number(),
  artwork_url: z.string().nullable(),
  deezer_url: z.string(),
  preview_url: z.string().nullable(), // null when previews are disabled (config.PREVIEWS_ENABLED)
});
export type VerifiedCandidate = z.infer<typeof VerifiedCandidate>;

export const DIMENSIONS = [
  "semantic",
  "emotional",
  "aesthetic",
  "pacing",
  "dialogue",
  "cultural",
  "originality",
] as const;
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
  direction_label: z.string(), // rank 1 is always "Best fit"; ranks 2–3 get DIRECTION_LABEL of their primary direction
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

export const SubmissionStatus = z.enum(["uploaded", "analyzing", "recommending", "ready", "failed"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;
```

- [ ] **Step 5: Write `src/shared/config.ts`**

```ts
export const MODELS = {
  analysis: "claude-fable-5-1",
  candidates: "claude-sonnet-5-5",
  scoring: "claude-sonnet-5-5",
  explain: "claude-sonnet-5-5",
  whisper: "whisper-1",
} as const;

export const LIMITS = {
  maxUploadBytes: 150 * 1024 * 1024,
  maxDurationSeconds: 180,
  maxFrames: 60,
  frameWidth: 512,
  candidatesPerDirection: 25,
  deezerConcurrency: 6,
  deezerTimeoutMs: 8_000,
  sectionMin: 12,
  sectionMax: 20,
  sectionDefault: 15,
  pipelineBudgetMs: 280_000,
  modelTimeoutMs: 120_000,
  inFlightStaleMinutes: 6,
} as const;

/** C8 ruling: no audio previews at launch unless Dylan enables them. */
export const PREVIEWS_ENABLED = false;

/** Must match the literal in the create_submission() SQL function (supabase/migrations/0001_init.sql). */
export const FREE_RESULTS_PER_CREATOR = 1;

export const CONTENT_CATEGORIES = [
  "fashion",
  "beauty",
  "fitness",
  "travel",
  "food",
  "lifestyle",
  "comedy",
  "music",
  "dance",
  "education",
  "business",
  "gaming",
  "pets",
  "family",
  "other",
] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

/** Read a required environment variable. Throws with the variable name if unset or empty. */
export function env(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Comma-separated admin emails, lower-cased. Empty array if unset. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
```

- [ ] **Step 6: Write `src/shared/errors.ts`**

```ts
export type PipelineStage = "upload" | "analyze" | "recommend";

/**
 * Thrown by any pipeline stage. `raw` carries the model's raw text when a
 * response failed to parse so the admin can see exactly what came back.
 */
export class PipelineError extends Error {
  readonly stage: PipelineStage;
  readonly raw: string | undefined;

  constructor(stage: PipelineStage, message: string, raw?: string) {
    super(`[${stage}] ${message}`);
    this.name = "PipelineError";
    this.stage = stage;
    this.raw = raw;
  }
}

export function isPipelineError(e: unknown): e is PipelineError {
  return e instanceof PipelineError;
}

/** Thrown by createSubmission() when the database refuses a submission because the free result is used up. */
export class PaywallError extends Error {
  readonly reason = "needs_subscription" as const;
  constructor() {
    super("needs_subscription");
    this.name = "PaywallError";
  }
}

export function isPaywallError(e: unknown): e is PaywallError {
  return e instanceof PaywallError;
}
```

- [ ] **Step 7: Write `src/shared/logger.ts`**

```ts
type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, msg: string, data?: Record<string, unknown>): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** The one logger. Import as `logger` everywhere; there is no `log` export. */
export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => write("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
};
```

- [ ] **Step 8: Write `src/shared/json.ts`**

```ts
/** Thrown when model output holds no parseable JSON. `raw` is the full model text for the admin inspector. */
export class JsonExtractError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "JsonExtractError";
    this.raw = raw;
  }
}

/**
 * Pulls the first JSON object or array out of model text. Strips a ```json fence
 * if present, then parses from the first `{` or `[` to the matching last closer.
 * Returns `unknown`; callers validate with Zod.
 */
export function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();

  const firstObj = t.indexOf("{");
  const firstArr = t.indexOf("[");
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  if (starts.length === 0) throw new JsonExtractError("no JSON value found in model output", text);

  const start = Math.min(...starts);
  const closer = t[start] === "{" ? "}" : "]";
  const end = t.lastIndexOf(closer);
  if (end <= start) throw new JsonExtractError("no JSON value found in model output", text);

  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch (e) {
    throw new JsonExtractError(`invalid JSON in model output: ${(e as Error).message}`, text);
  }
}
```

- [ ] **Step 9: Write `src/shared/anthropic.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { env, LIMITS } from "./config";
import { logger } from "./logger";

export type ClaudeCall = (args: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number; // per-call override; defaults to LIMITS.modelTimeoutMs (or the makeClaudeCall default)
}) => Promise<string>;

/**
 * Builds a text-in / text-out caller around an Anthropic client. Every text-only
 * stage (candidates, scoring, explanations) uses this; tests inject a stub client.
 * `timeoutMs` is passed as the SDK request timeout so a hung call cannot eat the
 * pipeline budget.
 */
export function makeClaudeCall(
  client: Pick<Anthropic, "messages">,
  opts: { timeoutMs?: number } = {},
): ClaudeCall {
  const defaultTimeout = opts.timeoutMs ?? LIMITS.modelTimeoutMs;
  return async ({ model, system, user, maxTokens = 4000, timeoutMs }) => {
    const started = Date.now();
    const res = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      },
      { timeout: timeoutMs ?? defaultTimeout },
    );
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    // One structured line per model call so cost and truncation are visible in logs (ruling I1).
    logger.info("model.call", {
      model,
      ms: Date.now() - started,
      input_tokens: res.usage?.input_tokens ?? null,
      output_tokens: res.usage?.output_tokens ?? null,
      stop_reason: res.stop_reason ?? null,
    });
    if (res.stop_reason === "max_tokens") throw new Error("claude: output truncated at max_tokens");
    if (!text) throw new Error("claude: no text in response");
    return text;
  };
}

let singleton: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (!singleton) singleton = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  return singleton;
}

/** Default caller used in production. Lazily constructs the client so tests never need a key. */
export const callClaude: ClaudeCall = (args) => makeClaudeCall(defaultClient())(args);
```

`analyzeVideo` (Task 2.3) keeps its own client because it sends image blocks; every text-only stage in Phase 3 uses `callClaude`.

- [ ] **Step 10: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: `Test Files  4 passed`, `Tests  24 passed` (types 8, config 7, json 6, anthropic 3).

- [ ] **Step 11: Typecheck and commit**

```bash
pnpm typecheck
git add vitest.config.ts src/shared tests/shared tests/stubs
git commit -m "Add shared config, Zod types, errors, logger, JSON extraction and Claude caller"
```

---

### Task 0.3: Hosted Supabase project, migrations, paywall and claim functions

**Files:**
- Modify: `docs/DATA_MODEL.md` (new columns on `candidates`, `recommendations`, `video_analyses`, `submissions`; new `stripe_events` table; the two SQL functions)
- Create: `supabase/config.toml` (generated by `supabase init`), `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_catalog.sql`, `supabase/migrations/0003_rls.sql`
- Create (generated): `src/db/types.ts`

**Interfaces:**
- Consumes: Dylan's hosted Supabase project (`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, service keys in `.env.local`) and a one-time CLI login.
- Produces: every table in `docs/DATA_MODEL.md`, the `videos` storage bucket, the SQL functions `create_submission(p_id, p_creator_id, p_video_path, p_intent)` (atomic paywall + insert, raises `needs_subscription`) and `claim_submission_run(p_id)` (atomic run claim, returns the row or null), the `stripe_events` table, and the generated `Database` type in `src/db/types.ts` that Task 0.4 imports.

- [ ] **Step 1: Update `docs/DATA_MODEL.md` first**

In `## submissions`, add after `viewed_at`:

```markdown
| updated_at        | timestamptz | set by trigger on every update; used for stale-run detection |
```

In `## video_analyses`, add after `content_type`:

```markdown
| content_category    | text        | one of CONTENT_CATEGORIES; mirrored onto submissions   |
```

In `## candidates`, replace the single `generator_reason` row with these rows (keep `component_scores`, `total_score`, `prompt_version` after them):

```markdown
| anchor_seconds    | numeric     | the model's claimed musical hit inside the window   |
| section_is_vocal  | boolean     | lead vocals in the proposed section                 |
| section_reason    | text        | what happens musically at the section               |
| fit_reason        | text        | why it fits this video                              |
| directions        | text[]      | every generation direction that proposed it         |
| canonical_title   | text        | nullable, provider's title verbatim                 |
| canonical_artist  | text        | nullable, provider's artist verbatim                |
| artwork_url       | text        | nullable, from Deezer                               |
| deezer_url        | text        | nullable, from Deezer                               |
| preview_url       | text        | nullable, 30s Deezer preview                        |
| source            | text        | 'model' now; 'catalog' later                        |
| segment_id        | uuid        | nullable, → song_segments ON DELETE SET NULL (later) |
| aligned_to_moment | numeric     | nullable, video time the anchor was aligned to      |
```

In `## recommendations`, add after `preview_url`:

```markdown
| selected              | boolean     | default false; at most one true per submission     |
| rejected              | boolean     | default false                                      |
| explain_prompt_version| text        | nullable                                           |
| aligned_to_moment     | numeric     | nullable                                           |
```

Add a new section before `## Catalog tables`:

```markdown
## stripe_events
Idempotency record for the Stripe webhook. A row is written only AFTER the
event was processed successfully, so a failed activation stays retryable.

| column        | type        | notes                      |
|---------------|-------------|----------------------------|
| id            | text        | Stripe event id, primary key |
| type          | text        |                            |
| processed_at  | timestamptz | default now()              |

RLS: service role only.

## SQL functions (security definer, service role only)
- `create_submission(p_id uuid, p_creator_id uuid, p_video_path text, p_intent text) returns submissions`
  — takes a per-creator advisory lock, counts the creator's `ready` rows plus
  in-flight rows (`uploaded|analyzing|recommending` updated in the last 10
  minutes), checks for an active subscription, raises `needs_subscription`
  when count ≥ 1 and not subscribed, otherwise inserts and returns the row.
  Idempotent on `p_id` for the same creator. The literal `1` matches
  `FREE_RESULTS_PER_CREATOR` in `src/shared/config.ts`.
- `claim_submission_run(p_id uuid) returns submissions` — one conditional
  update: moves `uploaded|failed` to `analyzing`, or re-claims an in-flight
  row whose `updated_at` is older than 6 minutes (status unchanged so the
  runner resumes from stored outputs). Never touches `ready`. Returns the
  row, or null when nothing was claimed.
```

Also change the `## subscriptions` note for `stripe_subscription_id` to: `nullable, plain UNIQUE (nulls allowed)`.

- [ ] **Step 2: Log in to the Supabase CLI and link the hosted project**

Dylan runs the login himself (it opens a browser), by typing this in the Claude prompt:

```
! npx supabase login
```

Then, with `.env.local` filled in (`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`):

```bash
set -a; source .env.local; set +a
pnpm supabase init
pnpm supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
```

Expected: `supabase init` prints `Finished supabase init.` and creates `supabase/config.toml`. `supabase link` prints `Finished supabase link.` and writes `supabase/.temp/project-ref` (git-ignored). If `link` reports a pooler/connection error, re-check `SUPABASE_DB_PASSWORD`; it is the database password from project creation, not the service-role key.

Google auth is configured in the Supabase dashboard (Task 1.6), not in `config.toml`.

- [ ] **Step 3: Write `supabase/migrations/0001_init.sql`**

```sql
-- Songfit core tables, functions and bucket. See docs/DATA_MODEL.md.
create extension if not exists "pgcrypto";

-- creators -----------------------------------------------------------------
create table public.creators (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text,
  preferences jsonb,
  created_at timestamptz not null default now()
);

-- Mirror every new auth user into creators.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.creators (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- shared updated_at trigger ------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- submissions --------------------------------------------------------------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (id) on delete cascade,
  video_path text not null,
  duration_seconds numeric,
  creator_intent text,
  content_category text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'analyzing', 'recommending', 'ready', 'failed')),
  error text,
  analyzed_at timestamptz,
  recommended_at timestamptz,
  viewed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index submissions_creator_id_idx on public.submissions (creator_id);
create index submissions_status_idx on public.submissions (status);
create index submissions_created_at_idx on public.submissions (created_at desc);

create trigger submissions_set_updated_at
before update on public.submissions
for each row execute function public.set_updated_at();

-- video_analyses -----------------------------------------------------------
create table public.video_analyses (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  summary text not null,
  content_type text not null,
  content_category text,
  setting text,
  story text,
  aesthetic text[] not null default '{}',
  mood text[] not null default '{}',
  energy text not null,
  pacing text not null,
  dialogue_present boolean not null default false,
  transcript text,
  important_moments jsonb not null default '[]'::jsonb,
  music_brief text not null,
  music_brief_fields jsonb not null,
  prompt_version text not null,
  raw_response jsonb,
  created_at timestamptz not null default now()
);

-- candidates ---------------------------------------------------------------
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  song_id uuid,     -- FK to songs added in 0002_catalog.sql
  segment_id uuid,  -- FK to song_segments added in 0002_catalog.sql
  title text not null,
  artist text not null,
  canonical_title text,
  canonical_artist text,
  deezer_id text,
  itunes_id text,
  duration_seconds numeric,
  verified boolean not null default false,
  proposed_start numeric not null,
  proposed_end numeric not null,
  anchor_seconds numeric not null,
  section_is_vocal boolean not null default false,
  section_reason text not null,
  fit_reason text not null,
  directions text[] not null default '{}',
  artwork_url text,
  deezer_url text,
  preview_url text,
  source text not null default 'model' check (source in ('model', 'catalog')),
  aligned_to_moment numeric,
  component_scores jsonb,
  total_score numeric,
  prompt_version text not null,
  created_at timestamptz not null default now()
);
create index candidates_submission_id_idx on public.candidates (submission_id);

-- recommendations ----------------------------------------------------------
create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  candidate_id uuid references public.candidates (id) on delete set null,
  rank int not null check (rank in (1, 2, 3)),
  direction_label text not null,
  title text not null,
  artist text not null,
  start_seconds numeric not null,
  end_seconds numeric not null,
  explanation text not null,
  spotify_url text not null,
  deezer_url text,
  artwork_url text,
  preview_url text,
  selected boolean not null default false,
  rejected boolean not null default false,
  explain_prompt_version text,
  aligned_to_moment numeric,
  created_at timestamptz not null default now(),
  unique (submission_id, rank)
);

-- events -------------------------------------------------------------------
create table public.events (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.creators (id) on delete set null,
  submission_id uuid references public.submissions (id) on delete set null,
  name text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index events_name_idx on public.events (name);
create index events_submission_id_idx on public.events (submission_id);
create index events_creator_id_idx on public.events (creator_id);
create index events_created_at_idx on public.events (created_at desc);

-- subscriptions ------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text unique, -- plain UNIQUE: nulls may repeat, supports ON CONFLICT upsert
  status text not null check (status in ('active', 'canceled', 'past_due')),
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index subscriptions_creator_id_idx on public.subscriptions (creator_id);

-- stripe_events ------------------------------------------------------------
-- Written only AFTER an event is processed successfully (C4 ruling).
create table public.stripe_events (
  id text primary key,
  type text not null,
  processed_at timestamptz not null default now()
);

-- paywall + insert, atomic --------------------------------------------------
-- The literal `1` is FREE_RESULTS_PER_CREATOR in src/shared/config.ts.
create or replace function public.create_submission(
  p_id uuid,
  p_creator_id uuid,
  p_video_path text,
  p_intent text
)
returns public.submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.submissions;
  used_count int;
  subscribed boolean;
  created public.submissions;
begin
  -- Serialize per creator so two concurrent uploads cannot both pass the count.
  perform pg_advisory_xact_lock(hashtext(p_creator_id::text));

  -- Idempotent: the same creator re-posting the same id gets the same row.
  select * into existing from public.submissions where id = p_id;
  if found then
    if existing.creator_id <> p_creator_id then
      raise exception 'forbidden';
    end if;
    return existing;
  end if;

  select count(*) into used_count
  from public.submissions
  where creator_id = p_creator_id
    and (
      status = 'ready'
      or (status in ('uploaded', 'analyzing', 'recommending')
          and updated_at > now() - interval '10 minutes')
    );

  select exists (
    select 1 from public.subscriptions
    where creator_id = p_creator_id and status = 'active'
  ) into subscribed;

  if used_count >= 1 and not subscribed then
    raise exception 'needs_subscription';
  end if;

  insert into public.submissions (id, creator_id, video_path, creator_intent, status)
  values (p_id, p_creator_id, p_video_path, p_intent, 'uploaded')
  returning * into created;
  return created;
end;
$$;

-- atomic run claim -----------------------------------------------------------
-- Moves uploaded|failed → analyzing, or re-claims a stale in-flight row (older
-- than 6 minutes, status kept so the runner resumes from stored outputs).
-- Never touches ready. Returns null when nothing was claimed.
create or replace function public.claim_submission_run(p_id uuid)
returns public.submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.submissions;
begin
  update public.submissions
     set status = case when status in ('uploaded', 'failed') then 'analyzing' else status end,
         updated_at = now()
   where id = p_id
     and status <> 'ready'
     and (status in ('uploaded', 'failed') or updated_at < now() - interval '6 minutes')
  returning * into claimed;
  return claimed;
end;
$$;

revoke execute on function public.create_submission(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.claim_submission_run(uuid) from public, anon, authenticated;
grant execute on function public.create_submission(uuid, uuid, text, text) to service_role;
grant execute on function public.claim_submission_run(uuid) to service_role;

-- storage ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('videos', 'videos', false, 157286400)
on conflict (id) do nothing;
```

Note on the bucket limit: Supabase Free caps uploads at 50 MB regardless of `file_size_limit`; the 150 MB limit only takes effect on Supabase Pro (C7 ruling, Dylan's decision 3). Until then, uploads over 50 MB fail at Storage; Task 1.4's client check uses `LIMITS.maxUploadBytes`, so lower that constant if the project stays on Free.

- [ ] **Step 4: Write `supabase/migrations/0002_catalog.sql`**

```sql
-- Catalog tables. Created now, populated after launch. See docs/DATA_MODEL.md.
create extension if not exists vector;

create table public.songs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text not null,
  deezer_id text unique,
  itunes_id text,
  genres text[] not null default '{}',
  moods text[] not null default '{}',
  aesthetics text[] not null default '{}',
  energy numeric,
  bpm numeric,
  vocal_type text,
  language text,
  cultural_tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.song_segments (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  start_seconds numeric not null,
  end_seconds numeric not null,
  label text not null
    check (label in ('intro', 'verse', 'pre-chorus', 'chorus', 'drop', 'bridge', 'break', 'hook')),
  description text not null,
  moods text[] not null default '{}',
  energy numeric,
  lyrics_snippet text,
  embedding vector(1536),
  created_at timestamptz not null default now()
);
create index song_segments_song_id_idx on public.song_segments (song_id);

create table public.song_trend_signals (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs (id) on delete cascade,
  platform text not null check (platform in ('tiktok', 'instagram')),
  popularity_score numeric not null,
  growth_score numeric not null,
  saturation_score numeric not null,
  content_categories text[] not null default '{}',
  observed_at timestamptz not null default now(),
  source text not null check (source in ('manual', 'api')),
  created_at timestamptz not null default now()
);
create index song_trend_signals_song_id_idx on public.song_trend_signals (song_id);

alter table public.candidates
  add constraint candidates_song_id_fkey
  foreign key (song_id) references public.songs (id) on delete set null;
alter table public.candidates
  add constraint candidates_segment_id_fkey
  foreign key (segment_id) references public.song_segments (id) on delete set null;
```

- [ ] **Step 5: Write `supabase/migrations/0003_rls.sql`**

```sql
-- Row Level Security. Creators see only their own rows. Tables with no
-- policies are service-role only (the service role bypasses RLS).
-- There is deliberately NO insert policy on submissions: rows are created
-- only through create_submission() via the service role (C2 ruling).

alter table public.creators enable row level security;
create policy "creators: read own" on public.creators
  for select to authenticated using (auth.uid() = id);
create policy "creators: update own" on public.creators
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

alter table public.submissions enable row level security;
create policy "submissions: read own" on public.submissions
  for select to authenticated using (auth.uid() = creator_id);

alter table public.video_analyses enable row level security;
create policy "video_analyses: read own" on public.video_analyses
  for select to authenticated using (
    exists (
      select 1 from public.submissions s
      where s.id = video_analyses.submission_id and s.creator_id = auth.uid()
    )
  );

alter table public.candidates enable row level security;
-- no policies: service role only

alter table public.recommendations enable row level security;
create policy "recommendations: read own" on public.recommendations
  for select to authenticated using (
    exists (
      select 1 from public.submissions s
      where s.id = recommendations.submission_id and s.creator_id = auth.uid()
    )
  );

alter table public.events enable row level security;
-- no policies: service role only

alter table public.subscriptions enable row level security;
create policy "subscriptions: read own" on public.subscriptions
  for select to authenticated using (auth.uid() = creator_id);

alter table public.stripe_events enable row level security;
-- no policies: service role only

alter table public.songs enable row level security;
alter table public.song_segments enable row level security;
alter table public.song_trend_signals enable row level security;
-- no policies: service role only

-- Storage: creators upload to and read from their own folder in `videos`.
-- Signed upload URLs are issued by the server (Task 1.2); this policy scopes
-- any authenticated upload to the caller's own prefix.
create policy "videos: upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "videos: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 6: Push the migrations to the hosted project**

```bash
pnpm db:push
```

Expected: `Applying migration 0001_init.sql...`, `0002_catalog.sql...`, `0003_rls.sql...`, then `Finished supabase db push.` If `vector` fails to install, enable the `vector` extension once in the dashboard (Database → Extensions) and re-run.

- [ ] **Step 7: Verify the schema on the hosted project**

Write and run a throwaway check with the service client (no `psql` on this machine):

```bash
cat > /tmp/check-schema.mjs <<'EOF'
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
for (const t of ["creators","submissions","video_analyses","candidates","recommendations","events","subscriptions","stripe_events","songs","song_segments","song_trend_signals"]) {
  const { error } = await db.from(t).select("*", { head: true, count: "exact" });
  console.log(t.padEnd(20), error ? "FAIL " + error.message : "ok");
}
const { data: b } = await db.storage.getBucket("videos");
console.log("bucket videos".padEnd(20), b ? `ok public=${b.public} limit=${b.file_size_limit}` : "FAIL");
const { error: fe } = await db.rpc("claim_submission_run", { p_id: "00000000-0000-0000-0000-000000000000" });
console.log("claim_submission_run".padEnd(20), fe ? "FAIL " + fe.message : "ok (null row)");
EOF
node --env-file=.env.local /tmp/check-schema.mjs
```

Expected: every table `ok`, `bucket videos ok public=false limit=157286400`, `claim_submission_run ok (null row)`.

- [ ] **Step 8: Generate database types**

```bash
mkdir -p src/db
set -a; source .env.local; set +a
pnpm db:types
head -5 src/db/types.ts
grep -c "create_submission\|claim_submission_run" src/db/types.ts
```

Expected: file begins with `export type Json =`, contains `candidates: { Row: {` and `anchor_seconds`, and the grep prints `2` or more (both functions appear under `Functions`).

- [ ] **Step 9: Commit**

```bash
pnpm typecheck
git add docs/DATA_MODEL.md supabase/config.toml supabase/migrations src/db/types.ts
git commit -m "Add hosted Supabase migrations with paywall and run-claim functions, RLS and generated types"
```

---

### Task 0.4: Database clients and typed queries

**Files:**
- Create: `src/db/client.ts`, `src/db/browser.ts`, `src/db/queries/creators.ts`, `src/db/queries/submissions.ts`, `src/db/queries/analyses.ts`, `src/db/queries/candidates.ts`, `src/db/queries/recommendations.ts`, `src/db/queries/events.ts`, `src/db/queries/subscriptions.ts`, `src/db/queries/stripeEvents.ts`

**Interfaces:**
- Consumes: `Database` from `src/db/types.ts` (Task 0.3); `env()` from `src/shared/config.ts`; `SubmissionStatus`, `VideoAnalysis`, `MusicBrief` from `src/shared/types.ts`; `PaywallError` from `src/shared/errors.ts`; `logger` from `src/shared/logger.ts` (Task 0.2).
- Produces:
  - `createServerClient(): Promise<SupabaseClient<Database>>`, `createServiceClient(): SupabaseClient<Database>` (in `client.ts`); `createBrowserClient(): SupabaseClient<Database>` (in `browser.ts`).
  - `ensureCreator(id, email, displayName?)`, `getCreatorByEmail(email)`, `getCreator(id)`
  - `getSubmission(id)`, `createSubmission({ id, creatorId, videoPath, creatorIntent })` (rpc `create_submission`; throws `PaywallError` on `needs_subscription`), `claimSubmissionRun(id)` (rpc `claim_submission_run`; row or null), `setSubmissionStatus(id, status, error?)`, `setSubmissionAnalyzed(id, { durationSeconds, contentCategory })`, `markSubmissionViewed(id)`, `listSubmissions(limit?)` → `SubmissionWithCreator[]`, `listSubmissionsForCreator(creatorId)`, `countReadySubmissions(creatorId)`, `countSubmissionsForCreator(creatorId)`
  - `upsertAnalysis(row)`, `getAnalysisRow(submissionId)`, `getAnalysis(submissionId)` → `{ analysis, brief, row } | null`
  - `replaceCandidates(submissionId, rows: CandidateInsert[]): Promise<CandidateRow[]>`, `listCandidates(submissionId)`
  - `replaceRecommendations(submissionId, rows: RecommendationInsert[]): Promise<RecommendationRow[]>`, `listRecommendations(submissionId)`, `markRecommendationFeedback(submissionId, rank, { selected?, rejected? })`
  - `insertEvent(row)`, `listEventsForSubmission(submissionId)`, `countEventsByName()`, `listEvents(limit?)`
  - `getActiveSubscription(creatorId)`, `activateSubscription({ creatorId, stripeCustomerId, stripeSubscriptionId })`, `setSubscriptionStatus(stripeSubscriptionId, status)`
  - `recordStripeEvent(id, type)` (insert; a duplicate id is ignored and returns `false`)
  - Row type aliases: `SubmissionRow`, `AnalysisRow`, `CandidateRow`, `RecommendationRow`, `EventRow`, `SubscriptionRow`, `CreatorRow`, and `Insert` variants (`CandidateInsert`, `RecommendationInsert`, `AnalysisInsert`, `EventInsert`).

No unit tests in this task: every function is a thin typed wrapper over Supabase with no branching logic beyond error mapping. Verified by `pnpm typecheck` against the generated `Database` type, and exercised end to end in Phase 1.

- [ ] **Step 1: Write `src/db/client.ts`**

```ts
import "server-only";
import { createServerClient as createSsrServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "@/src/shared/config";
import type { Database } from "./types";

export type Db = SupabaseClient<Database>;

/** Cookie-bound client that respects RLS. Use in server components, route handlers and server actions. */
export async function createServerClient(): Promise<Db> {
  const cookieStore = await cookies();
  return createSsrServerClient<Database>(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; middleware refreshes the session instead.
          }
        },
      },
    },
  );
}

let serviceClient: Db | undefined;

/** Service-role client that bypasses RLS. Server only. Never expose to the browser. */
export function createServiceClient(): Db {
  if (!serviceClient) {
    serviceClient = createClient<Database>(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return serviceClient;
}
```

- [ ] **Step 2: Write `src/db/browser.ts`**

```ts
"use client";
import { createBrowserClient as createSsrBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

let client: SupabaseClient<Database> | undefined;

/** Browser client (anon key, RLS enforced). Safe for client components. */
export function createBrowserClient(): SupabaseClient<Database> {
  if (!client) {
    client = createSsrBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    );
  }
  return client;
}
```

- [ ] **Step 3: Write `src/db/queries/creators.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type CreatorRow = Database["public"]["Tables"]["creators"]["Row"];

export async function getCreator(id: string): Promise<CreatorRow | null> {
  const { data, error } = await createServiceClient().from("creators").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getCreatorByEmail(email: string): Promise<CreatorRow | null> {
  const { data, error } = await createServiceClient()
    .from("creators")
    .select("*")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Idempotent. The auth trigger normally creates the row; this covers users created before the trigger existed. */
export async function ensureCreator(id: string, email: string, displayName?: string | null): Promise<CreatorRow> {
  const { data, error } = await createServiceClient()
    .from("creators")
    .upsert({ id, email: email.toLowerCase(), display_name: displayName ?? null }, { onConflict: "id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Write `src/db/queries/submissions.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";
import type { SubmissionStatus } from "@/src/shared/types";
import { PaywallError } from "@/src/shared/errors";

export type SubmissionRow = Database["public"]["Tables"]["submissions"]["Row"];

export async function getSubmission(id: string): Promise<SubmissionRow | null> {
  const { data, error } = await createServiceClient().from("submissions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Creates the submission through the create_submission() SQL function, which
 * enforces the paywall atomically (one free result per creator unless
 * subscribed) and is idempotent on `id` for the same creator.
 * Throws PaywallError when the database raises `needs_subscription`.
 */
export async function createSubmission(input: {
  id: string;
  creatorId: string;
  videoPath: string;
  creatorIntent: string | null;
}): Promise<SubmissionRow> {
  const { data, error } = await createServiceClient().rpc("create_submission", {
    p_id: input.id,
    p_creator_id: input.creatorId,
    p_video_path: input.videoPath,
    p_intent: input.creatorIntent,
  });
  if (error) {
    if (error.message.includes("needs_subscription")) throw new PaywallError();
    throw error;
  }
  if (!data) throw new Error("create_submission returned no row");
  return data as SubmissionRow;
}

/**
 * Atomically claims the submission for a pipeline run via claim_submission_run().
 * Returns the claimed row, or null when another run holds it (or it is already ready).
 */
export async function claimSubmissionRun(id: string): Promise<SubmissionRow | null> {
  const { data, error } = await createServiceClient().rpc("claim_submission_run", { p_id: id });
  if (error) throw error;
  // A composite-returning function yields null (or a row with null id) when nothing matched.
  if (!data || !(data as SubmissionRow).id) return null;
  return data as SubmissionRow;
}

export async function setSubmissionStatus(
  id: string,
  status: SubmissionStatus,
  error?: string | null,
): Promise<void> {
  const patch: Database["public"]["Tables"]["submissions"]["Update"] = { status, error: error ?? null };
  const db = createServiceClient();
  if (status === "ready") {
    // Preserve the first readiness timestamp across retries (I7 ruling).
    const { data } = await db.from("submissions").select("recommended_at").eq("id", id).maybeSingle();
    if (!data?.recommended_at) patch.recommended_at = new Date().toISOString();
  }
  const { error: dbError } = await db.from("submissions").update(patch).eq("id", id);
  if (dbError) throw dbError;
}

export async function setSubmissionAnalyzed(
  id: string,
  input: { durationSeconds: number; contentCategory: string },
): Promise<void> {
  const { error } = await createServiceClient()
    .from("submissions")
    .update({
      duration_seconds: input.durationSeconds,
      content_category: input.contentCategory,
      analyzed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

/** Sets viewed_at only the first time. */
export async function markSubmissionViewed(id: string): Promise<void> {
  const { error } = await createServiceClient()
    .from("submissions")
    .update({ viewed_at: new Date().toISOString() })
    .eq("id", id)
    .is("viewed_at", null);
  if (error) throw error;
}

export type SubmissionWithCreator = SubmissionRow & { creator: { email: string } | null };

/** Admin queue: every submission, newest first, with the creator's email joined. */
export async function listSubmissions(limit = 200): Promise<SubmissionWithCreator[]> {
  const { data, error } = await createServiceClient()
    .from("submissions")
    .select("*, creator:creators(email)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function listSubmissionsForCreator(creatorId: string): Promise<SubmissionRow[]> {
  const { data, error } = await createServiceClient()
    .from("submissions")
    .select("*")
    .eq("creator_id", creatorId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

/** UX-only paywall preview (the database enforces the real rule): finished results for this creator. */
export async function countReadySubmissions(creatorId: string): Promise<number> {
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .eq("status", "ready");
  if (error) throw error;
  return count ?? 0;
}

export async function countSubmissionsForCreator(creatorId: string): Promise<number> {
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId);
  if (error) throw error;
  return count ?? 0;
}
```

- [ ] **Step 5: Write `src/db/queries/analyses.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";
import { VideoAnalysis, MusicBrief } from "@/src/shared/types";

export type AnalysisRow = Database["public"]["Tables"]["video_analyses"]["Row"];
export type AnalysisInsert = Database["public"]["Tables"]["video_analyses"]["Insert"];

/** One analysis per submission; re-running the stage overwrites it. */
export async function upsertAnalysis(row: AnalysisInsert): Promise<AnalysisRow> {
  const { data, error } = await createServiceClient()
    .from("video_analyses")
    .upsert(row, { onConflict: "submission_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getAnalysisRow(submissionId: string): Promise<AnalysisRow | null> {
  const { data, error } = await createServiceClient()
    .from("video_analyses")
    .select("*")
    .eq("submission_id", submissionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Typed view used by the engine: rebuilds VideoAnalysis + MusicBrief from the
 * stored columns and validates them with Zod, so a hand-edited row fails loudly.
 */
export async function getAnalysis(
  submissionId: string,
): Promise<{ analysis: VideoAnalysis; brief: MusicBrief; row: AnalysisRow } | null> {
  const row = await getAnalysisRow(submissionId);
  if (!row) return null;
  const analysis = VideoAnalysis.parse({
    summary: row.summary,
    content_type: row.content_type,
    content_category: row.content_category ?? "other",
    setting: row.setting,
    story: row.story,
    aesthetic: row.aesthetic,
    mood: row.mood,
    energy: row.energy,
    pacing: row.pacing,
    dialogue_present: row.dialogue_present,
    important_moments: row.important_moments,
  });
  const brief = MusicBrief.parse({ text: row.music_brief, fields: row.music_brief_fields });
  return { analysis, brief, row };
}
```

- [ ] **Step 6: Write `src/db/queries/candidates.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type CandidateRow = Database["public"]["Tables"]["candidates"]["Row"];
export type CandidateInsert = Database["public"]["Tables"]["candidates"]["Insert"];

/** Idempotent per stage run: deletes the submission's candidates and inserts the new set. Returns the inserted rows (with ids). */
export async function replaceCandidates(submissionId: string, rows: CandidateInsert[]): Promise<CandidateRow[]> {
  const db = createServiceClient();
  const { error: delError } = await db.from("candidates").delete().eq("submission_id", submissionId);
  if (delError) throw delError;
  if (rows.length === 0) return [];
  const { data, error } = await db
    .from("candidates")
    .insert(rows.map((r) => ({ ...r, submission_id: submissionId })))
    .select("*");
  if (error) throw error;
  return data;
}

export async function listCandidates(submissionId: string): Promise<CandidateRow[]> {
  const { data, error } = await createServiceClient()
    .from("candidates")
    .select("*")
    .eq("submission_id", submissionId)
    .order("total_score", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data;
}
```

- [ ] **Step 7: Write `src/db/queries/recommendations.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type RecommendationRow = Database["public"]["Tables"]["recommendations"]["Row"];
export type RecommendationInsert = Database["public"]["Tables"]["recommendations"]["Insert"];

/** Idempotent per stage run: replaces the submission's 3 recommendations. */
export async function replaceRecommendations(
  submissionId: string,
  rows: RecommendationInsert[],
): Promise<RecommendationRow[]> {
  const db = createServiceClient();
  const { error: delError } = await db.from("recommendations").delete().eq("submission_id", submissionId);
  if (delError) throw delError;
  if (rows.length === 0) return [];
  const { data, error } = await db
    .from("recommendations")
    .insert(rows.map((r) => ({ ...r, submission_id: submissionId })))
    .select("*")
    .order("rank", { ascending: true });
  if (error) throw error;
  return data;
}

export async function listRecommendations(submissionId: string): Promise<RecommendationRow[]> {
  const { data, error } = await createServiceClient()
    .from("recommendations")
    .select("*")
    .eq("submission_id", submissionId)
    .order("rank", { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * Records creator feedback on one rank. Selection is exclusive: selecting a
 * rank clears `selected` on the other two first. Returns the number of rows
 * updated for the target rank (0 means the rank did not exist).
 */
export async function markRecommendationFeedback(
  submissionId: string,
  rank: 1 | 2 | 3,
  patch: { selected?: boolean; rejected?: boolean },
): Promise<number> {
  const db = createServiceClient();
  if (patch.selected === true) {
    const { error: clearError } = await db
      .from("recommendations")
      .update({ selected: false })
      .eq("submission_id", submissionId)
      .neq("rank", rank);
    if (clearError) throw clearError;
  }
  const update: Database["public"]["Tables"]["recommendations"]["Update"] = {};
  if (patch.selected !== undefined) update.selected = patch.selected;
  if (patch.rejected !== undefined) update.rejected = patch.rejected;
  if (patch.selected === true) update.rejected = false;
  const { data, error } = await db
    .from("recommendations")
    .update(update)
    .eq("submission_id", submissionId)
    .eq("rank", rank)
    .select("id");
  if (error) throw error;
  return data.length;
}
```

- [ ] **Step 8: Write `src/db/queries/events.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type EventRow = Database["public"]["Tables"]["events"]["Row"];
export type EventInsert = Database["public"]["Tables"]["events"]["Insert"];

export async function insertEvent(row: EventInsert): Promise<void> {
  const { error } = await createServiceClient().from("events").insert(row);
  if (error) throw error;
}

export async function listEventsForSubmission(submissionId: string): Promise<EventRow[]> {
  const { data, error } = await createServiceClient()
    .from("events")
    .select("*")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

/** Returns { name: count } across all events. Used by the admin metrics page. */
export async function countEventsByName(): Promise<Record<string, number>> {
  const { data, error } = await createServiceClient().from("events").select("name");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data) counts[row.name] = (counts[row.name] ?? 0) + 1;
  return counts;
}

export async function listEvents(limit = 5000): Promise<EventRow[]> {
  const { data, error } = await createServiceClient()
    .from("events")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data;
}
```

- [ ] **Step 9: Write `src/db/queries/subscriptions.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];
export type SubscriptionStatus = "active" | "canceled" | "past_due";

export async function getActiveSubscription(creatorId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await createServiceClient()
    .from("subscriptions")
    .select("*")
    .eq("creator_id", creatorId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Idempotent on stripe_subscription_id (plain UNIQUE constraint in 0001_init.sql). */
export async function activateSubscription(input: {
  creatorId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): Promise<SubscriptionRow> {
  const { data, error } = await createServiceClient()
    .from("subscriptions")
    .upsert(
      {
        creator_id: input.creatorId,
        stripe_customer_id: input.stripeCustomerId,
        stripe_subscription_id: input.stripeSubscriptionId,
        status: "active",
        started_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setSubscriptionStatus(
  stripeSubscriptionId: string,
  status: SubscriptionStatus,
): Promise<void> {
  const { error } = await createServiceClient()
    .from("subscriptions")
    .update({ status })
    .eq("stripe_subscription_id", stripeSubscriptionId);
  if (error) throw error;
}
```

- [ ] **Step 10: Write `src/db/queries/stripeEvents.ts`**

```ts
import "server-only";
import { createServiceClient } from "../client";
import { logger } from "@/src/shared/logger";

/**
 * Records a Stripe event id AFTER it was processed successfully (C4 ruling).
 * Returns true when the row was written, false when the id already existed
 * (a redelivery that reached the end a second time; harmless).
 */
export async function recordStripeEvent(id: string, type: string): Promise<boolean> {
  const { error } = await createServiceClient().from("stripe_events").insert({ id, type });
  if (!error) return true;
  if (error.code === "23505") {
    logger.info("stripe event already recorded", { id, type });
    return false;
  }
  throw error;
}
```

- [ ] **Step 11: Typecheck and commit**

```bash
pnpm typecheck
```

Expected: exit 0. If `rpc("create_submission", …)` or `rpc("claim_submission_run", …)` fails to typecheck, `src/db/types.ts` was generated before the functions existed: re-run `pnpm db:push` then `pnpm db:types` and try again.

```bash
git add src/db
git commit -m "Add Supabase clients and typed query functions"
```

---

### Task 0.5: Event names and `logEvent`

**Files:**
- Create: `src/feedback/events.ts`
- Test: `tests/feedback/events.test.ts`

**Interfaces:**
- Consumes: `insertEvent` from `src/db/queries/events.ts` (Task 0.4); `logger` from `src/shared/logger.ts`.
- Produces: `EVENT_NAMES`, `EventName`, `isEventName(x): x is EventName`, `logEvent({ name, creatorId?, submissionId?, metadata? })`.

- [ ] **Step 1: Write the failing test**

`tests/feedback/events.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const insertEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/src/db/queries/events", () => ({ insertEvent }));

import { EVENT_NAMES, isEventName, logEvent } from "@/src/feedback/events";

/** Pulls the fenced list under "Allowed event names" out of docs/DATA_MODEL.md. */
function eventNamesFromDataModel(): string[] {
  const doc = readFileSync(path.join(process.cwd(), "docs", "DATA_MODEL.md"), "utf8");
  const start = doc.indexOf("Allowed event names");
  const fenceOpen = doc.indexOf("```", start);
  const fenceClose = doc.indexOf("```", fenceOpen + 3);
  const block = doc.slice(fenceOpen + 3, fenceClose);
  return block
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((name) => /^[a-z_0-9]+$/.test(name));
}

beforeEach(() => insertEvent.mockClear());

describe("EVENT_NAMES", () => {
  it("matches docs/DATA_MODEL.md exactly", () => {
    const documented = eventNamesFromDataModel();
    expect(documented.length).toBeGreaterThan(10);
    expect([...EVENT_NAMES].sort()).toEqual([...documented].sort());
  });

  it("isEventName guards unknown strings", () => {
    expect(isEventName("submission_created")).toBe(true);
    expect(isEventName("made_up_event")).toBe(false);
  });
});

describe("logEvent", () => {
  it("passes creatorId and submissionId through to the row", async () => {
    await logEvent({ name: "recommendations_ready", creatorId: "cre-1", submissionId: "sub-1", metadata: { ms: 90 } });
    expect(insertEvent).toHaveBeenCalledWith({
      name: "recommendations_ready",
      creator_id: "cre-1",
      submission_id: "sub-1",
      metadata: { ms: 90 },
    });
  });

  it("never throws when the insert fails", async () => {
    insertEvent.mockRejectedValueOnce(new Error("db down"));
    await expect(logEvent({ name: "paid" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/feedback
```

Expected: FAIL with `Cannot find module '@/src/feedback/events'`.

- [ ] **Step 3: Write `src/feedback/events.ts`**

```ts
import { insertEvent } from "@/src/db/queries/events";
import { logger } from "@/src/shared/logger";

/** Keep in sync with docs/DATA_MODEL.md → events → "Allowed event names". The test enforces it. */
export const EVENT_NAMES = [
  "signed_up",
  "submission_created",
  "upload_completed",
  "analysis_completed",
  "recommendations_ready",
  "recommendations_viewed",
  "recommendation_selected",
  "recommendation_rejected",
  "all_rejected",
  "more_like_this_requested",
  "paid_offer_viewed",
  "paid_offer_clicked",
  "paid",
  "returned_with_second_submission",
  "pipeline_failed",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export function isEventName(x: unknown): x is EventName {
  return typeof x === "string" && (EVENT_NAMES as readonly string[]).includes(x);
}

/**
 * Writes one row to `events`. Never throws: a failed metric must not fail the
 * creator's request. Errors are logged. Always pass creatorId when known —
 * the funnel counts distinct creators per milestone (I7 ruling).
 */
export async function logEvent(e: {
  name: EventName;
  creatorId?: string | null;
  submissionId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await insertEvent({
      name: e.name,
      creator_id: e.creatorId ?? null,
      submission_id: e.submissionId ?? null,
      metadata: e.metadata ?? null,
    });
  } catch (err) {
    logger.error("logEvent failed", { name: e.name, error: String(err) });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: `Test Files  5 passed`, `Tests  28 passed`. If the DATA_MODEL comparison fails, the list in the doc and in code differ — fix the code list, not the test.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add src/feedback/events.ts tests/feedback
git commit -m "Add event names with logEvent and doc-sync test"
```

---

### Task 0.6: App shell, palette, logo and upload screen placeholder

**Files:**
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `components/Logo.tsx`, `components/UploadForm.tsx`
- Delete: any `app/page.module.css`, `app/favicon.ico` references that create-next-app added to `page.tsx` (keep `favicon.ico` itself)

**Interfaces:**
- Produces: `Logo` (NAMED export, wordmark), `UploadForm` (default export) placeholder that Phase 1 Task 1.4 replaces with the real client component (same file path, same default export name).

- [ ] **Step 1: Write `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --ink: #0f1419;
  --steel-light: #8fa8c8;
  --steel: #5b7190;
  --steel-dark: #2e3a4a;
  --canvas: #f7f8fa;
  --card: #ffffff;
  --muted: #6b7280;
}

html,
body {
  background: var(--canvas);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.steel-gradient {
  background-image: linear-gradient(135deg, var(--steel-light) 0%, var(--steel-dark) 100%);
}

.steel-text {
  background-image: linear-gradient(135deg, var(--steel-light) 0%, var(--steel-dark) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
```

- [ ] **Step 2: Write `components/Logo.tsx`**

```tsx
/** Wordmark. Named export: `import { Logo } from "@/components/Logo"`. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline font-semibold tracking-tight ${className}`} aria-label="Songfit">
      <span className="text-ink">Song</span>
      <span className="steel-text">fit</span>
    </span>
  );
}
```

- [ ] **Step 3: Write `app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Songfit",
  description: "Find the right song for your content, and exactly which part to use.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F7F8FA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Write `components/UploadForm.tsx` (placeholder, replaced in Phase 1)**

```tsx
export default function UploadForm() {
  return (
    <form className="mt-10 flex w-full max-w-md flex-col gap-4" aria-disabled>
      <div className="flex h-44 w-full items-center justify-center rounded-3xl border border-dashed border-steel-light bg-white text-sm text-muted">
        Tap to choose a video
      </div>
      <input
        type="text"
        disabled
        placeholder="What do you want this to feel like? (optional)"
        className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base"
      />
      <button
        type="button"
        disabled
        className="steel-gradient w-full rounded-2xl px-6 py-4 text-base font-semibold text-white opacity-60"
      >
        Find my songs
      </button>
      <p className="text-center text-xs text-muted">
        Your video is processed by AI services to find songs and kept so you can come back to your results.
      </p>
    </form>
  );
}
```

- [ ] **Step 5: Write `app/page.tsx`**

```tsx
import { Logo } from "@/components/Logo";
import UploadForm from "@/components/UploadForm";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center px-5 pb-16 pt-10">
      <Logo className="text-2xl" />
      <h1 className="mt-12 text-center text-4xl font-semibold leading-tight tracking-tight">
        Find the right song for your content.
      </h1>
      <p className="mt-4 max-w-sm text-center text-base text-muted">
        Upload your Reel and Songfit will find the songs that fit it best, and exactly which part to use.
      </p>
      <UploadForm />
    </main>
  );
}
```

- [ ] **Step 6: Run the dev server and check the page**

```bash
pnpm dev &
sleep 5
curl -s http://localhost:3000 | grep -o "Find the right song for your content."
curl -s http://localhost:3000 | grep -o "processed by AI services"
kill %1
```

Expected: the first curl prints `Find the right song for your content.` once; the second prints `processed by AI services` once.

Open `http://localhost:3000` in a browser at a 390 px wide viewport: wordmark on top, headline, subline, dashed upload box, disabled input and button, disclosure line, no horizontal scroll.

- [ ] **Step 7: Typecheck, lint, test, commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add app components tailwind.config.ts
git commit -m "Add app shell, palette, logo and upload screen placeholder"
```

---

### Task 0.7: Provider smoke test

**Files:**
- Create: `scripts/smoke.ts`

**Interfaces:**
- Consumes: `callClaude` from `src/shared/anthropic.ts`, `MODELS` from `src/shared/config.ts`, `.env.local` (loaded by `node --env-file`), `ffmpeg-static`, `openai`, `@supabase/supabase-js`.
- Produces: `pnpm smoke` printing one `OK`/`FAIL` line per provider with latency. This is the Phase 0 gate and the first thing to re-run whenever a key changes. It deliberately does not import `src/db/client.ts` (which needs Next's server runtime).

- [ ] **Step 1: Write `scripts/smoke.ts`**

```ts
/* Run: pnpm smoke  (node --env-file=.env.local --import tsx scripts/smoke.ts) */
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { callClaude } from "../src/shared/anthropic";
import { MODELS, env } from "../src/shared/config";

const run = promisify(execFile);

type Check = { name: string; fn: () => Promise<string> };

async function timed(check: Check): Promise<boolean> {
  const t0 = Date.now();
  try {
    const detail = await check.fn();
    console.log(`OK    ${check.name.padEnd(10)} ${Date.now() - t0} ms  ${detail}`);
    return true;
  } catch (e) {
    console.log(`FAIL  ${check.name.padEnd(10)} ${Date.now() - t0} ms  ${(e as Error).message}`);
    return false;
  }
}

const checks: Check[] = [
  {
    name: "claude",
    fn: async () => {
      const text = await callClaude({
        model: MODELS.candidates,
        system: "Reply with exactly one word.",
        user: "Say: ready",
        maxTokens: 10,
      });
      return `reply="${text.trim()}"`;
    },
  },
  {
    name: "whisper",
    fn: async () => {
      if (!ffmpegPath) throw new Error("ffmpeg-static binary missing");
      const dir = await mkdtemp(path.join(os.tmpdir(), "songfit-smoke-"));
      const wav = path.join(dir, "silence.wav");
      try {
        await run(ffmpegPath, ["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", wav]);
        const openai = new OpenAI({ apiKey: env("OPENAI_API_KEY") });
        const res = await openai.audio.transcriptions.create({
          file: createReadStream(wav),
          model: MODELS.whisper,
          response_format: "text",
        });
        return `transcript="${String(res).trim().slice(0, 30)}" (silence, empty is fine)`;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "deezer",
    fn: async () => {
      const q = encodeURIComponent('artist:"The Weeknd" track:"Blinding Lights"');
      const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { title: string; duration: number }[] };
      const hit = json.data?.[0];
      if (!hit) throw new Error("no result");
      return `"${hit.title}" duration=${hit.duration}s`;
    },
  },
  {
    name: "database",
    fn: async () => {
      const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false },
      });
      const { count, error } = await db.from("submissions").select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return `submissions=${count ?? 0}`;
    },
  },
];

const results = await Promise.all(checks.map(timed));
process.exit(results.every(Boolean) ? 0 : 1);
```

- [ ] **Step 2: Run it**

```bash
pnpm smoke
```

Expected (with all keys in `.env.local`):

```
OK    claude     ~800 ms  reply="ready"
OK    whisper    ~1500 ms transcript="" (silence, empty is fine)
OK    deezer     ~300 ms  "Blinding Lights" duration=200s
OK    database   ~200 ms  submissions=0
```

and exit code 0. A `FAIL` line names the provider and the error; fix the key or network and re-run. If keys are not in yet, the claude/whisper/database lines FAIL with "Missing required environment variable" — that is expected until Dylan pastes them, and the phase gate waits on it.

- [ ] **Step 3: Typecheck and commit**

`scripts/` is outside `app/` and `src/` but inside the `tsconfig.json` include glob, so `pnpm typecheck` covers it.

```bash
pnpm typecheck
git add scripts/smoke.ts
git commit -m "Add provider smoke test script"
```

---

### Phase 0 demo check

- [ ] `pnpm typecheck && pnpm test && pnpm build` all pass (this is the phase gate; nothing in Phase 1 starts until it does).
- [ ] `pnpm dev` → `http://localhost:3000` shows the Songfit wordmark, headline "Find the right song for your content.", the placeholder upload form and the disclosure line, correctly at phone width.
- [ ] `node --env-file=.env.local /tmp/check-schema.mjs` (Task 0.3 step 7) prints `ok` for all 11 tables, the `videos` bucket, and `claim_submission_run`.
- [ ] `src/db/types.ts` exists, is committed, and contains `create_submission`, `claim_submission_run`, `anchor_seconds`, `stripe_events`.
- [ ] `pnpm smoke` prints four `OK` lines and exits 0 (requires Dylan's keys in `.env.local`).
- [ ] `.env.example` lists all 14 keys; `.env.local` exists locally and is git-ignored (`git ls-files | grep -c '^.env.local$'` prints `0`).
## Phase 1 — Upload → stored submission

**Demo when done:** From an iPhone on cellular, against the deployed Vercel app: sign in with Google, pick a Reel, watch it upload with a progress bar (resumable for big files), land on a waiting page that polls a real `submissions` row.

Codex-review rulings applied in this phase (`docs/review/03-claude-rulings.md`): C2 (atomic paywall at creation, exact path binding, rate limits), C3/I2 (one runner entered via an atomic claim, run inside the submit route with `waitUntil`), C5 (`submissionId` prop, named `Logo` export, no raw errors to creators), C7 (deploy + phone test moved into this phase), I6 (sign in first, resumable uploads), I10 (honest failed state), M3 (admin gate per page/action, tight redirect allowlist, retention disclosure).

Assumes Phase 0 is complete: scaffold, `src/shared/{types,config,logger,errors,json,anthropic}.ts`, `src/db/client.ts` (`createServerClient`, `createServiceClient`), `src/db/browser.ts` (`createBrowserClient`), `src/db/queries/*`, `src/feedback/events.ts` (`EVENT_NAMES`, `logEvent`), `components/Logo.tsx` (named export `Logo`), `app/page.tsx` rendering a placeholder, `@vercel/functions` installed.

Phase 0 functions used here (signatures):

```ts
// src/shared/errors.ts
export class PaywallError extends Error { reason: "needs_subscription" }
// src/db/queries/creators.ts
export async function ensureCreator(id: string, email: string, displayName?: string | null): Promise<CreatorRow>; // CreatorRow has created_at
// src/db/queries/submissions.ts
export async function getSubmission(id: string): Promise<SubmissionRow | null>;
/** Calls the create_submission() SQL function: inserts the row AND enforces the paywall atomically. Throws PaywallError. Idempotent on id (returns the existing row for the same creator). */
export async function createSubmission(s: { id: string; creatorId: string; videoPath: string; creatorIntent: string | null }): Promise<SubmissionRow>;
/** Atomic conditional update: status → 'analyzing', updated_at = now() when status in ('uploaded','failed') OR updated_at older than LIMITS.inFlightStaleMinutes. Returns the row, or null when another run holds it. */
export async function claimSubmissionRun(id: string): Promise<SubmissionRow | null>;
export async function setSubmissionStatus(id: string, status: SubmissionStatus, error?: string | null): Promise<void>;
export async function countReadySubmissions(creatorId: string): Promise<number>;
export async function countSubmissionsForCreator(creatorId: string): Promise<number>;
// src/db/queries/subscriptions.ts
export async function getActiveSubscription(creatorId: string): Promise<{ id: string; status: string } | null>;
// src/db/queries/recommendations.ts
export async function listRecommendations(submissionId: string): Promise<RecommendationRow[]>;
```

`SubmissionRow` is `Database["public"]["Tables"]["submissions"]["Row"]` from `src/db/types.ts`. `RecommendationView` is the only recommendation shape that reaches the browser (`src/shared/types.ts`).

---

### Task 1.1: Auth — server session, admin gate, OAuth callback, middleware, client sign-in

**Files:**
- Create: `src/auth/admin.ts`
- Create: `src/auth/session.ts`
- Create: `app/auth/callback/route.ts`
- Create: `middleware.ts`
- Create: `components/auth.ts`
- Test: `tests/auth/admin.test.ts`

**Interfaces:**
- Consumes: `createServerClient()` from `src/db/client.ts` (returns a Supabase client bound to Next cookies), `createBrowserClient()` from `src/db/browser.ts`, `ensureCreator()` from `src/db/queries/creators.ts`, `logEvent()`.
- Produces:
  - `isAdminEmail(email: string | null | undefined, list: string): boolean` (pure)
  - `getCreator(): Promise<{ id: string; email: string } | null>`
  - `requireCreator(): Promise<{ id: string; email: string }>` — redirects to `/` when signed out
  - `requireAdmin(): Promise<{ id: string; email: string }>` — redirects to `/` unless admin. **Rule for Phases 2–4:** every `app/admin/**` page, route handler and server action calls `requireAdmin()` itself. The admin layout calling it is not enough (layouts don't re-run on client navigation and do not protect server actions).
  - `isAdmin(creator): boolean`
  - `signInWithGoogle(next: string): Promise<void>` (client)
- Redirect allowlist (Supabase → Authentication → URL Configuration) is exactly: `http://localhost:3000/**`, `http://<LAN-IP>:3000/**` while phone-testing locally, the exact production Vercel URL `https://<project>.vercel.app/**` once Task 1.7 creates it, and `https://thissongfits.com/**`. No `*.vercel.app` wildcard.

- [ ] **Step 1: Write the failing test for the admin email check**

```ts
// tests/auth/admin.test.ts
import { describe, expect, it } from "vitest";
import { isAdminEmail } from "../../src/auth/admin";

describe("isAdminEmail", () => {
  it("matches case-insensitively against a comma-separated list", () => {
    expect(isAdminEmail("Dylan@Gmail.com", "dylanbryan2002@gmail.com, dylan@gmail.com")).toBe(true);
  });
  it("ignores whitespace around entries", () => {
    expect(isAdminEmail("a@b.com", "  a@b.com  ,c@d.com")).toBe(true);
  });
  it("rejects emails not in the list", () => {
    expect(isAdminEmail("x@y.com", "a@b.com,c@d.com")).toBe(false);
  });
  it("rejects null/undefined/empty", () => {
    expect(isAdminEmail(null, "a@b.com")).toBe(false);
    expect(isAdminEmail(undefined, "a@b.com")).toBe(false);
    expect(isAdminEmail("", "a@b.com")).toBe(false);
    expect(isAdminEmail("a@b.com", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/auth/admin.test.ts`
Expected: FAIL — `Cannot find module '../../src/auth/admin'`

- [ ] **Step 3: Write the pure admin check**

```ts
// src/auth/admin.ts
export function isAdminEmail(email: string | null | undefined, list: string): boolean {
  if (!email || !list) return false;
  const needle = email.trim().toLowerCase();
  if (!needle) return false;
  return list
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(needle);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/auth/admin.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the server session helpers**

```ts
// src/auth/session.ts
import { redirect } from "next/navigation";
import { createServerClient } from "@/src/db/client";
import { ensureCreator } from "@/src/db/queries/creators";
import { isAdminEmail } from "./admin";

export type Creator = { id: string; email: string };

export async function getCreator(): Promise<Creator | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || !data.user.email) return null;
  const creator = { id: data.user.id, email: data.user.email };
  // Idempotent mirror into public.creators so FK targets exist.
  await ensureCreator(
    creator.id,
    creator.email,
    (data.user.user_metadata?.full_name as string | undefined) ?? null,
  );
  return creator;
}

export async function requireCreator(): Promise<Creator> {
  const creator = await getCreator();
  if (!creator) redirect("/");
  return creator;
}

/** Call this in EVERY admin page, route handler and server action, not only in the admin layout. */
export async function requireAdmin(): Promise<Creator> {
  const creator = await getCreator();
  if (!creator || !isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "")) {
    redirect("/");
  }
  return creator;
}

export function isAdmin(creator: Creator | null): boolean {
  return !!creator && isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "");
}
```

- [ ] **Step 6: Write the OAuth callback route**

```ts
// app/auth/callback/route.ts
import { NextResponse } from "next/server";
import { createServerClient } from "@/src/db/client";
import { ensureCreator } from "@/src/db/queries/creators";
import { logEvent } from "@/src/feedback/events";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/";
  // Only allow same-origin relative paths to avoid open redirects.
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (code) {
    const supabase = await createServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Mirror the user into public.creators and log signed_up the first time we see them.
      const { data } = await supabase.auth.getUser();
      if (data.user?.email) {
        const row = await ensureCreator(
          data.user.id,
          data.user.email,
          (data.user.user_metadata?.full_name as string | undefined) ?? null,
        );
        if (Date.now() - Date.parse(row.created_at) < 60_000) {
          await logEvent({ name: "signed_up", creatorId: row.id });
        }
      }
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }
  return NextResponse.redirect(new URL("/?auth=failed", url.origin));
}
```

- [ ] **Step 7: Write the middleware that refreshes the session cookie**

```ts
// middleware.ts
import { createServerClient as createSsrClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createSsrClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touching getUser() refreshes an expired access token and rewrites cookies.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 8: Write the client sign-in helper**

```ts
// components/auth.ts
"use client";
import { createBrowserClient } from "@/src/db/browser";

export async function signInWithGoogle(next: string): Promise<void> {
  const supabase = createBrowserClient();
  const origin = window.location.origin;
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const supabase = createBrowserClient();
  await supabase.auth.signOut();
  window.location.assign("/");
}
```

- [ ] **Step 9: Typecheck and run all tests**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck exits 0; vitest PASS including `tests/auth/admin.test.ts`

- [ ] **Step 10: Commit**

```bash
git add src/auth middleware.ts app/auth components/auth.ts tests/auth
git commit -m "Add Google auth session helpers, callback route and admin gate"
```

---

### Task 1.2: Signed upload URL, storage helpers, paywall pre-check, rate limit

**Files:**
- Create: `src/media/storage.ts`
- Create: `src/billing/paywall.ts`
- Create: `src/billing/rateLimit.ts`
- Modify: `src/db/queries/submissions.ts` (add `countInFlightSubmissions`, `countSubmissionsSince`)
- Create: `app/api/upload-url/route.ts`
- Test: `tests/billing/paywall.test.ts`, `tests/billing/rateLimit.test.ts`, `tests/media/storagePath.test.ts`

**Interfaces:**
- Consumes: `createServiceClient()` from `src/db/client.ts`, `LIMITS`, `FREE_RESULTS_PER_CREATOR` from `src/shared/config.ts`, `getCreator()` from `src/auth/session.ts`, `countReadySubmissions()` and `getActiveSubscription()` (Phase 0).
- Produces:
  - `storagePathFor(creatorId, submissionId, ext): string` and `isExactStoragePath(path, creatorId, submissionId, ext): boolean` (pure)
  - `getSignedUploadUrl(creatorId, submissionId, ext): Promise<{ path; token; signedUrl }>`
  - `objectInfo(storagePath): Promise<{ sizeBytes: number; mimeType: string | null } | null>`
  - `downloadToTmp(storagePath): Promise<string>` (local file path in a fresh temp dir)
  - `getSignedPlaybackUrl(storagePath, seconds = 3600): Promise<string>`
  - `decideCanSubmit(readyCount, inFlightCount, hasActiveSub): { ok: true } | { ok: false; reason: "needs_subscription" }` (pure). **This is a UX pre-check only.** The binding gate is the `create_submission()` SQL function Phase 0 created, which runs the same rule inside the database when the row is inserted (ruling C2).
  - `canSubmit(creatorId): Promise<ReturnType<typeof decideCanSubmit>>`
  - `takeToken(store, key, limit, windowMs, now?)` (pure over its store) and `checkUploadRate(creatorId): Promise<boolean>`
  - `POST /api/upload-url` → `200 { submissionId, path, token, signedUrl }` | `401` | `402 { reason: "needs_subscription" }` | `429` | `400`. The server chooses `path`; the client must upload to exactly that path and send it back unchanged.

- [ ] **Step 1: Write the failing paywall test**

```ts
// tests/billing/paywall.test.ts
import { describe, expect, it } from "vitest";
import { decideCanSubmit } from "../../src/billing/paywall";

describe("decideCanSubmit (UX pre-check mirroring create_submission())", () => {
  it("allows the first submission with no subscription", () => {
    expect(decideCanSubmit(0, 0, false)).toEqual({ ok: true });
  });
  it("blocks a second submission without an active subscription", () => {
    expect(decideCanSubmit(1, 0, false)).toEqual({ ok: false, reason: "needs_subscription" });
    expect(decideCanSubmit(5, 0, false)).toEqual({ ok: false, reason: "needs_subscription" });
  });
  it("counts an in-flight submission against the free allowance", () => {
    expect(decideCanSubmit(0, 1, false)).toEqual({ ok: false, reason: "needs_subscription" });
  });
  it("allows any submission with an active subscription", () => {
    expect(decideCanSubmit(0, 0, true)).toEqual({ ok: true });
    expect(decideCanSubmit(9, 2, true)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/billing/paywall.test.ts`
Expected: FAIL — `Cannot find module '../../src/billing/paywall'`

- [ ] **Step 3: Add the two count queries, then write the paywall module**

Append to `src/db/queries/submissions.ts`:

```ts
/** In-flight = uploaded/analyzing/recommending and touched within the stale window. Mirrors create_submission(). */
export async function countInFlightSubmissions(creatorId: string, staleMinutes: number): Promise<number> {
  const since = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .in("status", ["uploaded", "analyzing", "recommending"])
    .gte("updated_at", since);
  if (error) throw error;
  return count ?? 0;
}

export async function countSubmissionsSince(creatorId: string, sinceIso: string): Promise<number> {
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .gte("created_at", sinceIso);
  if (error) throw error;
  return count ?? 0;
}
```

```ts
// src/billing/paywall.ts
import { countInFlightSubmissions, countReadySubmissions } from "@/src/db/queries/submissions";
import { getActiveSubscription } from "@/src/db/queries/subscriptions";
import { FREE_RESULTS_PER_CREATOR, LIMITS } from "@/src/shared/config";

export type CanSubmit = { ok: true } | { ok: false; reason: "needs_subscription" };

/**
 * UX pre-check. The database function create_submission() applies the same
 * rule atomically at insert time; this only exists so the client can show the
 * paywall before uploading 100 MB.
 */
export function decideCanSubmit(readyCount: number, inFlightCount: number, hasActiveSub: boolean): CanSubmit {
  if (hasActiveSub) return { ok: true };
  if (readyCount + inFlightCount >= FREE_RESULTS_PER_CREATOR) return { ok: false, reason: "needs_subscription" };
  return { ok: true };
}

export async function canSubmit(creatorId: string): Promise<CanSubmit> {
  const [readyCount, inFlight, sub] = await Promise.all([
    countReadySubmissions(creatorId),
    countInFlightSubmissions(creatorId, LIMITS.inFlightStaleMinutes),
    getActiveSubscription(creatorId),
  ]);
  return decideCanSubmit(readyCount, inFlight, sub !== null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/billing/paywall.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing tests for the storage path check and the rate limiter**

```ts
// tests/media/storagePath.test.ts
import { describe, expect, it } from "vitest";
import { isExactStoragePath, storagePathFor } from "../../src/media/storage";

const c = "11111111-1111-1111-1111-111111111111";
const s = "22222222-2222-2222-2222-222222222222";

describe("storagePathFor / isExactStoragePath", () => {
  it("builds creator/submission.ext", () => {
    expect(storagePathFor(c, s, "mov")).toBe(`${c}/${s}.mov`);
  });
  it("accepts only the exact path", () => {
    expect(isExactStoragePath(`${c}/${s}.mov`, c, s, "mov")).toBe(true);
    expect(isExactStoragePath(`${c}/${s}.mp4`, c, s, "mov")).toBe(false);
    expect(isExactStoragePath(`${c}/other.mov`, c, s, "mov")).toBe(false);
    expect(isExactStoragePath(`${c}/../${c}/${s}.mov`, c, s, "mov")).toBe(false);
    expect(isExactStoragePath(`${c}/${s}.mov/`, c, s, "mov")).toBe(false);
  });
});
```

```ts
// tests/billing/rateLimit.test.ts
import { describe, expect, it } from "vitest";
import { takeToken } from "../../src/billing/rateLimit";

describe("takeToken", () => {
  it("allows up to the limit inside the window, then refuses", () => {
    const store = new Map<string, number[]>();
    let now = 1_000_000;
    for (let i = 0; i < 5; i++) expect(takeToken(store, "c1", 5, 60_000, now)).toBe(true);
    expect(takeToken(store, "c1", 5, 60_000, now)).toBe(false);
    now += 60_001;
    expect(takeToken(store, "c1", 5, 60_000, now)).toBe(true);
  });
  it("keys are independent", () => {
    const store = new Map<string, number[]>();
    for (let i = 0; i < 5; i++) takeToken(store, "a", 5, 60_000, 0);
    expect(takeToken(store, "b", 5, 60_000, 0)).toBe(true);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm vitest run tests/media/storagePath.test.ts tests/billing/rateLimit.test.ts`
Expected: FAIL — cannot find modules

- [ ] **Step 7: Write the storage helpers**

```ts
// src/media/storage.ts
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServiceClient } from "@/src/db/client";

export const VIDEO_BUCKET = "videos";

export function storagePathFor(creatorId: string, submissionId: string, ext: string): string {
  return `${creatorId}/${submissionId}.${ext}`;
}

/** Exact string equality against the server-built path. No prefix logic, no normalisation. */
export function isExactStoragePath(candidate: string, creatorId: string, submissionId: string, ext: string): boolean {
  return candidate === storagePathFor(creatorId, submissionId, ext);
}

export async function getSignedUploadUrl(
  creatorId: string,
  submissionId: string,
  ext: string,
): Promise<{ path: string; token: string; signedUrl: string }> {
  const supabase = createServiceClient();
  const objectPath = storagePathFor(creatorId, submissionId, ext);
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUploadUrl(objectPath);
  if (error || !data) throw new Error(`createSignedUploadUrl failed: ${error?.message}`);
  return { path: data.path, token: data.token, signedUrl: data.signedUrl };
}

/** Size and type of a stored object, or null when it doesn't exist. */
export async function objectInfo(
  storagePath: string,
): Promise<{ sizeBytes: number; mimeType: string | null } | null> {
  const supabase = createServiceClient();
  const dir = path.posix.dirname(storagePath);
  const name = path.posix.basename(storagePath);
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).list(dir, { search: name });
  if (error) throw new Error(`storage list failed: ${error.message}`);
  const obj = (data ?? []).find((o) => o.name === name);
  if (!obj) return null;
  const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
  return { sizeBytes: Number(meta.size ?? 0), mimeType: meta.mimetype ?? null };
}

/**
 * Downloads the object into a fresh private directory (`/tmp/songfit-<random>/video.<ext>`)
 * so callers can `rm -rf path.dirname(result)` safely when done (Phase 2 relies on this).
 */
export async function downloadToTmp(storagePath: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).download(storagePath);
  if (error || !data) throw new Error(`storage download failed: ${error?.message}`);
  const dir = await mkdtemp(path.join(os.tmpdir(), "songfit-"));
  const ext = path.posix.extname(storagePath) || ".mp4";
  const localPath = path.join(dir, `video${ext}`);
  await writeFile(localPath, Buffer.from(await data.arrayBuffer()));
  return localPath;
}

export async function getSignedPlaybackUrl(storagePath: string, seconds = 3600): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(storagePath, seconds);
  if (error || !data) throw new Error(`createSignedUrl failed: ${error?.message}`);
  return data.signedUrl;
}
```

- [ ] **Step 8: Write the rate limiter**

```ts
// src/billing/rateLimit.ts
import { countSubmissionsSince } from "@/src/db/queries/submissions";

export const UPLOAD_URL_LIMIT = 5;
export const UPLOAD_URL_WINDOW_MS = 60_000;

/**
 * Sliding-window token take. Pure over the store it is given so it is testable.
 * The module-level store is PER SERVER INSTANCE: on Vercel each function
 * instance has its own map, so this is a best-effort second guard. The
 * database count in checkUploadRate() is the one that holds across instances.
 */
export function takeToken(
  store: Map<string, number[]>,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  const recent = (store.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    store.set(key, recent);
    return false;
  }
  recent.push(now);
  store.set(key, recent);
  return true;
}

const issuances = new Map<string, number[]>();

/** True when this creator may be issued another upload URL right now. */
export async function checkUploadRate(creatorId: string): Promise<boolean> {
  const since = new Date(Date.now() - UPLOAD_URL_WINDOW_MS).toISOString();
  const created = await countSubmissionsSince(creatorId, since);
  if (created >= UPLOAD_URL_LIMIT) return false;
  return takeToken(issuances, creatorId, UPLOAD_URL_LIMIT, UPLOAD_URL_WINDOW_MS);
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm vitest run tests/media/storagePath.test.ts tests/billing/rateLimit.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 10: Write the upload-url route**

```ts
// app/api/upload-url/route.ts
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { canSubmit } from "@/src/billing/paywall";
import { checkUploadRate } from "@/src/billing/rateLimit";
import { getSignedUploadUrl } from "@/src/media/storage";
import { LIMITS } from "@/src/shared/config";

export const dynamic = "force-dynamic";

const Body = z.object({
  ext: z.enum(["mp4", "mov", "webm", "m4v"]),
  sizeBytes: z.number().int().positive().max(LIMITS.maxUploadBytes),
});

export async function POST(request: Request) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  if (!(await checkUploadRate(creator.id))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const gate = await canSubmit(creator.id);
  if (!gate.ok) return NextResponse.json({ reason: gate.reason }, { status: 402 });

  const submissionId = randomUUID();
  const { path, token, signedUrl } = await getSignedUploadUrl(creator.id, submissionId, parsed.data.ext);
  return NextResponse.json({ submissionId, path, token, signedUrl });
}
```

- [ ] **Step 11: Typecheck and run all tests**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck exits 0; vitest PASS

- [ ] **Step 12: Manual check (browser console while signed in on `http://localhost:3000`)**

```js
await fetch("/api/upload-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ext: "mp4", sizeBytes: 1000 }) }).then(r => r.json())
```

Expected: `{ submissionId: "<uuid>", path: "<creatorId>/<uuid>.mp4", token: "...", signedUrl: "https://..." }`. Signed out: `401`. Run it 6 times in a row: the 6th returns `429`.

- [ ] **Step 13: Commit**

```bash
git add src/media/storage.ts src/billing src/db/queries/submissions.ts app/api/upload-url tests/billing tests/media
git commit -m "Add signed upload URL route, storage helpers, paywall pre-check and rate limit"
```

---

### Task 1.3: Submission creation (atomic paywall), in-route pipeline run, admin run route, status endpoint

**Files:**
- Create: `src/pipeline/run.ts` (stub for this phase; Phase 2 fills the body, signature is final)
- Create: `app/api/submissions/route.ts`
- Create: `app/api/submissions/[id]/run/route.ts`
- Create: `app/api/submissions/[id]/route.ts`
- Create: `src/feedback/recommendationView.ts`
- Test: `tests/feedback/recommendationView.test.ts`

**Interfaces:**
- Consumes: `getCreator()`, `isAdmin()`, `isExactStoragePath()`, `objectInfo()`, `createSubmission()` (throws `PaywallError`), `claimSubmissionRun()`, `getSubmission()`, `listRecommendations()`, `countSubmissionsForCreator()`, `logEvent()`, `env()`, `waitUntil` from `@vercel/functions`.
- Produces:
  - `runSubmission(submissionId: string): Promise<void>` — never throws; claims the run via `claimSubmissionRun` first.
  - `toRecommendationView(row: RecommendationRow): RecommendationView` (pure)
  - `POST /api/submissions` body `{ submissionId, path, ext, creatorIntent }` → `201 { id }` | `200 { id }` (already existed) | `402 { reason }` | `400` | `401`. Runs the pipeline in-process via `waitUntil`; `maxDuration = 300`.
  - `POST /api/submissions/[id]/run` header `x-internal-token` → `200 { ok: true }` | `409` (claim refused) — **admin retry only**.
  - `GET /api/submissions/[id]` → `200 { status, error: "failed" | null, recommendations: RecommendationView[] }` | `404`. Raw error text never leaves the server.

- [ ] **Step 1: Write the failing test for the view mapper**

```ts
// tests/feedback/recommendationView.test.ts
import { describe, expect, it } from "vitest";
import { toRecommendationView } from "../../src/feedback/recommendationView";

describe("toRecommendationView", () => {
  it("exposes only creator-facing fields", () => {
    const row = {
      id: "r1", submission_id: "s1", candidate_id: "c1", rank: 1, direction_label: "Best fit",
      title: "Song", artist: "Artist", start_seconds: 43, end_seconds: 58, explanation: "Why.",
      spotify_url: "https://open.spotify.com/search/Song%20Artist", deezer_url: "https://deezer.com/track/1",
      artwork_url: null, preview_url: null, selected: false, rejected: false, created_at: "2026-10-06T00:00:00Z",
      explain_prompt_version: "explain-v1",
    };
    expect(toRecommendationView(row as never)).toEqual({
      rank: 1, direction_label: "Best fit", title: "Song", artist: "Artist",
      start_seconds: 43, end_seconds: 58, explanation: "Why.", artwork_url: null, preview_url: null,
      spotify_url: "https://open.spotify.com/search/Song%20Artist", selected: false, rejected: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/feedback/recommendationView.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the view mapper**

```ts
// src/feedback/recommendationView.ts
import type { RecommendationRow } from "@/src/db/queries/recommendations";
import { RecommendationView } from "@/src/shared/types";

/** The ONLY shape that reaches the browser. Validated with Zod so a schema drift fails loudly. */
export function toRecommendationView(row: RecommendationRow): RecommendationView {
  // `selected` / `rejected` columns arrive with Phase 4's migration; until then the generated
  // Row type lacks them. Remove this cast in Task 4.1.
  const flags = row as { selected?: boolean | null; rejected?: boolean | null };
  return RecommendationView.parse({
    rank: row.rank,
    direction_label: row.direction_label,
    title: row.title,
    artist: row.artist,
    start_seconds: Number(row.start_seconds),
    end_seconds: Number(row.end_seconds),
    explanation: row.explanation,
    artwork_url: row.artwork_url,
    preview_url: row.preview_url,
    spotify_url: row.spotify_url,
    selected: flags.selected ?? false,
    rejected: flags.rejected ?? false,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/feedback/recommendationView.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Write the pipeline stub with the atomic claim**

```ts
// src/pipeline/run.ts
import { claimSubmissionRun } from "@/src/db/queries/submissions";
import { logger } from "@/src/shared/logger";

/**
 * Runs the full pipeline for a submission. Entered only through claimSubmissionRun(),
 * an atomic conditional update, so two concurrent callers cannot both run it.
 * Phase 1 stub: claim, log, return (status is now 'analyzing'). Phase 2 adds the
 * analyze stage, Phase 3 adds recommend. Never throws.
 */
export async function runSubmission(submissionId: string): Promise<void> {
  const claimed = await claimSubmissionRun(submissionId);
  if (!claimed) {
    logger.info("pipeline.claim_refused", { submissionId });
    return;
  }
  logger.info("pipeline.start", { submissionId });
}
```

- [ ] **Step 6: Write the submission creation route (runs the pipeline in-process)**

```ts
// app/api/submissions/route.ts
import { waitUntil } from "@vercel/functions";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { createSubmission, countSubmissionsForCreator, getSubmission } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";
import { isExactStoragePath, objectInfo } from "@/src/media/storage";
import { runSubmission } from "@/src/pipeline/run";
import { LIMITS } from "@/src/shared/config";
import { PaywallError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";

// The pipeline runs inside this request via waitUntil, so this route needs the full budget.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const Body = z.object({
  submissionId: z.string().uuid(),
  path: z.string().min(1).max(200),
  ext: z.enum(["mp4", "mov", "webm", "m4v"]),
  creatorIntent: z.string().trim().max(300).nullable().optional(),
});

export async function POST(request: Request) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { submissionId, path, ext, creatorIntent } = parsed.data;

  // Idempotent: a retried POST for an id this creator already owns returns it unchanged.
  const existing = await getSubmission(submissionId);
  if (existing) {
    if (existing.creator_id !== creator.id) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ id: existing.id }, { status: 200 });
  }

  // The path must be exactly the one the server issued for this creator + id + ext.
  if (!isExactStoragePath(path, creator.id, submissionId, ext)) {
    return NextResponse.json({ error: "forbidden_path" }, { status: 403 });
  }
  const info = await objectInfo(path);
  if (!info) return NextResponse.json({ error: "upload_not_found" }, { status: 400 });
  if (info.sizeBytes > LIMITS.maxUploadBytes) return NextResponse.json({ error: "too_large" }, { status: 400 });

  let submission;
  try {
    submission = await createSubmission({
      id: submissionId,
      creatorId: creator.id,
      videoPath: path,
      creatorIntent: creatorIntent?.length ? creatorIntent : null,
    });
  } catch (err) {
    if (err instanceof PaywallError) return NextResponse.json({ reason: err.reason }, { status: 402 });
    logger.error("submission.create_failed", { submissionId, err: String(err) });
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }

  await logEvent({ name: "submission_created", creatorId: creator.id, submissionId: submission.id });
  await logEvent({ name: "upload_completed", creatorId: creator.id, submissionId: submission.id });
  if ((await countSubmissionsForCreator(creator.id)) >= 2) {
    await logEvent({ name: "returned_with_second_submission", creatorId: creator.id, submissionId: submission.id });
  }

  // Run the pipeline in this function. waitUntil keeps the instance alive after the
  // response is sent (Vercel); locally it resolves like a normal background promise.
  waitUntil(
    runSubmission(submission.id).catch((err) =>
      logger.error("pipeline.unhandled", { submissionId: submission.id, err: String(err) }),
    ),
  );

  return NextResponse.json({ id: submission.id }, { status: 201 });
}
```

Known limitation (write it in README under "Known limitations"): `waitUntil` is not durable. If the instance dies mid-run the status stays in-flight; after `LIMITS.inFlightStaleMinutes` the claim becomes available again and the admin Retry (Phase 2) re-runs it.

- [ ] **Step 7: Write the admin-retry run route**

```ts
// app/api/submissions/[id]/run/route.ts
import { NextResponse } from "next/server";
import { getSubmission } from "@/src/db/queries/submissions";
import { runSubmission } from "@/src/pipeline/run";
import { env } from "@/src/shared/config";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Admin retry entry point. Protected by the shared INTERNAL_TOKEN; goes through the same atomic claim. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = request.headers.get("x-internal-token");
  if (!token || token !== env("INTERNAL_TOKEN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const before = await getSubmission(id);
  if (!before) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await runSubmission(id); // never throws; refuses internally when the claim fails
  const after = await getSubmission(id);
  if (after && before.status === after.status && before.updated_at === after.updated_at) {
    return NextResponse.json({ ok: false, error: "claim_refused" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 8: Write the status route**

```ts
// app/api/submissions/[id]/route.ts
import { NextResponse } from "next/server";
import { getCreator, isAdmin } from "@/src/auth/session";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { getSubmission } from "@/src/db/queries/submissions";
import { toRecommendationView } from "@/src/feedback/recommendationView";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await ctx.params;
  const submission = await getSubmission(id);
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.creator_id !== creator.id && !isAdmin(creator)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const recommendations =
    submission.status === "ready" ? (await listRecommendations(id)).map(toRecommendationView) : [];

  return NextResponse.json({
    status: submission.status,
    error: submission.status === "failed" ? "failed" : null, // never the raw message
    recommendations,
  });
}
```

- [ ] **Step 9: Typecheck and run tests**

Run: `pnpm typecheck && pnpm test`
Expected: exits 0; PASS

- [ ] **Step 10: Manual check of the run route token guard**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/submissions/00000000-0000-0000-0000-000000000000/run`
Expected: `403`

Run: `curl -s -X POST -H "x-internal-token: $(grep INTERNAL_TOKEN .env.local | cut -d= -f2)" http://localhost:3000/api/submissions/00000000-0000-0000-0000-000000000000/run`
Expected: `{"error":"not_found"}` with 404 — proves the guard passed.

- [ ] **Step 11: Commit**

```bash
git add src/pipeline/run.ts src/feedback/recommendationView.ts app/api/submissions tests/feedback
git commit -m "Add atomic submission creation, in-route pipeline run, admin run route and status endpoint"
```

---

### Task 1.4: Sign in first, then UploadForm with resumable upload

**Files:**
- Create: `components/fileExt.ts`
- Create: `components/videoDuration.ts`
- Create: `components/upload.ts`
- Create: `components/SignIn.tsx`
- Create: `components/UploadForm.tsx`
- Modify: `app/page.tsx`
- Modify: `package.json` (add `tus-js-client`)
- Test: `tests/components/fileExt.test.ts`

**Interfaces:**
- Consumes: `signInWithGoogle()` from `components/auth.ts`, `createBrowserClient()` from `src/db/browser.ts`, `LIMITS` from `src/shared/config.ts`, `POST /api/upload-url`, `POST /api/submissions`.
- Produces:
  - `fileExt(file: { name: string; type: string }): "mp4" | "mov" | "webm" | "m4v" | null` (pure)
  - `readVideoDuration(file: File): Promise<number>` (client)
  - `uploadVideo(args: { file, path, token, signedUrl, onProgress }): Promise<void>` (client; TUS resumable above 6 MB, signed PUT at or below)
  - `<SignIn />` — the signed-out landing: one "Continue with Google" button plus the retention line
  - `<UploadForm creator={Creator} />` — only rendered when signed in
- Product decision (ruling I6 default): sign-in happens BEFORE picking a file. Nothing is stashed across the OAuth redirect.

- [ ] **Step 1: Write the failing test for extension detection**

```ts
// tests/components/fileExt.test.ts
import { describe, expect, it } from "vitest";
import { fileExt } from "../../components/fileExt";

describe("fileExt", () => {
  it("uses the filename extension when recognised", () => {
    expect(fileExt({ name: "clip.MOV", type: "video/quicktime" })).toBe("mov");
    expect(fileExt({ name: "clip.mp4", type: "video/mp4" })).toBe("mp4");
    expect(fileExt({ name: "clip.webm", type: "video/webm" })).toBe("webm");
    expect(fileExt({ name: "clip.m4v", type: "video/x-m4v" })).toBe("m4v");
  });
  it("falls back to the mime type when the name has no usable extension", () => {
    expect(fileExt({ name: "image", type: "video/quicktime" })).toBe("mov");
    expect(fileExt({ name: "blob", type: "video/mp4" })).toBe("mp4");
  });
  it("returns null for unsupported files", () => {
    expect(fileExt({ name: "a.avi", type: "video/x-msvideo" })).toBeNull();
    expect(fileExt({ name: "a.jpg", type: "image/jpeg" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/components/fileExt.test.ts`
Expected: FAIL — `Cannot find module '../../components/fileExt'`

- [ ] **Step 3: Write the pure helper**

```ts
// components/fileExt.ts
export type VideoExt = "mp4" | "mov" | "webm" | "m4v";

const BY_EXT: Record<string, VideoExt> = { mp4: "mp4", mov: "mov", webm: "webm", m4v: "m4v" };
const BY_MIME: Record<string, VideoExt> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
};

export function fileExt(file: { name: string; type: string }): VideoExt | null {
  const dot = file.name.lastIndexOf(".");
  if (dot > -1) {
    const ext = file.name.slice(dot + 1).toLowerCase();
    if (BY_EXT[ext]) return BY_EXT[ext];
  }
  return BY_MIME[file.type.toLowerCase()] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/components/fileExt.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the duration reader**

```ts
// components/videoDuration.ts
"use client";

/** Resolves the duration in seconds by loading metadata into a detached <video>. */
export function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const d = video.duration;
      URL.revokeObjectURL(url);
      if (!Number.isFinite(d)) reject(new Error("Could not read video duration"));
      else resolve(d);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this video"));
    };
    video.src = url;
  });
}
```

- [ ] **Step 6: Install tus and write the uploader**

Run: `pnpm add tus-js-client`

Supabase Storage exposes a TUS endpoint at `/storage/v1/upload/resumable`. Chunks are exactly 6 MB; the user's access token authorises the write and the Storage INSERT policy (Phase 0, `0003_rls.sql`) restricts it to `{auth.uid()}/…` paths, which is why the client must use the server-issued `path` verbatim.

```ts
// components/upload.ts
"use client";
import * as tus from "tus-js-client";
import { createBrowserClient } from "@/src/db/browser";

const SIX_MB = 6 * 1024 * 1024;

export async function uploadVideo(args: {
  file: File;
  path: string;
  token: string;
  signedUrl: string;
  onProgress: (pct: number) => void;
}): Promise<void> {
  if (args.file.size <= SIX_MB) return putToSignedUrl(args.signedUrl, args.file, args.onProgress);
  return resumableUpload(args.file, args.path, args.onProgress);
}

/** Small files: one PUT to the signed upload URL (token is in the URL). */
function putToSignedUrl(signedUrl: string, file: File, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload_${xhr.status}`)));
    xhr.onerror = () => reject(new Error("upload_network"));
    xhr.onabort = () => reject(new Error("upload_aborted"));
    xhr.send(file);
  });
}

/** Big files: TUS resumable upload with automatic retry, survives flaky cellular. */
async function resumableUpload(file: File, objectName: string, onProgress: (pct: number) => void): Promise<void> {
  const supabase = createBrowserClient();
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("not_signed_in");

  const endpoint = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`;

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint,
      retryDelays: [0, 1000, 3000, 5000],
      chunkSize: SIX_MB, // Supabase requires exactly 6 MB chunks
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-upsert": "false",
      },
      metadata: {
        bucketName: "videos",
        objectName,
        contentType: file.type || "video/mp4",
        cacheControl: "3600",
      },
      onError: (err) => reject(err),
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onSuccess: () => resolve(),
    });
    // Resume a previous attempt of the same file if the browser kept its fingerprint.
    upload.findPreviousUploads().then((prev) => {
      if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    });
  });
}
```

- [ ] **Step 7: Write the signed-out landing**

```tsx
// components/SignIn.tsx
"use client";
import { useState } from "react";
import { signInWithGoogle } from "./auth";

export function SignIn() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-5">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await signInWithGoogle("/");
          } finally {
            setBusy(false);
          }
        }}
        className="w-full rounded-2xl bg-neutral-900 px-5 py-4 text-base font-semibold text-white disabled:opacity-60"
      >
        Continue with Google
      </button>
      <p className="px-4 text-center text-xs text-neutral-500">
        Your video is stored privately and analysed by AI services to find your songs. Nothing is posted anywhere.
      </p>
    </div>
  );
}
```

- [ ] **Step 8: Write the UploadForm component (signed-in only)**

```tsx
// components/UploadForm.tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fileExt } from "./fileExt";
import { readVideoDuration } from "./videoDuration";
import { uploadVideo } from "./upload";
import { LIMITS } from "@/src/shared/config";

type Creator = { id: string; email: string };
type Phase = "idle" | "checking" | "uploading" | "creating" | "error";

export function UploadForm({ creator }: { creator: Creator }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [intent, setIntent] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setFile(e.target.files?.[0] ?? null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) {
      setError("Pick a video first.");
      return;
    }
    const ext = fileExt(file);
    if (!ext) {
      setError("That file type isn't supported. Use MP4, MOV or WebM.");
      return;
    }
    if (file.size > LIMITS.maxUploadBytes) {
      setError("That video is over 150 MB. Try a shorter export.");
      return;
    }

    try {
      setPhase("checking");
      const duration = await readVideoDuration(file);
      if (duration > LIMITS.maxDurationSeconds) {
        setError("Keep it under 3 minutes for now.");
        setPhase("idle");
        return;
      }

      const urlRes = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ext, sizeBytes: file.size }),
      });
      if (urlRes.status === 402) {
        router.push("/subscribe");
        return;
      }
      if (urlRes.status === 429) throw new Error("Give it a minute and try again.");
      if (!urlRes.ok) throw new Error("Upload didn't finish. Try again.");
      const { submissionId, path, token, signedUrl } = (await urlRes.json()) as {
        submissionId: string;
        path: string;
        token: string;
        signedUrl: string;
      };

      setPhase("uploading");
      setProgress(0);
      await uploadVideo({ file, path, token, signedUrl, onProgress: setProgress });

      setPhase("creating");
      const createRes = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId, path, ext, creatorIntent: intent.trim() || null }),
      });
      if (createRes.status === 402) {
        router.push("/subscribe");
        return;
      }
      if (!createRes.ok) throw new Error("Upload didn't finish. Try again.");
      const { id } = (await createRes.json()) as { id: string };
      router.push(`/results/${id}`);
    } catch (err) {
      setPhase("error");
      const msg = err instanceof Error ? err.message : "";
      setError(msg.startsWith("Give it") || msg.startsWith("Upload didn't") ? msg : "Upload didn't finish. Try again.");
    }
  }

  const busy = phase === "checking" || phase === "uploading" || phase === "creating";

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-md flex-col gap-5">
      <label
        htmlFor="video"
        className="flex aspect-[9/12] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-sm active:scale-[0.99]"
      >
        {previewUrl ? (
          <video src={previewUrl} muted playsInline className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 text-center">
            <span className="text-lg font-semibold text-neutral-900">Tap to add your Reel</span>
            <span className="text-sm text-neutral-500">MP4 or MOV, up to 3 minutes</span>
          </div>
        )}
        <input id="video" type="file" accept="video/*" className="sr-only" onChange={onPick} disabled={busy} />
      </label>

      {file && <p className="truncate text-center text-sm text-neutral-500">{file.name}</p>}

      <input
        type="text"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        maxLength={300}
        placeholder="What do you want this to feel like? (optional)"
        className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-base text-neutral-900 placeholder:text-neutral-400"
        disabled={busy}
      />

      {phase === "uploading" && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full bg-neutral-900 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      )}

      {error && <p className="text-center text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-2xl bg-neutral-900 px-5 py-4 text-base font-semibold text-white disabled:opacity-60"
      >
        {phase === "checking" && "Checking your video"}
        {phase === "uploading" && `Uploading ${progress}%`}
        {phase === "creating" && "Almost there"}
        {(phase === "idle" || phase === "error") && "Find my songs"}
      </button>
      <p className="text-center text-xs text-neutral-400">Signed in as {creator.email}</p>
    </form>
  );
}
```

- [ ] **Step 9: Wire the page: sign-in first**

```tsx
// app/page.tsx
import { getCreator } from "@/src/auth/session";
import { Logo } from "@/components/Logo";
import { SignIn } from "@/components/SignIn";
import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const creator = await getCreator();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-8 px-4 pb-10 pt-10">
      <Logo />
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">
          Find the right song for your content.
        </h1>
        <p className="text-base text-neutral-500">
          Upload your Reel and Songfit will find the songs that fit it best, and exactly which part to use.
        </p>
      </div>
      {creator ? <UploadForm creator={creator} /> : <SignIn />}
    </main>
  );
}
```

- [ ] **Step 10: Typecheck and run tests**

Run: `pnpm typecheck && pnpm test`
Expected: exits 0; PASS including `tests/components/fileExt.test.ts`

- [ ] **Step 11: Manual check in the browser**

1. `pnpm dev`, open `http://localhost:3000` signed out. Expected: headline, subline, one "Continue with Google" button, the retention line. No file picker.
2. Tap it → Google → back on `/` showing the upload form and "Signed in as …".
3. Pick a 3 MB MP4, tap "Find my songs". Expected: "Uploading NN%", then `/results/<uuid>`.
4. Pick a 40 MB MOV. Expected: progress climbs in ~6 MB steps (TUS), then `/results/<uuid>`. In Supabase Studio → Storage → `videos` → `<creatorId>/<uuid>.mov` exists; `submissions` has a row with `status = analyzing`.
5. Toggle devtools → Network → Offline for 5 s during step 4, then back online. Expected: the upload resumes and completes.

- [ ] **Step 12: Commit**

```bash
git add components/UploadForm.tsx components/SignIn.tsx components/fileExt.ts components/videoDuration.ts components/upload.ts app/page.tsx package.json pnpm-lock.yaml tests/components
git commit -m "Add sign-in-first landing and resumable upload form"
```

---

### Task 1.5: Waiting page with status polling and an honest failed state

**Files:**
- Create: `app/results/[id]/page.tsx`
- Create: `components/WaitingState.tsx`
- Modify: `app/globals.css` (keyframes)

**Interfaces:**
- Consumes: `getCreator()`, `isAdmin()`, `getSubmission()`, `GET /api/submissions/[id]`.
- Produces: `<WaitingState submissionId={string} initialStatus={string} />`; `/results/[id]` renders the waiting state until `status === "ready"`, then a placeholder (Phase 3 replaces the placeholder with the results list).
- On `failed`: polling stops and the page says "Something went wrong on our side. We're on it." The admin Retry (Phase 2) puts it back in flight; the creator can reload.

- [ ] **Step 1: Add the keyframes to `app/globals.css`**

```css
@keyframes slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
```

- [ ] **Step 2: Write the WaitingState client component**

```tsx
// components/WaitingState.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const LINES = ["Watching your video", "Understanding the feel", "Finding your songs"];
const POLL_MS = 3000;
const LINE_MS = 4000;
const SLOW_AFTER_MS = 240_000;

type Status = "uploaded" | "analyzing" | "recommending" | "ready" | "failed";

export function WaitingState({ submissionId, initialStatus }: { submissionId: string; initialStatus: Status }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [lineIdx, setLineIdx] = useState(0);
  const [slow, setSlow] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (status === "failed") return;
    const t = setInterval(() => setLineIdx((i) => (i + 1) % LINES.length), LINE_MS);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    if (status === "failed") return;
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(`/api/submissions/${submissionId}`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { status: Status };
          if (cancelled) return;
          if (body.status === "ready") {
            router.refresh();
            return;
          }
          if (body.status === "failed") {
            setStatus("failed");
            return;
          }
        }
      } catch {
        /* transient network error: keep polling */
      }
      if (!cancelled && Date.now() - startedAt.current > SLOW_AFTER_MS) setSlow(true);
      if (!cancelled) setTimeout(tick, POLL_MS);
    }
    void tick();
    return () => {
      cancelled = true;
    };
  }, [submissionId, router, status]);

  if (status === "failed") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-lg font-medium text-neutral-900">Something went wrong on our side.</p>
        <p className="text-sm text-neutral-500">We&apos;re on it. Check back in a bit.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="h-1.5 w-40 overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full w-1/3 animate-[slide_1.4s_ease-in-out_infinite] rounded-full bg-neutral-900" />
      </div>
      <p className="text-lg font-medium text-neutral-900" aria-live="polite">
        {LINES[lineIdx]}
      </p>
      {slow && (
        <p className="text-sm text-neutral-500">This is taking longer than usual, we&apos;ll keep trying.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write the results page (waiting branch now, results branch in Phase 3)**

```tsx
// app/results/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { getCreator, isAdmin } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { Logo } from "@/components/Logo";
import { WaitingState } from "@/components/WaitingState";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, creator] = await Promise.all([params, getCreator()]);
  if (!creator) redirect("/");

  const submission = await getSubmission(id);
  if (!submission) notFound();
  if (submission.creator_id !== creator.id && !isAdmin(creator)) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-10 px-4 pb-10 pt-10">
      <Logo />
      {submission.status === "ready" ? (
        // Phase 3 replaces this block with the recommendation cards.
        <h1 className="text-2xl font-semibold text-neutral-900">Ready</h1>
      ) : (
        <WaitingState
          submissionId={id}
          initialStatus={submission.status as "uploaded" | "analyzing" | "recommending" | "failed"}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0

- [ ] **Step 5: Manual check**

1. Upload a video (Task 1.4). Expected: `/results/<id>` shows the sliding bar and the rotating lines, changing every 4 s.
2. In Supabase Studio, set that row's `status` to `ready`. Expected: within 3 s the page shows "Ready".
3. Set it to `failed`. Expected: within 3 s the page shows "Something went wrong on our side." and the Network tab shows polling has stopped.
4. Open the same URL in a private window signed in as a different Google account. Expected: 404.

- [ ] **Step 6: Commit**

```bash
git add app/results components/WaitingState.tsx app/globals.css
git commit -m "Add waiting page with status polling and failed state"
```

---

### Task 1.6: Google provider setup (Dylan, no code)

**Files:** none. Supabase dashboard + Google Cloud Console.

**Interfaces:**
- Produces: a working Google provider on the Supabase project, with a tight redirect allowlist.

- [ ] **Step 1: Google Cloud Console — OAuth consent screen**

1. Go to `https://console.cloud.google.com/`, create or select a project named `Songfit`.
2. APIs & Services → OAuth consent screen → User type **External** → Create.
3. App name `Songfit`, user support email = your Gmail, developer contact = your Gmail. Save.
4. Scopes → Add → tick `.../auth/userinfo.email` and `.../auth/userinfo.profile` → Update → Save.
5. Publishing status: click **Publish app** so any Google account can sign in (otherwise only listed test users can).

- [ ] **Step 2: Google Cloud Console — OAuth client**

1. APIs & Services → Credentials → Create credentials → **OAuth client ID** → Application type **Web application**, name `Songfit web`.
2. Authorized JavaScript origins: `http://localhost:3000`, `https://thissongfits.com`. (Add the exact Vercel URL after Task 1.7.)
3. Authorized redirect URIs: `https://<project-ref>.supabase.co/auth/v1/callback` (project ref from Supabase → Settings → General).
4. Create. Copy the **Client ID** and **Client secret**.

- [ ] **Step 3: Supabase dashboard — enable Google**

1. Authentication → Providers → Google → toggle **Enabled**.
2. Paste Client ID and Client secret. Save.
3. Authentication → URL Configuration:
   - Site URL: `https://thissongfits.com`
   - Redirect URLs (add each, no wildcards across hosts): `http://localhost:3000/**`, `https://thissongfits.com/**`. Task 1.7 adds the exact Vercel URL. For phone testing on the LAN add `http://<LAN-IP>:3000/**` and remove it after.
4. Save.

- [ ] **Step 4: Local env**

In `.env.local` confirm `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` point at this project.

- [ ] **Step 5: Manual verify**

1. `pnpm dev`, open `http://localhost:3000`, tap "Continue with Google".
2. Expected: Google account chooser → consent → redirected to `http://localhost:3000/` showing the upload form.
3. Supabase → Authentication → Users shows your Gmail. Table `creators` has a matching row and `events` has one `signed_up` row for it.

---

### Task 1.7: Deploy to Vercel and run the phone test (ruling C7)

**Files:**
- Create: `app/api/health/route.ts`
- Modify: `README.md` (Deploy section: the steps below)

**Interfaces:**
- Produces: a public Vercel URL running this branch, a verified 300 s function budget, and a submission created from an iPhone over cellular.

- [ ] **Step 1: Write the health route that proves the function budget**

```ts
// app/api/health/route.ts
import { NextResponse } from "next/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** GET /api/health?sleep=65 → waits that many seconds then returns 200. Proves maxDuration is honoured. */
export async function GET(request: Request) {
  const sleep = Math.min(Number(new URL(request.url).searchParams.get("sleep") ?? "0"), 290);
  if (sleep > 0) await new Promise((r) => setTimeout(r, sleep * 1000));
  return NextResponse.json({ ok: true, slept: sleep });
}
```

Run locally: `curl -s "http://localhost:3000/api/health?sleep=2"` → `{"ok":true,"slept":2}`.

- [ ] **Step 2: Push the repo to GitHub**

```bash
gh auth status || gh auth login
gh repo create songfit --private --source=. --remote=origin --push
```

Expected: `origin` set, branch `mvp` pushed.

- [ ] **Step 3: Create the Vercel project (Dylan signs in; Claude runs the commands)**

```bash
pnpm dlx vercel login
pnpm dlx vercel link        # new project "songfit", framework Next.js, root "./"
```

In the Vercel dashboard → Project → Settings:
- **Functions → Fluid Compute: ON** (required for 300 s on Hobby; Pro gives it by default). Codex's note stands: a commercial subscription app should be on Pro; Dylan decides by Wednesday.
- **Environment Variables**: every key in `.env.example` with the production values (Supabase URL/anon/service role, Anthropic, OpenAI, `ADMIN_EMAILS`, `INTERNAL_TOKEN` = `openssl rand -hex 32`, `NEXT_PUBLIC_SITE_URL` = the Vercel URL for now). Stripe keys are added in Phase 4.
- **Git**: production branch `mvp` for now (switch to `main` when merging).

```bash
pnpm dlx vercel --prod
```

Expected: a URL like `https://songfit-<hash>.vercel.app` (note the stable project URL `https://songfit.vercel.app` if the name is free).

- [ ] **Step 4: Prove the budget on Vercel**

Run: `curl -s -m 120 "https://<vercel-url>/api/health?sleep=65"`
Expected: `{"ok":true,"slept":65}` after ~65 s. A 504 or an empty response before 60 s means Fluid Compute is off or the plan caps functions at 60 s; fix that before continuing.

- [ ] **Step 5: Point Supabase and Google at the Vercel URL**

1. Supabase → Authentication → URL Configuration → Redirect URLs: add `https://<vercel-url>/**` (exact host).
2. Google Cloud → the OAuth client → Authorized JavaScript origins: add `https://<vercel-url>`.

- [ ] **Step 6: Phone test on cellular**

On an iPhone with Wi-Fi OFF:
1. Open `https://<vercel-url>` in Safari. Tap "Continue with Google" → sign in → upload form appears.
2. Pick a 60 s MOV shot on the phone (HEVC, 1080p; typically 60–120 MB). Tap "Find my songs".
3. Expected: progress climbs in steps, then the waiting page with rotating lines.
4. Supabase Studio: `submissions` has the row with `status = analyzing`, `video_path = <creatorId>/<uuid>.mov`; `events` has `submission_created` and `upload_completed`; Storage → `videos` has the object with the right size.
5. Vercel → Logs: `pipeline.start` for that id, no errors.

If the upload fails above 50 MB with a Storage error about file size, the Supabase project is on the Free plan (50 MB object limit). Either upgrade to Pro (Dylan's decision, ruling C7) or lower `LIMITS.maxUploadBytes` to `50 * 1024 * 1024` and the copy to "under 50 MB" until then.

- [ ] **Step 7: Commit**

```bash
git add app/api/health README.md
git commit -m "Add health route and Vercel deploy steps; phone upload verified on cellular"
git push
```

---

### Phase 1 demo check

- [ ] `pnpm typecheck && pnpm test && pnpm build` all exit 0 (the end-of-phase gate).
- [ ] Task 1.7 Step 6 passed on a real iPhone over cellular against the Vercel URL, including a > 50 MB file (or the 50 MB cap was consciously set).
- [ ] Signed out, the landing shows only the Google button; `GET /api/submissions/<id>` for someone else's id returns 404; a sixth `/api/upload-url` within a minute returns 429.
- [ ] A second creator account that already has one `ready` row (set it by hand in Studio) gets 402 from `/api/upload-url` and lands on `/subscribe` (page exists in Phase 4; a 404 there is fine for now, the redirect is what's being checked).
- [ ] Commit any fixes found during the demo:

```bash
git add -A
git commit -m "Phase 1: upload to stored submission working from a phone on the deployed app"
```
## Phase 2 — Analysis

**Demo when done:** a real Reel uploaded from an iPhone over cellular to the DEPLOYED app moves `uploaded → analyzing → recommending`; `/admin/submissions/[id]` shows the video, a sensible structured analysis, the transcript and a music brief. `pnpm typecheck && pnpm test && pnpm build` pass.

Assumes Phase 0 delivered: `src/shared/{types,config,errors,logger}.ts` (`logger` is the export name), `src/shared/json.ts` (`extractJson(text): unknown` — strips fences, finds the first `{` or `[`, `JSON.parse`, throws with the raw text attached), `src/shared/anthropic.ts` (`callClaude`, used by Phase 3's text-only stages; Task 2.3 keeps its own client because it sends image blocks), `src/db/queries/*` (`getSubmission`, `setSubmissionStatus(id, status, error?)`, `claimSubmissionRun(id)`, `updateSubmission`, `upsertAnalysis`, `getAnalysisRow`, `getAnalysis`, `listRecommendations`, `listSubmissions`), the `video_analyses.content_category` column, and `submissions.updated_at` (used by `claimSubmissionRun`). Assumes Phase 1 delivered `src/media/storage.ts` (`downloadToTmp` into a fresh private dir, `getSignedPlaybackUrl`), `src/feedback/events.ts` (`logEvent`), `src/auth/session.ts` (`requireAdmin`), and a stub `src/pipeline/run.ts`.

`PipelineError` (Phase 0, `src/shared/errors.ts`) has the shape:

```ts
export class PipelineError extends Error {
  constructor(public stage: "analyze" | "recommend", message: string, public raw?: string) {
    super(message);
    this.name = "PipelineError";
  }
}
```

Deadline convention used by every stage in this phase (and by Phase 3): the runner computes `deadlineAt = started + LIMITS.pipelineBudgetMs` and passes `{ deadlineAt }` down. A stage never starts a model call or subprocess whose default timeout would overrun `deadlineAt`; it shortens the timeout to the remaining time via the `timeoutFor()` helper (Task 2.1), so the function always fails cleanly with time left to persist `failed`.

---

### Task 2.1: Media extraction (ffprobe duration, ffmpeg frames + audio)

**Files:**
- Create: `src/media/extract.ts`
- Create: `src/media/extractHelpers.ts`
- Test: `tests/media/extractHelpers.test.ts`
- Test: `tests/media/extract.integration.test.ts`
- Modify: `package.json` (add deps)

**Interfaces:**
- Consumes: `LIMITS` from `src/shared/config.ts`; `PipelineError` from `src/shared/errors.ts`; `logger`.
- Produces:
  ```ts
  export async function extractMedia(
    videoPath: string,
    opts?: { workDir?: string; deadlineAt?: number },
  ): Promise<{
    durationSeconds: number;
    frames: { time: number; path: string }[];
    audioPath: string | null;
    workDir: string;
  }>;
  export function pickFps(durationSeconds: number, maxFrames: number): number;
  export function frameTimestamps(count: number, fps: number): number[];
  /** min(defaultMs, time left until deadlineAt), never below 1000 ms; defaultMs when no deadline */
  export function timeoutFor(defaultMs: number, deadlineAt: number | undefined, now?: number): number;
  ```
- Subprocess timeouts (ruling C3): ffprobe 20 s, ffmpeg frames 90 s, ffmpeg audio 60 s. A timed-out process is killed and surfaces as `PipelineError("analyze", "ffmpeg timeout: <step>")`.
- iPhone input: Safari hands us `.mov` containing HEVC (H.265). The `ffmpeg-static` builds decode HEVC, so no transcoding step is needed; the Phase 2 deployed test (Task 2.7) proves it on Vercel.

- [ ] **Step 1: Install the ffmpeg binaries**

```bash
pnpm add ffmpeg-static ffprobe-static
pnpm add -D @types/ffprobe-static
```

Expected: both appear in `package.json` dependencies. `node -e "console.log(require('ffmpeg-static'))"` prints a path ending in `ffmpeg`.

- [ ] **Step 2: Write the failing tests for the pure helpers**

`tests/media/extractHelpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickFps, frameTimestamps, timeoutFor } from "../../src/media/extractHelpers";

describe("pickFps", () => {
  it("uses 1 fps for short videos", () => {
    expect(pickFps(30, 60)).toBe(1);
  });
  it("caps frames at maxFrames for long videos", () => {
    // 180 s video, 60 frames → 1 frame every 3 s
    expect(pickFps(180, 60)).toBeCloseTo(1 / 3, 5);
  });
  it("never exceeds 1 fps", () => {
    expect(pickFps(5, 60)).toBe(1);
  });
  it("throws on non-positive duration", () => {
    expect(() => pickFps(0, 60)).toThrow();
  });
});

describe("frameTimestamps", () => {
  it("maps frame index to seconds at 1 fps", () => {
    expect(frameTimestamps(3, 1)).toEqual([0, 1, 2]);
  });
  it("maps frame index to seconds at fractional fps", () => {
    expect(frameTimestamps(3, 1 / 3)).toEqual([0, 3, 6]);
  });
  it("returns empty for zero frames", () => {
    expect(frameTimestamps(0, 1)).toEqual([]);
  });
});

describe("timeoutFor", () => {
  it("returns the default when there is no deadline", () => {
    expect(timeoutFor(90_000, undefined, 0)).toBe(90_000);
  });
  it("shortens to the remaining time when the deadline is closer", () => {
    expect(timeoutFor(90_000, 50_000, 20_000)).toBe(30_000);
  });
  it("never drops below 1000 ms", () => {
    expect(timeoutFor(90_000, 10, 5)).toBe(1000);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/media/extractHelpers.test.ts`
Expected: FAIL with `Cannot find module '../../src/media/extractHelpers'`

- [ ] **Step 4: Write the helpers**

`src/media/extractHelpers.ts`:

```ts
/** Frames per second to sample so that a video of `durationSeconds` yields at most `maxFrames`, never more than 1 fps. */
export function pickFps(durationSeconds: number, maxFrames: number): number {
  if (!(durationSeconds > 0)) throw new Error(`invalid duration: ${durationSeconds}`);
  return Math.min(1, maxFrames / durationSeconds);
}

/** Timestamp (seconds) of each extracted frame, given ffmpeg's `fps=` filter output order. */
export function frameTimestamps(count: number, fps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round((i / fps) * 1000) / 1000);
  return out;
}

/**
 * Timeout to hand a subprocess or SDK call: the step's default, shortened to whatever
 * is left before the pipeline deadline, floored at 1 s so a call always gets a chance
 * to fail with a real error rather than a zero timeout.
 */
export function timeoutFor(defaultMs: number, deadlineAt: number | undefined, now: number = Date.now()): number {
  if (deadlineAt === undefined) return defaultMs;
  return Math.max(1000, Math.min(defaultMs, deadlineAt - now));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/media/extractHelpers.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Write extractMedia**

`src/media/extract.ts`:

```ts
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { LIMITS } from "../shared/config";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";
import { pickFps, frameTimestamps, timeoutFor } from "./extractHelpers";

const TIMEOUTS = { probe: 20_000, frames: 90_000, audio: 60_000 } as const;

function bin(): { ffmpeg: string; ffprobe: string } {
  if (!ffmpegPath) throw new PipelineError("analyze", "ffmpeg binary not found");
  const ffprobe = ffprobeStatic.path;
  if (!ffprobe) throw new PipelineError("analyze", "ffprobe binary not found");
  return { ffmpeg: ffmpegPath, ffprobe };
}

/**
 * Runs a binary with a hard timeout. On timeout Node sends SIGKILL to the child and
 * rejects with `killed: true`; we translate that into a PipelineError so the runner
 * records "ffmpeg timeout: <step>" instead of an opaque signal name.
 */
function run(file: string, args: string[], step: string, timeoutMs: number): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout: String(stdout) });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
        if (e.killed || e.signal === "SIGKILL") {
          return reject(new PipelineError("analyze", `ffmpeg timeout: ${step} (${timeoutMs} ms)`));
        }
        reject(new PipelineError("analyze", `${step} failed: ${e.message}`, String(stderr).slice(0, 2000)));
      },
    );
  });
}

async function probeDuration(ffprobe: string, input: string, deadlineAt?: number): Promise<number> {
  const { stdout } = await run(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", input],
    "ffprobe duration",
    timeoutFor(TIMEOUTS.probe, deadlineAt),
  );
  const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
  const d = Number(parsed.format?.duration);
  if (!Number.isFinite(d) || d <= 0) throw new PipelineError("analyze", "could not read video duration", stdout);
  return d;
}

async function hasAudioStream(ffprobe: string, input: string, deadlineAt?: number): Promise<boolean> {
  const { stdout } = await run(
    ffprobe,
    ["-v", "error", "-select_streams", "a", "-show_streams", "-of", "json", input],
    "ffprobe streams",
    timeoutFor(TIMEOUTS.probe, deadlineAt),
  );
  const parsed = JSON.parse(stdout) as { streams?: unknown[] };
  return Array.isArray(parsed.streams) && parsed.streams.length > 0;
}

export async function extractMedia(
  videoPath: string,
  opts: { workDir?: string; deadlineAt?: number } = {},
): Promise<{
  durationSeconds: number;
  frames: { time: number; path: string }[];
  audioPath: string | null;
  workDir: string;
}> {
  const { ffmpeg, ffprobe } = bin();
  const { deadlineAt } = opts;
  const dir = opts.workDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "songfit-")));
  await fs.mkdir(dir, { recursive: true });

  const durationSeconds = await probeDuration(ffprobe, videoPath, deadlineAt);
  if (durationSeconds > LIMITS.maxDurationSeconds) {
    throw new PipelineError("analyze", `video too long: ${Math.round(durationSeconds)}s > ${LIMITS.maxDurationSeconds}s`);
  }

  const fps = pickFps(durationSeconds, LIMITS.maxFrames);
  const framePattern = path.join(dir, "frame_%03d.jpg");
  await run(
    ffmpeg,
    [
      "-hide_banner", "-loglevel", "error",
      "-i", videoPath,
      "-vf", `fps=${fps},scale=${LIMITS.frameWidth}:-2`,
      "-q:v", "4",
      framePattern,
    ],
    "ffmpeg frames",
    timeoutFor(TIMEOUTS.frames, deadlineAt),
  );
  const names = (await fs.readdir(dir)).filter((n) => /^frame_\d{3}\.jpg$/.test(n)).sort();
  const times = frameTimestamps(names.length, fps);
  const frames = names.map((n, i) => ({ time: times[i], path: path.join(dir, n) }));
  if (frames.length === 0) throw new PipelineError("analyze", "no frames extracted");

  let audioPath: string | null = null;
  if (await hasAudioStream(ffprobe, videoPath, deadlineAt)) {
    audioPath = path.join(dir, "audio.wav");
    await run(
      ffmpeg,
      [
        "-hide_banner", "-loglevel", "error",
        "-i", videoPath,
        "-vn", "-ac", "1", "-ar", "16000", "-f", "wav",
        audioPath,
      ],
      "ffmpeg audio",
      timeoutFor(TIMEOUTS.audio, deadlineAt),
    );
  }

  logger.info("media.extracted", { durationSeconds, frames: frames.length, fps, audio: audioPath !== null });
  return { durationSeconds, frames, audioPath, workDir: dir };
}
```

- [ ] **Step 7: Write the integration test (runs for real; skips only when the binary path is null)**

`ffmpeg-static` is a hard dependency, so this test runs in every environment that ran `pnpm install`. The only skip is when the package resolved no binary for this platform — and then it prints a loud warning so nobody mistakes a skip for a pass.

`tests/media/extract.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);
const ffmpeg: string | null = (ffmpegPath as string | null) ?? null;

if (!ffmpeg) {
  // eslint-disable-next-line no-console
  console.warn(
    "\n!!! ffmpeg-static resolved NO binary for this platform. extract.integration is SKIPPED, which is NOT a pass. Fix the install before trusting Phase 2.\n",
  );
}

describe.skipIf(!ffmpeg)("extractMedia (integration)", () => {
  let sample: string;

  beforeAll(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "songfit-sample-"));
    sample = path.join(dir, "sample.mp4");
    // 5 s synthetic video with a 440 Hz tone so an audio stream exists.
    await run(ffmpeg!, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=5:size=320x240:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
      "-shortest", "-pix_fmt", "yuv420p", sample,
    ]);
  });

  it("extracts duration, ~1 frame per second and a wav", async () => {
    const { extractMedia } = await import("../../src/media/extract");
    const out = await extractMedia(sample);
    expect(out.durationSeconds).toBeGreaterThan(4.5);
    expect(out.durationSeconds).toBeLessThan(5.5);
    expect(out.frames.length).toBeGreaterThanOrEqual(4);
    expect(out.frames.length).toBeLessThanOrEqual(6);
    expect(out.frames[0].time).toBe(0);
    expect(out.audioPath).toMatch(/audio\.wav$/);
    const stat = await fs.stat(out.audioPath!);
    expect(stat.size).toBeGreaterThan(1000);
  });

  it("fails with a PipelineError timeout when the deadline leaves too little time", async () => {
    const { extractMedia } = await import("../../src/media/extract");
    // A 170 s 720p clip takes several seconds to decode for frames. With ~1.5 s left before the
    // deadline, ffprobe (fast) succeeds but the frames step is capped near the 1 s floor and is killed.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "songfit-long-"));
    const long = path.join(dir, "long.mp4");
    await run(ffmpeg!, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=170:size=1280x720:rate=30",
      "-pix_fmt", "yuv420p", "-preset", "ultrafast", long,
    ]);
    await expect(extractMedia(long, { deadlineAt: Date.now() + 1500 })).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      message: expect.stringMatching(/timeout/),
    });
  }, 60_000);
});
```

- [ ] **Step 8: Run all media tests**

Run: `pnpm vitest run tests/media`
Expected: PASS, 12 tests, no "SKIPPED" warning in the output. If the warning prints, stop and fix `pnpm install` (re-run it; check the network) — do not proceed on a skipped integration suite.

Manual check if you want to see the frames: `ls $(node -e "console.log(require('os').tmpdir())")/songfit-*/` after running the test.

- [ ] **Step 9: Typecheck and commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml src/media/extract.ts src/media/extractHelpers.ts tests/media
git commit -m "Add ffmpeg media extraction with hard timeouts"
```

---

### Task 2.2: Whisper transcription

**Files:**
- Create: `src/analysis/transcribe.ts`
- Test: `tests/analysis/transcribe.test.ts`

**Interfaces:**
- Consumes: `MODELS.whisper` from config; `env("OPENAI_API_KEY")`; `timeoutFor` from `src/media/extractHelpers.ts`.
- Produces:
  ```ts
  export type TranscriptSegment = { start: number; end: number; text: string };
  export type Transcript = { text: string; segments: TranscriptSegment[] };
  export async function transcribe(
    audioPath: string | null,
    opts?: { client?: OpenAI; deadlineAt?: number },
  ): Promise<Transcript>;
  ```
- Ruling I9: there is NO word-count dialogue heuristic. Whisper returns whatever words it hears — spoken or sung. Whether speech is *spoken dialogue* is decided by the analysis model in Task 2.3 from the timestamped transcript plus the frames; `dialogue_present` is its answer.

- [ ] **Step 1: Install the OpenAI SDK**

```bash
pnpm add openai
```

- [ ] **Step 2: Write the failing test**

`tests/analysis/transcribe.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { transcribe } from "../../src/analysis/transcribe";

describe("transcribe", () => {
  it("returns an empty transcript when there is no audio", async () => {
    expect(await transcribe(null)).toEqual({ text: "", segments: [] });
  });

  it("calls Whisper with verbose_json and maps text + segments", async () => {
    const create = vi.fn().mockResolvedValue({
      text: "  this is my new fit  ",
      segments: [
        { start: 0.0, end: 1.4, text: " this is " },
        { start: 1.4, end: 2.9, text: " my new fit " },
      ],
    });
    const client = { audio: { transcriptions: { create } } } as unknown as import("openai").default;
    const t = await transcribe(__filename, { client });
    expect(t.text).toBe("this is my new fit");
    expect(t.segments).toEqual([
      { start: 0, end: 1.4, text: "this is" },
      { start: 1.4, end: 2.9, text: "my new fit" },
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "whisper-1", response_format: "verbose_json" }),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("tolerates a response with no segments array", async () => {
    const create = vi.fn().mockResolvedValue({ text: "hello" });
    const client = { audio: { transcriptions: { create } } } as unknown as import("openai").default;
    const t = await transcribe(__filename, { client });
    expect(t).toEqual({ text: "hello", segments: [] });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/analysis/transcribe.test.ts`
Expected: FAIL with `Cannot find module '../../src/analysis/transcribe'`

- [ ] **Step 4: Implement**

`src/analysis/transcribe.ts`:

```ts
import fs from "node:fs";
import OpenAI from "openai";
import { MODELS, env } from "../shared/config";
import { logger } from "../shared/logger";
import { timeoutFor } from "../media/extractHelpers";

export type TranscriptSegment = { start: number; end: number; text: string };
export type Transcript = { text: string; segments: TranscriptSegment[] };

const WHISPER_TIMEOUT_MS = 60_000;

let singleton: OpenAI | null = null;
function defaultClient(): OpenAI {
  if (!singleton) singleton = new OpenAI({ apiKey: env("OPENAI_API_KEY") });
  return singleton;
}

/**
 * Words Whisper hears, spoken or sung, with segment timestamps. Returns an empty
 * transcript when there is no audio track. Does NOT decide whether this is dialogue —
 * the analysis model does (Task 2.3).
 */
export async function transcribe(
  audioPath: string | null,
  opts: { client?: OpenAI; deadlineAt?: number } = {},
): Promise<Transcript> {
  if (!audioPath) return { text: "", segments: [] };
  const c = opts.client ?? defaultClient();
  const result = (await c.audio.transcriptions.create(
    {
      file: fs.createReadStream(audioPath),
      model: MODELS.whisper,
      response_format: "verbose_json",
    },
    { timeout: timeoutFor(WHISPER_TIMEOUT_MS, opts.deadlineAt) },
  )) as { text?: string; segments?: { start: number; end: number; text: string }[] };

  const text = (result.text ?? "").trim();
  const segments: TranscriptSegment[] = Array.isArray(result.segments)
    ? result.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }))
    : [];
  logger.info("analysis.transcribed", { chars: text.length, segments: segments.length });
  return { text, segments };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/analysis/transcribe.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml src/analysis/transcribe.ts tests/analysis/transcribe.test.ts
git commit -m "Add Whisper transcription with timestamped segments"
```

---

### Task 2.3: Claude video analysis → VideoAnalysis + MusicBrief

**Files:**
- Create: `src/analysis/analyzeVideo.ts`
- Test: `tests/analysis/analyzeVideo.test.ts`

**Interfaces:**
- Consumes: `VideoAnalysis`, `MusicBrief`, `AnalysisResult` from `src/shared/types.ts`; `MODELS.analysis`, `LIMITS.modelTimeoutMs`, `CONTENT_CATEGORIES`, `env("ANTHROPIC_API_KEY")`; `extractJson` from `src/shared/json.ts` (Phase 0); `PipelineError`; `timeoutFor`; `TranscriptSegment` from Task 2.2.
- Produces:
  ```ts
  export const PROMPT_VERSION = "analyze-v2";
  export const MOMENT_TYPES = ["scene_change", "main_visual_reveal", "climax", "transition", "text_overlay", "beat_cut"] as const;
  export type AnalyzeInput = {
    frames: { time: number; base64: string }[];
    transcript: string;
    transcriptSegments: TranscriptSegment[];
    creatorIntent: string | null;
    durationSeconds: number;
  };
  export async function analyzeVideo(
    input: AnalyzeInput,
    opts?: { client?: Anthropic; deadlineAt?: number },
  ): Promise<AnalysisResult & { raw: string }>;
  ```
- Ruling C1: parse = `extractJson` → Zod. One retry carrying the Zod error, then `PipelineError("analyze", "model output invalid", raw)`. Nothing is silently dropped or defaulted.
- Ruling I9: the prompt distinguishes spoken dialogue from singing/lyrics; `dialogue_present` is true only for spoken words.
- `important_moments[].type` must come from `MOMENT_TYPES` (the Zod schema keeps `type: z.string()`; we enforce the list with a refinement here so the engine's alignment rule in Phase 3 can match on `main_visual_reveal | climax | transition | beat_cut`).

- [ ] **Step 1: Install the Anthropic SDK**

```bash
pnpm add @anthropic-ai/sdk
```

(No-op if Phase 0 already added it for `src/shared/anthropic.ts`.)

- [ ] **Step 2: Write the failing tests for analyzeVideo**

`tests/analysis/analyzeVideo.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { analyzeVideo, PROMPT_VERSION } from "../../src/analysis/analyzeVideo";
import type Anthropic from "@anthropic-ai/sdk";

const validPayload = {
  analysis: {
    summary: "Creator walks through NYC at night and reveals an outfit.",
    content_type: "fashion lifestyle reel",
    content_category: "fashion",
    setting: "New York at night",
    story: "walk, then outfit reveal",
    aesthetic: ["luxury", "urban"],
    mood: ["confident", "mysterious"],
    energy: "medium-high",
    pacing: "medium",
    dialogue_present: false,
    important_moments: [{ time: 7.8, type: "main_visual_reveal", note: "outfit reveal" }],
  },
  brief: {
    text: "Modern NYC fashion montage. Confident and slightly mysterious. Needs a lift around 8s.",
    fields: {
      moods: ["confident", "cool"],
      energy: 0.72,
      tempo_preference: "medium-high",
      vocal_preference: "either",
      genre_preferences: [],
      genre_avoid: [],
      dialogue_present: false,
      desired_cultural_relevance: "high",
      desired_familiarity: "recognizable_not_overused",
    },
  },
};

function fakeClient(responses: string[]): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn();
  for (const r of responses) {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: r }], stop_reason: "end_turn" });
  }
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const input = {
  frames: [{ time: 0, base64: "AAAA" }, { time: 1, base64: "BBBB" }],
  transcript: "",
  transcriptSegments: [],
  creatorIntent: null,
  durationSeconds: 12,
};

describe("analyzeVideo", () => {
  it("parses a valid response into AnalysisResult", async () => {
    const { client, create } = fakeClient([JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.content_category).toBe("fashion");
    expect(out.brief.fields.energy).toBe(0.72);
    expect(out.transcript).toBe("");
    expect(out.prompt_version).toBe(PROMPT_VERSION);
    expect(create).toHaveBeenCalledTimes(1);
    const [params, reqOpts] = create.mock.calls[0];
    expect(params.model).toBeDefined();
    expect(reqOpts).toEqual(expect.objectContaining({ timeout: expect.any(Number) }));
    // two image blocks, each preceded by a timestamp label
    const content = params.messages[0].content as { type: string; text?: string }[];
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect(content.some((b) => b.type === "text" && b.text?.includes("t=1.0s"))).toBe(true);
  });

  it("accepts fenced JSON", async () => {
    const { client } = fakeClient(["```json\n" + JSON.stringify(validPayload) + "\n```"]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.summary).toContain("NYC");
  });

  it("renders transcript segments with timestamps into the prompt", async () => {
    const { client, create } = fakeClient([JSON.stringify(validPayload)]);
    await analyzeVideo(
      {
        ...input,
        transcript: "okay so here is the fit",
        transcriptSegments: [{ start: 2.1, end: 4.0, text: "okay so here is the fit" }],
      },
      { client },
    );
    const content = create.mock.calls[0][0].messages[0].content as { type: string; text?: string }[];
    const joined = content.map((b) => b.text ?? "").join("\n");
    expect(joined).toContain("[2.1–4.0] okay so here is the fit");
  });

  it("retries once when the first response fails validation, then succeeds", async () => {
    const bad = JSON.stringify({ analysis: { summary: "x" }, brief: {} });
    const { client, create } = fakeClient([bad, JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.content_category).toBe("fashion");
    expect(create).toHaveBeenCalledTimes(2);
    const retryMessages = create.mock.calls[1][0].messages;
    expect(JSON.stringify(retryMessages)).toContain("did not match the schema");
  });

  it("rejects an important_moments type outside MOMENT_TYPES (then retries)", async () => {
    const wrongType = JSON.parse(JSON.stringify(validPayload));
    wrongType.analysis.important_moments[0].type = "vibe_shift";
    const { client, create } = fakeClient([JSON.stringify(wrongType), JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.important_moments[0].type).toBe("main_visual_reveal");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("throws PipelineError with raw text after two invalid responses", async () => {
    const bad = "{\"nope\": true}";
    const { client } = fakeClient([bad, bad]);
    await expect(analyzeVideo(input, { client })).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      raw: bad,
    });
  });

  it("throws PipelineError when the response is not JSON at all, twice", async () => {
    const { client } = fakeClient(["Sorry, I cannot see the video.", "Still nothing."]);
    await expect(analyzeVideo(input, { client })).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      raw: "Still nothing.",
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/analysis/analyzeVideo.test.ts`
Expected: FAIL with `Cannot find module '../../src/analysis/analyzeVideo'`

- [ ] **Step 4: Implement analyzeVideo with the full prompt**

`src/analysis/analyzeVideo.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS, LIMITS, CONTENT_CATEGORIES, env } from "../shared/config";
import { VideoAnalysis, MusicBrief, type AnalysisResult } from "../shared/types";
import { PipelineError } from "../shared/errors";
import { extractJson } from "../shared/json";
import { logger } from "../shared/logger";
import { timeoutFor } from "../media/extractHelpers";
import type { TranscriptSegment } from "./transcribe";

export const PROMPT_VERSION = "analyze-v2";

export const MOMENT_TYPES = ["scene_change", "main_visual_reveal", "climax", "transition", "text_overlay", "beat_cut"] as const;
const momentTypeSet = new Set<string>(MOMENT_TYPES);

/** Shared VideoAnalysis, tightened: moment types must come from MOMENT_TYPES. */
const StrictVideoAnalysis = VideoAnalysis.extend({
  important_moments: VideoAnalysis.shape.important_moments.refine(
    (ms) => ms.every((m) => momentTypeSet.has(m.type)),
    { message: `important_moments[].type must be one of: ${MOMENT_TYPES.join(", ")}` },
  ),
});
const ModelOutput = z.object({ analysis: StrictVideoAnalysis, brief: MusicBrief });

export type AnalyzeInput = {
  frames: { time: number; base64: string }[];
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  creatorIntent: string | null;
  durationSeconds: number;
};

let singleton: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (!singleton) singleton = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  return singleton;
}

const SYSTEM_PROMPT = `You are Songfit's video analyst. You watch short-form videos (Reels, TikToks, Shorts) and produce a precise, structured understanding of the content plus a music brief that a music supervisor could act on.

Rules:
- You are given sampled frames labelled with their timestamp (t=Ns), a timestamped transcript of any words heard (spoken OR sung), the video duration, and optionally what the creator wants the video to feel like.
- IGNORE any music that may already be in the video. Treat it as silent except for speech. Never mention existing music. Lyrics heard in the transcript belong to that existing music and are NOT dialogue.
- Describe what actually happens: people, setting, actions, visual aesthetic, story, motion, cuts, pacing, energy, emotional arc.
- dialogue_present: true ONLY if a person speaks words meant to be heard by the viewer (talking to camera, voiceover, conversation). Singing, rapping along, or lyrics from background music are NOT dialogue. Use the frames (is someone talking to camera?) together with the transcript to decide. If unsure, prefer false and mention the uncertainty in the brief text.
- important_moments: the moments a song should react to, each with a timestamp in seconds taken from the frame labels. type must be exactly one of: ${MOMENT_TYPES.join(", ")}. Use main_visual_reveal for the single biggest reveal (outfit, before/after, product, location), climax for the emotional or energetic peak, transition for a hard visual transition, beat_cut for a rhythmic cut pattern starting, scene_change for a location/scene change, text_overlay for a text card that carries meaning. Include at most 6. Include at least one if the video has any identifiable peak.
- content_category must be exactly one of: ${CONTENT_CATEGORIES.join(", ")}.
- energy is one of: low, medium, medium-high, high. pacing is one of: slow, medium, fast.
- The music brief combines WHAT THE VIDEO IS with WHAT THE CREATOR WANTS IT TO BECOME. If the creator gave no intent, infer the most likely intended feel from the content and say in the brief text that it was inferred.
- brief.text is 3–6 sentences in plain language, written for a human music supervisor: the feel, the energy, the cultural register (current vs timeless, mainstream vs niche), vocal considerations given any dialogue, and where in the video a musical lift or hit should land (reference timestamps).
- brief.fields: moods (3–6 words), energy 0..1, tempo_preference (slow | medium | medium-high | high), vocal_preference (vocals | instrumental | either — choose instrumental or "either with no vocals over speech" when dialogue_present is true), genre_preferences (may be empty), genre_avoid (may be empty), dialogue_present (same value as analysis.dialogue_present), desired_cultural_relevance (low | medium | high), desired_familiarity (recognizable | recognizable_not_overused | unexpected).

Output exactly ONE JSON object with this shape and nothing else, no prose, no code fences:
{
  "analysis": {
    "summary": string,
    "content_type": string,
    "content_category": string,
    "setting": string | null,
    "story": string | null,
    "aesthetic": string[],
    "mood": string[],
    "energy": "low" | "medium" | "medium-high" | "high",
    "pacing": "slow" | "medium" | "fast",
    "dialogue_present": boolean,
    "important_moments": [{ "time": number, "type": "${MOMENT_TYPES.join('" | "')}", "note"?: string }]
  },
  "brief": {
    "text": string,
    "fields": {
      "moods": string[],
      "energy": number,
      "tempo_preference": "slow" | "medium" | "medium-high" | "high",
      "vocal_preference": "vocals" | "instrumental" | "either",
      "genre_preferences": string[],
      "genre_avoid": string[],
      "dialogue_present": boolean,
      "desired_cultural_relevance": "low" | "medium" | "high",
      "desired_familiarity": "recognizable" | "recognizable_not_overused" | "unexpected"
    }
  }
}`;

type Block = Anthropic.Messages.ContentBlockParam;

function renderTranscript(input: AnalyzeInput): string {
  if (input.transcriptSegments.length > 0) {
    return input.transcriptSegments
      .map((s) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)}] ${s.text}`)
      .join("\n");
  }
  return input.transcript;
}

function buildUserContent(input: AnalyzeInput): Block[] {
  const blocks: Block[] = [];
  blocks.push({
    type: "text",
    text: `Video duration: ${input.durationSeconds.toFixed(1)}s. ${input.frames.length} sampled frames follow, each labelled with its timestamp.`,
  });
  for (const f of input.frames) {
    blocks.push({ type: "text", text: `t=${f.time.toFixed(1)}s` });
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: f.base64 },
    });
  }
  const transcript = renderTranscript(input);
  blocks.push({
    type: "text",
    text: `Words heard (spoken or sung), with [start–end] seconds. Empty means nothing was heard:\n"""${transcript}"""`,
  });
  blocks.push({
    type: "text",
    text: input.creatorIntent && input.creatorIntent.trim().length > 0
      ? `Creator intent — what they want this to feel like: """${input.creatorIntent.trim()}"""`
      : "Creator intent: none given. Infer a likely direction from the content and state in the brief that it was inferred.",
  });
  blocks.push({ type: "text", text: "Now output the single JSON object." });
  return blocks;
}

async function callModel(client: Anthropic, content: Block[], deadlineAt?: number): Promise<string> {
  const res = await client.messages.create(
    {
      model: MODELS.analysis,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    },
    { timeout: timeoutFor(LIMITS.modelTimeoutMs, deadlineAt) },
  );
  if (res.stop_reason === "max_tokens") {
    logger.warn("analysis.truncated", { stop_reason: res.stop_reason });
  }
  return res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function tryParse(raw: string): z.infer<typeof ModelOutput> | { error: string } {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (e) {
    return { error: `not valid JSON: ${(e as Error).message}` };
  }
  const parsed = ModelOutput.safeParse(json);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return parsed.data;
}

export async function analyzeVideo(
  input: AnalyzeInput,
  opts: { client?: Anthropic; deadlineAt?: number } = {},
): Promise<AnalysisResult & { raw: string }> {
  const c = opts.client ?? defaultClient();
  const content = buildUserContent(input);

  const first = await callModel(c, content, opts.deadlineAt);
  let result = tryParse(first);
  let raw = first;

  if ("error" in result) {
    logger.warn("analysis.retry", { error: result.error });
    const retryContent: Block[] = [
      ...content,
      {
        type: "text",
        text: `Your previous output did not match the schema: ${result.error}. Output the corrected single JSON object only.`,
      },
    ];
    raw = await callModel(c, retryContent, opts.deadlineAt);
    result = tryParse(raw);
  }

  if ("error" in result) {
    throw new PipelineError("analyze", `model output invalid: ${result.error}`, raw);
  }

  logger.info("analysis.done", {
    category: result.analysis.content_category,
    moments: result.analysis.important_moments.length,
    dialogue: result.analysis.dialogue_present,
  });
  return {
    analysis: result.analysis,
    brief: result.brief,
    transcript: input.transcript,
    prompt_version: PROMPT_VERSION,
    raw,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/analysis/analyzeVideo.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml src/analysis/analyzeVideo.ts tests/analysis/analyzeVideo.test.ts
git commit -m "Add Claude video analysis producing VideoAnalysis and MusicBrief"
```

---

### Task 2.4: analyzeSubmission orchestration and persistence

**Files:**
- Create: `src/analysis/index.ts`
- Test: `tests/analysis/analyzeSubmission.test.ts`

**Interfaces:**
- Consumes: `getSubmission(id)`, `updateSubmission(id, patch)` from `src/db/queries/submissions.ts`; `upsertAnalysis(row)` from `src/db/queries/analyses.ts`; `downloadToTmp(storagePath)` from `src/media/storage.ts`; `extractMedia`; `transcribe`; `analyzeVideo`; `logEvent`.
- Produces: `export async function analyzeSubmission(submissionId: string, ctx: { deadlineAt: number }, deps?: Partial<AnalyzeDeps>): Promise<void>;`
- Ruling C5/I7: persists `content_category` on BOTH `video_analyses` and `submissions`; `analysis_completed` carries `creatorId`.

Expected db query shapes (Phase 0):

```ts
// src/db/queries/analyses.ts — AnalysisInsert is the generated Insert type; the relevant columns:
export async function upsertAnalysis(row: {
  submission_id: string; summary: string; content_type: string; content_category: string;
  setting: string | null; story: string | null;
  aesthetic: string[]; mood: string[]; energy: string; pacing: string; dialogue_present: boolean;
  transcript: string | null; important_moments: unknown; music_brief: string; music_brief_fields: unknown;
  prompt_version: string; raw_response: unknown;
}): Promise<unknown>;
// src/db/queries/submissions.ts
export async function updateSubmission(id: string, patch: { content_category?: string; duration_seconds?: number; analyzed_at?: string; recommended_at?: string; viewed_at?: string }): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

`tests/analysis/analyzeSubmission.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { analyzeSubmission } from "../../src/analysis/index";

const submission = {
  id: "sub-1",
  creator_id: "cre-1",
  video_path: "cre-1/sub-1.mp4",
  creator_intent: "make it feel luxurious",
  status: "analyzing",
};

const analysisResult = {
  analysis: {
    summary: "s", content_type: "fashion reel", content_category: "fashion", setting: null, story: null,
    aesthetic: ["luxury"], mood: ["confident"], energy: "medium-high", pacing: "medium",
    dialogue_present: false, important_moments: [{ time: 7.8, type: "main_visual_reveal" }],
  },
  brief: {
    text: "brief", fields: {
      moods: ["confident"], energy: 0.7, tempo_preference: "medium-high", vocal_preference: "either",
      genre_preferences: [], genre_avoid: [], dialogue_present: false,
      desired_cultural_relevance: "high", desired_familiarity: "recognizable_not_overused",
    },
  },
  transcript: "",
  prompt_version: "analyze-v2",
  raw: "{}",
};

const ctx = { deadlineAt: 1_000_000 };

function deps() {
  return {
    getSubmission: vi.fn().mockResolvedValue(submission),
    downloadToTmp: vi.fn().mockResolvedValue("/tmp/x/video.mp4"),
    extractMedia: vi.fn().mockResolvedValue({
      durationSeconds: 12.3,
      frames: [{ time: 0, path: "/tmp/x/frame_001.jpg" }],
      audioPath: "/tmp/x/audio.wav",
      workDir: "/tmp/x",
    }),
    readFrame: vi.fn().mockResolvedValue("QUJD"),
    transcribe: vi.fn().mockResolvedValue({ text: "", segments: [] }),
    analyzeVideo: vi.fn().mockResolvedValue(analysisResult),
    upsertAnalysis: vi.fn().mockResolvedValue(undefined),
    updateSubmission: vi.fn().mockResolvedValue(undefined),
    logEvent: vi.fn().mockResolvedValue(undefined),
    removeDir: vi.fn().mockResolvedValue(undefined),
  };
}

describe("analyzeSubmission", () => {
  it("runs the stages in order, threads the deadline, and persists every column", async () => {
    const d = deps();
    await analyzeSubmission("sub-1", ctx, d);

    expect(d.downloadToTmp).toHaveBeenCalledWith("cre-1/sub-1.mp4");
    expect(d.extractMedia).toHaveBeenCalledWith("/tmp/x/video.mp4", { workDir: "/tmp/x", deadlineAt: 1_000_000 });
    expect(d.transcribe).toHaveBeenCalledWith("/tmp/x/audio.wav", { deadlineAt: 1_000_000 });
    expect(d.analyzeVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        frames: [{ time: 0, base64: "QUJD" }],
        transcript: "",
        transcriptSegments: [],
        creatorIntent: "make it feel luxurious",
        durationSeconds: 12.3,
      }),
      { deadlineAt: 1_000_000 },
    );
    expect(d.upsertAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        submission_id: "sub-1",
        summary: "s",
        content_type: "fashion reel",
        content_category: "fashion",
        setting: null,
        story: null,
        aesthetic: ["luxury"],
        mood: ["confident"],
        energy: "medium-high",
        pacing: "medium",
        dialogue_present: false,
        transcript: "",
        important_moments: [{ time: 7.8, type: "main_visual_reveal" }],
        music_brief: "brief",
        music_brief_fields: expect.objectContaining({ energy: 0.7 }),
        prompt_version: "analyze-v2",
        raw_response: "{}",
      }),
    );
    expect(d.updateSubmission).toHaveBeenCalledWith(
      "sub-1",
      expect.objectContaining({ content_category: "fashion", duration_seconds: 12.3, analyzed_at: expect.any(String) }),
    );
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: "analysis_completed", submissionId: "sub-1", creatorId: "cre-1" }),
    );
    expect(d.removeDir).toHaveBeenCalledWith("/tmp/x");
  });

  it("cleans up the work dir even when analysis throws", async () => {
    const d = deps();
    d.analyzeVideo.mockRejectedValue(new Error("boom"));
    await expect(analyzeSubmission("sub-1", ctx, d)).rejects.toThrow("boom");
    expect(d.removeDir).toHaveBeenCalledWith("/tmp/x");
    expect(d.upsertAnalysis).not.toHaveBeenCalled();
  });

  it("throws when the submission does not exist", async () => {
    const d = deps();
    d.getSubmission.mockResolvedValue(null);
    await expect(analyzeSubmission("nope", ctx, d)).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/analysis/analyzeSubmission.test.ts`
Expected: FAIL with `Cannot find module '../../src/analysis/index'`

- [ ] **Step 3: Implement**

`src/analysis/index.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { getSubmission, updateSubmission } from "../db/queries/submissions";
import { upsertAnalysis } from "../db/queries/analyses";
import { downloadToTmp } from "../media/storage";
import { extractMedia } from "../media/extract";
import { transcribe } from "./transcribe";
import { analyzeVideo } from "./analyzeVideo";
import { logEvent } from "../feedback/events";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";

export type AnalyzeDeps = {
  getSubmission: typeof getSubmission;
  downloadToTmp: typeof downloadToTmp;
  extractMedia: typeof extractMedia;
  readFrame: (framePath: string) => Promise<string>;
  transcribe: typeof transcribe;
  analyzeVideo: typeof analyzeVideo;
  upsertAnalysis: typeof upsertAnalysis;
  updateSubmission: typeof updateSubmission;
  logEvent: typeof logEvent;
  removeDir: (dir: string) => Promise<void>;
};

const defaultDeps: AnalyzeDeps = {
  getSubmission,
  downloadToTmp,
  extractMedia,
  readFrame: async (p) => (await fs.readFile(p)).toString("base64"),
  transcribe,
  analyzeVideo,
  upsertAnalysis,
  updateSubmission,
  logEvent,
  removeDir: async (dir) => fs.rm(dir, { recursive: true, force: true }),
};

/**
 * Stage 1 of the pipeline: media → transcript → Claude analysis → video_analyses row.
 * Idempotent (upsert on submission_id). The deadline is threaded into every external call.
 */
export async function analyzeSubmission(
  submissionId: string,
  ctx: { deadlineAt: number },
  overrides: Partial<AnalyzeDeps> = {},
): Promise<void> {
  const d: AnalyzeDeps = { ...defaultDeps, ...overrides };
  const sub = await d.getSubmission(submissionId);
  if (!sub) throw new PipelineError("analyze", `submission not found: ${submissionId}`);

  const videoPath = await d.downloadToTmp(sub.video_path);
  const workDir = path.dirname(videoPath);
  try {
    const media = await d.extractMedia(videoPath, { workDir, deadlineAt: ctx.deadlineAt });
    const frames = await Promise.all(
      media.frames.map(async (f) => ({ time: f.time, base64: await d.readFrame(f.path) })),
    );
    const transcript = await d.transcribe(media.audioPath, { deadlineAt: ctx.deadlineAt });
    const result = await d.analyzeVideo(
      {
        frames,
        transcript: transcript.text,
        transcriptSegments: transcript.segments,
        creatorIntent: sub.creator_intent ?? null,
        durationSeconds: media.durationSeconds,
      },
      { deadlineAt: ctx.deadlineAt },
    );

    await d.upsertAnalysis({
      submission_id: submissionId,
      summary: result.analysis.summary,
      content_type: result.analysis.content_type,
      content_category: result.analysis.content_category,
      setting: result.analysis.setting,
      story: result.analysis.story,
      aesthetic: result.analysis.aesthetic,
      mood: result.analysis.mood,
      energy: result.analysis.energy,
      pacing: result.analysis.pacing,
      dialogue_present: result.analysis.dialogue_present,
      transcript: result.transcript,
      important_moments: result.analysis.important_moments,
      music_brief: result.brief.text,
      music_brief_fields: result.brief.fields,
      prompt_version: result.prompt_version,
      raw_response: result.raw,
    });

    await d.updateSubmission(submissionId, {
      content_category: result.analysis.content_category,
      duration_seconds: media.durationSeconds,
      analyzed_at: new Date().toISOString(),
    });

    await d.logEvent({ name: "analysis_completed", submissionId, creatorId: sub.creator_id });
    logger.info("analysis.persisted", { submissionId });
  } finally {
    await d.removeDir(workDir);
  }
}
```

`downloadToTmp` (Phase 1) places the file inside its own fresh `mkdtemp` directory (`/tmp/songfit-<random>/video.<ext>`), so `path.dirname(videoPath)` is safe to delete.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/analysis/analyzeSubmission.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && pnpm test
git add src/analysis/index.ts tests/analysis/analyzeSubmission.test.ts
git commit -m "Add analyzeSubmission stage with persistence and cleanup"
```

---

### Task 2.5: The single pipeline runner — atomic claim, resume from stored outputs, deadline, failure recording

**Files:**
- Modify: `src/pipeline/run.ts` (replace the Phase 1 stub)
- Create: `src/pipeline/stages.ts`
- Test: `tests/pipeline/stages.test.ts`
- Test: `tests/pipeline/run.test.ts`

**Interfaces:**
- Consumes: `claimSubmissionRun(id)` (Phase 0: atomic conditional update that moves `uploaded | failed`, or an in-flight row whose `updated_at` is older than `LIMITS.inFlightStaleMinutes`, to `analyzing` and returns the row; returns `null` otherwise — this relies on `submissions.updated_at` from migration 0001), `setSubmissionStatus(id, status, error?)`, `getAnalysisRow(submissionId)`, `listRecommendations(submissionId)`, `analyzeSubmission(id, { deadlineAt })`, `logEvent`, `LIMITS.pipelineBudgetMs`.
- Produces:
  ```ts
  // src/pipeline/stages.ts
  export type Stage = "analyze" | "recommend" | "done";
  export function nextStage(hasAnalysis: boolean, hasRecommendations: boolean): Stage;
  // src/pipeline/run.ts
  export type StageCtx = { deadlineAt: number };
  export type RunDeps = {
    claimSubmissionRun: (id: string) => Promise<{ id: string; creator_id: string } | null>;
    getAnalysisRow: (submissionId: string) => Promise<unknown | null>;
    listRecommendations: (submissionId: string) => Promise<unknown[]>;
    setSubmissionStatus: (id: string, status: SubmissionStatus, error?: string | null) => Promise<void>;
    analyze: (id: string, ctx: StageCtx) => Promise<void>;
    recommend: (id: string, ctx: StageCtx) => Promise<void>;
    logEvent: typeof logEvent;
    now: () => number;
  };
  export async function runSubmission(submissionId: string, overrides?: Partial<RunDeps>): Promise<void>;
  ```
- **Contract with Phase 3 (ruling C3 — ONE runner):** this file is the only runner. Phase 3 does not rewrite it. Phase 3 changes exactly two lines: the import of `recommendSubmission` from `src/engine/recommend.ts`, and `defaultDeps.recommend`, which until then is `recommendNotImplemented` (throws `PipelineError("recommend", "not implemented")`). Everything else — claim, stage selection, deadline, failure recording — stays as written here. Admin retry (Task 2.6) and the submit route (Phase 1, via `waitUntil`) both call `runSubmission(id)`; the claim makes concurrent calls safe.
- Behaviour: (a) claim or return; (b) stage from stored outputs, never from the status string; (c) `deadlineAt = started + LIMITS.pipelineBudgetMs`, checked before each stage and threaded into it; (d) on any error: `failed`, `error` = message (internal, admin-only), event `pipeline_failed { stage, error }` with `creatorId`; never throws; (e) the recorded stage is the one that was running.

- [ ] **Step 1: Write the failing test for nextStage**

`tests/pipeline/stages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextStage } from "../../src/pipeline/stages";

describe("nextStage", () => {
  it("no analysis → analyze", () => expect(nextStage(false, false)).toBe("analyze"));
  it("analysis but no recommendations → recommend", () => expect(nextStage(true, false)).toBe("recommend"));
  it("both present → done", () => expect(nextStage(true, true)).toBe("done"));
  it("recommendations without analysis is impossible but still re-analyzes", () =>
    expect(nextStage(false, true)).toBe("analyze"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/pipeline/stages.test.ts`
Expected: FAIL with `Cannot find module '../../src/pipeline/stages'`

- [ ] **Step 3: Implement nextStage**

`src/pipeline/stages.ts`:

```ts
export type Stage = "analyze" | "recommend" | "done";

/**
 * Which stage to run next, derived ONLY from persisted outputs (ruling C3): a row in
 * video_analyses means analyze is done; rows in recommendations mean recommend is done.
 * The status string is never consulted, so a crash between "write output" and
 * "update status" resumes correctly.
 */
export function nextStage(hasAnalysis: boolean, hasRecommendations: boolean): Stage {
  if (!hasAnalysis) return "analyze";
  if (!hasRecommendations) return "recommend";
  return "done";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/pipeline/stages.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing tests for runSubmission**

`tests/pipeline/run.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runSubmission } from "../../src/pipeline/run";
import { PipelineError } from "../../src/shared/errors";

function deps(over: Record<string, unknown> = {}) {
  const state = { hasAnalysis: false, hasRecs: false };
  const d = {
    claimSubmissionRun: vi.fn(async () => ({ id: "sub-1", creator_id: "cre-1" })),
    getAnalysisRow: vi.fn(async () => (state.hasAnalysis ? { id: "an-1" } : null)),
    listRecommendations: vi.fn(async () => (state.hasRecs ? [{ id: "r1" }] : [])),
    setSubmissionStatus: vi.fn(async () => undefined),
    analyze: vi.fn(async () => { state.hasAnalysis = true; }),
    recommend: vi.fn(async () => { state.hasRecs = true; }),
    logEvent: vi.fn(async () => undefined),
    now: () => 0,
    ...over,
  };
  return { d, state };
}

describe("runSubmission", () => {
  it("is a no-op when the claim fails (another run is in flight or the row is ready)", async () => {
    const { d } = deps();
    d.claimSubmissionRun.mockResolvedValue(null);
    await runSubmission("sub-1", d);
    expect(d.analyze).not.toHaveBeenCalled();
    expect(d.recommend).not.toHaveBeenCalled();
    expect(d.setSubmissionStatus).not.toHaveBeenCalled();
  });

  it("runs analyze then recommend, in order, and ends ready", async () => {
    const { d } = deps();
    const order: string[] = [];
    d.analyze.mockImplementation(async () => { order.push("analyze"); });
    d.recommend.mockImplementation(async () => { order.push("recommend"); });
    await runSubmission("sub-1", d);
    expect(order).toEqual(["analyze", "recommend"]);
    const statuses = d.setSubmissionStatus.mock.calls.map((c) => c[1]);
    expect(statuses).toEqual(["analyzing", "recommending", "ready"]);
  });

  it("threads a deadline into every stage", async () => {
    const { d } = deps({ now: () => 1_000 });
    await runSubmission("sub-1", d);
    const ctx = d.analyze.mock.calls[0][1];
    expect(ctx).toEqual({ deadlineAt: expect.any(Number) });
    expect(ctx.deadlineAt).toBeGreaterThan(1_000);
    expect(d.recommend.mock.calls[0][1]).toEqual(ctx);
  });

  it("skips analyze on retry when the analysis row exists", async () => {
    const { d, state } = deps();
    state.hasAnalysis = true;
    await runSubmission("sub-1", d);
    expect(d.analyze).not.toHaveBeenCalled();
    expect(d.recommend).toHaveBeenCalledTimes(1);
    const statuses = d.setSubmissionStatus.mock.calls.map((c) => c[1]);
    expect(statuses).toEqual(["recommending", "ready"]);
  });

  it("marks ready without running anything when both outputs already exist", async () => {
    const { d, state } = deps();
    state.hasAnalysis = true;
    state.hasRecs = true;
    await runSubmission("sub-1", d);
    expect(d.analyze).not.toHaveBeenCalled();
    expect(d.recommend).not.toHaveBeenCalled();
    expect(d.setSubmissionStatus).toHaveBeenCalledTimes(1);
    expect(d.setSubmissionStatus).toHaveBeenCalledWith("sub-1", "ready", null);
  });

  it("records a failure in analyze with stage, error and creatorId, and does not throw", async () => {
    const { d } = deps();
    d.analyze.mockRejectedValue(new PipelineError("analyze", "video too long"));
    await expect(runSubmission("sub-1", d)).resolves.toBeUndefined();
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", "video too long");
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "pipeline_failed",
        submissionId: "sub-1",
        creatorId: "cre-1",
        metadata: { stage: "analyze", error: "video too long" },
      }),
    );
    expect(d.recommend).not.toHaveBeenCalled();
  });

  it("records a failure in recommend as stage recommend, even for a plain Error", async () => {
    const { d } = deps();
    d.recommend.mockRejectedValue(new Error("deezer down"));
    await runSubmission("sub-1", d);
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { stage: "recommend", error: "deezer down" } }),
    );
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", "deezer down");
  });

  it("fails cleanly when the time budget is exhausted before a stage", async () => {
    let t = 0;
    const { d } = deps({ now: () => t });
    d.analyze.mockImplementation(async () => { t = 290_000; });
    await runSubmission("sub-1", d);
    expect(d.recommend).not.toHaveBeenCalled();
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", expect.stringMatching(/budget exceeded before recommend/));
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ stage: "recommend" }) }),
    );
  });

  it("still records failure if setSubmissionStatus itself throws once", async () => {
    const { d } = deps();
    d.analyze.mockRejectedValue(new Error("boom"));
    d.setSubmissionStatus.mockRejectedValueOnce(new Error("db hiccup")); // the 'analyzing' write fails
    await expect(runSubmission("sub-1", d)).resolves.toBeUndefined();
    expect(d.logEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "pipeline_failed" }));
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm vitest run tests/pipeline/run.test.ts`
Expected: FAIL (the Phase 1 stub does not accept deps / does not call these functions)

- [ ] **Step 7: Implement runSubmission**

`src/pipeline/run.ts`:

```ts
import { claimSubmissionRun, setSubmissionStatus } from "../db/queries/submissions";
import { getAnalysisRow } from "../db/queries/analyses";
import { listRecommendations } from "../db/queries/recommendations";
import { analyzeSubmission } from "../analysis";
import { logEvent } from "../feedback/events";
import { LIMITS } from "../shared/config";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";
import { nextStage, type Stage } from "./stages";
import type { SubmissionStatus } from "../shared/types";

export type StageCtx = { deadlineAt: number };

export type RunDeps = {
  claimSubmissionRun: (id: string) => Promise<{ id: string; creator_id: string } | null>;
  getAnalysisRow: (submissionId: string) => Promise<unknown | null>;
  listRecommendations: (submissionId: string) => Promise<unknown[]>;
  setSubmissionStatus: (id: string, status: SubmissionStatus, error?: string | null) => Promise<void>;
  analyze: (id: string, ctx: StageCtx) => Promise<void>;
  recommend: (id: string, ctx: StageCtx) => Promise<void>;
  logEvent: typeof logEvent;
  now: () => number;
};

// Phase 3 replaces ONLY the next line's import and the `recommend:` default below.
async function recommendNotImplemented(_id: string, _ctx: StageCtx): Promise<void> {
  throw new PipelineError("recommend", "not implemented");
}

const defaultDeps: RunDeps = {
  claimSubmissionRun,
  getAnalysisRow,
  listRecommendations,
  setSubmissionStatus,
  analyze: (id, ctx) => analyzeSubmission(id, ctx),
  recommend: recommendNotImplemented,
  logEvent,
  now: () => Date.now(),
};

const STAGE_STATUS: Record<Exclude<Stage, "done">, SubmissionStatus> = {
  analyze: "analyzing",
  recommend: "recommending",
};

/**
 * The one and only pipeline runner. Safe to call from the submit route, the run route
 * and the admin retry action concurrently: the atomic claim admits exactly one run.
 * Resumes from stored outputs. Never throws.
 */
export async function runSubmission(submissionId: string, overrides: Partial<RunDeps> = {}): Promise<void> {
  const d: RunDeps = { ...defaultDeps, ...overrides };

  const claimed = await d.claimSubmissionRun(submissionId);
  if (!claimed) {
    logger.info("run.skipped_in_flight", { submissionId });
    return;
  }

  const started = d.now();
  const ctx: StageCtx = { deadlineAt: started + LIMITS.pipelineBudgetMs };

  let stage: Stage = nextStage(
    (await d.getAnalysisRow(submissionId)) !== null,
    (await d.listRecommendations(submissionId)).length > 0,
  );
  let current: Exclude<Stage, "done"> = stage === "done" ? "recommend" : stage;

  try {
    while (stage !== "done") {
      current = stage;
      if (d.now() >= ctx.deadlineAt) {
        throw new PipelineError(current, `budget exceeded before ${current}`);
      }
      await d.setSubmissionStatus(submissionId, STAGE_STATUS[current], null);
      logger.info("pipeline.stage", { submissionId, stage: current, remainingMs: ctx.deadlineAt - d.now() });

      if (current === "analyze") {
        await d.analyze(submissionId, ctx);
        stage = "recommend";
      } else {
        await d.recommend(submissionId, ctx);
        stage = "done";
      }
    }
    await d.setSubmissionStatus(submissionId, "ready", null);
    logger.info("pipeline.ready", { submissionId, ms: d.now() - started });
  } catch (err) {
    const e = err as Error;
    const failedStage = e instanceof PipelineError ? e.stage : current;
    const message = e.message ?? String(err);
    logger.error("pipeline.failed", { submissionId, stage: failedStage, message });
    try {
      await d.setSubmissionStatus(submissionId, "failed", message);
    } catch (writeErr) {
      logger.error("pipeline.failed_write", { submissionId, error: String(writeErr) });
    }
    try {
      await d.logEvent({
        name: "pipeline_failed",
        submissionId,
        creatorId: claimed.creator_id,
        metadata: { stage: failedStage, error: message },
      });
    } catch (eventErr) {
      logger.error("pipeline.failed_event", { submissionId, error: String(eventErr) });
    }
  }
}
```

Why `current` starts as `"recommend"` when `stage === "done"`: it is never used in that case (the loop doesn't run), but TypeScript needs a value of the narrowed type; `recommend` is the more plausible stage to blame if `setSubmissionStatus("ready")` itself throws.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run tests/pipeline`
Expected: PASS (13 tests)

- [ ] **Step 9: Commit**

```bash
pnpm typecheck && pnpm test
git add src/pipeline/run.ts src/pipeline/stages.ts tests/pipeline
git commit -m "Add single pipeline runner with atomic claim, resume and deadline"
```

---

### Task 2.6: Admin queue and inspector (analysis view)

**Files:**
- Create: `app/admin/layout.tsx`
- Create: `app/admin/page.tsx`
- Create: `app/admin/submissions/[id]/page.tsx`
- Create: `app/admin/submissions/[id]/actions.ts`
- Create: `src/db/queries/admin.ts`
- Test: `tests/db/adminFormat.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()` from `src/auth/session.ts`; `listSubmissions()` (returns `SubmissionWithCreator[]`, with `creator.email`) and `getSubmission(id)` from `src/db/queries/submissions.ts`; `getAnalysisRow(submissionId)` from `src/db/queries/analyses.ts`; `getSignedPlaybackUrl(storagePath)` from `src/media/storage.ts`; `runSubmission` from `src/pipeline/run.ts`.
- Produces:
  ```ts
  // src/db/queries/admin.ts
  export function formatElapsed(fromIso: string | null, toIso: string | null): string; // "1m 12s" | "—"
  export function shortId(id: string): string; // first 8 chars
  // app/admin/submissions/[id]/actions.ts
  export async function retrySubmission(formData: FormData): Promise<void>; // server action; FormData carries `id`
  ```
- Ruling M3: `requireAdmin()` is called in the layout AND in every admin page AND in the server action. The layout gate is UX; the per-page/per-action gates are the security boundary (layouts can be bypassed by direct server-action calls and by certain routing modes).
- Raw pipeline errors (`submissions.error`) are shown here only, never to creators.

- [ ] **Step 1: Write the failing test for the formatting helpers**

`tests/db/adminFormat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatElapsed, shortId } from "../../src/db/queries/admin";

describe("formatElapsed", () => {
  it("formats minutes and seconds", () => {
    expect(formatElapsed("2026-10-06T10:00:00Z", "2026-10-06T10:01:12Z")).toBe("1m 12s");
  });
  it("formats seconds only under a minute", () => {
    expect(formatElapsed("2026-10-06T10:00:00Z", "2026-10-06T10:00:42Z")).toBe("42s");
  });
  it("returns a dash when either side is missing", () => {
    expect(formatElapsed(null, "2026-10-06T10:00:42Z")).toBe("—");
    expect(formatElapsed("2026-10-06T10:00:00Z", null)).toBe("—");
  });
});

describe("shortId", () => {
  it("returns the first 8 characters", () => {
    expect(shortId("0f4a1c9e-1234-5678-9abc-def012345678")).toBe("0f4a1c9e");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/db/adminFormat.test.ts`
Expected: FAIL with `Cannot find module '../../src/db/queries/admin'`

- [ ] **Step 3: Implement helpers**

`src/db/queries/admin.ts`:

```ts
export function formatElapsed(fromIso: string | null, toIso: string | null): string {
  if (!fromIso || !toIso) return "—";
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/db/adminFormat.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Admin layout with the email gate**

`app/admin/layout.tsx`:

```tsx
import Link from "next/link";
import { requireAdmin } from "@/src/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <header className="flex items-center gap-6 border-b px-6 py-3 text-sm">
        <Link href="/admin" className="font-semibold">Songfit admin</Link>
        <Link href="/admin/metrics">Metrics</Link>
        <span className="ml-auto text-neutral-500">{admin.email}</span>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
```

(`/admin/metrics` is built in Phase 4; the link 404s until then.)

- [ ] **Step 6: Queue page**

`app/admin/page.tsx`:

```tsx
import Link from "next/link";
import { requireAdmin } from "@/src/auth/session";
import { listSubmissions } from "@/src/db/queries/submissions";
import { formatElapsed, shortId } from "@/src/db/queries/admin";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage() {
  await requireAdmin(); // ruling M3: every admin page gates itself, not just the layout
  const rows = await listSubmissions();
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Submissions ({rows.length})</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-2 pr-4">ID</th>
              <th className="py-2 pr-4">Creator</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Category</th>
              <th className="py-2 pr-4">Created</th>
              <th className="py-2 pr-4">Upload → analyzed</th>
              <th className="py-2 pr-4">Upload → ready</th>
              <th className="py-2 pr-4">Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="py-2 pr-4 font-mono">
                  <Link className="underline" href={`/admin/submissions/${r.id}`}>{shortId(r.id)}</Link>
                </td>
                <td className="py-2 pr-4">{r.creator?.email ?? "—"}</td>
                <td className="py-2 pr-4">{r.status}</td>
                <td className="py-2 pr-4">{r.content_category ?? "—"}</td>
                <td className="py-2 pr-4">{new Date(r.created_at).toLocaleString()}</td>
                <td className="py-2 pr-4">{formatElapsed(r.created_at, r.analyzed_at)}</td>
                <td className="py-2 pr-4">{formatElapsed(r.created_at, r.recommended_at)}</td>
                <td className="max-w-xs truncate py-2 pr-4 text-red-700">{r.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Retry server action**

`app/admin/submissions/[id]/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/auth/session";
import { runSubmission } from "@/src/pipeline/run";

/**
 * Admin retry. Goes through the same claimed runner as the submit route (ruling C3), so a
 * retry while a run is still in flight is a safe no-op, and a stale in-flight row
 * (updated_at older than LIMITS.inFlightStaleMinutes) can be reclaimed.
 */
export async function retrySubmission(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("missing submission id");
  await runSubmission(id);
  revalidatePath(`/admin/submissions/${id}`);
  revalidatePath("/admin");
}
```

- [ ] **Step 8: Inspector page**

`app/admin/submissions/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireAdmin } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { getAnalysisRow } from "@/src/db/queries/analyses";
import { getSignedPlaybackUrl } from "@/src/media/storage";
import { retrySubmission } from "./actions";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 border-t py-1">
      <dt className="text-neutral-500">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default async function SubmissionInspectorPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(); // ruling M3
  const { id } = await params;
  const sub = await getSubmission(id);
  if (!sub) notFound();
  const analysis = await getAnalysisRow(id);
  const videoUrl = await getSignedPlaybackUrl(sub.video_path);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold">Submission {id.slice(0, 8)}</h1>
        <span className="rounded bg-neutral-100 px-2 py-1 text-sm">{sub.status}</span>
        <form action={retrySubmission}>
          <input type="hidden" name="id" value={id} />
          <button className="rounded border px-3 py-1 text-sm" type="submit">Retry pipeline</button>
        </form>
      </div>

      {/* Raw pipeline error: admin-only. Creators see a generic failed state (Phase 4). */}
      {sub.error && <p className="rounded bg-red-50 p-3 text-sm text-red-800">Error: {sub.error}</p>}

      <section className="grid gap-6 md:grid-cols-[320px_1fr]">
        <video controls playsInline className="w-full rounded bg-black" src={videoUrl} />
        <dl className="text-sm">
          <Row label="Creator intent" value={sub.creator_intent ?? "—"} />
          <Row label="Duration" value={sub.duration_seconds ? `${sub.duration_seconds.toFixed(1)}s` : "—"} />
          <Row label="Category" value={sub.content_category ?? "—"} />
          <Row label="Created" value={new Date(sub.created_at).toLocaleString()} />
          <Row label="Updated" value={new Date(sub.updated_at).toLocaleString()} />
          <Row label="Analyzed" value={sub.analyzed_at ? new Date(sub.analyzed_at).toLocaleString() : "—"} />
          <Row label="Recommended" value={sub.recommended_at ? new Date(sub.recommended_at).toLocaleString() : "—"} />
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Analysis</h2>
        {!analysis ? (
          <p className="text-sm text-neutral-500">No analysis yet.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <dl>
              <Row label="Summary" value={analysis.summary} />
              <Row label="Content type" value={analysis.content_type} />
              <Row label="Category" value={analysis.content_category} />
              <Row label="Setting" value={analysis.setting ?? "—"} />
              <Row label="Story" value={analysis.story ?? "—"} />
              <Row label="Aesthetic" value={analysis.aesthetic.join(", ")} />
              <Row label="Mood" value={analysis.mood.join(", ")} />
              <Row label="Energy / pacing" value={`${analysis.energy} / ${analysis.pacing}`} />
              <Row label="Spoken dialogue" value={analysis.dialogue_present ? "yes" : "no"} />
              <Row label="Prompt version" value={analysis.prompt_version} />
            </dl>
            <div>
              <h3 className="font-medium">Important moments</h3>
              <pre className="overflow-x-auto rounded bg-neutral-50 p-3">{JSON.stringify(analysis.important_moments, null, 2)}</pre>
            </div>
            <div>
              <h3 className="font-medium">Music brief</h3>
              <p className="whitespace-pre-wrap rounded bg-neutral-50 p-3">{analysis.music_brief}</p>
              <pre className="mt-2 overflow-x-auto rounded bg-neutral-50 p-3">{JSON.stringify(analysis.music_brief_fields, null, 2)}</pre>
            </div>
            <div>
              <h3 className="font-medium">Transcript (words heard, spoken or sung)</h3>
              <p className="whitespace-pre-wrap rounded bg-neutral-50 p-3">{analysis.transcript || "(nothing heard)"}</p>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Candidates (Phase 3)</h2>
      </section>
    </div>
  );
}
```

`getAnalysisRow` returns the generated Row type: `aesthetic` and `mood` are `string[]`, `important_moments` and `music_brief_fields` are `Json` (Supabase returns jsonb as objects already). If the generated type widens any of these to `unknown`, cast at the query boundary in `src/db/queries/analyses.ts`, not in the page.

- [ ] **Step 9: Typecheck, run dev, and check the pages**

```bash
pnpm typecheck && pnpm test && pnpm dev
```

Open `http://localhost:3000/admin` signed in as the `ADMIN_EMAILS` account. Expected: the table lists submissions. Open a submission: the video plays, "No analysis yet." shows until the pipeline has run. Signed in as a non-admin: redirected per `requireAdmin()`. Call the retry action from a non-admin session (e.g. curl the server action id): rejected by `requireAdmin()` inside the action, not only by the layout.

- [ ] **Step 10: Commit**

```bash
git add app/admin src/db/queries/admin.ts tests/db/adminFormat.test.ts
git commit -m "Add admin queue and submission inspector with analysis view"
```

---

### Task 2.7: Deployed media test from an iPhone (ruling C7)

**Files:**
- Modify: `next.config.ts` (only if the deployed run fails on ffmpeg — see Step 4)
- Modify: `docs/RESEARCH.md` (append measured elapsed time and cost)

**Interfaces:**
- Consumes: the Vercel project linked in Phase 1 (Task 1.7, deployed phone upload test), the Phase 1 submit route calling `runSubmission` via `waitUntil`, `/admin/submissions/[id]`.
- Produces: proof that `ffmpeg-static` + `ffprobe-static` execute inside a Vercel Node function on a real iPhone HEVC `.mov`, and a measured per-run cost.

This is the release gate for Phase 2. It moves the riskiest deployment unknowns — binary execution, function size, HEVC decode, 60-frame payload to the model — ahead of all admin polish.

- [ ] **Step 1: Push and deploy**

```bash
git push origin mvp
```

Expected: Vercel builds the `mvp` branch preview (or production, per Phase 1's project setup) and the build log shows no warnings about `ffmpeg-static` or `ffprobe-static` being bundled/externalised incorrectly. Note the deployment URL.

- [ ] **Step 2: Upload a real iPhone clip over cellular**

On an iPhone, Wi-Fi OFF, open the deployment URL, sign in with Google, pick a 45–60 s `.mov` shot with the iPhone camera (default HEVC), submit.

Expected: the waiting page appears; within ~90 s `/admin` (on a laptop) shows the row at `recommending`, then `failed` with error `not implemented` (the Phase 3 stub) — that failure is expected and proves the runner reached the recommend stage after a successful analyze on Vercel.

- [ ] **Step 3: Inspect**

Open the inspector. Check every box:

- [ ] The video plays (signed URL works on the deployed project).
- [ ] `Duration` is populated and within ±1 s of the clip length (ffprobe ran).
- [ ] `Analysis` shows a summary that matches the clip; `Category` is one of `CONTENT_CATEGORIES`; `Spoken dialogue` is correct for what you filmed (talk to camera for a few seconds in the clip so this is testable).
- [ ] `important_moments` has at least one entry with a `type` from `MOMENT_TYPES` and a timestamp that matches a real moment in the clip.
- [ ] `Transcript` contains the words you spoke.
- [ ] Vercel function logs (Vercel dashboard → Logs, filter by the submit route) show `media.extracted` with `frames` between 45 and 60 and `audio: true`, then `analysis.done`.

- [ ] **Step 4: If the function fails on ffmpeg, fix the deployment config (one checkbox per cause)**

Read the Vercel function log for the `pipeline.failed` line. Match the message:

- [ ] `ffmpeg binary not found` / `ENOENT`: the binary was not traced into the function bundle. In `next.config.ts` ensure BOTH of these are present (keep any existing `images.remotePatterns` from Phase 0):
  ```ts
  // next.config.ts
  import type { NextConfig } from "next";

  const nextConfig: NextConfig = {
    serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
    outputFileTracingIncludes: {
      "/api/submissions/**": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/**"],
      "/admin/**": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/**"],
    },
    // Phase 0's remotePatterns stay here.
  };
  export default nextConfig;
  ```
  Then `git commit -am "Trace ffmpeg binaries into Vercel functions"` and redeploy.
- [ ] `EACCES` (permission denied): the traced binary lost its executable bit. Add `"postinstall": "chmod +x node_modules/ffmpeg-static/ffmpeg node_modules/ffprobe-static/bin/*/*/ffprobe || true"` to `package.json` scripts, commit, redeploy.
- [ ] `Serverless Function has exceeded the unzipped maximum size` (250 MB): remove the `ffprobe-static` dependency and use `ffmpeg -i <file>` stderr parsing for duration instead — only do this if the size error actually occurs; it has not in similar projects at 60 frames/512 px.
- [ ] `ffmpeg timeout: ffmpeg frames`: the Vercel Node runtime is older/slower than expected. Confirm Project → Settings → General → Node.js Version is 20.x (not 18), redeploy. If it persists on a 60 s clip, halve `LIMITS.frameWidth` to 384 and note it in the ledger.
- [ ] Function timed out before `pipeline.failed` was written (row stuck at `analyzing`): the submit route lacks `export const maxDuration = 300;` or Fluid Compute is off (Project → Settings → Functions). Fix per Phase 1 Task 1.3 and the C7 ruling; a stuck row is reclaimable via admin Retry after `LIMITS.inFlightStaleMinutes`.

Re-run Step 2 after each fix until every Step 3 box is checked.

- [ ] **Step 5: Record measurements**

From the Vercel log line `pipeline.failed` (or `pipeline.ready` once Phase 3 lands) read the elapsed ms. From console.anthropic.com → Usage read the cost of the analysis call (expect roughly $0.05–0.15 for 60 frames at 512 px on Fable); from platform.openai.com → Usage read the Whisper cost (under $0.01 for 60 s). Append to `docs/RESEARCH.md`:

```markdown
## 2026-10-07 — First deployed analysis run (Phase 2, Task 2.7)
- Device/clip: iPhone <model>, <N> s .mov HEVC, cellular upload.
- Upload → analyzed: <X> s. Frames: <N>. Transcript chars: <N>.
- Cost: Anthropic analysis $<x.xx> (model <MODELS.analysis>), Whisper $<x.xx>.
- Deployment fixes needed: <none | list from Step 4>.
```

- [ ] **Step 6: Commit**

```bash
git add docs/RESEARCH.md next.config.ts package.json
git commit -m "Record first deployed analysis run and any deployment fixes"
git push origin mvp
```

---

### Phase 2 demo check

1. Task 2.7 completed with every Step 3 box checked on the deployed app from an iPhone over cellular.
2. Locally: `pnpm typecheck && pnpm test && pnpm build` all pass; the media integration suite ran (no SKIPPED warning).
3. In `/admin`, click "Retry pipeline" on the `failed` row. Expected: `analyze` is skipped (status jumps to `recommending`, then `failed` with `not implemented` again) — confirms resume-from-stored-outputs. Click Retry twice quickly: the second click is a no-op (`run.skipped_in_flight` in the logs) — confirms the atomic claim.
4. Measurements written to `docs/RESEARCH.md`.
## Phase 3 — Engine → results

**Demo when done:** upload a real video → about 90 s later the results page shows 3 real songs with sections and reasons; the admin inspector shows ~60 scored candidates. Previews are hidden unless `PREVIEWS_ENABLED` is flipped (ruling C8).

Tasks are ordered by dependency: normalisation first (everything matches on it), then candidates, catalog, scoring, diversify, sections, explain, the orchestrator, and finally UI.

This phase was rewritten after the Codex review (`docs/review/02-codex-review.md`, rulings in `docs/review/03-claude-rulings.md`): C1, C3, C5, C6, I1, I3, I4, I5, I7, I8, I9, I10, M1 apply here.

Conventions for every task in this phase:
- Imports use the `@/` alias (`@/src/shared/types`), which Next.js maps to the repo root.
- Model calls go through `callClaude` from `src/shared/anthropic.ts` (Phase 0, Task 0.2):
  ```ts
  export type ClaudeCall = (args: { model: string; system: string; user: string; maxTokens?: number; timeoutMs?: number }) => Promise<string>;
  export const callClaude: ClaudeCall;
  ```
  `callClaude` itself logs `model.call` with model, latency, input/output tokens and stop reason (Phase 2.3b owns that). Stages log their own `{ stage, ms, chars }` line. Each model-backed stage takes an optional `deps` argument so tests inject a stub instead of mocking modules.
- `extractJson(text: string): unknown` from `src/shared/json.ts` (Phase 2, Task 2.3) strips fences, finds the first `{` or `[`, `JSON.parse`s, and throws with the raw text attached. Stages call `extractJson` then Zod. **No per-item dropping, no fabricated defaults**: a response that fails validation is retried once with the Zod error appended to the user prompt, then the stage fails with `PipelineError(stage, message, raw)` (ruling C1).
- `PipelineError` from `src/shared/errors.ts` (Phase 0): `new PipelineError(stage: string, message: string, raw?: string)`.
- Generated DB types: `CandidateInsert` / `CandidateRow` from `src/db/queries/candidates.ts`, `RecommendationInsert` / `RecommendationRow` from `src/db/queries/recommendations.ts` (Phase 0, Task 0.4; aliases of `Database["public"]["Tables"][…]["Insert" | "Row"]`).
- `p-limit` is a dependency (Phase 0, Task 0.1).
- Tests live in `tests/` mirroring `src/`, run with `pnpm test -- <path>`. Shared fixtures `analysis` and `brief` are exported from `tests/engine/fixtures.ts` (created in Task 3.2).

---

### Task 3.1: Title and artist normalisation (conservative matching)

**Files:**
- Create: `src/engine/catalog/normalize.ts`
- Test: `tests/engine/catalog/normalize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export function normalizeTitle(s: string): string;       // folded, featuring stripped, version words kept
  export function versionTags(title: string): Set<string>; // {"live","remix","acoustic","sped up","slowed","instrumental","karaoke","cover","demo","radio edit","remaster","extended","version"}
  export function normalizeArtist(s: string): string;      // primary artist, featuring stripped; never split on "and"/"&"
  export function normalizeKey(title: string, artist: string): string; // `${normalizeTitle}|${normalizeArtist}` (version words removed from title part)
  export function titlesMatch(a: string, b: string): boolean;  // EQUALITY after removing version words, AND same version tags (ignoring remaster/radio edit)
  export function artistsMatch(a: string, b: string): boolean;
  ```

Ruling I3: no prefix matching, versions must agree, "and"/"&" are part of band names, diacritics are folded for comparison only (never ASCII-stripped away: non-Latin scripts survive).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/catalog/normalize.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeTitle, normalizeArtist, normalizeKey, titlesMatch, artistsMatch, versionTags,
} from "@/src/engine/catalog/normalize";

describe("normalizeTitle", () => {
  it("lowercases, folds diacritics and collapses punctuation", () => {
    expect(normalizeTitle("Don't Stop Me Now!")).toBe("don t stop me now");
    expect(normalizeTitle("Señorita")).toBe("senorita");
  });
  it("strips featuring clauses only", () => {
    expect(normalizeTitle("Industry Baby (feat. Jack Harlow)")).toBe("industry baby");
    expect(normalizeTitle("Industry Baby feat. Jack Harlow")).toBe("industry baby");
  });
  it("keeps version words", () => {
    expect(normalizeTitle("Stay (Sped Up)")).toBe("stay sped up");
    expect(normalizeTitle("Blinding Lights - Remastered")).toBe("blinding lights remastered");
  });
  it("keeps non-Latin scripts", () => {
    expect(normalizeTitle("夜に駆ける")).toBe("夜に駆ける");
  });
});

describe("versionTags", () => {
  it("extracts tags from anywhere in the title", () => {
    expect([...versionTags("Stay (Sped Up)")]).toEqual(["sped up"]);
    expect([...versionTags("Blinding Lights - Live at the O2")]).toEqual(["live"]);
    expect([...versionTags("Blinding Lights")]).toEqual([]);
  });
});

describe("normalizeArtist", () => {
  it("keeps the primary artist and strips featuring", () => {
    expect(normalizeArtist("Drake feat. Rihanna")).toBe("drake");
    expect(normalizeArtist("Jawsh 685 featuring Jason Derulo")).toBe("jawsh 685");
  });
  it("never splits on and / & / x / commas", () => {
    expect(normalizeArtist("Florence + The Machine")).toBe("florence the machine");
    expect(normalizeArtist("Simon & Garfunkel")).toBe("simon garfunkel");
    expect(normalizeArtist("Of Monsters and Men")).toBe("of monsters and men");
  });
  it("folds diacritics and keeps non-Latin names", () => {
    expect(normalizeArtist("Beyoncé")).toBe("beyonce");
    expect(normalizeArtist("YOASOBI")).toBe("yoasobi");
    expect(normalizeArtist("宇多田ヒカル")).toBe("宇多田ヒカル");
  });
});

describe("matching (10 fixtures)", () => {
  const cases: [string, string, boolean][] = [
    ["Blinding Lights", "Blinding Lights - Remastered", true],
    ["Blinding Lights", "Blinding Lights (Radio Edit)", true],
    ["Stay", "Stay With Me", false],
    ["Stay (Sped Up)", "Stay", false],
    ["Stay", "Stay (Live)", false],
    ["Blinding Lights", "Save Your Tears", false],
    ["Industry Baby", "Industry Baby (feat. Jack Harlow)", true],
    ["Running Up That Hill", "Running Up That Hill (A Deal With God)", false],
    ["夜に駆ける", "夜に駆ける", true],
    ["", "", false],
  ];
  it.each(cases)("titlesMatch(%s, %s) = %s", (a, b, expected) => {
    expect(titlesMatch(a, b)).toBe(expected);
  });
  it("artistsMatch compares primary artists", () => {
    expect(artistsMatch("Beyoncé", "Beyonce")).toBe(true);
    expect(artistsMatch("Drake feat. Rihanna", "Drake")).toBe(true);
    expect(artistsMatch("Drake", "Rihanna")).toBe(false);
    expect(artistsMatch("Florence + The Machine", "Florence + the Machine")).toBe(true);
    expect(artistsMatch("宇多田ヒカル", "宇多田ヒカル")).toBe(true);
  });
  it("normalizeKey drops version words so dedupe treats edits as one song", () => {
    expect(normalizeKey("Blinding Lights - Remastered", "The Weeknd")).toBe("blinding lights|the weeknd");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/catalog/normalize.test.ts`
Expected: FAIL, "Cannot find module '@/src/engine/catalog/normalize'".

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/normalize.ts
// Conservative string matching (ruling I3). Both sides of every comparison go through the same
// functions. We fold case/diacritics and punctuation, strip featuring credits, and keep version
// words so "Stay (Sped Up)" never matches "Stay".

const VERSION_WORDS = [
  "sped up", "radio edit", "live", "remix", "acoustic", "slowed", "instrumental",
  "karaoke", "cover", "demo", "remastered", "remaster", "extended", "version",
] as const;
const SAME_RECORDING = new Set(["remaster", "radio edit"]); // same take, different master/cut

const FEAT_PAREN_RE = /\s*[(\[][^)\]]*\b(?:feat\.?|ft\.?|featuring|with)\b[^)\]]*[)\]]/gi;
const FEAT_TAIL_RE = /\s+\b(?:feat\.?|ft\.?|featuring)\b\s+.*$/i;

/** Lowercase, fold combining marks, keep letters/digits of any script, collapse the rest to spaces. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizeTitle(s: string): string {
  return fold(s.replace(FEAT_PAREN_RE, "").replace(FEAT_TAIL_RE, ""));
}

export function versionTags(title: string): Set<string> {
  const t = fold(title);
  const tags = new Set<string>();
  for (const w of VERSION_WORDS) {
    if (new RegExp(`(^|\\s)${w}(\\s|$)`).test(t)) tags.add(w === "remastered" ? "remaster" : w);
  }
  return tags;
}

function stripVersionWords(normalized: string): string {
  let out = normalized;
  for (const w of VERSION_WORDS) out = out.replace(new RegExp(`(^|\\s)${w}(?=\\s|$)`, "g"), " ");
  return out.replace(/\s+/g, " ").trim();
}

export function normalizeArtist(s: string): string {
  return fold(s.replace(FEAT_PAREN_RE, "").replace(FEAT_TAIL_RE, ""));
}

export function normalizeKey(title: string, artist: string): string {
  return `${stripVersionWords(normalizeTitle(title))}|${normalizeArtist(artist)}`;
}

function comparableTags(title: string): Set<string> {
  const tags = versionTags(title);
  for (const t of SAME_RECORDING) tags.delete(t);
  return tags;
}

export function titlesMatch(a: string, b: string): boolean {
  const na = stripVersionWords(normalizeTitle(a));
  const nb = stripVersionWords(normalizeTitle(b));
  if (!na || !nb || na !== nb) return false;
  const ta = comparableTags(a);
  const tb = comparableTags(b);
  if (ta.size !== tb.size) return false;
  for (const t of ta) if (!tb.has(t)) return false;
  return true;
}

export function artistsMatch(a: string, b: string): boolean {
  const na = normalizeArtist(a);
  const nb = normalizeArtist(b);
  return !!na && !!nb && na === nb;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/catalog/normalize.test.ts`
Expected: PASS, 21 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/normalize.ts tests/engine/catalog/normalize.test.ts
git commit -m "Add conservative title and artist normalisation for song matching"
```

---

### Task 3.2: Candidate generation (three directions, merged memberships)

**Files:**
- Create: `tests/engine/fixtures.ts`, `src/engine/candidates/generateCandidates.ts`
- Test: `tests/engine/candidates/generateCandidates.test.ts`

**Interfaces:**
- Consumes: `MusicBrief`, `VideoAnalysis`, `GeneratedCandidate`, `DirectionTag` from `@/src/shared/types`; `MODELS`, `LIMITS` from `@/src/shared/config`; `callClaude`, `ClaudeCall`; `extractJson`; `normalizeKey` (Task 3.1).
- Produces:
  ```ts
  export const PROMPT_VERSION = "candidates-v2";
  export type GenerateOpts = { note?: string; exclude?: string[]; call?: ClaudeCall };
  export function buildCandidatePrompt(direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis, opts?: { note?: string; exclude?: string[] }): string;
  export function parseCandidateList(text: string, direction: DirectionTag): { ok: true; items: GeneratedCandidate[] } | { ok: false; error: string };
  export function mergeCandidates(lists: GeneratedCandidate[][]): GeneratedCandidate[]; // dedupe by normalizeKey, union of directions
  export async function generateCandidates(brief: MusicBrief, analysis: VideoAnalysis, opts?: GenerateOpts): Promise<GeneratedCandidate[]>;
  ```

Rulings: C1 (whole-list validation, one retry, then fail), I4 (`exclude` for regeneration), I9 (`directions` keeps every membership; `anchor_seconds` and `section_is_vocal` are explicit fields).

- [ ] **Step 1: Write the shared fixtures**

```ts
// tests/engine/fixtures.ts
import type { MusicBrief, VideoAnalysis, GeneratedCandidate, VerifiedCandidate, ScoredCandidate, Pick } from "@/src/shared/types";

export const analysis: VideoAnalysis = {
  summary: "Creator walks through NYC at night and reveals an outfit.",
  content_type: "fashion lifestyle reel", content_category: "fashion",
  setting: "New York at night", story: "walk then reveal",
  aesthetic: ["luxury", "urban"], mood: ["confident", "mysterious"],
  energy: "medium-high", pacing: "medium", dialogue_present: false,
  important_moments: [{ time: 7.8, type: "main_visual_reveal", note: "outfit reveal" }],
};

export const brief: MusicBrief = {
  text: "Modern NYC fashion montage. Confident and slightly mysterious. Needs a lift around 8 s.",
  fields: {
    moods: ["confident", "cool"], energy: 0.72, tempo_preference: "medium-high",
    vocal_preference: "either", genre_preferences: [], genre_avoid: [],
    dialogue_present: false, desired_cultural_relevance: "high",
    desired_familiarity: "recognizable_not_overused",
  },
};

export const gen = (over: Partial<GeneratedCandidate> = {}): GeneratedCandidate => ({
  title: "Blinding Lights", artist: "The Weeknd", proposed_start: 43, proposed_end: 58,
  anchor_seconds: 45, section_is_vocal: true, section_reason: "chorus entry",
  fit_reason: "fits the night drive", directions: ["safe"], ...over,
});

export const ver = (over: Partial<VerifiedCandidate> = {}): VerifiedCandidate => ({
  ...gen(), deezer_id: "1", canonical_title: "Blinding Lights", canonical_artist: "The Weeknd",
  duration_seconds: 200, artwork_url: null, deezer_url: "https://www.deezer.com/track/1", preview_url: null, ...over,
});

const one = { score: 0.7, reason: "r" };
export const scored = (over: Partial<ScoredCandidate> = {}): ScoredCandidate => ({
  ...ver(), total_score: 0.7,
  component_scores: { semantic: one, emotional: one, aesthetic: one, pacing: one, dialogue: one, cultural: one, originality: one },
  ...over,
});

export const pick = (over: Partial<Pick> = {}): Pick => ({
  ...scored(), rank: 1, direction_label: "Best fit", start_seconds: 43, end_seconds: 58, aligned_to_moment: null, ...over,
});
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/engine/candidates/generateCandidates.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  mergeCandidates, parseCandidateList, generateCandidates, buildCandidatePrompt,
} from "@/src/engine/candidates/generateCandidates";
import { analysis, brief, gen } from "../fixtures";

const item = (title: string, artist = "X") => ({
  title, artist, proposed_start: 10, proposed_end: 25, anchor_seconds: 12, section_is_vocal: true,
  section_reason: "s", fit_reason: "f",
});

describe("mergeCandidates", () => {
  it("dedupes by normalised key and unions directions in first-seen order", () => {
    const out = mergeCandidates([
      [gen({ title: "Blinding Lights", directions: ["safe"] })],
      [gen({ title: "blinding lights - remastered", directions: ["current"] }), gen({ title: "Save Your Tears", directions: ["current"] })],
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.directions).toEqual(["safe", "current"]);
    expect(out[0]!.title).toBe("Blinding Lights");
    expect(out[1]!.directions).toEqual(["current"]);
  });
});

describe("parseCandidateList", () => {
  it("accepts a fenced array and stamps the direction", () => {
    const r = parseCandidateList("```json\n" + JSON.stringify([item("A")]) + "\n```", "unexpected");
    expect(r.ok && r.items[0]!.directions).toEqual(["unexpected"]);
  });
  it("rejects the whole list when any item is malformed", () => {
    const r = parseCandidateList(JSON.stringify([item("A"), { title: "Bad", artist: "C" }]), "safe");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/proposed_start|anchor_seconds|section_is_vocal/);
  });
  it("rejects prose", () => {
    expect(parseCandidateList("sorry, no", "safe").ok).toBe(false);
  });
});

describe("generateCandidates", () => {
  it("makes three calls and merges results", async () => {
    const call = vi.fn(async ({ user }: { user: string }) => {
      const dir = user.includes("DIRECTION: safe") ? "safe" : user.includes("DIRECTION: current") ? "current" : "unexpected";
      return JSON.stringify([item(`${dir} song`), item("Shared Song", "Y")]);
    });
    const out = await generateCandidates(brief, analysis, { call });
    expect(call).toHaveBeenCalledTimes(3);
    expect(out.map((c) => c.title).sort()).toEqual(["Shared Song", "current song", "safe song", "unexpected song"]);
    expect(out.find((c) => c.title === "Shared Song")!.directions).toEqual(["safe", "current", "unexpected"]);
  });
  it("retries a direction once with the validation error, then fails", async () => {
    const call = vi.fn(async ({ user }: { user: string }) =>
      user.includes("DIRECTION: safe") ? JSON.stringify([{ title: "Bad" }]) : JSON.stringify([item("ok")]));
    await expect(generateCandidates(brief, analysis, { call })).rejects.toThrow(/candidate output invalid/);
    const safeCalls = call.mock.calls.filter((c) => (c[0] as { user: string }).user.includes("DIRECTION: safe"));
    expect(safeCalls).toHaveLength(2);
    expect((safeCalls[1]![0] as { user: string }).user).toMatch(/PREVIOUS OUTPUT WAS INVALID/);
  });
  it("includes the note and the exclusion list when given", () => {
    const p = buildCandidatePrompt("safe", brief, analysis, { note: "avoid previous list", exclude: ["stay|the kid laroi"] });
    expect(p).toContain("avoid previous list");
    expect(p).toContain("stay|the kid laroi");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/candidates/generateCandidates.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write the implementation**

```ts
// src/engine/candidates/generateCandidates.ts
import { z } from "zod";
import {
  GeneratedCandidate, DirectionTag, type MusicBrief, type VideoAnalysis,
} from "@/src/shared/types";
import { MODELS, LIMITS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { normalizeKey } from "@/src/engine/catalog/normalize";

export const PROMPT_VERSION = "candidates-v2";

export type GenerateOpts = { note?: string; exclude?: string[]; call?: ClaudeCall };

const SYSTEM = `You are Songfit's music supervisor for short-form video (Instagram Reels, TikTok).
You know mainstream, independent and viral music across decades, and you know which songs
creators actually use on these platforms. You only ever name REAL, officially released songs by
the original artist that are very likely available in the Instagram and TikTok music libraries
in the United States. Never invent songs. Never suggest AI-generated music, unreleased tracks,
remixes by unknown accounts, or production-library stock music. Name the original studio
recording, not a live, sped-up, slowed, acoustic or remix version.`;

const DIRECTION_BRIEF: Record<DirectionTag, string> = {
  safe: "Recognisable, proven fits for this kind of content: songs a creator in this niche has seen work many times. Mainstream enough to be in both libraries.",
  current: "Songs you believe have been popular on Instagram Reels and TikTok within the last 12 months, or trending-adjacent artists having a moment. Still real, released and easy to find. You are not told what is trending today; use your best knowledge.",
  unexpected: "Less obvious: older songs, niche genres, deep cuts from known artists, genre-crossing picks that a tasteful editor would reach for. Must still be real, released and findable in the libraries.",
};

export function buildCandidatePrompt(
  direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis,
  opts: { note?: string; exclude?: string[] } = {},
): string {
  const moments = analysis.important_moments
    .map((m) => `- ${m.time.toFixed(1)}s: ${m.type}${m.note ? ` (${m.note})` : ""}`)
    .join("\n") || "- none identified";
  const exclude = opts.exclude?.length
    ? `\nDO NOT propose any of these (title|artist keys): ${opts.exclude.join("; ")}\n`
    : "";
  return `DIRECTION: ${direction}
${DIRECTION_BRIEF[direction]}

VIDEO
${analysis.summary}
Content type: ${analysis.content_type} (${analysis.content_category})
Setting: ${analysis.setting ?? "unknown"}
Story: ${analysis.story ?? "none"}
Aesthetic: ${analysis.aesthetic.join(", ")}
Mood: ${analysis.mood.join(", ")}
Energy: ${analysis.energy}. Pacing: ${analysis.pacing}.
Spoken dialogue present: ${analysis.dialogue_present ? "YES — sung vocals will compete with the speech; prefer sections without lead vocals" : "no"}
Key moments:
${moments}

MUSIC BRIEF
${brief.text}
Fields: ${JSON.stringify(brief.fields)}
${opts.note ? `\nNOTE: ${opts.note}\n` : ""}${exclude}
TASK
Propose exactly ${LIMITS.candidatesPerDirection} songs for this direction. For each song choose the single
best ${LIMITS.sectionMin}–${LIMITS.sectionMax} second window of the ORIGINAL studio recording for this video.
- anchor_seconds: the second where the song's defining musical moment happens inside that window
  (chorus entry, drop, the lift). Be as accurate as you can; if unsure, say so in section_reason.
- proposed_start / proposed_end: the window, in seconds, containing anchor_seconds.
- section_is_vocal: true if lead vocals are singing during most of the window.

Return ONLY a JSON array, no prose, each item exactly:
{
  "title": string,
  "artist": string,
  "proposed_start": number,
  "proposed_end": number,
  "anchor_seconds": number,
  "section_is_vocal": boolean,
  "section_reason": string,   // what happens musically at the anchor and across the window (one sentence)
  "fit_reason": string        // why it fits THIS video, referencing something specific in it (one sentence)
}`;
}

const Item = GeneratedCandidate.omit({ directions: true });
const ItemList = z.array(Item).min(1);

export function parseCandidateList(
  text: string, direction: DirectionTag,
): { ok: true; items: GeneratedCandidate[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "no JSON found" };
  }
  const parsed = ItemList.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, items: parsed.data.map((i) => ({ ...i, directions: [direction] })) };
}

export function mergeCandidates(lists: GeneratedCandidate[][]): GeneratedCandidate[] {
  const byKey = new Map<string, GeneratedCandidate>();
  for (const list of lists) {
    for (const c of list) {
      const key = normalizeKey(c.title, c.artist);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...c, directions: [...c.directions] });
        continue;
      }
      for (const d of c.directions) if (!existing.directions.includes(d)) existing.directions.push(d);
    }
  }
  return [...byKey.values()];
}

async function generateDirection(
  direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis, opts: GenerateOpts, call: ClaudeCall,
): Promise<GeneratedCandidate[]> {
  const user = buildCandidatePrompt(direction, brief, analysis, opts);
  const started = Date.now();
  const first = await call({ model: MODELS.candidates, system: SYSTEM, user, maxTokens: 6000, timeoutMs: LIMITS.modelTimeoutMs });
  const r1 = parseCandidateList(first, direction);
  if (r1.ok) {
    logger.info("candidates.direction", { direction, ms: Date.now() - started, items: r1.items.length });
    return r1.items;
  }
  logger.warn("candidates.retry", { direction, error: r1.error.slice(0, 300) });
  const retryUser = `${user}\n\nPREVIOUS OUTPUT WAS INVALID. Validation error:\n${r1.error.slice(0, 2000)}\nReturn the full corrected JSON array.`;
  const second = await call({ model: MODELS.candidates, system: SYSTEM, user: retryUser, maxTokens: 6000, timeoutMs: LIMITS.modelTimeoutMs });
  const r2 = parseCandidateList(second, direction);
  if (r2.ok) return r2.items;
  throw new PipelineError("recommend", `candidate output invalid (${direction}): ${r2.error.slice(0, 200)}`, second);
}

export async function generateCandidates(
  brief: MusicBrief, analysis: VideoAnalysis, opts: GenerateOpts = {},
): Promise<GeneratedCandidate[]> {
  const call = opts.call ?? callClaude;
  const lists = await Promise.all(
    DirectionTag.options.map((direction) => generateDirection(direction, brief, analysis, opts, call)),
  );
  return mergeCandidates(lists);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/candidates/generateCandidates.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && git add src/engine/candidates tests/engine/candidates tests/engine/fixtures.ts
git commit -m "Add three-direction candidate generation with strict parsing and merged memberships"
```

---
### Task 3.3: Deezer search with bounded concurrency, timeouts and provider errors

**Files:**
- Create: `src/engine/catalog/deezer.ts`
- Test: `tests/engine/catalog/deezer.test.ts`

**Interfaces:**
- Consumes: `LIMITS.deezerConcurrency`, `LIMITS.deezerTimeoutMs`; `titlesMatch`, `artistsMatch` (Task 3.1); `p-limit`.
- Produces:
  ```ts
  export type DeezerTrack = { id: number; title: string; duration: number; preview: string | null; link: string; artist: { name: string }; album?: { cover_medium?: string | null; cover_big?: string | null } };
  export class ProviderError extends Error { constructor(message: string, readonly status?: number) }
  export const deezerLimit: ReturnType<typeof pLimit>;                 // shared p-limit(LIMITS.deezerConcurrency)
  export async function deezerGet(url: string, fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>): Promise<unknown>; // timeout + retry/backoff; throws ProviderError
  export async function searchDeezer(title: string, artist: string, fetchImpl?: typeof fetch): Promise<DeezerTrack[]>;
  export function pickDeezerMatch(cand: { title: string; artist: string }, results: DeezerTrack[]): DeezerTrack | null;
  export async function findDeezerMatch(cand: { title: string; artist: string }, fetchImpl?: typeof fetch): Promise<DeezerTrack | null>; // throws ProviderError on outage
  ```

Ruling I5: no in-process token bucket (it does not survive multiple Vercel instances); bounded concurrency + per-request timeout + backoff on 429/5xx instead. Provider outages are distinguished from "no such song".

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/catalog/deezer.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  deezerGet, pickDeezerMatch, searchDeezer, findDeezerMatch, ProviderError, type DeezerTrack,
} from "@/src/engine/catalog/deezer";

const track = (over: Partial<DeezerTrack> = {}): DeezerTrack => ({
  id: 1, title: "Blinding Lights", duration: 200, preview: "https://p/1.mp3",
  link: "https://www.deezer.com/track/1", artist: { name: "The Weeknd" },
  album: { cover_medium: "m.jpg", cover_big: "b.jpg" }, ...over,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("deezerGet", () => {
  it("retries 429 and 5xx with backoff, then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ data: [] }));
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    const out = await deezerGet("https://api.deezer.com/x", fetchImpl as unknown as typeof fetch, sleep);
    expect(out).toEqual({ data: [] });
    expect(sleeps).toEqual([500, 1500]);
  });
  it("throws ProviderError after 3 failed attempts", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 500));
    await expect(deezerGet("https://api.deezer.com/x", fetchImpl as unknown as typeof fetch, async () => {}))
      .rejects.toBeInstanceOf(ProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("wraps network errors as ProviderError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(deezerGet("https://api.deezer.com/x", fetchImpl as unknown as typeof fetch, async () => {}))
      .rejects.toBeInstanceOf(ProviderError);
  });
});

describe("pickDeezerMatch", () => {
  it("returns the first ACCEPTABLE result (same version, same primary artist)", () => {
    const results = [
      track({ id: 9, title: "Blinding Lights", artist: { name: "Karaoke Hits" } }),
      track({ id: 3, title: "Blinding Lights (Live)", artist: { name: "The Weeknd" } }),
      track({ id: 2, title: "Blinding Lights - Remastered", artist: { name: "The Weeknd" } }),
    ];
    expect(pickDeezerMatch({ title: "Blinding Lights", artist: "The Weeknd" }, results)?.id).toBe(2);
  });
  it("returns null when nothing is acceptable", () => {
    expect(pickDeezerMatch({ title: "Stay", artist: "The Kid LAROI" }, [track({ title: "Stay With Me", artist: { name: "The Kid LAROI" } })])).toBeNull();
  });
});

describe("findDeezerMatch", () => {
  it("falls through to the plain query when the strict query has no acceptable match", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const data = u.includes("artist%3A") ? [track({ title: "Blinding Lights (Live)" })] : [track({})];
      return json({ data });
    });
    const out = await findDeezerMatch({ title: "Blinding Lights", artist: "The Weeknd" }, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out?.id).toBe(1);
  });
  it("propagates ProviderError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json({}, 503));
    await expect(findDeezerMatch({ title: "A", artist: "B" }, fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(ProviderError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/catalog/deezer.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/deezer.ts
// Deezer's public search API: no auth, community-documented ~50 req / 5 s per IP (docs/RESEARCH.md).
// We treat that as an assumption, not an SLA: bounded concurrency, timeouts, backoff on 429/5xx.
import { z } from "zod";
import pLimit from "p-limit";
import { LIMITS } from "@/src/shared/config";
import { titlesMatch, artistsMatch } from "@/src/engine/catalog/normalize";

const DeezerTrackSchema = z.object({
  id: z.number(),
  title: z.string(),
  duration: z.number(),
  preview: z.string().nullable().optional().transform((v) => v || null),
  link: z.string(),
  artist: z.object({ name: z.string() }),
  album: z
    .object({ cover_medium: z.string().nullable().optional(), cover_big: z.string().nullable().optional() })
    .optional(),
});
const DeezerSearchSchema = z.object({ data: z.array(DeezerTrackSchema).default([]) });
export type DeezerTrack = z.infer<typeof DeezerTrackSchema>;

export class ProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ProviderError";
  }
}

export const deezerLimit = pLimit(LIMITS.deezerConcurrency);

const BACKOFF_MS = [500, 1500, 4000];
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET with timeout and retry on 429/5xx/network. Resolves the parsed JSON or throws ProviderError. */
export async function deezerGet(
  url: string, fetchImpl: typeof fetch = fetch, sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<unknown> {
  let last: ProviderError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(LIMITS.deezerTimeoutMs) });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) {
        last = new ProviderError(`deezer ${res.status}`, res.status);
      } else {
        throw new ProviderError(`deezer ${res.status}`, res.status); // 4xx other than 429: do not retry
      }
    } catch (e) {
      if (e instanceof ProviderError && e.status && e.status < 500 && e.status !== 429) throw e;
      last = e instanceof ProviderError ? e : new ProviderError(e instanceof Error ? e.message : String(e));
    }
    if (attempt < 2) await sleep(BACKOFF_MS[attempt]!);
  }
  throw last ?? new ProviderError("deezer: unknown failure");
}

async function query(q: string, fetchImpl: typeof fetch): Promise<DeezerTrack[]> {
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`;
  const body = await deezerLimit(() => deezerGet(url, fetchImpl));
  const parsed = DeezerSearchSchema.safeParse(body);
  return parsed.success ? parsed.data.data : [];
}

export async function searchDeezer(title: string, artist: string, fetchImpl: typeof fetch = fetch): Promise<DeezerTrack[]> {
  return query(`artist:"${artist}" track:"${title}"`, fetchImpl);
}

export function pickDeezerMatch(cand: { title: string; artist: string }, results: DeezerTrack[]): DeezerTrack | null {
  for (const r of results) {
    if (titlesMatch(cand.title, r.title) && artistsMatch(cand.artist, r.artist.name)) return r;
  }
  return null;
}

/** Strict search first; if it yields no ACCEPTABLE match, try the plain query. Throws ProviderError on outage. */
export async function findDeezerMatch(
  cand: { title: string; artist: string }, fetchImpl: typeof fetch = fetch,
): Promise<DeezerTrack | null> {
  const strict = pickDeezerMatch(cand, await searchDeezer(cand.title, cand.artist, fetchImpl));
  if (strict) return strict;
  const plain = await query(`${cand.title} ${cand.artist}`, fetchImpl);
  return pickDeezerMatch(cand, plain);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/catalog/deezer.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/deezer.ts tests/engine/catalog/deezer.test.ts
git commit -m "Add Deezer search with bounded concurrency, timeouts, backoff and strict matching"
```

---

### Task 3.4: iTunes preview fallback (only when previews are enabled)

**Files:**
- Create: `src/engine/catalog/itunes.ts`
- Test: `tests/engine/catalog/itunes.test.ts`

**Interfaces:**
- Consumes: `titlesMatch`, `artistsMatch`; `PREVIEWS_ENABLED`, `LIMITS.deezerTimeoutMs`.
- Produces: `export async function findItunesPreview(title: string, artist: string, fetchImpl?: typeof fetch): Promise<{ itunesId: string; previewUrl: string | null } | null>` — returns `null` immediately when `PREVIEWS_ENABLED` is false; never throws.

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/catalog/itunes.test.ts
import { describe, it, expect, vi } from "vitest";

const body = {
  results: [
    { trackId: 11, trackName: "Blinding Lights (Karaoke)", artistName: "Karaoke Co", previewUrl: "https://k.m4a" },
    { trackId: 12, trackName: "Blinding Lights", artistName: "The Weeknd", previewUrl: "https://w.m4a" },
  ],
};

describe("findItunesPreview", () => {
  it("returns the matching track's id and preview when previews are enabled", async () => {
    vi.doMock("@/src/shared/config", async (orig) => ({ ...(await orig<object>()), PREVIEWS_ENABLED: true }));
    const { findItunesPreview } = await import("@/src/engine/catalog/itunes");
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const out = await findItunesPreview("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch);
    expect(out).toEqual({ itunesId: "12", previewUrl: "https://w.m4a" });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("country=US");
    vi.doUnmock("@/src/shared/config");
    vi.resetModules();
  });
  it("returns null on no match or error, and never throws", async () => {
    vi.doMock("@/src/shared/config", async (orig) => ({ ...(await orig<object>()), PREVIEWS_ENABLED: true }));
    const { findItunesPreview } = await import("@/src/engine/catalog/itunes");
    const bad = vi.fn(async () => new Response("nope", { status: 403 }));
    expect(await findItunesPreview("X", "Y", bad as unknown as typeof fetch)).toBeNull();
    const boom = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await findItunesPreview("X", "Y", boom as unknown as typeof fetch)).toBeNull();
    vi.doUnmock("@/src/shared/config");
    vi.resetModules();
  });
  it("does not call the network when previews are disabled", async () => {
    vi.doMock("@/src/shared/config", async (orig) => ({ ...(await orig<object>()), PREVIEWS_ENABLED: false }));
    const { findItunesPreview } = await import("@/src/engine/catalog/itunes");
    const fetchImpl = vi.fn();
    expect(await findItunesPreview("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.doUnmock("@/src/shared/config");
    vi.resetModules();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/engine/catalog/itunes.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/itunes.ts
// iTunes Search API: free, no auth, ~20 calls/min. Only called for a final pick missing a preview,
// and only when PREVIEWS_ENABLED (ruling C8). Failure never blocks a result.
import { z } from "zod";
import { LIMITS, PREVIEWS_ENABLED } from "@/src/shared/config";
import { titlesMatch, artistsMatch } from "@/src/engine/catalog/normalize";

const ItunesResult = z.object({
  trackId: z.number(),
  trackName: z.string(),
  artistName: z.string(),
  previewUrl: z.string().optional(),
});
const ItunesSearch = z.object({ results: z.array(ItunesResult).default([]) });

export async function findItunesPreview(
  title: string, artist: string, fetchImpl: typeof fetch = fetch,
): Promise<{ itunesId: string; previewUrl: string | null } | null> {
  if (!PREVIEWS_ENABLED) return null;
  try {
    const term = encodeURIComponent(`${title} ${artist}`);
    const res = await fetchImpl(
      `https://itunes.apple.com/search?term=${term}&entity=song&limit=5&country=US`,
      { signal: AbortSignal.timeout(LIMITS.deezerTimeoutMs) },
    );
    if (!res.ok) return null;
    const parsed = ItunesSearch.safeParse(await res.json());
    if (!parsed.success) return null;
    const hit = parsed.data.results.find((r) => titlesMatch(title, r.trackName) && artistsMatch(artist, r.artistName));
    return hit ? { itunesId: String(hit.trackId), previewUrl: hit.previewUrl ?? null } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/engine/catalog/itunes.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/itunes.ts tests/engine/catalog/itunes.test.ts
git commit -m "Add iTunes preview lookup gated by PREVIEWS_ENABLED"
```

---

### Task 3.5: Verify candidates against Deezer (drop impossible sections, dedupe by recording)

**Files:**
- Create: `src/engine/catalog/verifyCandidates.ts`
- Test: `tests/engine/catalog/verifyCandidates.test.ts`

**Interfaces:**
- Consumes: `GeneratedCandidate`, `VerifiedCandidate`; `findDeezerMatch`, `ProviderError`, `DeezerTrack` (Task 3.3); `PREVIEWS_ENABLED`.
- Produces:
  ```ts
  export function validateSection(start: number, end: number, anchor: number, duration: number): { start: number; end: number } | null;
  export async function verifyCandidates(cands: GeneratedCandidate[], deps?: { find?: typeof findDeezerMatch }): Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }>; // throws ProviderError when ≥30% of lookups hit the provider
  ```

Rulings C6 (no clamp-and-pretend: an anchor past the track end means the model is wrong about the song, drop it), I3 (dedupe by `deezer_id`), I4/I5 (outage ≠ no match).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/catalog/verifyCandidates.test.ts
import { describe, it, expect, vi } from "vitest";
import { validateSection, verifyCandidates } from "@/src/engine/catalog/verifyCandidates";
import { ProviderError, type DeezerTrack } from "@/src/engine/catalog/deezer";
import { gen } from "../fixtures";

describe("validateSection", () => {
  it("leaves a valid window alone", () => {
    expect(validateSection(43, 58, 45, 200)).toEqual({ start: 43, end: 58 });
  });
  it("clamps an end overshoot of at most 1 s", () => {
    expect(validateSection(186, 201, 190, 200)).toEqual({ start: 186, end: 200 });
  });
  it("drops a window that overshoots the track by more than 1 s", () => {
    expect(validateSection(190, 215, 195, 200)).toBeNull();
  });
  it("drops an anchor within 2 s of the end or beyond it", () => {
    expect(validateSection(180, 195, 199, 200)).toBeNull();
    expect(validateSection(180, 195, 250, 200)).toBeNull();
  });
});

const hit = (over: Partial<DeezerTrack> = {}): DeezerTrack => ({
  id: 7, title: "Found", duration: 200, preview: "https://p.mp3", link: "https://d/7",
  artist: { name: "The Weeknd" }, album: { cover_medium: "m.jpg", cover_big: "b.jpg" }, ...over,
});

describe("verifyCandidates", () => {
  it("splits verified/unverified, attaches canonical fields, dedupes by deezer id", async () => {
    const find = vi.fn(async (c: { title: string }) => (c.title.startsWith("Found") ? hit() : null));
    const { verified, unverified } = await verifyCandidates(
      [gen({ title: "Found" }), gen({ title: "Found - Remastered" }), gen({ title: "Missing" })], { find },
    );
    expect(unverified.map((c) => c.title)).toEqual(["Missing"]);
    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatchObject({
      deezer_id: "7", canonical_title: "Found", canonical_artist: "The Weeknd", duration_seconds: 200,
      artwork_url: "b.jpg", deezer_url: "https://d/7", preview_url: null, proposed_start: 43, proposed_end: 58,
    });
  });
  it("drops a verified song whose section is impossible for the real track", async () => {
    const find = vi.fn(async () => hit({ duration: 40 }));
    const { verified, unverified } = await verifyCandidates([gen({ anchor_seconds: 45 })], { find });
    expect(verified).toHaveLength(0);
    expect(unverified).toHaveLength(1);
  });
  it("throws when the provider is failing for 30% or more of lookups", async () => {
    const find = vi.fn(async (c: { title: string }) => {
      if (c.title === "A") throw new ProviderError("deezer 503", 503);
      return hit();
    });
    await expect(verifyCandidates([gen({ title: "A" }), gen({ title: "B" }), gen({ title: "C" })], { find }))
      .rejects.toBeInstanceOf(ProviderError);
  });
  it("tolerates a single provider failure among many", async () => {
    const find = vi.fn(async (c: { title: string }) => {
      if (c.title === "A") throw new ProviderError("deezer 503", 503);
      return hit({ id: Number(c.title.charCodeAt(0)) });
    });
    const { verified } = await verifyCandidates(["A", "B", "C", "D"].map((t) => gen({ title: t })), { find });
    expect(verified).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/catalog/verifyCandidates.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/verifyCandidates.ts
import type { GeneratedCandidate, VerifiedCandidate } from "@/src/shared/types";
import { PREVIEWS_ENABLED } from "@/src/shared/config";
import { findDeezerMatch, ProviderError } from "@/src/engine/catalog/deezer";
import { logger } from "@/src/shared/logger";

const OUTAGE_RATIO = 0.3;

/**
 * A section is valid only if it fits the real track. We never move an anchor: if the model's
 * musical moment cannot exist in this recording, the candidate is wrong, not the arithmetic.
 */
export function validateSection(
  start: number, end: number, anchor: number, duration: number,
): { start: number; end: number } | null {
  if (duration <= 0) return null;
  if (anchor >= duration - 2) return null;
  if (end > duration + 1) return null;
  return { start: Math.max(0, start), end: Math.min(end, duration) };
}

export async function verifyCandidates(
  cands: GeneratedCandidate[],
  deps: { find?: typeof findDeezerMatch } = {},
): Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }> {
  const find = deps.find ?? findDeezerMatch;
  const verified: VerifiedCandidate[] = [];
  const unverified: GeneratedCandidate[] = [];
  const seenIds = new Set<string>();
  let providerErrors = 0;
  let lastProviderError: ProviderError | null = null;

  // Concurrency is bounded inside deezer.ts (deezerLimit); allSettled keeps one failure from hiding the rest.
  const results = await Promise.allSettled(cands.map((c) => find(c)));

  results.forEach((r, i) => {
    const c = cands[i]!;
    if (r.status === "rejected") {
      if (r.reason instanceof ProviderError) {
        providerErrors++;
        lastProviderError = r.reason;
      } else {
        logger.warn("verifyCandidates.lookup_error", { title: c.title, err: String(r.reason) });
      }
      unverified.push(c);
      return;
    }
    const hit = r.value;
    if (!hit) {
      unverified.push(c);
      return;
    }
    const id = String(hit.id);
    if (seenIds.has(id)) return; // same recording proposed twice under different spellings
    const section = validateSection(c.proposed_start, c.proposed_end, c.anchor_seconds, hit.duration);
    if (!section) {
      logger.info("verifyCandidates.section_impossible", { title: c.title, anchor: c.anchor_seconds, duration: hit.duration });
      unverified.push(c);
      return;
    }
    seenIds.add(id);
    verified.push({
      ...c,
      proposed_start: section.start,
      proposed_end: section.end,
      deezer_id: id,
      canonical_title: hit.title,
      canonical_artist: hit.artist.name,
      duration_seconds: hit.duration,
      artwork_url: hit.album?.cover_big ?? hit.album?.cover_medium ?? null,
      deezer_url: hit.link,
      preview_url: PREVIEWS_ENABLED ? hit.preview : null,
    });
  });

  if (cands.length > 0 && providerErrors / cands.length >= OUTAGE_RATIO && lastProviderError) {
    throw lastProviderError;
  }
  logger.info("verifyCandidates", { total: cands.length, verified: verified.length, providerErrors });
  return { verified, unverified };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/catalog/verifyCandidates.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/verifyCandidates.ts tests/engine/catalog/verifyCandidates.test.ts
git commit -m "Verify candidates against Deezer, drop impossible sections, dedupe by recording"
```

---
### Task 3.6: Scoring (strict batched model dimensions, rules, weights)

**Files:**
- Create: `src/engine/scoring/dimensions.ts`, `src/engine/scoring/modelScores.ts`, `src/engine/scoring/dialogue.ts`, `src/engine/scoring/config/overused.ts`, `src/engine/scoring/overuse.ts`, `src/engine/scoring/weights.ts`, `src/engine/scoring/scoreCandidates.ts`
- Test: `tests/engine/scoring/rules.test.ts`, `tests/engine/scoring/scoreCandidates.test.ts`

**Interfaces:**
- Consumes: `VerifiedCandidate`, `ScoredCandidate`, `ComponentScore`, `ComponentScores`, `Dimension`, `DIMENSIONS`; `callClaude`; `extractJson`; `normalizeKey`; `MODELS.scoring`, `LIMITS.modelTimeoutMs`.
- Produces:
  ```ts
  // dimensions.ts
  export { DIMENSIONS } from "@/src/shared/types";
  export const MODEL_DIMENSIONS = ["semantic","emotional","aesthetic","pacing","cultural","originality"] as const;
  export type ModelDimension = (typeof MODEL_DIMENSIONS)[number];
  // modelScores.ts
  export const PROMPT_VERSION = "scoring-v2";
  export function parseScores(text: string, count: number): { ok: true; scores: Record<ModelDimension, ComponentScore>[] } | { ok: false; error: string };
  export async function modelScores(analysis, brief, cands: VerifiedCandidate[], deps?: { call?: ClaudeCall }): Promise<Record<ModelDimension, ComponentScore>[]>; // aligned with cands; throws PipelineError
  // dialogue.ts
  export function dialogueScore(analysis: VideoAnalysis, cand: VerifiedCandidate): ComponentScore;
  // overuse.ts
  export function overuseScore(cand: { title: string; artist: string }): ComponentScore;
  // weights.ts
  export const WEIGHTS: Record<Dimension, number>;
  export function combine(scores: ComponentScores): number;
  // scoreCandidates.ts
  export async function scoreCandidates(analysis, brief, cands: VerifiedCandidate[], deps?: { scores?: typeof modelScores }): Promise<ScoredCandidate[]>; // sorted desc by total_score
  ```

Rulings C1 (every candidate must be scored or the stage fails), I1 (Sonnet, short reasons, right-sized `max_tokens`), I9 (dialogue rule uses the explicit `section_is_vocal` flag, not prose).

- [ ] **Step 1: Write the failing rule tests**

```ts
// tests/engine/scoring/rules.test.ts
import { describe, it, expect } from "vitest";
import { combine, WEIGHTS } from "@/src/engine/scoring/weights";
import { dialogueScore } from "@/src/engine/scoring/dialogue";
import { overuseScore } from "@/src/engine/scoring/overuse";
import type { ComponentScores, VideoAnalysis } from "@/src/shared/types";
import { analysis, ver } from "../fixtures";

describe("combine", () => {
  it("is a weighted mean", () => {
    const scores = Object.fromEntries(Object.keys(WEIGHTS).map((d) => [d, { score: 0.5, reason: "" }])) as ComponentScores;
    expect(combine(scores)).toBeCloseTo(0.5, 6);
    scores.semantic = { score: 1, reason: "" };
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(combine(scores)).toBeCloseTo((0.5 * (total - WEIGHTS.semantic) + WEIGHTS.semantic) / total, 6);
  });
});

describe("dialogueScore", () => {
  const talky: VideoAnalysis = { ...analysis, dialogue_present: true };
  it("is 1 when there is no dialogue", () => {
    expect(dialogueScore(analysis, ver({ section_is_vocal: true })).score).toBe(1);
  });
  it("penalises vocal sections when there is dialogue", () => {
    expect(dialogueScore(talky, ver({ section_is_vocal: true })).score).toBe(0.3);
  });
  it("passes non-vocal sections under dialogue", () => {
    expect(dialogueScore(talky, ver({ section_is_vocal: false })).score).toBe(1);
  });
});

describe("overuseScore", () => {
  it("flags a known overused song regardless of formatting", () => {
    expect(overuseScore({ title: "Oh No (Remastered)", artist: "Capone" }).score).toBe(0.4);
  });
  it("passes everything else", () => {
    expect(overuseScore({ title: "Obscure Tune", artist: "Nobody" }).score).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/scoring/rules.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write dimensions, weights and rules**

```ts
// src/engine/scoring/dimensions.ts
export { DIMENSIONS } from "@/src/shared/types";
export const MODEL_DIMENSIONS = ["semantic", "emotional", "aesthetic", "pacing", "cultural", "originality"] as const;
export type ModelDimension = (typeof MODEL_DIMENSIONS)[number];
```

```ts
// src/engine/scoring/weights.ts
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
```

```ts
// src/engine/scoring/dialogue.ts
import type { ComponentScore, VerifiedCandidate, VideoAnalysis } from "@/src/shared/types";

/** Uses the generator's explicit section_is_vocal flag (ruling I9), never prose matching. */
export function dialogueScore(analysis: VideoAnalysis, cand: VerifiedCandidate): ComponentScore {
  if (!analysis.dialogue_present) return { score: 1, reason: "no dialogue to compete with" };
  if (cand.section_is_vocal) return { score: 0.3, reason: "lead vocals will fight the speech" };
  return { score: 1, reason: "section has no lead vocals under the speech" };
}
```

```ts
// src/engine/scoring/config/overused.ts
// Hand-maintained list of songs saturated on IG/TikTok. Replaced by song_trend_signals later.
// Matching uses normalizeKey, so version suffixes do not matter.
export const OVERUSED: { title: string; artist: string }[] = [
  { title: "Oh No", artist: "Capone" },
  { title: "Monkeys Spinning Monkeys", artist: "Kevin MacLeod" },
  { title: "Aesthetic", artist: "Tollan Kim" },
  { title: "Sunroof", artist: "Nicky Youre" },
  { title: "Blinding Lights", artist: "The Weeknd" },
  { title: "Say So", artist: "Doja Cat" },
  { title: "Savage Love", artist: "Jawsh 685" },
  { title: "Stay", artist: "The Kid LAROI" },
  { title: "Flowers", artist: "Miley Cyrus" },
  { title: "Espresso", artist: "Sabrina Carpenter" },
];
```

```ts
// src/engine/scoring/overuse.ts
import type { ComponentScore } from "@/src/shared/types";
import { normalizeKey } from "@/src/engine/catalog/normalize";
import { OVERUSED } from "@/src/engine/scoring/config/overused";

const KEYS = new Set(OVERUSED.map((s) => normalizeKey(s.title, s.artist)));

export function overuseScore(cand: { title: string; artist: string }): ComponentScore {
  if (KEYS.has(normalizeKey(cand.title, cand.artist))) return { score: 0.4, reason: "overused on social right now" };
  return { score: 1, reason: "not on the overused list" };
}
```

- [ ] **Step 4: Run rule tests to verify they pass**

Run: `pnpm test -- tests/engine/scoring/rules.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing scoreCandidates and modelScores tests**

```ts
// tests/engine/scoring/scoreCandidates.test.ts
import { describe, it, expect, vi } from "vitest";
import { scoreCandidates } from "@/src/engine/scoring/scoreCandidates";
import { modelScores, parseScores, PROMPT_VERSION } from "@/src/engine/scoring/modelScores";
import { DIMENSIONS, type VerifiedCandidate } from "@/src/shared/types";
import { analysis, brief, ver } from "../fixtures";

const vc = (title: string, id: string) => ver({ title, deezer_id: id });
const six = (s: number) => ({
  semantic: { score: s, reason: "a" }, emotional: { score: s, reason: "b" }, aesthetic: { score: s, reason: "c" },
  pacing: { score: s, reason: "d" }, cultural: { score: s, reason: "e" }, originality: { score: s, reason: "f" },
});

describe("scoreCandidates", () => {
  it("attaches all 7 dimensions and sorts by total descending", async () => {
    const scores = vi.fn(async (_a, _b, cands: VerifiedCandidate[]) => cands.map((c) => six(c.title === "Great" ? 0.9 : 0.4)));
    const out = await scoreCandidates(analysis, brief, [vc("Meh", "1"), vc("Great", "2")], { scores });
    expect(out.map((c) => c.title)).toEqual(["Great", "Meh"]);
    for (const c of out) {
      expect(Object.keys(c.component_scores).sort()).toEqual([...DIMENSIONS].sort());
      expect(c.total_score).toBeGreaterThan(0);
    }
  });
});

describe("parseScores", () => {
  it("accepts a complete list", () => {
    const r = parseScores(JSON.stringify([{ index: 0, ...six(0.5) }, { index: 1, ...six(0.6) }]), 2);
    expect(r.ok && r.scores[1]!.semantic.score).toBe(0.6);
  });
  it("rejects a list with a missing index", () => {
    const r = parseScores(JSON.stringify([{ index: 0, ...six(0.5) }]), 2);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/missing index 1/);
  });
  it("rejects an item with an invalid score", () => {
    const bad = { index: 0, ...six(0.5), pacing: { score: 1.7, reason: "x" } };
    expect(parseScores(JSON.stringify([bad]), 1).ok).toBe(false);
  });
});

describe("modelScores", () => {
  it("retries once with the error, then throws", async () => {
    const call = vi.fn(async () => JSON.stringify([{ index: 0, ...six(0.5) }])); // always one short
    await expect(modelScores(analysis, brief, [vc("A", "1"), vc("B", "2")], { call })).rejects.toThrow(/scoring output invalid/);
    expect(call).toHaveBeenCalledTimes(2);
    expect((call.mock.calls[1]![0] as { user: string }).user).toMatch(/PREVIOUS OUTPUT WAS INVALID/);
    expect(PROMPT_VERSION).toBe("scoring-v2");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test -- tests/engine/scoring/scoreCandidates.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 7: Write modelScores and scoreCandidates**

```ts
// src/engine/scoring/modelScores.ts
import { z } from "zod";
import { ComponentScore, type MusicBrief, type VerifiedCandidate, type VideoAnalysis } from "@/src/shared/types";
import { MODELS, LIMITS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { MODEL_DIMENSIONS, type ModelDimension } from "@/src/engine/scoring/dimensions";

export const PROMPT_VERSION = "scoring-v2";
const TOKENS_PER_ITEM = 90; // 6 dims × (score + ≤12-word reason) ≈ 90 output tokens

const SYSTEM = `You are Songfit's music supervisor. You score candidate song sections against a specific
short-form video. Be decisive and discriminating: use the full 0–1 range, do not give everything 0.7.
A 1.0 means "this is exactly the song a great editor would pick"; a 0.2 means "clearly wrong".
Reasons are at most 12 words. You must return one object for EVERY candidate index.`;

const DIMENSION_DEFINITIONS: Record<ModelDimension, string> = {
  semantic: "Does the song make sense for what is literally happening in the video (subject, setting, story)?",
  emotional: "Does the emotional character of this section match or productively contrast the video's feel and the creator's intent?",
  aesthetic: "Does the sound match the visual world (luxury vs raw, modern vs retro, polished vs lo-fi)?",
  pacing: "Do the energy and rhythm of this section fit the edit's pace and cuts, and does its musical moment land near the key moment?",
  cultural: "Would this creator realistically use this song on Instagram or TikTok right now, given their niche and audience?",
  originality: "Is it good without being painfully obvious or exhausted?",
};

const Item = z.object({ index: z.number().int().min(0) }).and(
  z.object(Object.fromEntries(MODEL_DIMENSIONS.map((d) => [d, ComponentScore])) as Record<ModelDimension, typeof ComponentScore>),
);

export function buildScoringPrompt(analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[]): string {
  const defs = MODEL_DIMENSIONS.map((d) => `- ${d}: ${DIMENSION_DEFINITIONS[d]}`).join("\n");
  const list = cands
    .map((c, i) => `${i}. "${c.canonical_title}" — ${c.canonical_artist} | section ${c.proposed_start}s–${c.proposed_end}s, anchor ${c.anchor_seconds}s | ${c.section_reason} | proposed because: ${c.fit_reason}`)
    .join("\n");
  const moments = analysis.important_moments.map((m) => `${m.time}s ${m.type}`).join("; ") || "none";
  return `VIDEO
${analysis.summary}
Category: ${analysis.content_category}. Aesthetic: ${analysis.aesthetic.join(", ")}. Mood: ${analysis.mood.join(", ")}.
Energy ${analysis.energy}, pacing ${analysis.pacing}. Dialogue: ${analysis.dialogue_present ? "yes" : "no"}. Key moments: ${moments}.

MUSIC BRIEF
${brief.text}

DIMENSIONS (score each 0–1, reason ≤ 12 words)
${defs}

CANDIDATES (${cands.length}; return exactly ${cands.length} objects, indexes 0–${cands.length - 1})
${list}

Return ONLY a JSON array with one object per candidate:
{ "index": number, "semantic": {"score": number, "reason": string}, "emotional": {...}, "aesthetic": {...}, "pacing": {...}, "cultural": {...}, "originality": {...} }`;
}

export function parseScores(
  text: string, count: number,
): { ok: true; scores: Record<ModelDimension, ComponentScore>[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "no JSON found" };
  }
  const arr = z.array(Item).safeParse(raw);
  if (!arr.success) return { ok: false, error: arr.error.message };
  const byIndex = new Map<number, Record<ModelDimension, ComponentScore>>();
  for (const { index, ...rest } of arr.data) byIndex.set(index, rest as Record<ModelDimension, ComponentScore>);
  const scores: Record<ModelDimension, ComponentScore>[] = [];
  for (let i = 0; i < count; i++) {
    const s = byIndex.get(i);
    if (!s) return { ok: false, error: `missing index ${i}` };
    scores.push(s);
  }
  return { ok: true, scores };
}

export async function modelScores(
  analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[],
  deps: { call?: ClaudeCall } = {},
): Promise<Record<ModelDimension, ComponentScore>[]> {
  const call = deps.call ?? callClaude;
  const user = buildScoringPrompt(analysis, brief, cands);
  const maxTokens = Math.min(16000, 500 + cands.length * TOKENS_PER_ITEM);
  const started = Date.now();
  const first = await call({ model: MODELS.scoring, system: SYSTEM, user, maxTokens, timeoutMs: LIMITS.modelTimeoutMs });
  const r1 = parseScores(first, cands.length);
  if (r1.ok) {
    logger.info("scoring", { ms: Date.now() - started, candidates: cands.length, chars: first.length });
    return r1.scores;
  }
  logger.warn("scoring.retry", { error: r1.error.slice(0, 300) });
  const retryUser = `${user}\n\nPREVIOUS OUTPUT WAS INVALID. Validation error:\n${r1.error.slice(0, 2000)}\nReturn the full corrected JSON array with every index.`;
  const second = await call({ model: MODELS.scoring, system: SYSTEM, user: retryUser, maxTokens, timeoutMs: LIMITS.modelTimeoutMs });
  const r2 = parseScores(second, cands.length);
  if (r2.ok) return r2.scores;
  throw new PipelineError("recommend", `scoring output invalid: ${r2.error.slice(0, 200)}`, second);
}
```

```ts
// src/engine/scoring/scoreCandidates.ts
import type { ComponentScores, MusicBrief, ScoredCandidate, VerifiedCandidate, VideoAnalysis } from "@/src/shared/types";
import { modelScores } from "@/src/engine/scoring/modelScores";
import { dialogueScore } from "@/src/engine/scoring/dialogue";
import { overuseScore } from "@/src/engine/scoring/overuse";
import { combine } from "@/src/engine/scoring/weights";

export async function scoreCandidates(
  analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[],
  deps: { scores?: typeof modelScores } = {},
): Promise<ScoredCandidate[]> {
  if (cands.length === 0) return [];
  const scores = deps.scores ?? modelScores;
  const fromModel = await scores(analysis, brief, cands);
  const scored: ScoredCandidate[] = cands.map((c, i) => {
    const component_scores: ComponentScores = {
      ...fromModel[i]!,
      dialogue: dialogueScore(analysis, c),
      originality: lower(fromModel[i]!.originality, overuseScore(c)),
    };
    return { ...c, component_scores, total_score: combine(component_scores) };
  });
  return scored.sort((a, b) => b.total_score - a.total_score);
}

/** The overuse rule caps originality: a saturated song cannot score high on originality. */
function lower(a: { score: number; reason: string }, b: { score: number; reason: string }) {
  return a.score <= b.score ? a : b;
}
```

- [ ] **Step 8: Run all scoring tests**

Run: `pnpm test -- tests/engine/scoring`
Expected: PASS, 11 tests.

- [ ] **Step 9: Commit**

```bash
pnpm typecheck && git add src/engine/scoring tests/engine/scoring
git commit -m "Add strict candidate scoring: batched model dimensions, dialogue and overuse rules, weights"
```

---

### Task 3.7: Diversify into 3 picks (rank 1 is always "Best fit")

**Files:**
- Create: `src/engine/diversify/diversify.ts`
- Test: `tests/engine/diversify/diversify.test.ts`

**Interfaces:**
- Consumes: `ScoredCandidate`, `Pick`, `DirectionTag`, `DIRECTION_LABEL`; `normalizeArtist`; `PipelineError`.
- Produces:
  ```ts
  export function primaryDirection(c: { directions: DirectionTag[] }): DirectionTag; // first membership
  export const RUNNER_UP_LABEL: Record<DirectionTag, string>; // safe: "Safe bet", current: "More current", unexpected: "Unexpected"
  export function diversify(scored: ScoredCandidate[]): Pick[]; // length 3, ranks 1–3
  ```

Ruling I9: overall rank and generation direction are different things. Rank 1 is the top total and is labeled "Best fit" whatever its direction. Ranks 2–3 are labeled by their primary direction (`RUNNER_UP_LABEL`, which equals the header's `DIRECTION_LABEL`: safe → "Safe bet"; rank 1 uses `BEST_FIT_LABEL`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/diversify/diversify.test.ts
import { describe, it, expect } from "vitest";
import { diversify } from "@/src/engine/diversify/diversify";
import type { DirectionTag } from "@/src/shared/types";
import { scored } from "../fixtures";

let n = 0;
const sc = (title: string, directions: DirectionTag[], total: number, artist = `Artist ${++n}`) =>
  scored({ title, canonical_title: title, artist, canonical_artist: artist, directions, deezer_id: String(++n), total_score: total });

describe("diversify", () => {
  it("rank 1 is top overall labeled Best fit; 2 and 3 come from other directions", () => {
    const out = diversify([
      sc("S1", ["safe"], 0.9), sc("S2", ["safe"], 0.85), sc("C1", ["current"], 0.8), sc("U1", ["unexpected"], 0.6), sc("C2", ["current"], 0.7),
    ]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "U1"]);
    expect(out.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(out.map((p) => p.direction_label)).toEqual(["Best fit", "More current", "Unexpected"]);
    expect(out[0]).toMatchObject({ start_seconds: 43, end_seconds: 58, aligned_to_moment: null });
  });
  it("a top candidate from the unexpected direction is still labeled Best fit", () => {
    const out = diversify([sc("U1", ["unexpected"], 0.95), sc("S1", ["safe"], 0.9), sc("C1", ["current"], 0.8)]);
    expect(out.map((p) => p.direction_label)).toEqual(["Best fit", "Safe bet", "More current"]);
  });
  it("a song proposed in two directions does not count as a different direction from rank 1", () => {
    const out = diversify([sc("S1", ["safe"], 0.9), sc("X", ["safe", "current"], 0.88), sc("C1", ["current"], 0.8), sc("U1", ["unexpected"], 0.5)]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "U1"]);
  });
  it("falls back to next best overall when a direction is empty", () => {
    const out = diversify([sc("S1", ["safe"], 0.9), sc("S2", ["safe"], 0.85), sc("C1", ["current"], 0.8)]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "S2"]);
    expect(out[2]!.direction_label).toBe("Safe bet");
  });
  it("prefers a different artist when a close alternative exists", () => {
    const out = diversify([
      sc("S1", ["safe"], 0.9, "Drake"), sc("C1", ["current"], 0.8, "Drake"), sc("C2", ["current"], 0.75, "SZA"), sc("U1", ["unexpected"], 0.5, "Khruangbin"),
    ]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C2", "U1"]);
  });
  it("keeps the repeated artist when the alternative is far worse", () => {
    const out = diversify([
      sc("S1", ["safe"], 0.9, "Drake"), sc("C1", ["current"], 0.8, "Drake"), sc("C2", ["current"], 0.5, "SZA"), sc("U1", ["unexpected"], 0.5, "Khruangbin"),
    ]);
    expect(out[1]!.title).toBe("C1");
  });
  it("throws with fewer than 3 candidates", () => {
    expect(() => diversify([sc("S1", ["safe"], 0.9), sc("S2", ["safe"], 0.8)])).toThrow(/fewer than 3/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/diversify/diversify.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/diversify/diversify.ts
import { DirectionTag, type Pick, type ScoredCandidate } from "@/src/shared/types";
import { PipelineError } from "@/src/shared/errors";
import { normalizeArtist } from "@/src/engine/catalog/normalize";

const ARTIST_TOLERANCE = 0.1;

export const RUNNER_UP_LABEL: Record<DirectionTag, string> = {
  safe: "Safe bet",
  current: "More current",
  unexpected: "Unexpected",
};

export function primaryDirection(c: { directions: DirectionTag[] }): DirectionTag {
  return c.directions[0] ?? "safe";
}

export function diversify(scored: ScoredCandidate[]): Pick[] {
  if (scored.length < 3) throw new PipelineError("recommend", `fewer than 3 verified candidates (${scored.length})`);
  const sorted = [...scored].sort((a, b) => b.total_score - a.total_score);
  const picks: ScoredCandidate[] = [];
  const usedIds = new Set<string>();
  const usedArtists = new Set<string>();
  const usedDirections = new Set<DirectionTag>();

  const take = (c: ScoredCandidate) => {
    picks.push(c);
    usedIds.add(c.deezer_id);
    usedArtists.add(normalizeArtist(c.canonical_artist));
    usedDirections.add(primaryDirection(c));
  };
  const preferNewArtist = (pool: ScoredCandidate[]): ScoredCandidate | undefined => {
    const first = pool[0];
    if (!first || !usedArtists.has(normalizeArtist(first.canonical_artist))) return first;
    const alt = pool.find(
      (c) => !usedArtists.has(normalizeArtist(c.canonical_artist)) && first.total_score - c.total_score <= ARTIST_TOLERANCE,
    );
    return alt ?? first;
  };

  take(sorted[0]!);
  while (picks.length < 3) {
    const available = sorted.filter((c) => !usedIds.has(c.deezer_id));
    // "Different direction" means none of the candidate's memberships is a direction already picked.
    const fresh = available.filter((c) => c.directions.every((d) => !usedDirections.has(d)));
    const choice = preferNewArtist(fresh.length ? fresh : available);
    if (!choice) break;
    take(choice);
  }
  if (picks.length < 3) throw new PipelineError("recommend", "could not assemble 3 distinct picks");

  return picks.map((c, i) => ({
    ...c,
    rank: (i + 1) as 1 | 2 | 3,
    direction_label: i === 0 ? "Best fit" : RUNNER_UP_LABEL[primaryDirection(c)],
    start_seconds: c.proposed_start,
    end_seconds: c.proposed_end,
    aligned_to_moment: null,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/diversify/diversify.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/diversify tests/engine/diversify
git commit -m "Add diversification: Best fit first, then distinct directions"
```

---

### Task 3.8: Section selection with honest anchor alignment

**Files:**
- Create: `src/engine/sections/selectSections.ts`
- Test: `tests/engine/sections/selectSections.test.ts`

**Interfaces:**
- Consumes: `Pick` (with `anchor_seconds`, `duration_seconds`), `VideoAnalysis`, `LIMITS.sectionMin/sectionMax`.
- Produces:
  ```ts
  export function fitWindow(start: number, end: number, anchor: number, duration: number): { start: number; end: number }; // length in [min,max], inside track, contains anchor
  export function alignToMoment(window: { start: number; end: number }, anchor: number, duration: number, analysis: VideoAnalysis): { start: number; end: number; aligned_to_moment: number } | null;
  export function selectSections(picks: Pick[], analysis: VideoAnalysis): Pick[];
  ```

Ruling C6. ASSUMPTION, written into the module: the creator starts the chosen section at video time 0. The song's defining moment is at `anchor_seconds` (the model's claim; unverified, see the footer copy in 3.11). To land the anchor on a video moment at time T, the section must start at `anchor − T`. We apply that ONLY when the result is feasible (`start ≥ 0`, `start + length ≤ duration`, anchor inside); otherwise we keep the window and record `aligned_to_moment = null` so no downstream copy claims alignment. No clamping to 0: clamping would put the hit at the wrong video time and then describe it as aligned. The "nudge rank 2 by 2 s" rule is removed (M1).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/sections/selectSections.test.ts
import { describe, it, expect } from "vitest";
import { fitWindow, alignToMoment, selectSections } from "@/src/engine/sections/selectSections";
import type { VideoAnalysis } from "@/src/shared/types";
import { analysis, pick } from "../fixtures";

const quiet: VideoAnalysis = { ...analysis, important_moments: [] };

describe("fitWindow", () => {
  it("shortens a long window by moving the end only", () => {
    expect(fitWindow(40, 70, 45, 200)).toEqual({ start: 40, end: 60 });
  });
  it("lengthens a short window by moving the end only", () => {
    expect(fitWindow(50, 54, 51, 200)).toEqual({ start: 50, end: 62 });
  });
  it("pulls the window back when it runs past the track end", () => {
    expect(fitWindow(85, 110, 90, 100)).toEqual({ start: 80, end: 100 });
  });
  it("moves the window to contain an anchor that fell outside it", () => {
    expect(fitWindow(20, 35, 50, 200)).toEqual({ start: 48, end: 63 });
  });
});

describe("alignToMoment", () => {
  it("shifts the window so the anchor lands on the reveal", () => {
    // reveal at 7.8 s, anchor at 50 s, 15 s window → start 42.2
    expect(alignToMoment({ start: 45, end: 60 }, 50, 200, analysis)).toEqual({ start: 42.2, end: 57.2, aligned_to_moment: 7.8 });
  });
  it("does NOT align (and does not clamp) when the anchor is earlier than the reveal", () => {
    // anchor 5 s, reveal 10 s → start would be −5 → no alignment claimed
    const late: VideoAnalysis = { ...analysis, important_moments: [{ time: 10, type: "main_visual_reveal" }] };
    expect(alignToMoment({ start: 0, end: 15 }, 5, 200, late)).toBeNull();
  });
  it("returns null when there is no key moment", () => {
    expect(alignToMoment({ start: 45, end: 60 }, 50, 200, quiet)).toBeNull();
  });
  it("returns null when the aligned window would run past the track end", () => {
    expect(alignToMoment({ start: 185, end: 200 }, 199.5, 200, { ...analysis, important_moments: [{ time: 2, type: "climax" }] })).toBeNull();
  });
});

describe("selectSections", () => {
  it("fits every window, aligns every pick that can be aligned, and never nudges lengths", () => {
    const out = selectSections(
      [
        pick({ rank: 1, proposed_start: 45, proposed_end: 60, anchor_seconds: 50, start_seconds: 45, end_seconds: 60 }),
        pick({ rank: 2, deezer_id: "2", proposed_start: 0, proposed_end: 15, anchor_seconds: 3, start_seconds: 0, end_seconds: 15 }),
        pick({ rank: 3, deezer_id: "3", proposed_start: 20, proposed_end: 60, anchor_seconds: 22, start_seconds: 20, end_seconds: 60 }),
      ],
      analysis,
    );
    // rank 1: anchor 50 − reveal 7.8 → 42.2
    expect(out[0]).toMatchObject({ start_seconds: 42.2, end_seconds: 57.2, aligned_to_moment: 7.8 });
    // rank 2: anchor 3 is before the reveal → no alignment, window unchanged
    expect(out[1]).toMatchObject({ start_seconds: 0, end_seconds: 15, aligned_to_moment: null });
    // rank 3: window first fitted to 20 s (20–40), then aligned: 22 − 7.8 = 14.2
    expect(out[2]).toMatchObject({ start_seconds: 14.2, end_seconds: 34.2, aligned_to_moment: 7.8 });
    expect(out.map((p) => p.end_seconds - p.start_seconds)).toEqual([15, 15, 20]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/sections/selectSections.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/sections/selectSections.ts
//
// ASSUMPTION (replace when we have real audio-structure analysis):
// anchor_seconds is the generator's claim of where the song's defining moment is. A creator starts
// the chosen section at video time 0. To land the anchor on a video moment at time T the section
// must start at (anchor − T). We only claim alignment when that is feasible; otherwise the window is
// kept as proposed and aligned_to_moment is null. We never clamp to 0 and call it aligned.
import type { Pick, VideoAnalysis } from "@/src/shared/types";
import { LIMITS } from "@/src/shared/config";

const KEY_MOMENT_TYPES = new Set(["main_visual_reveal", "climax", "transition"]);
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Length in [sectionMin, sectionMax] (move end only), inside the track, containing the anchor. */
export function fitWindow(start: number, end: number, anchor: number, duration: number): { start: number; end: number } {
  let s = Math.max(0, start);
  let len = Math.min(LIMITS.sectionMax, Math.max(LIMITS.sectionMin, end - s));
  let e = s + len;
  if (anchor < s || anchor > e) {
    s = Math.max(0, anchor - 2);
    e = s + len;
  }
  if (duration > 0 && e > duration) {
    e = duration;
    s = Math.max(0, e - len);
  }
  return { start: round1(s), end: round1(e) };
}

export function alignToMoment(
  window: { start: number; end: number }, anchor: number, duration: number, analysis: VideoAnalysis,
): { start: number; end: number; aligned_to_moment: number } | null {
  const moment = [...analysis.important_moments]
    .filter((m) => KEY_MOMENT_TYPES.has(m.type))
    .sort((a, b) => a.time - b.time)[0];
  if (!moment) return null;
  const len = window.end - window.start;
  const start = anchor - moment.time;
  if (start < 0) return null;
  if (duration > 0 && start + len > duration) return null;
  if (anchor < start || anchor > start + len) return null;
  return { start: round1(start), end: round1(start + len), aligned_to_moment: moment.time };
}

export function selectSections(picks: Pick[], analysis: VideoAnalysis): Pick[] {
  return picks.map((p) => {
    const fitted = fitWindow(p.start_seconds, p.end_seconds, p.anchor_seconds, p.duration_seconds);
    const aligned = alignToMoment(fitted, p.anchor_seconds, p.duration_seconds, analysis);
    return aligned
      ? { ...p, start_seconds: aligned.start, end_seconds: aligned.end, aligned_to_moment: aligned.aligned_to_moment }
      : { ...p, start_seconds: fitted.start, end_seconds: fitted.end, aligned_to_moment: null };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/sections/selectSections.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/sections tests/engine/sections
git commit -m "Add section selection with feasible-only anchor alignment"
```

---

### Task 3.9: Explanations in the Songfit voice (strict, alignment-aware)

**Files:**
- Create: `src/engine/explain/explainPicks.ts`
- Test: `tests/engine/explain/explainPicks.test.ts`

**Interfaces:**
- Consumes: `Pick`, `FinalRecommendation`, `VideoAnalysis`, `MusicBrief`; `callClaude`; `extractJson`; `findItunesPreview` (Task 3.4); `DIMENSIONS`; `MODELS.explain`.
- Produces:
  ```ts
  export const PROMPT_VERSION = "explain-v2";
  export function spotifySearchUrl(title: string, artist: string): string;
  export function parseExplanations(text: string, ranks: number[]): { ok: true; byRank: Map<number, string> } | { ok: false; error: string };
  export async function explainPicks(picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief, deps?: { call?: ClaudeCall; itunes?: typeof findItunesPreview }): Promise<FinalRecommendation[]>;
  ```

Rulings C1 (all three required, one retry, then fail — no fit_reason fallback), C6/I9 (mention alignment only when `aligned_to_moment` is non-null; never claim trend status or platform availability), I5 (iTunes only for a missing preview; failure never blocks).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/explain/explainPicks.test.ts
import { describe, it, expect, vi } from "vitest";
import { explainPicks, spotifySearchUrl, buildExplainPrompt } from "@/src/engine/explain/explainPicks";
import { analysis, brief, pick } from "../fixtures";

const three = () => [
  pick({ rank: 1, title: "Song 1", aligned_to_moment: 7.8 }),
  pick({ rank: 2, deezer_id: "2", title: "Song 2", direction_label: "More current" }),
  pick({ rank: 3, deezer_id: "3", title: "Song 3", direction_label: "Unexpected", preview_url: "https://d.mp3" }),
];
const ok = JSON.stringify([{ rank: 1, explanation: "One." }, { rank: 2, explanation: "Two." }, { rank: 3, explanation: "Three." }]);

describe("explainPicks", () => {
  it("attaches explanations and spotify url; asks iTunes only for picks missing a preview", async () => {
    const call = vi.fn(async () => ok);
    const itunes = vi.fn(async (title: string) => (title === "Song 2" ? { itunesId: "99", previewUrl: "https://i.m4a" } : null));
    const out = await explainPicks(three(), analysis, brief, { call, itunes });
    expect(out.map((r) => r.explanation)).toEqual(["One.", "Two.", "Three."]);
    expect(out[0]!.spotify_url).toBe(spotifySearchUrl("Song 1", "The Weeknd"));
    expect(out[1]).toMatchObject({ preview_url: "https://i.m4a", itunes_id: "99" });
    expect(out[2]).toMatchObject({ preview_url: "https://d.mp3", itunes_id: null });
    expect(itunes.mock.calls.map((c) => c[0])).toEqual(["Song 1", "Song 2"]); // Song 3 already had a preview
  });
  it("retries once when a rank is missing, then throws", async () => {
    const call = vi.fn(async () => JSON.stringify([{ rank: 1, explanation: "One." }]));
    await expect(explainPicks(three(), analysis, brief, { call, itunes: async () => null })).rejects.toThrow(/explanation output invalid/);
    expect(call).toHaveBeenCalledTimes(2);
  });
  it("tells the model about alignment only where it happened", () => {
    const p = buildExplainPrompt(three(), analysis, brief);
    expect(p).toMatch(/#1 .*aligned: the song's moment lands at 7\.8s/);
    expect(p).toMatch(/#2 .*aligned: no/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/engine/explain/explainPicks.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/explain/explainPicks.ts
import { z } from "zod";
import { DIMENSIONS, type FinalRecommendation, type MusicBrief, type Pick, type VideoAnalysis } from "@/src/shared/types";
import { MODELS, LIMITS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { findItunesPreview } from "@/src/engine/catalog/itunes";

export const PROMPT_VERSION = "explain-v2";

const SYSTEM = `You write the two-sentence reasons under Songfit's song picks. Voice: a sharp friend who edits
video. Second person. Two sentences, each under 20 words. No hype, no emojis, no exclamation marks,
no words like "perfect", "vibe", "elevate". Never mention scores, models, AI, or how the pick was made.
Never claim a song is trending, viral, popular right now, or available on any platform.
Each reason names something specific from the video and says what the song section does for it.
Mention the song's moment landing on a video moment ONLY for picks marked "aligned: the song's moment lands at …".`;

const Item = z.object({ rank: z.number().int(), explanation: z.string().min(1) });

function topReasons(p: Pick): string {
  return DIMENSIONS
    .map((d) => p.component_scores[d])
    .filter((s) => s && s.reason)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.reason)
    .join("; ");
}

const fmt = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function buildExplainPrompt(picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief): string {
  const list = picks
    .map((p) => `#${p.rank} (${p.direction_label}): "${p.canonical_title}" — ${p.canonical_artist}, use ${fmt(p.start_seconds)}–${fmt(p.end_seconds)}; aligned: ${p.aligned_to_moment === null ? "no" : `the song's moment lands at ${p.aligned_to_moment}s of the video`}.
   Section: ${p.section_reason}. Why proposed: ${p.fit_reason}. Strongest reasons: ${topReasons(p) || "n/a"}.`)
    .join("\n");
  return `VIDEO: ${analysis.summary}
Key moments: ${analysis.important_moments.map((m) => `${m.time}s ${m.type}`).join("; ") || "none"}
BRIEF: ${brief.text}

PICKS
${list}

Return ONLY a JSON array with all ${picks.length} ranks: [{ "rank": 1, "explanation": "..." }, ...]`;
}

export function spotifySearchUrl(title: string, artist: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`)}`;
}

export function parseExplanations(text: string, ranks: number[]): { ok: true; byRank: Map<number, string> } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "no JSON found" };
  }
  const arr = z.array(Item).safeParse(raw);
  if (!arr.success) return { ok: false, error: arr.error.message };
  const byRank = new Map(arr.data.map((i) => [i.rank, i.explanation.trim()]));
  for (const r of ranks) if (!byRank.get(r)) return { ok: false, error: `missing rank ${r}` };
  return { ok: true, byRank };
}

export async function explainPicks(
  picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief,
  deps: { call?: ClaudeCall; itunes?: typeof findItunesPreview } = {},
): Promise<FinalRecommendation[]> {
  const call = deps.call ?? callClaude;
  const itunes = deps.itunes ?? findItunesPreview;
  const ranks = picks.map((p) => p.rank);
  const user = buildExplainPrompt(picks, analysis, brief);

  const previewsP = Promise.all(picks.map((p) => (p.preview_url ? Promise.resolve(null) : itunes(p.canonical_title, p.canonical_artist))));

  const started = Date.now();
  const first = await call({ model: MODELS.explain, system: SYSTEM, user, maxTokens: 1500, timeoutMs: LIMITS.modelTimeoutMs });
  let parsed = parseExplanations(first, ranks);
  if (!parsed.ok) {
    logger.warn("explain.retry", { error: parsed.error.slice(0, 300) });
    const second = await call({
      model: MODELS.explain, system: SYSTEM,
      user: `${user}\n\nPREVIOUS OUTPUT WAS INVALID. Validation error:\n${parsed.error.slice(0, 1000)}\nReturn the full corrected JSON array.`,
      maxTokens: 1500, timeoutMs: LIMITS.modelTimeoutMs,
    });
    parsed = parseExplanations(second, ranks);
    if (!parsed.ok) throw new PipelineError("recommend", `explanation output invalid: ${parsed.error.slice(0, 200)}`, second);
  }
  logger.info("explain", { ms: Date.now() - started });

  const previews = await previewsP;
  const byRank = parsed.byRank;
  return picks.map((p, i) => {
    const it = previews[i] ?? null;
    return {
      ...p,
      explanation: byRank.get(p.rank)!,
      spotify_url: spotifySearchUrl(p.canonical_title, p.canonical_artist),
      itunes_id: it?.itunesId ?? null,
      preview_url: p.preview_url ?? it?.previewUrl ?? null,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/engine/explain/explainPicks.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/explain tests/engine/explain
git commit -m "Add strict Songfit-voice explanations with alignment-aware prompting"
```

---
### Task 3.10: Orchestrator `recommendSubmission` (plugs into the Phase 2 runner)

**Files:**
- Create: `src/engine/recommend.ts`
- Modify: `src/pipeline/run.ts` (ONE line: the default `recommend` dep)
- Modify: `src/db/queries/submissions.ts` (`setSubmissionStatus` sets `recommended_at` only when null)
- Test: `tests/engine/recommend.test.ts`

**Interfaces:**
- Consumes: Tasks 3.2–3.9; from Phase 0: `getSubmission(id)`, `getAnalysis(submissionId) → { analysis, brief, row } | null`, `setSubmissionStatus(id, status, error?)`, `replaceCandidates(submissionId, rows: CandidateInsert[]) → CandidateRow[]` (rows carry `id`, `deezer_id`), `replaceRecommendations(submissionId, rows: RecommendationInsert[])`, `logEvent`, `PipelineError`; from Phase 2: `runSubmission(id, deps)` whose deps include `recommend: (submissionId: string) => Promise<void>` (Phase 2 ships a stub that throws `PipelineError("recommend", "not implemented")`).
- Produces:
  ```ts
  export type RecommendDeps = { getSubmission; getAnalysis; generate; verify; score; diversify; sections; explain; replaceCandidates; replaceRecommendations; setStatus; logEvent };
  export function toCandidateInsert(submissionId: string, c: GeneratedCandidate | ScoredCandidate, verified: boolean, promptVersion: string): CandidateInsert;
  export async function recommendSubmission(submissionId: string, deps?: RecommendDeps): Promise<void>;
  ```

Rulings C3 (one runner; this task does not rewrite `src/pipeline/run.ts`), I4 (regeneration merges with the first attempt by `deezer_id` and excludes seen keys), I7 (`recommendations_ready` carries `creatorId`), I8 (structured provenance persisted: canonical names, anchor, directions, both reasons, `source`, explain prompt version).

- [ ] **Step 1: Make `setSubmissionStatus` preserve the first `recommended_at`**

In `src/db/queries/submissions.ts` (Phase 0), change the `ready` branch so a retry never overwrites the first readiness time (I7):

```ts
export async function setSubmissionStatus(id: string, status: SubmissionStatus, error?: string | null): Promise<void> {
  const db = createServiceClient();
  const patch: Database["public"]["Tables"]["submissions"]["Update"] = { status, error: error ?? null };
  const { error: e1 } = await db.from("submissions").update(patch).eq("id", id);
  if (e1) throw e1;
  if (status === "ready") {
    // Only stamp recommended_at the first time; retries keep the original timestamp.
    const { error: e2 } = await db.from("submissions")
      .update({ recommended_at: new Date().toISOString() })
      .eq("id", id)
      .is("recommended_at", null);
    if (e2) throw e2;
  }
}
```

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 2: Write the failing orchestrator tests**

```ts
// tests/engine/recommend.test.ts
import { describe, it, expect, vi } from "vitest";
import { recommendSubmission, type RecommendDeps } from "@/src/engine/recommend";
import type { GeneratedCandidate, VerifiedCandidate, FinalRecommendation } from "@/src/shared/types";
import { analysis, brief, gen, ver, scored, pick } from "./fixtures";

const row = { id: "sub-1", creator_id: "cre-1", status: "recommending" } as never;
const finalsFrom = (vs: VerifiedCandidate[]): FinalRecommendation[] =>
  vs.slice(0, 3).map((v, i) => ({ ...pick({ ...v, rank: (i + 1) as 1 | 2 | 3 }), explanation: "e", spotify_url: "s", itunes_id: null }));

function makeDeps(over: Partial<RecommendDeps> = {}): RecommendDeps & { calls: string[] } {
  const calls: string[] = [];
  const deps: RecommendDeps = {
    getSubmission: vi.fn(async () => row),
    getAnalysis: vi.fn(async () => ({ analysis, brief, row: {} as never })),
    generate: vi.fn(async () => { calls.push("generate"); return []; }),
    verify: vi.fn(async () => { calls.push("verify"); return { verified: [], unverified: [] }; }),
    score: vi.fn(async (_a, _b, vs: VerifiedCandidate[]) => { calls.push("score"); return vs.map((v) => scored(v)); }),
    diversify: vi.fn((s) => { calls.push("diversify"); return s.slice(0, 3).map((c, i) => pick({ ...c, rank: (i + 1) as 1 | 2 | 3 })); }),
    sections: vi.fn((p) => { calls.push("sections"); return p; }),
    explain: vi.fn(async (p) => { calls.push("explain"); return p.map((x) => ({ ...x, explanation: "e", spotify_url: "s", itunes_id: null })); }),
    replaceCandidates: vi.fn(async (_id: string, rows: { deezer_id: string | null }[]) => {
      calls.push("replaceCandidates");
      return rows.map((r, i) => ({ id: `cand-${i}`, deezer_id: r.deezer_id })) as never;
    }),
    replaceRecommendations: vi.fn(async () => { calls.push("replaceRecommendations"); }),
    setStatus: vi.fn(async () => { calls.push("setStatus"); }),
    logEvent: vi.fn(async () => {}),
    ...over,
  };
  return Object.assign(deps, { calls });
}

describe("recommendSubmission", () => {
  it("runs the stages in order, persists unverified rows, links recommendations to candidate ids, logs with creatorId", async () => {
    const generated = [gen({ title: "V1" }), gen({ title: "V2" }), gen({ title: "V3" }), gen({ title: "Missing" })];
    const verified = generated.slice(0, 3).map((c, i) => ver({ ...c, deezer_id: String(i + 1) }));
    const deps = makeDeps({
      generate: vi.fn(async () => generated),
      verify: vi.fn(async () => ({ verified, unverified: [generated[3]!] })),
    });
    await recommendSubmission("sub-1", deps);
    expect(deps.calls.filter((c) => c !== "generate" && c !== "verify"))
      .toEqual(["score", "replaceCandidates", "diversify", "sections", "explain", "replaceRecommendations", "setStatus"]);
    const rows = (deps.replaceCandidates as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { verified: boolean; directions: string[]; anchor_seconds: number; source: string }[];
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => !r.verified)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "model", directions: ["safe"], anchor_seconds: 45 });
    expect(deps.setStatus).toHaveBeenCalledWith("sub-1", "ready");
    expect(deps.logEvent).toHaveBeenCalledWith(expect.objectContaining({ name: "recommendations_ready", creatorId: "cre-1", submissionId: "sub-1" }));
    const recRows = (deps.replaceRecommendations as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { candidate_id: string | null; explain_prompt_version: string }[];
    expect(recRows.map((r) => r.candidate_id)).toEqual(["cand-0", "cand-1", "cand-2"]);
    expect(recRows[0]!.explain_prompt_version).toBe("explain-v2");
  });

  it("regenerates once with exclusions and merges by deezer id", async () => {
    const first = [gen({ title: "A" }), gen({ title: "B" }), gen({ title: "Gone" })];
    const second = [gen({ title: "A - Remastered" }), gen({ title: "C" })]; // A again (same recording), plus C
    const generate = vi.fn(async (_b, _a, opts?: { exclude?: string[] }) => (opts?.exclude ? second : first));
    const verify = vi.fn(async (cands: GeneratedCandidate[]) => ({
      verified: cands.filter((c) => c.title !== "Gone").map((c) => ver({ ...c, deezer_id: c.title.startsWith("A") ? "10" : c.title === "B" ? "11" : "12" })),
      unverified: cands.filter((c) => c.title === "Gone"),
    }));
    const deps = makeDeps({ generate, verify });
    await recommendSubmission("sub-1", deps);
    expect(generate).toHaveBeenCalledTimes(2);
    const opts = (generate.mock.calls[1] as unknown[])[2] as { exclude: string[]; note: string };
    expect(opts.exclude).toEqual(expect.arrayContaining(["a|the weeknd", "b|the weeknd", "gone|the weeknd"]));
    expect(opts.note).toMatch(/could not be found/);
    const scoredArg = (deps.score as ReturnType<typeof vi.fn>).mock.calls[0]![2] as VerifiedCandidate[];
    expect(scoredArg.map((v) => v.deezer_id).sort()).toEqual(["10", "11", "12"]);
    const rows = (deps.replaceCandidates as ReturnType<typeof vi.fn>).mock.calls[0]![1] as { prompt_version: string }[];
    expect(rows.some((r) => r.prompt_version.endsWith("#2"))).toBe(true);
  });

  it("fails when still fewer than 3 distinct recordings after regeneration", async () => {
    const deps = makeDeps({
      generate: vi.fn(async () => [gen({ title: "X" })]),
      verify: vi.fn(async (c: GeneratedCandidate[]) => ({ verified: c.map((x) => ver({ ...x, deezer_id: "1" })), unverified: [] })),
    });
    await expect(recommendSubmission("sub-1", deps)).rejects.toThrow(/fewer than 3/);
    expect(deps.replaceCandidates).toHaveBeenCalled(); // what we saw is still persisted for the inspector
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test -- tests/engine/recommend.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Write the orchestrator**

```ts
// src/engine/recommend.ts
import type {
  FinalRecommendation, GeneratedCandidate, MusicBrief, Pick, ScoredCandidate, SubmissionStatus,
  VerifiedCandidate, VideoAnalysis,
} from "@/src/shared/types";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { generateCandidates, PROMPT_VERSION as CANDIDATES_VERSION, type GenerateOpts } from "@/src/engine/candidates/generateCandidates";
import { normalizeKey } from "@/src/engine/catalog/normalize";
import { verifyCandidates } from "@/src/engine/catalog/verifyCandidates";
import { scoreCandidates } from "@/src/engine/scoring/scoreCandidates";
import { PROMPT_VERSION as SCORING_VERSION } from "@/src/engine/scoring/modelScores";
import { diversify } from "@/src/engine/diversify/diversify";
import { selectSections } from "@/src/engine/sections/selectSections";
import { explainPicks, PROMPT_VERSION as EXPLAIN_VERSION } from "@/src/engine/explain/explainPicks";
import { getAnalysis } from "@/src/db/queries/analyses";
import { getSubmission, setSubmissionStatus, type SubmissionRow } from "@/src/db/queries/submissions";
import { replaceCandidates, type CandidateInsert, type CandidateRow } from "@/src/db/queries/candidates";
import { replaceRecommendations, type RecommendationInsert } from "@/src/db/queries/recommendations";
import { logEvent } from "@/src/feedback/events";

export type RecommendDeps = {
  getSubmission: (id: string) => Promise<SubmissionRow | null>;
  getAnalysis: (submissionId: string) => Promise<{ analysis: VideoAnalysis; brief: MusicBrief; row: unknown } | null>;
  generate: (brief: MusicBrief, analysis: VideoAnalysis, opts?: GenerateOpts) => Promise<GeneratedCandidate[]>;
  verify: (cands: GeneratedCandidate[]) => Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }>;
  score: (analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[]) => Promise<ScoredCandidate[]>;
  diversify: (scored: ScoredCandidate[]) => Pick[];
  sections: (picks: Pick[], analysis: VideoAnalysis) => Pick[];
  explain: (picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief) => Promise<FinalRecommendation[]>;
  replaceCandidates: (submissionId: string, rows: CandidateInsert[]) => Promise<CandidateRow[]>;
  replaceRecommendations: (submissionId: string, rows: RecommendationInsert[]) => Promise<void>;
  setStatus: (id: string, status: SubmissionStatus, error?: string | null) => Promise<void>;
  logEvent: typeof logEvent;
};

const defaultDeps: RecommendDeps = {
  getSubmission, getAnalysis,
  generate: generateCandidates, verify: verifyCandidates, score: scoreCandidates,
  diversify, sections: selectSections, explain: explainPicks,
  replaceCandidates, replaceRecommendations, setStatus: setSubmissionStatus, logEvent,
};

const RETRY_NOTE = "Several previous suggestions could not be found on Deezer as the original recording; propose different, well-known songs by the original artists.";

export function toCandidateInsert(
  submissionId: string, c: GeneratedCandidate | ScoredCandidate, verified: boolean, promptVersion: string,
): CandidateInsert {
  const s = c as Partial<ScoredCandidate>;
  return {
    submission_id: submissionId,
    title: c.title,
    artist: c.artist,
    canonical_title: s.canonical_title ?? null,
    canonical_artist: s.canonical_artist ?? null,
    deezer_id: s.deezer_id ?? null,
    itunes_id: null,
    duration_seconds: s.duration_seconds ?? null,
    verified,
    proposed_start: c.proposed_start,
    proposed_end: c.proposed_end,
    anchor_seconds: c.anchor_seconds,
    section_is_vocal: c.section_is_vocal,
    directions: c.directions,
    section_reason: c.section_reason,
    fit_reason: c.fit_reason,
    source: "model",
    song_id: null,
    segment_id: null,
    component_scores: s.component_scores ?? null,
    total_score: s.total_score ?? null,
    prompt_version: promptVersion,
  };
}

function toRecommendationInsert(submissionId: string, candidateId: string | null, r: FinalRecommendation): RecommendationInsert {
  return {
    submission_id: submissionId,
    candidate_id: candidateId,
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
  };
}

const distinctRecordings = (vs: VerifiedCandidate[]) => new Set(vs.map((v) => v.deezer_id)).size;

export async function recommendSubmission(submissionId: string, deps: RecommendDeps = defaultDeps): Promise<void> {
  const started = Date.now();
  const sub = await deps.getSubmission(submissionId);
  if (!sub) throw new PipelineError("recommend", "submission not found");
  const stored = await deps.getAnalysis(submissionId);
  if (!stored) throw new PipelineError("recommend", "no analysis stored for submission");
  const { analysis, brief } = stored;

  // Attempt 1
  const gen1 = await deps.generate(brief, analysis);
  const v1 = await deps.verify(gen1);
  let verified = v1.verified;
  let unverified = v1.unverified;
  const versionOf = new Map<string, string>(gen1.map((c) => [normalizeKey(c.title, c.artist), CANDIDATES_VERSION]));

  // Attempt 2 (I4): keep what we have, exclude everything seen, merge by recording id.
  if (distinctRecordings(verified) < 3) {
    const exclude = gen1.map((c) => normalizeKey(c.title, c.artist));
    logger.warn("recommend.regenerate", { submissionId, verified: distinctRecordings(verified) });
    const gen2 = await deps.generate(brief, analysis, { note: RETRY_NOTE, exclude });
    for (const c of gen2) versionOf.set(normalizeKey(c.title, c.artist), `${CANDIDATES_VERSION}#2`);
    const v2 = await deps.verify(gen2);
    const seen = new Set(verified.map((v) => v.deezer_id));
    for (const v of v2.verified) if (!seen.has(v.deezer_id)) { verified.push(v); seen.add(v.deezer_id); }
    unverified = [...unverified, ...v2.unverified];
  }

  const scored = distinctRecordings(verified) >= 3 ? await deps.score(analysis, brief, verified) : [];
  const rows: CandidateInsert[] = [
    ...scored.map((c) => toCandidateInsert(submissionId, c, true, `${versionOf.get(normalizeKey(c.title, c.artist)) ?? CANDIDATES_VERSION}+${SCORING_VERSION}`)),
    ...(scored.length ? [] : verified).map((c) => toCandidateInsert(submissionId, c, true, versionOf.get(normalizeKey(c.title, c.artist)) ?? CANDIDATES_VERSION)),
    ...unverified.map((c) => toCandidateInsert(submissionId, c, false, versionOf.get(normalizeKey(c.title, c.artist)) ?? CANDIDATES_VERSION)),
  ];
  const inserted = await deps.replaceCandidates(submissionId, rows); // persisted even when we fail next, for the inspector
  if (distinctRecordings(verified) < 3) {
    throw new PipelineError("recommend", `fewer than 3 verified candidates (${distinctRecordings(verified)})`);
  }
  const idByDeezer = new Map(inserted.filter((r) => r.deezer_id).map((r) => [r.deezer_id as string, r.id]));

  const picks = deps.sections(deps.diversify(scored), analysis);
  const finals = await deps.explain(picks, analysis, brief);

  await deps.replaceRecommendations(
    submissionId,
    finals.map((r) => toRecommendationInsert(submissionId, idByDeezer.get(r.deezer_id) ?? null, r)),
  );
  await deps.setStatus(submissionId, "ready");
  await deps.logEvent({
    name: "recommendations_ready", creatorId: sub.creator_id, submissionId,
    metadata: { candidates: rows.length, verified: distinctRecordings(verified), ms: Date.now() - started },
  });
}
```

- [ ] **Step 5: Plug into the runner (one line)**

In `src/pipeline/run.ts` (Phase 2), replace the stub import in the default deps:

```ts
// before (Phase 2 stub)
// recommend: async (id) => { throw new PipelineError("recommend", "not implemented"); },
// after
import { recommendSubmission } from "@/src/engine/recommend";
// … in defaultDeps:
recommend: recommendSubmission,
```

Nothing else in `run.ts` changes: status handling, the atomic claim, the time budget and `pipeline_failed` logging all stay as Phase 2 wrote them (ruling C3).

- [ ] **Step 6: Run tests**

Run: `pnpm test -- tests/engine tests/pipeline`
Expected: PASS, all engine tests (recommend: 3) and the Phase 2 pipeline tests still green.

- [ ] **Step 7: Commit**

```bash
pnpm typecheck && git add src/engine/recommend.ts src/pipeline/run.ts src/db/queries/submissions.ts tests/engine/recommend.test.ts
git commit -m "Add recommendation orchestrator with merged regeneration and plug it into the runner"
```

---

### Task 3.11: Results page and recommendation cards (`RecommendationView` only)

**Files:**
- Create: `src/shared/format.ts`, `src/shared/views.ts`, `components/RecommendationCard.tsx`, `components/ResultsView.tsx`
- Modify: `app/api/submissions/[id]/route.ts`, `app/results/[id]/page.tsx`
- Modify: `src/db/queries/submissions.ts` (add `markViewed`)
- Test: `tests/shared/format.test.ts`, `tests/shared/views.test.ts`

**Interfaces:**
- Consumes: `listRecommendations` (Phase 0), `getSubmission`, `getCreator` (Phase 1), `logEvent`, `<WaitingState submissionId>` (Phase 1), `RecommendationView` (header).
- Produces:
  ```ts
  export function formatTime(seconds: number): string;                                  // "0:43"
  export function toRecommendationView(row: RecommendationRow): RecommendationView;      // the ONLY mapper to the browser shape
  // GET /api/submissions/[id] → { status: SubmissionStatus; recommendations: RecommendationView[] }
  // <RecommendationCard rec chosen collapsed onSelect onReject />
  // <ResultsView submissionId recommendations />   (Phase 4 wires real handlers; here local state)
  ```

Rulings C5 (one DTO, no scores/reasons/directions to the browser), I10 (`selected`/`rejected` come from the server so refresh keeps state), C6 (footer copy).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/shared/format.test.ts
import { describe, it, expect } from "vitest";
import { formatTime } from "@/src/shared/format";

describe("formatTime", () => {
  it("formats m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(43)).toBe("0:43");
    expect(formatTime(67.4)).toBe("1:07");
    expect(formatTime(600)).toBe("10:00");
  });
});
```

```ts
// tests/shared/views.test.ts
import { describe, it, expect } from "vitest";
import { toRecommendationView } from "@/src/shared/views";
import { RecommendationView } from "@/src/shared/types";

describe("toRecommendationView", () => {
  it("maps a row to the browser shape and nothing more", () => {
    const row = {
      id: "r1", submission_id: "s1", candidate_id: "c1", rank: 1, direction_label: "Best fit", title: "T", artist: "A",
      start_seconds: "43", end_seconds: "58", aligned_to_moment: 7.8, explanation: "e", explain_prompt_version: "explain-v2",
      spotify_url: "https://open.spotify.com/search/T%20A", deezer_url: "d", artwork_url: null, preview_url: null,
      selected: false, rejected: true, created_at: "2026-10-07T00:00:00Z",
    } as never;
    const v = toRecommendationView(row);
    expect(RecommendationView.parse(v)).toEqual(v);
    expect(v).toMatchObject({ rank: 1, start_seconds: 43, end_seconds: 58, rejected: true, selected: false });
    expect(Object.keys(v).sort()).toEqual(Object.keys(RecommendationView.shape).sort());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/shared/format.test.ts tests/shared/views.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `formatTime` and the view mapper**

```ts
// src/shared/format.ts
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
```

```ts
// src/shared/views.ts
import { RecommendationView } from "@/src/shared/types";
import type { RecommendationRow } from "@/src/db/queries/recommendations";

/** Everything the browser is allowed to see about a recommendation. Validated so a new column never leaks by accident. */
export function toRecommendationView(r: RecommendationRow): RecommendationView {
  return RecommendationView.parse({
    rank: r.rank,
    direction_label: r.direction_label,
    title: r.title,
    artist: r.artist,
    start_seconds: Number(r.start_seconds),
    end_seconds: Number(r.end_seconds),
    explanation: r.explanation,
    artwork_url: r.artwork_url,
    preview_url: r.preview_url,
    spotify_url: r.spotify_url,
    selected: r.selected,
    rejected: r.rejected,
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/shared/format.test.ts tests/shared/views.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Return recommendations from the status route**

```ts
// app/api/submissions/[id]/route.ts
import { NextResponse } from "next/server";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { toRecommendationView } from "@/src/shared/views";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sub = await getSubmission(id);
  if (!sub || sub.creator_id !== creator.id) return NextResponse.json({ error: "not found" }, { status: 404 });
  const recommendations = sub.status === "ready" ? (await listRecommendations(id)).map(toRecommendationView) : [];
  return NextResponse.json({ status: sub.status, recommendations });
}
```

- [ ] **Step 6: Add `markViewed` and render the results page**

```ts
// add to src/db/queries/submissions.ts
/** Sets viewed_at once; returns true the first time. */
export async function markViewed(id: string): Promise<boolean> {
  const res = await createServiceClient().from("submissions")
    .update({ viewed_at: new Date().toISOString() }).eq("id", id).is("viewed_at", null).select("id");
  if (res.error) throw res.error;
  return res.data.length > 0;
}
```

```tsx
// app/results/[id]/page.tsx
import { redirect, notFound } from "next/navigation";
import { getCreator } from "@/src/auth/session";
import { getSubmission, markViewed } from "@/src/db/queries/submissions";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { toRecommendationView } from "@/src/shared/views";
import { logEvent } from "@/src/feedback/events";
import { WaitingState } from "@/components/WaitingState";
import { ResultsView } from "@/components/ResultsView";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const creator = await getCreator();
  if (!creator) redirect(`/?next=/results/${id}`);
  const sub = await getSubmission(id);
  if (!sub || sub.creator_id !== creator.id) notFound();

  if (sub.status !== "ready") return <WaitingState submissionId={id} status={sub.status} />;

  if (await markViewed(id)) {
    await logEvent({ name: "recommendations_viewed", creatorId: creator.id, submissionId: id });
  }
  const recs = (await listRecommendations(id)).map(toRecommendationView);
  return <ResultsView submissionId={id} recommendations={recs} />;
}
```

`WaitingState` gains an optional `status` prop here so a `failed` submission can render the honest failure state (ruling I10); Phase 4 Task 4.1 wires the copy. For this task pass it through; `WaitingState` may ignore it.

```tsx
// components/ResultsView.tsx
"use client";
import { useState } from "react";
import { RecommendationCard } from "@/components/RecommendationCard";
import type { RecommendationView } from "@/src/shared/types";

export function ResultsView({ submissionId, recommendations }: { submissionId: string; recommendations: RecommendationView[] }) {
  // Phase 4 replaces local state with the feedback API; the server-provided selected/rejected flags seed it.
  const [selected, setSelected] = useState<number | null>(recommendations.find((r) => r.selected)?.rank ?? null);
  const [rejected, setRejected] = useState<Set<number>>(new Set(recommendations.filter((r) => r.rejected).map((r) => r.rank)));
  void submissionId;

  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your Songfit</h1>
      <p className="mt-1 text-sm text-ink/60">Three songs that fit this video. Tap one to use it.</p>
      <div className="mt-6 flex flex-col gap-4">
        {recommendations.map((r) => (
          <RecommendationCard
            key={r.rank}
            rec={{ ...r, selected: selected === r.rank, rejected: rejected.has(r.rank) }}
            chosen={selected === r.rank}
            collapsed={selected !== null && selected !== r.rank}
            onSelect={(rank) => setSelected(rank)}
            onReject={(rank) => setRejected((s) => new Set(s).add(rank))}
          />
        ))}
      </div>
      <p className="mt-8 text-center text-xs text-ink/50">Sections are our best estimate. Check it against the track.</p>
    </main>
  );
}
```

```tsx
// components/RecommendationCard.tsx
"use client";
import { useRef, useState } from "react";
import { formatTime } from "@/src/shared/format";
import type { RecommendationView } from "@/src/shared/types";

type Props = {
  rec: RecommendationView;
  chosen: boolean;
  collapsed: boolean;
  onSelect: (rank: number) => void;
  onReject: (rank: number) => void;
};

export function RecommendationCard({ rec, chosen, collapsed, onSelect, onReject }: Props) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const featured = rec.rank === 1;
  if (collapsed) return null;

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); } else { void el.play(); setPlaying(true); }
  };

  return (
    <article className={["rounded-2xl border border-ink/10 bg-white shadow-sm transition", featured ? "p-5" : "p-4", rec.rejected ? "opacity-40" : ""].join(" ")}>
      <div className="flex gap-4">
        {rec.artwork_url ? (
          <img src={rec.artwork_url} alt="" className={featured ? "h-24 w-24 rounded-xl object-cover" : "h-16 w-16 rounded-lg object-cover"} />
        ) : (
          <div className={featured ? "h-24 w-24 rounded-xl bg-ink/5" : "h-16 w-16 rounded-lg bg-ink/5"} />
        )}
        <div className="min-w-0 flex-1">
          <span className="inline-block rounded-full bg-steel/10 px-2 py-0.5 text-xs font-medium text-steel">#{rec.rank} {rec.direction_label}</span>
          <h2 className={featured ? "mt-1 truncate text-lg font-semibold text-ink" : "mt-1 truncate font-semibold text-ink"}>{rec.title}</h2>
          <p className="truncate text-sm text-ink/60">{rec.artist}</p>
          <p className="mt-2 text-base font-bold text-ink">Use {formatTime(rec.start_seconds)}–{formatTime(rec.end_seconds)}</p>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-ink/80">{rec.explanation}</p>

      <div className="mt-3 flex items-center gap-3 text-sm">
        {rec.preview_url && (
          <>
            <audio ref={audio} src={rec.preview_url} preload="none" onEnded={() => setPlaying(false)} />
            <button type="button" onClick={toggle} className="rounded-full border border-ink/15 px-3 py-1 text-ink">
              {playing ? "Pause preview" : "Play preview"}
            </button>
          </>
        )}
        <a href={rec.spotify_url} target="_blank" rel="noopener noreferrer" className="text-steel underline-offset-2 hover:underline">Open in Spotify</a>
      </div>

      {!chosen && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onSelect(rec.rank)} className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white">Use this</button>
          <button type="button" onClick={() => onReject(rec.rank)} className="rounded-xl border border-ink/15 px-4 py-3 text-sm font-medium text-ink">Not for me</button>
        </div>
      )}
      {chosen && <p className="mt-4 text-sm font-medium text-steel">Chosen. Go make it.</p>}
    </article>
  );
}
```

Tailwind tokens `ink` and `steel` come from Phase 0's `tailwind.config.ts`.

- [ ] **Step 7: Check it renders**

Run: `pnpm typecheck && pnpm dev`, open `/results/<id of a ready submission>` at a 390 px viewport.
Expected: "Your Songfit", three cards with #1 larger, bold "Use m:ss–m:ss", no preview button (previews disabled), "Open in Spotify" opens a search in a new tab, "Use this" hides the other two, "Not for me" dims a card, the footer line is present. Refreshing does not log a second `recommendations_viewed` event. The JSON from `/api/submissions/<id>` contains no `component_scores`, `directions`, `anchor_seconds` or `deezer_id`.

- [ ] **Step 8: Commit**

```bash
git add src/shared/format.ts src/shared/views.ts tests/shared components/RecommendationCard.tsx components/ResultsView.tsx app/results app/api/submissions src/db/queries/submissions.ts
git commit -m "Add results page with RecommendationView-only cards"
```

---

### Task 3.12: Admin inspector: plain candidates table and final picks

**Files:**
- Create: `components/admin/CandidatesTable.tsx`
- Modify: `app/admin/submissions/[id]/page.tsx`

**Interfaces:**
- Consumes: `listCandidates` (Phase 0), `listRecommendations`, `requireAdmin` (Phase 1), the Phase 2 inspector page.
- Produces: nothing new for other tasks.

Ruling M1: a plain table, no presentation work.

- [ ] **Step 1: Write the table component**

```tsx
// components/admin/CandidatesTable.tsx
import { DIMENSIONS, type ComponentScores } from "@/src/shared/types";
import type { CandidateRow } from "@/src/db/queries/candidates";
import { formatTime } from "@/src/shared/format";

export function CandidatesTable({ rows }: { rows: CandidateRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left">
            <th className="p-1">#</th><th className="p-1">Song</th><th className="p-1">Dirs</th><th className="p-1">Verified</th>
            <th className="p-1">Anchor</th><th className="p-1">Window</th><th className="p-1">Total</th>
            {DIMENSIONS.map((d) => <th key={d} className="p-1">{d.slice(0, 4)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const scores = r.component_scores as ComponentScores | null;
            return (
              <tr key={r.id} className={r.verified ? "" : "text-gray-400"}>
                <td className="p-1">{i + 1}</td>
                <td className="p-1" title={`${r.section_reason} / ${r.fit_reason}`}>{r.canonical_title ?? r.title} — {r.canonical_artist ?? r.artist}</td>
                <td className="p-1">{(r.directions ?? []).join(",")}</td>
                <td className="p-1">{r.verified ? "yes" : "no"}</td>
                <td className="p-1">{formatTime(Number(r.anchor_seconds))}</td>
                <td className="p-1">{formatTime(Number(r.proposed_start))}–{formatTime(Number(r.proposed_end))}</td>
                <td className="p-1 font-mono">{r.total_score === null ? "—" : Number(r.total_score).toFixed(2)}</td>
                {DIMENSIONS.map((d) => {
                  const s = scores?.[d];
                  return <td key={d} className="p-1 font-mono" title={s?.reason ?? ""}>{s ? s.score.toFixed(2) : "—"}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Add the sections to the inspector page**

In `app/admin/submissions/[id]/page.tsx` (Phase 2), after the brief/transcript sections:

```tsx
import { listCandidates } from "@/src/db/queries/candidates";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { CandidatesTable } from "@/components/admin/CandidatesTable";
import { formatTime } from "@/src/shared/format";

// inside the component, after loading the submission (requireAdmin() already ran in this page per M3):
const [candidates, recs] = await Promise.all([listCandidates(id), listRecommendations(id)]);

// JSX:
<section className="mt-8">
  <h2 className="text-lg font-semibold">Final 3</h2>
  {recs.length === 0 ? <p className="text-sm text-gray-500">none yet</p> : (
    <ol className="mt-2 space-y-2 text-sm">
      {recs.map((r) => (
        <li key={r.id}>
          <b>#{r.rank} {r.direction_label}</b>: {r.title} — {r.artist}, use {formatTime(Number(r.start_seconds))}–{formatTime(Number(r.end_seconds))}
          {r.aligned_to_moment !== null && <span className="text-gray-500"> (aligned to {r.aligned_to_moment}s)</span>}
          <div className="text-gray-600">{r.explanation}</div>
        </li>
      ))}
    </ol>
  )}
</section>
<section className="mt-8">
  <h2 className="text-lg font-semibold">Candidates ({candidates.length}, {candidates.filter((c) => c.verified).length} verified)</h2>
  <CandidatesTable rows={candidates} />
</section>
```

- [ ] **Step 3: Check it renders**

Run: `pnpm typecheck && pnpm dev`, open `/admin/submissions/<id>` as the admin.
Expected: "Final 3" with alignment notes where present, and a candidates table sorted by total with unverified rows greyed out; hovering a score shows its reason; hovering a song shows both reasons.

- [ ] **Step 4: Commit**

```bash
git add components/admin/CandidatesTable.tsx app/admin/submissions
git commit -m "Show candidates with anchors, directions and component scores in admin inspector"
```

---

### Phase 3 demo check

Do this with real keys in `.env.local` against the hosted Supabase project.

- [ ] 1. Upload a real 20–60 s Reel from the upload screen (Phase 1 flow). Note the submission id from the URL.
- [ ] 2. Watch the logs: three `candidates.direction` lines, `verifyCandidates { total: ~70, verified: ~50-60, providerErrors: 0 }`, `scoring { ms, candidates }`, `explain { ms }`, then `recommendations_ready` with `ms`. Target: under 120 s end to end.
- [ ] 3. Results page: 3 real songs. For each, open the Spotify link and confirm the song exists by that artist. In admin, confirm `start_seconds < end_seconds <= duration_seconds` and that the anchor lies inside the window.
- [ ] 4. Admin inspector: ~60 scored rows plus greyed unverified rows; all three directions represented among verified rows; scores not clustered (if they sit at 0.7, tighten the "use the full range" instruction and bump `PROMPT_VERSION` to `scoring-v3`).
- [ ] 5. Per-stage cost and latency: from the `model.call` log lines (tokens, stop reason) and the Anthropic console, record input/output tokens and dollars for candidates (3 calls), scoring (1), explain (1), plus Whisper and analysis from Phase 2. Write the per-run total and elapsed time into `docs/RESEARCH.md` under a dated entry "First end-to-end run". If a stop reason is `max_tokens`, raise the stage's `maxTokens` and note it.
- [ ] 6. Run the full gate: `pnpm typecheck && pnpm test && pnpm build`. Expected: all green, build succeeds.
- [ ] 7. Commit any prompt tweaks with bumped `PROMPT_VERSION` constants.
## Phase 4 — Feedback, paywall, admin metrics, launch

**Demo when done:** on thissongfits.com from a phone: upload → results → "Use this" → offer → pay (Stripe test mode) → thanks (entitlement confirmed) → second upload allowed. A second creator who has not paid hits `/subscribe` on their second upload. `/admin/metrics` shows the funnel with distinct creators and distinct submissions.

Assumes Phases 0–3 are merged. From Phase 0 (migrations 0001–0003 and queries): `recommendations.selected` / `recommendations.rejected`, `stripe_events(id, type, processed_at)`, `submissions.updated_at` + trigger, SQL functions `create_submission()` and `claim_submission_run()`, queries `recordStripeEvent(id, type)`, `markRecommendationFeedback(submissionId, rank, { selected?, rejected? })` (selecting a rank clears `selected` on the other ranks), `listRecommendations(submissionId)`, `getSubmission`, `getActiveSubscription`, `activateSubscription`, `listSubmissions`, `insertEvent`, and `logger` from `src/shared/logger.ts`. From Phase 1: Task 1.7 did the first Vercel deploy, the submit route runs the pipeline via `waitUntil(runSubmission(id))`, `getCreator()` / `requireAdmin()`. From Phase 3: `GET /api/submissions/[id]` returns `RecommendationView[]` (with `selected`/`rejected`), `RecommendationCard` takes `{ rec, chosen, collapsed, onSelect, onReject }`, the admin queue and inspector exist, and the queue already highlights failed rows with their error text and a Retry form.

Rulings applied in this phase (see `docs/review/03-claude-rulings.md`): C4 (Stripe order and validation), C5 (`RecommendationView` DTO), I7 (metrics correctness), I10 (honest billing/feedback UX), M1 (queue polish cut), M2 (hosted Supabase, metrics grants), M3 (admin gate per page/action, no raw errors, retention disclosure).

Migration numbering after Phase 0 ships 0001–0003: this phase adds only `0004_metrics.sql` (Task 4.5). There is no feedback migration.

---

### Task 4.1: Feedback actions and API route

**Files:**
- Create: `src/feedback/actions.ts`
- Create: `app/api/submissions/[id]/feedback/route.ts`
- Modify: `src/db/queries/events.ts` (add `hasEvent`)
- Test: `tests/feedback/actions.test.ts`

No migration: `recommendations.selected`, `recommendations.rejected` and `stripe_events` were created in Phase 0 (`0001_init.sql`). If `pnpm db:types` output lacks `selected` on `recommendations`, stop and fix Phase 0 Task 0.3 first.

**Interfaces:**
- Consumes: `logEvent({ name, creatorId, submissionId, metadata })` from `src/feedback/events.ts`; `getSubmission(id)` → `{ id, creator_id, status, ... } | null`; `markRecommendationFeedback(submissionId, rank, patch)` from `src/db/queries/recommendations.ts` — returns the number of rows updated (`Promise<number>`); `insertEvent` / `createServiceClient()`; `getCreator()`.
- Produces:
  ```ts
  // src/db/queries/events.ts
  export async function hasEvent(submissionId: string, name: EventName, metadata?: Record<string, unknown>): Promise<boolean>;
  // src/feedback/actions.ts
  export type Rank = 1 | 2 | 3;
  export type FeedbackAction = "select" | "reject" | "all_rejected";
  export class FeedbackError extends Error { status: 403 | 404 }
  export async function selectRecommendation(submissionId: string, rank: Rank, creatorId: string): Promise<void>;
  export async function rejectRecommendation(submissionId: string, rank: Rank, creatorId: string): Promise<void>;
  export async function allRejected(submissionId: string, creatorId: string): Promise<void>;
  ```
  Route: `POST /api/submissions/[id]/feedback` body `{ action: "select" | "reject"; rank: 1|2|3 } | { action: "all_rejected" }` → `204`; `400` bad body; `401` signed out; `403` not owner; `404` no submission or no such recommendation. Offer events are NOT on this route (Task 4.3 adds `/api/offer-events`).

- [ ] **Step 1: Write the failing test**

`tests/feedback/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const markRecommendationFeedback = vi.fn();
const getSubmission = vi.fn();
const hasEvent = vi.fn();
const logEvent = vi.fn();
vi.mock("@/src/db/queries/recommendations", () => ({ markRecommendationFeedback }));
vi.mock("@/src/db/queries/submissions", () => ({ getSubmission }));
vi.mock("@/src/db/queries/events", () => ({ hasEvent }));
vi.mock("@/src/feedback/events", () => ({ logEvent }));

import { selectRecommendation, rejectRecommendation, allRejected, FeedbackError } from "@/src/feedback/actions";

const owned = { id: "sub-1", creator_id: "cre-1", status: "ready" };

describe("feedback actions", () => {
  beforeEach(() => {
    markRecommendationFeedback.mockReset().mockResolvedValue(1);
    getSubmission.mockReset().mockResolvedValue(owned);
    hasEvent.mockReset().mockResolvedValue(false);
    logEvent.mockReset();
  });

  it("select marks the row exclusively and logs recommendation_selected with creator and rank", async () => {
    await selectRecommendation("sub-1", 2, "cre-1");
    expect(markRecommendationFeedback).toHaveBeenCalledWith("sub-1", 2, { selected: true, rejected: false });
    expect(logEvent).toHaveBeenCalledWith({ name: "recommendation_selected", creatorId: "cre-1", submissionId: "sub-1", metadata: { rank: 2 } });
  });

  it("select does not log twice for the same submission and rank", async () => {
    hasEvent.mockResolvedValue(true);
    await selectRecommendation("sub-1", 2, "cre-1");
    expect(markRecommendationFeedback).toHaveBeenCalledTimes(1);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("reject marks the row and logs recommendation_rejected", async () => {
    await rejectRecommendation("sub-1", 3, "cre-1");
    expect(markRecommendationFeedback).toHaveBeenCalledWith("sub-1", 3, { rejected: true, selected: false });
    expect(logEvent).toHaveBeenCalledWith({ name: "recommendation_rejected", creatorId: "cre-1", submissionId: "sub-1", metadata: { rank: 3 } });
  });

  it("refuses a submission owned by someone else before touching anything", async () => {
    getSubmission.mockResolvedValue({ ...owned, creator_id: "someone-else" });
    await expect(selectRecommendation("sub-1", 1, "cre-1")).rejects.toBeInstanceOf(FeedbackError);
    expect(markRecommendationFeedback).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("does not log when no recommendation row was updated", async () => {
    markRecommendationFeedback.mockResolvedValue(0);
    await expect(selectRecommendation("sub-1", 1, "cre-1")).rejects.toMatchObject({ status: 404 });
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("allRejected logs all_rejected then more_like_this_requested with the creator", async () => {
    await allRejected("sub-1", "cre-1");
    expect(logEvent.mock.calls.map((c) => c[0])).toEqual([
      { name: "all_rejected", creatorId: "cre-1", submissionId: "sub-1" },
      { name: "more_like_this_requested", creatorId: "cre-1", submissionId: "sub-1" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/feedback/actions.test.ts`
Expected: FAIL — `Cannot find module '@/src/feedback/actions'`.

- [ ] **Step 3: Add `hasEvent` to the events query**

Append to `src/db/queries/events.ts`:

```ts
/** True when an event with this name (and, if given, this exact metadata) already exists for the submission. */
export async function hasEvent(
  submissionId: string,
  name: EventName,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  let q = createServiceClient()
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", submissionId)
    .eq("name", name);
  if (metadata) q = q.contains("metadata", metadata);
  const { count, error } = await q;
  if (error) throw error;
  return (count ?? 0) > 0;
}
```

(`EventName` is already imported in that file from `@/src/feedback/events`; if not, add `import type { EventName } from "@/src/feedback/events";`.)

- [ ] **Step 4: Write the actions**

`src/feedback/actions.ts`:

```ts
import { markRecommendationFeedback } from "@/src/db/queries/recommendations";
import { getSubmission } from "@/src/db/queries/submissions";
import { hasEvent } from "@/src/db/queries/events";
import { logEvent } from "@/src/feedback/events";

export type Rank = 1 | 2 | 3;
export type FeedbackAction = "select" | "reject" | "all_rejected";

export class FeedbackError extends Error {
  constructor(public status: 403 | 404, message: string) {
    super(message);
  }
}

/** Throws unless the submission exists and belongs to the creator. Runs before any write or log. */
async function assertOwned(submissionId: string, creatorId: string): Promise<void> {
  const submission = await getSubmission(submissionId);
  if (!submission) throw new FeedbackError(404, "submission not found");
  if (submission.creator_id !== creatorId) throw new FeedbackError(403, "not your submission");
}

export async function selectRecommendation(submissionId: string, rank: Rank, creatorId: string): Promise<void> {
  await assertOwned(submissionId, creatorId);
  // Exclusive: the query clears `selected` on the other ranks in the same statement.
  const updated = await markRecommendationFeedback(submissionId, rank, { selected: true, rejected: false });
  if (updated === 0) throw new FeedbackError(404, "no such recommendation");
  if (await hasEvent(submissionId, "recommendation_selected", { rank })) return;
  await logEvent({ name: "recommendation_selected", creatorId, submissionId, metadata: { rank } });
}

export async function rejectRecommendation(submissionId: string, rank: Rank, creatorId: string): Promise<void> {
  await assertOwned(submissionId, creatorId);
  const updated = await markRecommendationFeedback(submissionId, rank, { rejected: true, selected: false });
  if (updated === 0) throw new FeedbackError(404, "no such recommendation");
  if (await hasEvent(submissionId, "recommendation_rejected", { rank })) return;
  await logEvent({ name: "recommendation_rejected", creatorId, submissionId, metadata: { rank } });
}

export async function allRejected(submissionId: string, creatorId: string): Promise<void> {
  await assertOwned(submissionId, creatorId);
  if (await hasEvent(submissionId, "all_rejected")) return;
  await logEvent({ name: "all_rejected", creatorId, submissionId });
  await logEvent({ name: "more_like_this_requested", creatorId, submissionId });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/feedback/actions.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Write the route**

`app/api/submissions/[id]/feedback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { selectRecommendation, rejectRecommendation, allRejected, FeedbackError } from "@/src/feedback/actions";
import { logger } from "@/src/shared/logger";

const Rank = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select"), rank: Rank }),
  z.object({ action: z.literal("reject"), rank: Rank }),
  z.object({ action: z.literal("all_rejected") }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  try {
    const body = parsed.data;
    if (body.action === "select") await selectRecommendation(id, body.rank, creator.id);
    else if (body.action === "reject") await rejectRecommendation(id, body.rank, creator.id);
    else await allRejected(id, creator.id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof FeedbackError) return NextResponse.json({ error: e.message }, { status: e.status });
    logger.error("feedback.failed", { submissionId: id, err: String(e) });
    return NextResponse.json({ error: "feedback_failed" }, { status: 500 }); // generic: no raw error text to creators
  }
}
```

- [ ] **Step 7: Typecheck and manual check**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass.

With `pnpm dev` up and a signed-in browser, in the console on a ready `/results/<id>`:

```js
await fetch(location.pathname.replace("/results/", "/api/submissions/") + "/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "select", rank: 1 }) }).then(r => r.status)
```
Expected: `204`; in Supabase Studio the rank-1 row has `selected = true`, ranks 2–3 have `selected = false`, and `events` has exactly one `recommendation_selected` row with `creator_id` set even after running the snippet twice.

- [ ] **Step 8: Commit**

```bash
git add src/feedback/actions.ts src/db/queries/events.ts app/api/submissions/[id]/feedback/route.ts tests/feedback/actions.test.ts
git commit -m "Add owned, idempotent feedback actions and API route"
```

---

### Task 4.2: Results state reducer and client wiring

**Files:**
- Create: `src/feedback/resultsState.ts`
- Create: `components/ResultsClient.tsx`
- Modify: `app/results/[id]/page.tsx` (render `ResultsClient` instead of mapping cards directly)
- Test: `tests/feedback/resultsState.test.ts`

**Interfaces:**
- Consumes: `RecommendationView` from `@/src/shared/types` (fields `rank, direction_label, title, artist, start_seconds, end_seconds, explanation, artwork_url, preview_url, spotify_url, selected, rejected`); `RecommendationCard` props `{ rec: RecommendationView; chosen: boolean; collapsed: boolean; onSelect: (rank) => void; onReject: (rank) => void }` (Phase 3); `Offer` from Task 4.3 (stub in Step 7 if executed first).
- Produces:
  ```ts
  // src/feedback/resultsState.ts
  export type Rank = 1 | 2 | 3;
  export type ResultsState = { chosen: Rank | null; rejected: Rank[]; showOffer: boolean; allRejected: boolean };
  export type ResultsAction = { type: "select"; rank: Rank } | { type: "reject"; rank: Rank };
  export function initialResultsState(recs: { rank: Rank; selected: boolean; rejected: boolean }[]): ResultsState;
  export function nextResultsState(state: ResultsState, action: ResultsAction): ResultsState;
  ```
  State is derived from the server's `selected`/`rejected` flags on load, so a refresh shows the same choice.

- [ ] **Step 1: Write the failing test**

`tests/feedback/resultsState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { initialResultsState, nextResultsState } from "@/src/feedback/resultsState";

const fresh = () => initialResultsState([
  { rank: 1, selected: false, rejected: false },
  { rank: 2, selected: false, rejected: false },
  { rank: 3, selected: false, rejected: false },
]);

describe("results state", () => {
  it("select sets chosen and shows the offer", () => {
    const s = nextResultsState(fresh(), { type: "select", rank: 2 });
    expect(s.chosen).toBe(2);
    expect(s.showOffer).toBe(true);
    expect(s.allRejected).toBe(false);
  });

  it("selecting another rank replaces the choice (exclusive)", () => {
    let s = nextResultsState(fresh(), { type: "select", rank: 1 });
    s = nextResultsState(s, { type: "select", rank: 3 });
    expect(s.chosen).toBe(3);
  });

  it("rejecting one does not show the offer; rejecting all three does", () => {
    let s = nextResultsState(fresh(), { type: "reject", rank: 1 });
    expect(s.showOffer).toBe(false);
    s = nextResultsState(s, { type: "reject", rank: 2 });
    s = nextResultsState(s, { type: "reject", rank: 3 });
    expect(s.allRejected).toBe(true);
    expect(s.showOffer).toBe(true);
  });

  it("rejecting the chosen pick clears the choice", () => {
    let s = nextResultsState(fresh(), { type: "select", rank: 1 });
    s = nextResultsState(s, { type: "reject", rank: 1 });
    expect(s.chosen).toBeNull();
    expect(s.rejected).toEqual([1]);
  });

  it("initial state reflects a selection persisted on the server (refresh)", () => {
    const s = initialResultsState([
      { rank: 1, selected: false, rejected: true },
      { rank: 2, selected: true, rejected: false },
      { rank: 3, selected: false, rejected: false },
    ]);
    expect(s.chosen).toBe(2);
    expect(s.rejected).toEqual([1]);
    expect(s.showOffer).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/feedback/resultsState.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the reducer**

`src/feedback/resultsState.ts`:

```ts
export type Rank = 1 | 2 | 3;
export type ResultsState = { chosen: Rank | null; rejected: Rank[]; showOffer: boolean; allRejected: boolean };
export type ResultsAction = { type: "select"; rank: Rank } | { type: "reject"; rank: Rank };

export function initialResultsState(recs: { rank: Rank; selected: boolean; rejected: boolean }[]): ResultsState {
  const chosen = recs.find((r) => r.selected)?.rank ?? null;
  const rejected = recs.filter((r) => r.rejected).map((r) => r.rank).sort((a, b) => a - b);
  const allRejected = chosen === null && rejected.length === 3;
  return { chosen, rejected, showOffer: chosen !== null || allRejected, allRejected };
}

export function nextResultsState(state: ResultsState, action: ResultsAction): ResultsState {
  if (action.type === "select") {
    const rejected = state.rejected.filter((r) => r !== action.rank);
    return { chosen: action.rank, rejected, showOffer: true, allRejected: false };
  }
  const rejected = state.rejected.includes(action.rank) ? state.rejected : [...state.rejected, action.rank].sort((a, b) => a - b);
  const chosen = state.chosen === action.rank ? null : state.chosen;
  const allRejected = chosen === null && rejected.length === 3;
  return { chosen, rejected, allRejected, showOffer: state.showOffer || allRejected };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/feedback/resultsState.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the client wrapper**

`components/ResultsClient.tsx`:

```tsx
"use client";
import { useReducer, useCallback } from "react";
import type { RecommendationView } from "@/src/shared/types";
import { initialResultsState, nextResultsState, type Rank } from "@/src/feedback/resultsState";
import { RecommendationCard } from "@/components/RecommendationCard";
import { Offer } from "@/components/Offer";

type Props = { submissionId: string; recs: RecommendationView[]; creatorEmail: string; creatorId: string };

async function post(submissionId: string, body: Record<string, unknown>) {
  await fetch(`/api/submissions/${submissionId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined); // best-effort for the UI; the server is the record
}

export function ResultsClient({ submissionId, recs, creatorEmail, creatorId }: Props) {
  const [state, dispatch] = useReducer(nextResultsState, recs, initialResultsState);

  const onSelect = useCallback((rank: Rank) => {
    dispatch({ type: "select", rank });
    void post(submissionId, { action: "select", rank });
  }, [submissionId]);

  const onReject = useCallback((rank: Rank) => {
    const next = nextResultsState(state, { type: "reject", rank });
    dispatch({ type: "reject", rank });
    void post(submissionId, { action: "reject", rank });
    if (next.allRejected && !state.allRejected) void post(submissionId, { action: "all_rejected" });
  }, [submissionId, state]);

  const ordered = [...recs].sort((a, b) => a.rank - b.rank);

  return (
    <div className="flex flex-col gap-4">
      {ordered.map((rec) => (
        <RecommendationCard
          key={rec.rank}
          rec={rec}
          onSelect={onSelect}
          onReject={onReject}
          chosen={state.chosen === rec.rank}
          collapsed={state.chosen !== null && state.chosen !== rec.rank}
        />
      ))}
      {state.allRejected && (
        <p className="text-center text-lg font-medium">Want 3 different directions?</p>
      )}
      {state.showOffer && (
        <Offer submissionId={submissionId} creatorEmail={creatorEmail} creatorId={creatorId} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Wire it into the results page**

In `app/results/[id]/page.tsx`, replace the block where Phase 3 maps `recommendations` to three `RecommendationCard`s with:

```tsx
<ResultsClient
  submissionId={submission.id}
  recs={recommendations}
  creatorEmail={creator.email}
  creatorId={creator.id}
/>
```

and add `import { ResultsClient } from "@/components/ResultsClient";`. The page already has `creator` from `getCreator()` and `recommendations: RecommendationView[]` built by Phase 3's `toRecommendationView` mapper (which copies `selected`/`rejected` from the rows). Remove the now-unused `RecommendationCard` import from the page.

- [ ] **Step 7: Temporary Offer stub (only if Task 4.3 is not done yet)**

`components/Offer.tsx`:

```tsx
"use client";
export function Offer(_: { submissionId: string | null; creatorEmail: string; creatorId: string; headline?: string }) {
  return <div className="rounded-2xl border p-6 text-center">Offer goes here.</div>;
}
```

Task 4.3 replaces this file.

- [ ] **Step 8: Typecheck, run, verify in the browser**

Run: `pnpm typecheck && pnpm test`
Expected: pass.

`pnpm dev`, open a ready `/results/<id>` at 390 px wide. Tap "Use this" on #2: #1 and #3 collapse, #2 shows "Your pick", the offer appears. Reload: #2 is still the pick (state came from the server). Tap "Use this" on #3: #3 becomes the pick, #2 collapses. Reload again, tap "Not for me" on all three: "Want 3 different directions?" and the offer appear. In Supabase Studio exactly one recommendation has `selected = true` at any time, and `events` has `recommendation_selected` ×2 (ranks 2 and 3), `recommendation_rejected` ×3, `all_rejected`, `more_like_this_requested`, each with `creator_id`.

- [ ] **Step 9: Commit**

```bash
git add src/feedback/resultsState.ts components/ResultsClient.tsx components/Offer.tsx app/results/[id]/page.tsx tests/feedback/resultsState.test.ts
git commit -m "Wire results feedback with server-derived state and exclusive selection"
```

---

### Task 4.3: Offer component, offer events and paywall pages

**Files:**
- Create (replace stub): `components/Offer.tsx`
- Create: `src/billing/paymentLink.ts`
- Create: `app/api/offer-events/route.ts`
- Create: `app/api/me/subscription/route.ts`
- Create: `app/subscribe/page.tsx`
- Create: `app/subscribe/thanks/page.tsx`
- Create: `components/ThanksClient.tsx`
- Modify: `.env.example` (add `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`, `NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL`)
- Test: `tests/billing/paymentLink.test.ts`

**Interfaces:**
- Consumes: `getCreator()`; `getActiveSubscription(creatorId)` → row or null; `logEvent`; `UploadForm` already redirects to `/subscribe` when `POST /api/upload-url` returns 402 (Phase 1). Sign-in is the first tap on `/` (Phase 1, ruling I6), so `/subscribe` can simply redirect signed-out users to `/`.
- Produces:
  ```ts
  // src/billing/paymentLink.ts
  export function buildPaymentLink(base: string, creatorEmail: string, creatorId: string): string;
  // components/Offer.tsx
  export function Offer(props: { submissionId: string | null; creatorEmail: string; creatorId: string; headline?: string }): JSX.Element;
  // POST /api/offer-events  body { action: "offer_viewed" | "offer_clicked"; submissionId?: string } → 204 | 400 | 401
  // GET  /api/me/subscription → { status: "active" | "canceled" | "past_due" | "none" }
  ```
  Env: `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`, `NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL` (both public Stripe URLs; `NEXT_PUBLIC_` lets client components read them).

- [ ] **Step 1: Write the failing test**

`tests/billing/paymentLink.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPaymentLink } from "@/src/billing/paymentLink";

describe("buildPaymentLink", () => {
  it("appends prefilled_email and client_reference_id", () => {
    const url = buildPaymentLink("https://buy.stripe.com/test_abc", "a+b@x.com", "11111111-2222-3333-4444-555555555555");
    expect(url).toBe("https://buy.stripe.com/test_abc?prefilled_email=a%2Bb%40x.com&client_reference_id=11111111-2222-3333-4444-555555555555");
  });
  it("uses & when the base already has a query", () => {
    const url = buildPaymentLink("https://buy.stripe.com/test_abc?locale=en", "a@x.com", "id");
    expect(url.startsWith("https://buy.stripe.com/test_abc?locale=en&prefilled_email=")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/billing/paymentLink.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

`src/billing/paymentLink.ts`:

```ts
export function buildPaymentLink(base: string, creatorEmail: string, creatorId: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}prefilled_email=${encodeURIComponent(creatorEmail)}&client_reference_id=${encodeURIComponent(creatorId)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/billing/paymentLink.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Offer events route (creator-level, submission optional)**

`app/api/offer-events/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";

const Body = z.object({
  action: z.enum(["offer_viewed", "offer_clicked"]),
  submissionId: z.string().uuid().optional(),
});

const NAME = { offer_viewed: "paid_offer_viewed", offer_clicked: "paid_offer_clicked" } as const;

export async function POST(req: Request) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  // Attach the submission only when it is the caller's; never trust a foreign id.
  let submissionId: string | null = null;
  if (parsed.data.submissionId) {
    const s = await getSubmission(parsed.data.submissionId);
    if (s && s.creator_id === creator.id) submissionId = s.id;
  }
  await logEvent({ name: NAME[parsed.data.action], creatorId: creator.id, submissionId });
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 6: Subscription status route**

`app/api/me/subscription/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getCreator } from "@/src/auth/session";
import { getActiveSubscription } from "@/src/db/queries/subscriptions";

export const dynamic = "force-dynamic";

export async function GET() {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sub = await getActiveSubscription(creator.id);
  return NextResponse.json({ status: sub ? "active" : "none" });
}
```

(`getActiveSubscription` returns only rows with `status = 'active'`, so anything else reads as `none` here; the webhook keeps the row's true status.)

- [ ] **Step 7: Write the Offer component**

`components/Offer.tsx` (replaces the Task 4.2 stub):

```tsx
"use client";
import { useEffect, useRef } from "react";
import { buildPaymentLink } from "@/src/billing/paymentLink";

type Props = { submissionId: string | null; creatorEmail: string; creatorId: string; headline?: string };

function track(action: "offer_viewed" | "offer_clicked", submissionId: string | null) {
  void fetch("/api/offer-events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(submissionId ? { action, submissionId } : { action }),
    keepalive: true,
  }).catch(() => undefined);
}

export function Offer({ submissionId, creatorEmail, creatorId, headline = "Want Songfit for your next posts?" }: Props) {
  const base = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL ?? "";
  const portal = process.env.NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL ?? "";
  const href = base ? buildPaymentLink(base, creatorEmail, creatorId) : "#";
  const viewed = useRef(false);

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track("offer_viewed", submissionId);
  }, [submissionId]);

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
      <h2 className="text-xl font-semibold tracking-tight">{headline}</h2>
      <p className="mt-2 text-neutral-600">$9.99/month, cancel anytime.</p>
      <a
        href={href}
        onClick={() => track("offer_clicked", submissionId)}
        className="mt-5 inline-block w-full rounded-full bg-black px-6 py-3 text-base font-medium text-white"
      >
        Get Songfit
      </a>
      {portal && (
        <p className="mt-3 text-xs text-neutral-500">
          Already subscribed? <a href={portal} className="underline">Manage or cancel</a>
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 8: Write the paywall pages**

`app/subscribe/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCreator } from "@/src/auth/session";
import { Offer } from "@/components/Offer";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

export default async function SubscribePage() {
  const creator = await getCreator();
  if (!creator) redirect("/"); // sign-in is the first tap on the upload screen (Phase 1)
  const portal = process.env.NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL ?? "";
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <p className="text-center text-neutral-700">You&apos;ve used your free Songfit. Subscribe to keep going.</p>
      <Offer submissionId={null} creatorEmail={creator.email} creatorId={creator.id} headline="Songfit for every post" />
      {portal && (
        <p className="text-center text-xs text-neutral-500">
          <a href={portal} className="underline">Manage or cancel</a> an existing subscription.
        </p>
      )}
    </main>
  );
}
```

`components/ThanksClient.tsx` (polls entitlement; "You're in" only when the webhook has landed):

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Phase = "checking" | "active" | "slow";

export function ThanksClient() {
  const [phase, setPhase] = useState<Phase>("checking");

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    const tick = async () => {
      if (cancelled) return;
      try {
        const r = await fetch("/api/me/subscription", { cache: "no-store" });
        const j = (await r.json()) as { status?: string };
        if (j.status === "active") { setPhase("active"); return; }
      } catch { /* keep polling */ }
      if (Date.now() - started > 60_000) { setPhase("slow"); return; }
      setTimeout(tick, 2_000);
    };
    void tick();
    return () => { cancelled = true; };
  }, []);

  if (phase === "active") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">You&apos;re in.</h1>
        <p className="text-neutral-700">Upload your next video.</p>
        <Link href="/" className="rounded-full bg-black px-6 py-3 font-medium text-white">Find my songs</Link>
      </>
    );
  }
  if (phase === "slow") {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Payment received.</h1>
        <p className="text-neutral-700">Taking longer than expected — refresh in a minute.</p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Payment received.</h1>
      <p className="text-neutral-700">Activating…</p>
    </>
  );
}
```

`app/subscribe/thanks/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCreator } from "@/src/auth/session";
import { Logo } from "@/components/Logo";
import { ThanksClient } from "@/components/ThanksClient";

export const dynamic = "force-dynamic";

export default async function ThanksPage() {
  const creator = await getCreator();
  if (!creator) redirect("/");
  const portal = process.env.NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL ?? "";
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <Logo />
      <ThanksClient />
      {portal && (
        <p className="text-xs text-neutral-500"><a href={portal} className="underline">Manage or cancel</a></p>
      )}
    </main>
  );
}
```

- [ ] **Step 9: Env example**

Append to `.env.example` (keep the existing Stripe lines):

```
# Public Stripe URLs (safe to expose)
NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL=https://buy.stripe.com/test_replace_me
NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL=https://billing.stripe.com/p/login/test_replace_me
```

- [ ] **Step 10: Typecheck and verify**

Run: `pnpm typecheck && pnpm test`
Expected: pass.

`pnpm dev`; sign in as a creator who already has one ready submission; tap "Find my songs" with a new file. Expected: redirected to `/subscribe`; `events` gets a `paid_offer_viewed` row with `creator_id` set and `submission_id` null. Tap "Get Songfit": a `paid_offer_clicked` row, and the Stripe test link opens with your email prefilled. Open `/subscribe/thanks` directly without paying: shows "Payment received. Activating…" then after 60 s the "refresh in a minute" line (no "You're in").

- [ ] **Step 11: Commit**

```bash
git add components/Offer.tsx components/ThanksClient.tsx src/billing/paymentLink.ts app/api/offer-events/route.ts app/api/me/subscription/route.ts app/subscribe/page.tsx app/subscribe/thanks/page.tsx .env.example tests/billing/paymentLink.test.ts
git commit -m "Add offer, creator-level offer events, and entitlement-aware subscribe pages"
```

---

### Task 4.4: Stripe webhook

**Files:**
- Create: `src/billing/stripe.ts`
- Create: `app/api/stripe/webhook/route.ts`
- Modify: `src/db/queries/subscriptions.ts` (add `upsertSubscriptionFromStripe`, `getCreatorIdByStripeCustomer`)
- Modify: `src/db/queries/stripeEvents.ts` (ensure `recordStripeEvent` and add `isStripeEventRecorded`)
- Modify: `src/db/queries/events.ts` (reuse `hasEvent`; add `hasCreatorEvent`)
- Test: `tests/billing/stripe.test.ts`

**Interfaces:**
- Consumes: Phase 0's `stripe_events(id text primary key, type text, processed_at timestamptz)` table and `recordStripeEvent(id, type)` query; `subscriptions` table with `stripe_subscription_id text unique` (plain nullable unique constraint — verify in `0001_init.sql`; if it is a partial index, change it in Phase 0 Task 0.3 to `unique` before this task); `logEvent`; `env("STRIPE_SECRET_KEY")`, `env("STRIPE_WEBHOOK_SECRET")`, `env("STRIPE_PRICE_ID")`.
- Produces:
  ```ts
  // src/db/queries/stripeEvents.ts
  export async function isStripeEventRecorded(id: string): Promise<boolean>;
  export async function recordStripeEvent(id: string, type: string): Promise<void>; // AFTER successful processing only
  // src/db/queries/subscriptions.ts
  export type StripeSubStatus = "active" | "canceled" | "past_due";
  export async function upsertSubscriptionFromStripe(input: { creatorId: string; stripeCustomerId: string; stripeSubscriptionId: string; status: StripeSubStatus }): Promise<void>;
  export async function getCreatorIdByStripeCustomer(stripeCustomerId: string): Promise<string | null>;
  // src/db/queries/events.ts
  export async function hasCreatorEvent(creatorId: string, name: EventName, metadata?: Record<string, unknown>): Promise<boolean>;
  // src/billing/stripe.ts
  export function verifyWebhook(rawBody: string, signature: string): Stripe.Event; // throws on bad signature
  export type StripeDeps = {
    isStripeEventRecorded; recordStripeEvent; upsertSubscriptionFromStripe; getCreatorIdByStripeCustomer;
    hasCreatorEvent; logEvent; retrieveSubscription: (id: string) => Promise<Stripe.Subscription>; priceId: string;
  };
  export async function handleStripeEvent(event: Stripe.Event, deps?: Partial<StripeDeps>): Promise<"processed" | "duplicate" | "ignored">;
  ```
  Processing order (C4): check recorded → process (validate, upsert from Stripe's *current* status) → record event id. A throw before recording leaves the event retryable by Stripe.

- [ ] **Step 1: Install stripe**

Run: `pnpm add stripe`
Expected: `stripe` in `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

`tests/billing/stripe.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { handleStripeEvent } from "@/src/billing/stripe";

const PRICE = "price_songfit_999";

function subscription(over: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    status: "active",
    customer: "cus_1",
    items: { data: [{ price: { id: PRICE } }] },
    ...over,
  } as unknown as Stripe.Subscription;
}

function deps(over: Partial<Record<string, unknown>> = {}) {
  return {
    isStripeEventRecorded: vi.fn(async () => false),
    recordStripeEvent: vi.fn(async () => undefined),
    upsertSubscriptionFromStripe: vi.fn(async () => undefined),
    getCreatorIdByStripeCustomer: vi.fn(async () => "cre-by-customer"),
    hasCreatorEvent: vi.fn(async () => false),
    logEvent: vi.fn(async () => undefined),
    retrieveSubscription: vi.fn(async () => subscription()),
    priceId: PRICE,
    ...over,
  };
}

function checkoutEvent(over: Partial<Stripe.Checkout.Session> = {}): Stripe.Event {
  return {
    id: "evt_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        client_reference_id: "cre-1",
        customer: "cus_1",
        subscription: "sub_1",
        payment_status: "paid",
        ...over,
      } as Stripe.Checkout.Session,
    },
  } as unknown as Stripe.Event;
}

function subEvent(type: "customer.subscription.updated" | "customer.subscription.deleted", over: Partial<Stripe.Subscription> = {}): Stripe.Event {
  return { id: `evt_${type}`, type, data: { object: subscription(over) } } as unknown as Stripe.Event;
}

describe("handleStripeEvent", () => {
  it("checkout: validates price, upserts from the live subscription status, logs paid, then records the event", async () => {
    const d = deps();
    const r = await handleStripeEvent(checkoutEvent(), d);
    expect(r).toBe("processed");
    expect(d.retrieveSubscription).toHaveBeenCalledWith("sub_1");
    expect(d.upsertSubscriptionFromStripe).toHaveBeenCalledWith({ creatorId: "cre-1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "active" });
    expect(d.logEvent).toHaveBeenCalledWith({ name: "paid", creatorId: "cre-1", metadata: { stripeSubscriptionId: "sub_1" } });
    const order = [d.upsertSubscriptionFromStripe, d.recordStripeEvent].map((f) => f.mock.invocationCallOrder[0]);
    expect(order[0]).toBeLessThan(order[1]);
    expect(d.recordStripeEvent).toHaveBeenCalledWith("evt_1", "checkout.session.completed");
  });

  it("a failure during activation does NOT record the event (Stripe can retry)", async () => {
    const d = deps({ upsertSubscriptionFromStripe: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(handleStripeEvent(checkoutEvent(), d)).rejects.toThrow("db down");
    expect(d.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("returns duplicate and does nothing when the event id is already recorded", async () => {
    const d = deps({ isStripeEventRecorded: vi.fn(async () => true) });
    expect(await handleStripeEvent(checkoutEvent(), d)).toBe("duplicate");
    expect(d.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
    expect(d.recordStripeEvent).not.toHaveBeenCalled();
  });

  it("checkout with a different price id is ignored (and not activated)", async () => {
    const d = deps({ retrieveSubscription: vi.fn(async () => subscription({ items: { data: [{ price: { id: "price_other" } }] } } as never)) });
    expect(await handleStripeEvent(checkoutEvent(), d)).toBe("ignored");
    expect(d.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
  });

  it("checkout missing client_reference_id is ignored — no email fallback", async () => {
    const d = deps();
    expect(await handleStripeEvent(checkoutEvent({ client_reference_id: null }), d)).toBe("ignored");
    expect(d.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
  });

  it("checkout not paid is ignored", async () => {
    const d = deps();
    expect(await handleStripeEvent(checkoutEvent({ payment_status: "unpaid" }), d)).toBe("ignored");
  });

  it("subscription.updated arriving before checkout upserts from the customer mapping", async () => {
    const d = deps();
    const r = await handleStripeEvent(subEvent("customer.subscription.updated", { status: "past_due" }), d);
    expect(r).toBe("processed");
    expect(d.getCreatorIdByStripeCustomer).toHaveBeenCalledWith("cus_1");
    expect(d.upsertSubscriptionFromStripe).toHaveBeenCalledWith({ creatorId: "cre-by-customer", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", status: "past_due" });
  });

  it("subscription.deleted marks canceled", async () => {
    const d = deps();
    await handleStripeEvent(subEvent("customer.subscription.deleted", { status: "canceled" }), d);
    expect(d.upsertSubscriptionFromStripe).toHaveBeenCalledWith(expect.objectContaining({ status: "canceled" }));
  });

  it("subscription event for an unmapped customer is ignored", async () => {
    const d = deps({ getCreatorIdByStripeCustomer: vi.fn(async () => null) });
    expect(await handleStripeEvent(subEvent("customer.subscription.updated"), d)).toBe("ignored");
    expect(d.upsertSubscriptionFromStripe).not.toHaveBeenCalled();
  });

  it("paid is logged once per subscription id", async () => {
    const d = deps({ hasCreatorEvent: vi.fn(async () => true) });
    await handleStripeEvent(checkoutEvent(), d);
    expect(d.logEvent).not.toHaveBeenCalled();
  });

  it("ignores unknown event types without recording", async () => {
    const d = deps();
    const ev = { id: "evt_x", type: "invoice.paid", data: { object: {} } } as unknown as Stripe.Event;
    expect(await handleStripeEvent(ev, d)).toBe("ignored");
    expect(d.recordStripeEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/billing/stripe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Queries**

`src/db/queries/stripeEvents.ts` (Phase 0 created `recordStripeEvent`; make the file read exactly):

```ts
import "server-only";
import { createServiceClient } from "../client";

export async function isStripeEventRecorded(id: string): Promise<boolean> {
  const { count, error } = await createServiceClient()
    .from("stripe_events")
    .select("id", { count: "exact", head: true })
    .eq("id", id);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** Call ONLY after the event's effects are committed. A duplicate insert (race) is harmless. */
export async function recordStripeEvent(id: string, type: string): Promise<void> {
  const { error } = await createServiceClient()
    .from("stripe_events")
    .insert({ id, type, processed_at: new Date().toISOString() });
  if (error && error.code !== "23505") throw error; // 23505 = already recorded by a concurrent delivery
}
```

Append to `src/db/queries/subscriptions.ts`:

```ts
export type StripeSubStatus = "active" | "canceled" | "past_due";

/** Idempotent: one row per Stripe subscription id, status always taken from Stripe's current object. */
export async function upsertSubscriptionFromStripe(input: {
  creatorId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: StripeSubStatus;
}): Promise<void> {
  const { error } = await createServiceClient()
    .from("subscriptions")
    .upsert(
      {
        creator_id: input.creatorId,
        stripe_customer_id: input.stripeCustomerId,
        stripe_subscription_id: input.stripeSubscriptionId,
        status: input.status,
        started_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id", ignoreDuplicates: false },
    );
  if (error) throw error;
}

export async function getCreatorIdByStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  const { data, error } = await createServiceClient()
    .from("subscriptions")
    .select("creator_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.creator_id ?? null;
}
```

Append to `src/db/queries/events.ts`:

```ts
export async function hasCreatorEvent(creatorId: string, name: EventName, metadata?: Record<string, unknown>): Promise<boolean> {
  let q = createServiceClient()
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .eq("name", name);
  if (metadata) q = q.contains("metadata", metadata);
  const { count, error } = await q;
  if (error) throw error;
  return (count ?? 0) > 0;
}
```

The `onConflict: "stripe_subscription_id"` upsert requires a plain UNIQUE constraint on that column. Confirm with:

Run: `grep -n "stripe_subscription_id" supabase/migrations/0001_init.sql`
Expected: a line containing `stripe_subscription_id text unique`. If it shows a partial index (`create unique index ... where`), change Phase 0's migration to the plain constraint and `pnpm db:push`.

- [ ] **Step 5: Write the Stripe module**

`src/billing/stripe.ts`:

```ts
import Stripe from "stripe";
import { env } from "@/src/shared/config";
import { logger } from "@/src/shared/logger";
import { isStripeEventRecorded as isRecordedDb, recordStripeEvent as recordDb } from "@/src/db/queries/stripeEvents";
import {
  upsertSubscriptionFromStripe as upsertDb,
  getCreatorIdByStripeCustomer as byCustomerDb,
  type StripeSubStatus,
} from "@/src/db/queries/subscriptions";
import { hasCreatorEvent as hasCreatorEventDb } from "@/src/db/queries/events";
import { logEvent as logEventDb } from "@/src/feedback/events";

let client: Stripe | null = null;
function stripe(): Stripe {
  if (!client) client = new Stripe(env("STRIPE_SECRET_KEY"));
  return client;
}

export function verifyWebhook(rawBody: string, signature: string): Stripe.Event {
  return stripe().webhooks.constructEvent(rawBody, signature, env("STRIPE_WEBHOOK_SECRET"));
}

export type StripeDeps = {
  isStripeEventRecorded: typeof isRecordedDb;
  recordStripeEvent: typeof recordDb;
  upsertSubscriptionFromStripe: typeof upsertDb;
  getCreatorIdByStripeCustomer: typeof byCustomerDb;
  hasCreatorEvent: typeof hasCreatorEventDb;
  logEvent: typeof logEventDb;
  retrieveSubscription: (id: string) => Promise<Stripe.Subscription>;
  priceId: string;
};

function defaultDeps(): StripeDeps {
  return {
    isStripeEventRecorded: isRecordedDb,
    recordStripeEvent: recordDb,
    upsertSubscriptionFromStripe: upsertDb,
    getCreatorIdByStripeCustomer: byCustomerDb,
    hasCreatorEvent: hasCreatorEventDb,
    logEvent: logEventDb,
    retrieveSubscription: (id) => stripe().subscriptions.retrieve(id),
    priceId: env("STRIPE_PRICE_ID"),
  };
}

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

function toStatus(s: Stripe.Subscription.Status): StripeSubStatus {
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  return "canceled";
}

function priceOf(sub: Stripe.Subscription): string | null {
  return sub.items?.data?.[0]?.price?.id ?? null;
}

/**
 * Order matters (ruling C4): duplicate check → process → record. Anything thrown
 * before `recordStripeEvent` leaves the event unrecorded so Stripe's retry re-processes it.
 */
export async function handleStripeEvent(
  event: Stripe.Event,
  overrides: Partial<StripeDeps> = {},
): Promise<"processed" | "duplicate" | "ignored"> {
  const deps: StripeDeps = { ...defaultDeps(), ...overrides };

  if (event.type !== "checkout.session.completed" && event.type !== "customer.subscription.updated" && event.type !== "customer.subscription.deleted") {
    logger.info("stripe.ignored_type", { type: event.type });
    return "ignored";
  }
  if (await deps.isStripeEventRecorded(event.id)) return "duplicate";

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const creatorId = s.client_reference_id ?? null;
    const stripeCustomerId = idOf(s.customer);
    const stripeSubscriptionId = idOf(s.subscription);
    if (!creatorId || !stripeCustomerId || !stripeSubscriptionId || s.payment_status !== "paid") {
      logger.warn("stripe.checkout_incomplete", { sessionId: s.id, hasCreator: !!creatorId, paid: s.payment_status });
      return "ignored";
    }
    const sub = await deps.retrieveSubscription(stripeSubscriptionId);
    if (priceOf(sub) !== deps.priceId) {
      logger.warn("stripe.wrong_price", { sessionId: s.id, price: priceOf(sub) });
      return "ignored";
    }
    await deps.upsertSubscriptionFromStripe({ creatorId, stripeCustomerId, stripeSubscriptionId, status: toStatus(sub.status) });
    if (!(await deps.hasCreatorEvent(creatorId, "paid", { stripeSubscriptionId }))) {
      await deps.logEvent({ name: "paid", creatorId, metadata: { stripeSubscriptionId } });
    }
    await deps.recordStripeEvent(event.id, event.type);
    return "processed";
  }

  // customer.subscription.updated | deleted — may arrive before or after checkout.
  const sub = event.data.object as Stripe.Subscription;
  const stripeCustomerId = idOf(sub.customer);
  if (!stripeCustomerId || !sub.id) return "ignored";
  const creatorId = sub.metadata?.creator_id || (await deps.getCreatorIdByStripeCustomer(stripeCustomerId));
  if (!creatorId) {
    logger.warn("stripe.unmapped", { customer: stripeCustomerId, subscription: sub.id });
    return "ignored";
  }
  const status = event.type === "customer.subscription.deleted" ? "canceled" : toStatus(sub.status);
  await deps.upsertSubscriptionFromStripe({ creatorId, stripeCustomerId, stripeSubscriptionId: sub.id, status });
  await deps.recordStripeEvent(event.id, event.type);
  return "processed";
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/billing/stripe.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 7: Write the route**

`app/api/stripe/webhook/route.ts`:

```ts
import { NextResponse } from "next/server";
import { verifyWebhook, handleStripeEvent } from "@/src/billing/stripe";
import { logger } from "@/src/shared/logger";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 400 });
  const raw = await req.text();

  let event;
  try {
    event = verifyWebhook(raw, signature);
  } catch (e) {
    logger.warn("stripe.bad_signature", { message: (e as Error).message });
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    // 500 on purpose: the event is NOT recorded, so Stripe retries and the activation is not lost.
    logger.error("stripe.handler_failed", { id: event.id, type: event.type, message: (e as Error).message });
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 8: Dylan's Stripe setup (do once in test mode, repeat in live mode Wednesday evening)**

- [ ] Stripe Dashboard → Product catalog → Add product → name `Songfit`, recurring, `$9.99` monthly. Save. Open the price and copy its ID (`price_...`) into `STRIPE_PRICE_ID`.
- [ ] Payment Links → New → pick the Songfit price. "Collect customers' email" on. After payment → "Don't show confirmation page" → redirect to `https://thissongfits.com/subscribe/thanks`. Create; copy the link into `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`.
- [ ] Settings → Billing → Customer portal → Activate; allow "Cancel subscriptions". Copy the portal login link (`https://billing.stripe.com/p/login/...`) into `NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL`.
- [ ] Developers → API keys → Secret key into `STRIPE_SECRET_KEY`.
- [ ] Developers → Webhooks → Add endpoint → `https://thissongfits.com/api/stripe/webhook` → events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Signing secret into `STRIPE_WEBHOOK_SECRET` (Vercel). Locally use the CLI secret from Step 9.
- [ ] Add all five values to Vercel env (Production + Preview) and `.env.local`.

- [ ] **Step 9: Local webhook test**

Install the Stripe CLI (download from https://docs.stripe.com/stripe-cli; no Homebrew on this Mac), then:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the printed `whsec_...` into `.env.local` as `STRIPE_WEBHOOK_SECRET`, restart `pnpm dev`, then in another terminal:

```bash
stripe trigger checkout.session.completed
```

Expected: `pnpm dev` logs `stripe.checkout_incomplete` or `stripe.wrong_price` (the trigger has no `client_reference_id` and a random price) and the response is `200 {"received":true,"result":"ignored"}`; no `subscriptions` row is written. Then a real test checkout: from `/subscribe` while signed in, pay with `4242 4242 4242 4242`, any future date, any CVC. Expected: redirect to `/subscribe/thanks` → "Activating…" → within a few seconds "You're in."; `subscriptions` row with `status = active` and your creator id; `stripe_events` row for the event; one `paid` event; a second upload is accepted. Resend the same event from the Stripe dashboard (Webhooks → event → Resend): response `{"result":"duplicate"}`, still one `paid` event.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml src/billing/stripe.ts app/api/stripe/webhook/route.ts src/db/queries/stripeEvents.ts src/db/queries/subscriptions.ts src/db/queries/events.ts tests/billing/stripe.test.ts
git commit -m "Add Stripe webhook: validate, upsert from live status, record event last"
```

---

### Task 4.5: Metrics SQL function, seed fixture and admin metrics page

**Files:**
- Create: `supabase/migrations/0004_metrics.sql`
- Create: `supabase/seed/metrics_fixture.sql`
- Create: `src/db/queries/metrics.ts`
- Create: `src/shared/stats.ts`
- Create: `app/admin/metrics/page.tsx`
- Modify: `app/admin/layout.tsx` (add a "Metrics" nav link)
- Modify: `docs/DATA_MODEL.md` (document `updated_at` on submissions and the `metrics_summary()` function)
- Test: `tests/shared/stats.test.ts`, `tests/db/metrics.integration.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()`; `createServiceClient()`; `submissions.updated_at` (Phase 0).
- Produces:
  ```ts
  // src/shared/stats.ts
  export function median(values: number[]): number | null;
  // src/db/queries/metrics.ts
  export type Metrics = {
    eventCounts: { name: string; count: number }[];
    funnel: { stage: string; submissions: number; creators: number }[];
    medianUploadToReadySeconds: number | null;
    medianReadyToSelectionSeconds: number | null;
    byCategory: { category: string; ready: number; selected: number }[];
    paidCreators: number;
    paidEvents: number;
    returningCreators: number;
  };
  export async function getMetrics(): Promise<Metrics>;
  ```
  SQL function `metrics_summary()` returning one jsonb, executable by `service_role` only.

- [ ] **Step 1: Write the failing unit test**

`tests/shared/stats.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { median } from "@/src/shared/stats";

describe("median", () => {
  it("returns null for empty input", () => expect(median([])).toBeNull());
  it("returns the middle of an odd list", () => expect(median([5, 1, 3])).toBe(3));
  it("averages the two middles of an even list", () => expect(median([1, 2, 3, 4])).toBe(2.5));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/shared/stats.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

`src/shared/stats.ts`:

```ts
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/shared/stats.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the migration**

`supabase/migrations/0004_metrics.sql`:

```sql
-- One-shot metrics summary for the admin page. Service role only.
-- Funnel counts DISTINCT submissions and DISTINCT creators per milestone.
-- Category breakdown aggregates submissions first (no event-join multiplication).
create or replace function metrics_summary() returns jsonb
language sql security definer set search_path = public as $$
with
event_counts as (
  select name, count(*)::int as count from events group by name
),
stages as (
  select * from (values
    ('submission_created', 1), ('recommendations_ready', 2), ('recommendations_viewed', 3),
    ('recommendation_selected', 4), ('all_rejected', 4), ('paid_offer_viewed', 5),
    ('paid_offer_clicked', 6), ('paid', 7)
  ) as t(stage, ord)
),
funnel as (
  select s.stage, s.ord,
    count(distinct e.submission_id)::int as submissions,
    count(distinct e.creator_id)::int as creators
  from stages s left join events e on e.name = s.stage
  group by s.stage, s.ord
),
upload_to_ready as (
  select extract(epoch from (recommended_at - created_at)) as secs
  from submissions where recommended_at is not null
),
ready_to_select as (
  select extract(epoch from (min(e.created_at) - s.recommended_at)) as secs
  from events e join submissions s on s.id = e.submission_id
  where e.name = 'recommendation_selected' and s.recommended_at is not null
  group by s.id, s.recommended_at
),
selected_submissions as (
  select distinct submission_id from events where name = 'recommendation_selected'
),
by_category as (
  select coalesce(s.content_category, 'unknown') as category,
    count(*) filter (where s.status = 'ready')::int as ready,
    count(*) filter (where ss.submission_id is not null)::int as selected
  from submissions s left join selected_submissions ss on ss.submission_id = s.id
  group by 1
),
paid as (
  select
    (select count(distinct creator_id)::int from subscriptions where status = 'active') as paid_creators,
    (select count(*)::int from events where name = 'paid') as paid_events
),
returning_creators as (
  select count(*)::int as n from (
    select creator_id from submissions group by creator_id having count(*) >= 2
  ) r
)
select jsonb_build_object(
  'eventCounts', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', count) order by name), '[]'::jsonb) from event_counts),
  'funnel', (select coalesce(jsonb_agg(jsonb_build_object('stage', stage, 'submissions', submissions, 'creators', creators) order by ord, stage), '[]'::jsonb) from funnel),
  'uploadToReadySeconds', (select coalesce(jsonb_agg(secs), '[]'::jsonb) from upload_to_ready),
  'readyToSelectionSeconds', (select coalesce(jsonb_agg(secs), '[]'::jsonb) from ready_to_select),
  'byCategory', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'ready', ready, 'selected', selected) order by ready desc), '[]'::jsonb) from by_category),
  'paidCreators', (select paid_creators from paid),
  'paidEvents', (select paid_events from paid),
  'returningCreators', (select n from returning_creators)
);
$$;

revoke execute on function metrics_summary() from public, anon, authenticated;
grant execute on function metrics_summary() to service_role;
```

Run: `pnpm db:push && pnpm db:types`
Expected (hosted project, see Phase 0 Task 0.3): `supabase db push` applies `0004_metrics.sql`; `src/db/types.ts` gains a `metrics_summary` entry under `Functions`.

- [ ] **Step 6: Document in the data model**

In `docs/DATA_MODEL.md`, add to the `## submissions` table (if Phase 0 did not already):

```markdown
| updated_at        | timestamptz | set by trigger on every update; used by claim_submission_run() for stale takeover |
```

and a new section after `## subscriptions`:

```markdown
## metrics_summary()
SQL function (service role only) returning one jsonb: eventCounts, funnel (distinct submissions + distinct creators per milestone), uploadToReadySeconds[], readyToSelectionSeconds[], byCategory (submissions aggregated before any event join), paidCreators (distinct creators with an active subscription), paidEvents, returningCreators (≥2 submissions). Read by `src/db/queries/metrics.ts`.
```

- [ ] **Step 7: Write the query**

`src/db/queries/metrics.ts`:

```ts
import "server-only";
import { z } from "zod";
import { createServiceClient } from "../client";
import { median } from "@/src/shared/stats";

const Raw = z.object({
  eventCounts: z.array(z.object({ name: z.string(), count: z.number() })),
  funnel: z.array(z.object({ stage: z.string(), submissions: z.number(), creators: z.number() })),
  uploadToReadySeconds: z.array(z.number()),
  readyToSelectionSeconds: z.array(z.number()),
  byCategory: z.array(z.object({ category: z.string(), ready: z.number(), selected: z.number() })),
  paidCreators: z.number(),
  paidEvents: z.number(),
  returningCreators: z.number(),
});

export type Metrics = {
  eventCounts: { name: string; count: number }[];
  funnel: { stage: string; submissions: number; creators: number }[];
  medianUploadToReadySeconds: number | null;
  medianReadyToSelectionSeconds: number | null;
  byCategory: { category: string; ready: number; selected: number }[];
  paidCreators: number;
  paidEvents: number;
  returningCreators: number;
};

export async function getMetrics(): Promise<Metrics> {
  const { data, error } = await createServiceClient().rpc("metrics_summary");
  if (error) throw new Error(`metrics_summary: ${error.message}`);
  const raw = Raw.parse(data);
  return {
    eventCounts: raw.eventCounts,
    funnel: raw.funnel,
    medianUploadToReadySeconds: median(raw.uploadToReadySeconds),
    medianReadyToSelectionSeconds: median(raw.readyToSelectionSeconds),
    byCategory: raw.byCategory,
    paidCreators: raw.paidCreators,
    paidEvents: raw.paidEvents,
    returningCreators: raw.returningCreators,
  };
}
```

- [ ] **Step 8: Seed fixture and integration test**

`supabase/seed/metrics_fixture.sql` (test data only; ids are fixed so the test can clean up):

```sql
-- Two creators, three submissions, repeated events, one paid.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'fixture-a@songfit.test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'fixture-b@songfit.test')
on conflict (id) do nothing;
-- the auth->creators trigger (Phase 0) mirrors these; ensure explicitly:
insert into creators (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'fixture-a@songfit.test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'fixture-b@songfit.test')
on conflict (id) do nothing;

insert into submissions (id, creator_id, video_path, status, content_category, created_at, recommended_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/1.mp4', 'ready', 'fashion', now() - interval '10 min', now() - interval '8 min'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/2.mp4', 'ready', 'fashion', now() - interval '6 min',  now() - interval '4 min'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002/3.mp4', 'ready', 'fitness', now() - interval '5 min',  now() - interval '3 min');

insert into events (creator_id, submission_id, name, metadata, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'submission_created', null, now() - interval '10 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'recommendations_ready', null, now() - interval '8 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'recommendations_viewed', null, now() - interval '7 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'recommendations_viewed', null, now() - interval '7 min'), -- repeated view
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'recommendation_selected', '{"rank":1}', now() - interval '6 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'submission_created', null, now() - interval '6 min'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'recommendations_ready', null, now() - interval '4 min'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000003', 'submission_created', null, now() - interval '5 min'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000003', 'recommendations_ready', null, now() - interval '3 min'),
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'paid_offer_viewed', null, now() - interval '2 min'),
  ('aaaaaaaa-0000-0000-0000-000000000002', null, 'paid', '{"stripeSubscriptionId":"sub_fixture"}', now() - interval '1 min');

insert into subscriptions (creator_id, stripe_customer_id, stripe_subscription_id, status, started_at) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cus_fixture', 'sub_fixture', 'active', now() - interval '1 min')
on conflict (stripe_subscription_id) do nothing;
```

`tests/db/metrics.integration.test.ts` (runs only when a database is configured; it is a real check of the SQL, not a mock):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(url && key && process.env.RUN_DB_TESTS === "1");

const CREATORS = ["aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002"];

describe.skipIf(!enabled)("metrics_summary() against the fixture", () => {
  const db = createClient(url ?? "", key ?? "");

  beforeAll(async () => {
    const sql = readFileSync("supabase/seed/metrics_fixture.sql", "utf8");
    const { error } = await db.rpc("exec_sql", { sql }); // helper below
    if (error) throw error;
  });

  afterAll(async () => {
    await db.from("subscriptions").delete().in("creator_id", CREATORS);
    await db.from("events").delete().in("creator_id", CREATORS);
    await db.from("submissions").delete().in("creator_id", CREATORS);
    await db.from("creators").delete().in("id", CREATORS);
  });

  it("counts distinct submissions and creators, aggregates categories once, and reports paid correctly", async () => {
    const { data, error } = await db.rpc("metrics_summary");
    expect(error).toBeNull();
    const m = data as {
      funnel: { stage: string; submissions: number; creators: number }[];
      byCategory: { category: string; ready: number; selected: number }[];
      paidCreators: number; paidEvents: number; returningCreators: number;
    };
    const stage = (s: string) => m.funnel.find((f) => f.stage === s)!;
    expect(stage("submission_created").submissions).toBeGreaterThanOrEqual(3);
    expect(stage("submission_created").creators).toBeGreaterThanOrEqual(2);
    expect(stage("recommendations_ready").creators).toBeGreaterThanOrEqual(2); // creatorId is on ready events now (I7)
    expect(stage("recommendations_viewed").submissions).toBeGreaterThanOrEqual(1); // two view rows, one submission
    const fashion = m.byCategory.find((c) => c.category === "fashion")!;
    expect(fashion.ready).toBeGreaterThanOrEqual(2); // not multiplied by the 5 events on submission 1
    expect(fashion.selected).toBeGreaterThanOrEqual(1);
    expect(m.paidCreators).toBeGreaterThanOrEqual(1);
    expect(m.paidEvents).toBeGreaterThanOrEqual(1);
    expect(m.returningCreators).toBeGreaterThanOrEqual(1);
  });
});
```

The fixture is loaded through a tiny helper function. Add to the top of `supabase/migrations/0004_metrics.sql` (service role only):

```sql
-- Test helper: run a SQL script. Service role only; never exposed to clients.
create or replace function exec_sql(sql text) returns void
language plpgsql security definer set search_path = public as $$
begin execute sql; end $$;
revoke execute on function exec_sql(text) from public, anon, authenticated;
grant execute on function exec_sql(text) to service_role;
```

Run: `RUN_DB_TESTS=1 pnpm vitest run tests/db/metrics.integration.test.ts`
Expected: PASS (1). Without `RUN_DB_TESTS=1` the suite reports it as skipped, so `pnpm test` stays green in CI-less local runs. (`≥` assertions keep the test valid when real data coexists with the fixture on the hosted project.)

- [ ] **Step 9: Write the page**

`app/admin/metrics/page.tsx`:

```tsx
import { requireAdmin } from "@/src/auth/session";
import { getMetrics } from "@/src/db/queries/metrics";

export const dynamic = "force-dynamic";

function secs(v: number | null) {
  return v === null ? "—" : `${Math.round(v)} s`;
}

export default async function MetricsPage() {
  await requireAdmin();
  const m = await getMetrics();
  return (
    <main className="mx-auto max-w-4xl space-y-10 p-6">
      <h1 className="text-2xl font-semibold">Metrics</h1>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Paying creators (active)</div><div className="text-xl">{m.paidCreators}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Paid events</div><div className="text-xl">{m.paidEvents}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Median upload → ready</div><div className="text-xl">{secs(m.medianUploadToReadySeconds)}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Median ready → selection</div><div className="text-xl">{secs(m.medianReadyToSelectionSeconds)}</div></div>
      </section>

      <section>
        <h2 className="mb-2 font-medium">Funnel (distinct)</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th>Stage</th><th>Submissions</th><th>Creators</th></tr></thead>
          <tbody>
            {m.funnel.map((f) => (
              <tr key={f.stage} className="border-t"><td>{f.stage}</td><td>{f.submissions}</td><td>{f.creators}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 font-medium">By category</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th>Category</th><th>Ready</th><th>Selected</th><th>Select rate</th></tr></thead>
          <tbody>
            {m.byCategory.map((c) => (
              <tr key={c.category} className="border-t">
                <td>{c.category}</td><td>{c.ready}</td><td>{c.selected}</td>
                <td>{c.ready ? `${Math.round((100 * c.selected) / c.ready)}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <p className="text-sm">Returning creators (≥2 uploads): <strong>{m.returningCreators}</strong></p>
      </section>

      <section>
        <h2 className="mb-2 font-medium">All events (raw counts)</h2>
        <table className="w-full text-sm">
          <tbody>
            {m.eventCounts.map((e) => (
              <tr key={e.name} className="border-t"><td>{e.name}</td><td className="text-right">{e.count}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
```

In `app/admin/layout.tsx` add a nav link next to the existing "Queue" link:

```tsx
<a href="/admin/metrics" className="underline">Metrics</a>
```

- [ ] **Step 10: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: pass (integration test skipped unless `RUN_DB_TESTS=1`).

Open `/admin/metrics` as the admin: the four tiles, funnel rows in order `submission_created … paid` with both distinct counts, a category table, returning creators, raw event counts. As a non-admin: redirected (existing `requireAdmin`).

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/0004_metrics.sql supabase/seed/metrics_fixture.sql src/db/types.ts src/db/queries/metrics.ts src/shared/stats.ts app/admin/metrics/page.tsx app/admin/layout.tsx docs/DATA_MODEL.md tests/shared/stats.test.ts tests/db/metrics.integration.test.ts
git commit -m "Add distinct-count metrics function with fixture test and admin metrics page"
```

---

### Task 4.6: Hardening for launch

**Files:**
- Modify: `app/api/upload-url/route.ts` (rate limit)
- Modify: `src/db/queries/submissions.ts` (`countRecentSubmissions`)
- Modify: `next.config.ts` (remote images; keep `serverExternalPackages`)
- Modify: `app/layout.tsx` (viewport, theme-color)
- Modify: `app/page.tsx` (retention disclosure line)
- Modify: `app/admin/page.tsx`, `app/admin/submissions/[id]/page.tsx`, `app/admin/metrics/page.tsx`, `app/admin/submissions/[id]/actions.ts` (each calls `requireAdmin()` itself)
- Create: `app/robots.ts`, `app/error.tsx`, `app/results/[id]/not-found.tsx`
- Test: `tests/db/countRecent.test.ts` is not needed — `countRecentSubmissions` is a thin query verified by typecheck and the manual check below; say so in the report.

No double-run guard here: `claim_submission_run()` (Phase 0) is an atomic conditional update, used by `runSubmission` in both the submit route and the admin retry, with stale takeover after `LIMITS.inFlightStaleMinutes`.

- [ ] **Step 1: Rate-limit upload authorizations**

Append to `src/db/queries/submissions.ts`:

```ts
export async function countRecentSubmissions(creatorId: string, withinMs: number): Promise<number> {
  const since = new Date(Date.now() - withinMs).toISOString();
  const { count, error } = await createServiceClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .gte("created_at", since);
  if (error) throw error;
  return count ?? 0;
}
```

In `app/api/upload-url/route.ts`, after the creator is resolved and before the `canSubmit` UX check (Phase 1 Task 1.2), add:

```ts
import { countRecentSubmissions } from "@/src/db/queries/submissions";
// ...
if ((await countRecentSubmissions(creator.id, 60_000)) >= 5) {
  return NextResponse.json({ error: "rate_limited" }, { status: 429 });
}
```

(Entitlement itself is enforced atomically by `create_submission()` in `POST /api/submissions`; this limit only stops upload-URL spam.)

- [ ] **Step 2: Config and chrome**

`next.config.ts` — the file must contain BOTH the Phase 0 externals and the image hosts:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  outputFileTracingIncludes: {
    "/api/submissions/**": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/**"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net" },
      { protocol: "https", hostname: "cdn-images.dzcdn.net" },
      { protocol: "https", hostname: "**.mzstatic.com" },
    ],
  },
};

export default nextConfig;
```

(If Phase 0's `next.config.ts` has different externals/tracing keys, keep Phase 0's values and only ADD `images`. Never drop the ffmpeg settings.)

`app/layout.tsx` — add (keep the existing `metadata`):

```tsx
import type { Viewport } from "next";
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};
```

`app/robots.ts`:

```ts
import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api"] }] };
}
```

`app/error.tsx` (generic copy; never shows the error message):

```tsx
"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg">Something went wrong, try again.</p>
      <button onClick={reset} className="rounded-full bg-black px-6 py-3 text-white">Try again</button>
    </main>
  );
}
```

`app/results/[id]/not-found.tsx`:

```tsx
import Link from "next/link";
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-lg">We couldn&apos;t find that Songfit.</p>
      <Link href="/" className="underline">Upload a video</Link>
    </main>
  );
}
```

In `app/results/[id]/page.tsx`, where the submission is loaded, call `notFound()` from `next/navigation` when it is null or belongs to another creator (replace any plain message Phase 3 rendered).

- [ ] **Step 3: Retention disclosure (M3)**

In `app/page.tsx`, under the upload form, add:

```tsx
<p className="mt-6 text-center text-xs text-neutral-500">
  Your video is stored by Songfit and analyzed with third-party AI services to find your songs. Email hello@thissongfits.com to have it deleted.
</p>
```

- [ ] **Step 4: Admin gate on every admin entry (M3)**

Confirm each of `app/admin/page.tsx`, `app/admin/submissions/[id]/page.tsx`, `app/admin/metrics/page.tsx` starts its default export with `await requireAdmin();`, and that `app/admin/submissions/[id]/actions.ts` calls `await requireAdmin();` as the first line of `retrySubmission`. Add it wherever missing. The layout's gate stays, but no page or action depends on it.

Run: `grep -L "requireAdmin" app/admin/page.tsx app/admin/submissions/\[id\]/page.tsx app/admin/metrics/page.tsx app/admin/submissions/\[id\]/actions.ts`
Expected: no output (every file contains the call).

- [ ] **Step 5: No raw errors to creators**

Run: `grep -rn "error.message\|String(e)\|String(err)" app/api app/results app/page.tsx components | grep -v logger`
Expected: no output. Any match that reaches a `NextResponse.json` body or JSX must be replaced with a fixed string (`"something_went_wrong"`) and the detail moved into a `logger.*` call.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all pass; build completes without image-host warnings and the ffmpeg binaries are listed in the function trace (`.next/server/app/api/submissions/...` references `ffmpeg-static`).

Manual: `POST /api/upload-url` six times in a minute from the console → the sixth returns 429. Open `/results/not-a-real-id` → not-found page. `curl -s localhost:3000/robots.txt` shows `Disallow: /admin`. Signed in as a non-admin, open `/admin/metrics` directly → redirected.

- [ ] **Step 7: Commit**

```bash
git add app/api/upload-url/route.ts src/db/queries/submissions.ts next.config.ts app/layout.tsx app/page.tsx app/robots.ts app/error.tsx app/results/[id]/not-found.tsx app/results/[id]/page.tsx app/admin
git commit -m "Harden uploads, admin gating, error pages and config for launch"
```

---

### Task 4.7: Production plans, domain and smoke test

**Files:**
- Modify: `README.md` (Deploy section)
- Modify (only if staying on Supabase Free): `src/shared/config.ts` (`maxUploadBytes`), `components/UploadForm.tsx` copy

The Vercel project and GitHub repo already exist from Phase 1 Task 1.7; this task finishes production.

- [ ] **Step 1: Plans (Dylan decisions, defaults apply)**

- [ ] **Vercel Pro** (default yes, $20/mo): Vercel → Settings → Billing → upgrade. Reason: commercial use is outside Hobby's terms, and Pro gives the 300 s function budget without relying on Fluid Compute. Confirm `maxDuration = 300` on `app/api/submissions/route.ts` (submit route, runs the pipeline) and `app/api/submissions/[id]/run/route.ts` (admin retry).
- [ ] **Supabase Pro** (default yes, $25/mo): Supabase → Settings → Billing → Pro. Then Storage → Settings → global file size limit `150 MB`. Reason: Free caps files at 50 MB; a 3-minute 1080p Reel exceeds it.
  - If Dylan chooses to stay on Free: set `maxUploadBytes: 50 * 1024 * 1024` in `src/shared/config.ts`, change the UploadForm size error to "Videos up to 50 MB for now", and set the Storage limit to 50 MB. Commit that change with message `Cap uploads at 50 MB (Supabase Free)`.

- [ ] **Step 2: Domain**

- [ ] Vercel → Project → Settings → Domains → add `thissongfits.com` and `www.thissongfits.com` (redirect www → apex).
- [ ] Registrar DNS: add the records Vercel shows (`A` for the apex to Vercel's IP, `CNAME` for `www` to `cname.vercel-dns.com`). Wait for "Valid Configuration".
- [ ] `https://thissongfits.com` serves the app with a valid certificate.

- [ ] **Step 3: Auth and payment URLs**

- [ ] Supabase → Authentication → URL Configuration: Site URL `https://thissongfits.com`; Redirect URLs: `https://thissongfits.com/auth/callback` and `http://localhost:3000/auth/callback` only (no `*.vercel.app` wildcard — M3).
- [ ] Google Cloud Console → the OAuth client from Phase 1: Authorized JavaScript origins add `https://thissongfits.com`; the redirect URI remains `https://<project-ref>.supabase.co/auth/v1/callback`.
- [ ] Vercel env: `NEXT_PUBLIC_SITE_URL=https://thissongfits.com`; all Stripe LIVE values from Task 4.4 Step 8 (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`, `NEXT_PUBLIC_STRIPE_CUSTOMER_PORTAL_URL`). Redeploy.
- [ ] Stripe live webhook endpoint → `https://thissongfits.com/api/stripe/webhook`; live Payment Link redirects to `https://thissongfits.com/subscribe/thanks`.

- [ ] **Step 4: Smoke test from a phone on cellular**

- [ ] Wi-Fi off. Open `https://thissongfits.com`. Tap "Continue with Google" (first tap), sign in, the upload form appears.
- [ ] Upload a 60–90 s iPhone MOV from the camera roll; progress bar moves; waiting state appears.
- [ ] Results within ~2 minutes: three real songs, sections inside the tracks, "Open in Spotify" works. (Previews only if `PREVIEWS_ENABLED`.)
- [ ] "Use this" collapses the others; the offer appears; `/admin` shows the submission `ready` with timing; `/admin/metrics` funnel has 1 creator at each stage reached.
- [ ] Second upload attempt as the same creator → `/subscribe`.

- [ ] **Step 5: README deploy section**

Append to `README.md`:

```markdown
## Deploy

Production runs on Vercel (Pro) from the `main` branch at https://thissongfits.com.
Env vars live in Vercel (Settings → Environment Variables); `.env.example` is the list.
The submit route and the admin run route export `maxDuration = 300`.
Supabase: Pro plan, Storage file limit 150 MB, Auth Site URL and redirect URLs set to the production domain.
Google OAuth origins include the production domain. Stripe webhook: `https://thissongfits.com/api/stripe/webhook`.
```

- [ ] **Step 6: Commit**

```bash
git add README.md src/shared/config.ts components/UploadForm.tsx
git commit -m "Document production deployment"
git push
```

(Only include `src/shared/config.ts` and `components/UploadForm.tsx` if Step 1's 50 MB fallback was taken.)

---

### Task 4.8: Launch-day runbook

**Files:**
- Create: `docs/RUNBOOK.md`

- [ ] **Step 1: Write the runbook**

`docs/RUNBOOK.md`:

```markdown
# Songfit launch runbook

## Watch (every hour on launch days)
- `/admin?status=failed` — any failed submission. Read the `error` text:
  - `analyze:` prefix → ffmpeg/Whisper/Claude analysis problem. Retry once. If it fails again, open the inspector and check the video plays; a corrupt or 0-byte upload is the usual cause.
  - `recommend:` prefix with "fewer than 3 verified" → the generator named songs Deezer can't find. Retry (the retry prompt carries exclusions and asks for better-known songs).
  - `budget exceeded` → pipeline hit the time budget. Retry; it resumes from the failed stage.
- A run that is lost: status stuck in `analyzing` or `recommending` for more than 6 minutes with no change. The claim allows stale takeover after `LIMITS.inFlightStaleMinutes`, so `/admin` → open → Retry simply works. If it happens more than once, check Vercel logs for the submit route being killed early (function duration or memory).
- `/admin` — median upload→ready creeping past 150 s means Claude or Deezer is slow; nothing to do unless runs fail.
- Anthropic console → Usage. Expect roughly $0.15–0.40 per submission with Sonnet on candidates/scoring/explain and Fable on analysis. A spike means a retry loop; look for one submission with many `pipeline_failed` events.
- Vercel → Logs, filter `error`. 504 on `/api/submissions` means the function duration limit; see Deploy in README.
- Stripe → Developers → Webhooks → the endpoint: any event with a non-2xx response. The handler returns 500 on purpose when activation fails so Stripe retries; if retries are exhausted, open the event and press Resend. Nothing is lost: an event is recorded only after its effects are committed.

## Retry a submission
`/admin` (failed rows are red) → Retry. It re-runs from the failed stage. Candidates and recommendations for that submission are replaced, never duplicated.

## Fix a bad recommendation by hand
Supabase Studio → Table editor:
1. `recommendations` → filter `submission_id` → edit `title`, `artist`, `start_seconds`, `end_seconds`, `explanation`, `artwork_url`, `spotify_url` directly. Rank stays 1–3. The creator's page shows the change on next load.
2. To swap in a different candidate: copy its row from `candidates` (same `submission_id`) into the recommendation row's fields; set `candidate_id` to that candidate's id.
3. To build a Spotify link by hand: `https://open.spotify.com/search/<Title>%20<Artist>`.
Note every manual change under "Manual fixes" below with the submission id. Do not invent event names.

## Cancel or refund a subscriber
Creators cancel themselves via "Manage or cancel" (Stripe Customer Portal). To do it for them: Stripe → Customers → the customer → subscription → Cancel. The `customer.subscription.deleted` webhook sets their row to `canceled`, which closes the paywall for them again. Refunds: Stripe → Payments → Refund.

## Disable previews / toggle launch flags
`src/shared/config.ts`: `PREVIEWS_ENABLED` (false at launch per the C8 ruling). Change, commit, push; Vercel redeploys in ~2 minutes.

## Overused songs
Edit `src/engine/scoring/config/overused.ts`: add `{ title, artist }` entries (normalised matching is case/punctuation-insensitive). Commit and push. Entries get the overuse penalty on `originality`.

## Reading the metrics page for the deck
`/admin/metrics`:
- Tile "Paying creators (active)" = creators with an active subscription right now (target 10). Cross-check Stripe → Customers.
- "Funnel → submission_created, creators" = distinct creators who submitted (target 100).
- "Funnel → recommendations_ready, submissions" = results delivered; "creators" = distinct creators who got a result.
- "recommendation_selected, submissions" ÷ "recommendations_viewed, submissions" = pick rate.
- "Median upload → ready" = time to result. "Median ready → selection" = decision time.
- "By category" = which niche picks most; use the select-rate column.
- "Returning creators" = came back for a second video.
- "All events" are raw row counts (repeat views count multiple times); use the funnel for the deck.

## Manual fixes
(append: date, submission id, what changed, why)
```

- [ ] **Step 2: Commit**

```bash
git add docs/RUNBOOK.md
git commit -m "Add launch runbook"
git push
```

---

### Phase 4 demo check

All on `https://thissongfits.com` from a phone, Stripe in test mode until Wednesday evening:

- [ ] `pnpm typecheck && pnpm test && pnpm build` pass on `main`; Vercel production deployment is green.
- [ ] Creator A (fresh Google account): sign in (first tap) → upload → waiting → 3 results → "Use this" on one → offer appears → "Get Songfit" → Stripe test checkout `4242 4242 4242 4242` → `/subscribe/thanks` shows "Activating…" then "You're in." → "Find my songs" → a second upload is accepted and produces results. Refresh the first results page: the pick is still marked.
- [ ] Creator B (another Google account): first upload works; second upload attempt redirects to `/subscribe` with "You've used your free Songfit."; `events` has a `paid_offer_viewed` row with B's `creator_id` and null `submission_id`.
- [ ] Creator A rejects all three on the second result: "Want 3 different directions?" and the offer appear; `events` has one `all_rejected` and one `more_like_this_requested` with A's `creator_id`.
- [ ] Resend A's `checkout.session.completed` from the Stripe dashboard: webhook replies `duplicate`; still one `paid` event; still one active subscription.
- [ ] `/admin/metrics`: `submission_created` creators = 2, `recommendations_ready` creators = 2, paying creators = 1, non-null medians, category rows with ready counts equal to the number of ready submissions (not inflated), returning creators = 1.
- [ ] `/admin` has no failed rows, or every failed row has been retried to `ready`.

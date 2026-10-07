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
- Deezer ≤ 8 requests/s. iTunes only for the final 3.
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
export const DIRECTION_LABEL: Record<DirectionTag, string> = {
  safe: "Best fit", current: "More current", unexpected: "Unexpected",
};

export const GeneratedCandidate = z.object({
  title: z.string(),
  artist: z.string(),
  proposed_start: z.number().min(0),
  proposed_end: z.number().min(0),
  section_reason: z.string(),
  fit_reason: z.string(),
  direction: DirectionTag,
});
export type GeneratedCandidate = z.infer<typeof GeneratedCandidate>;

export const VerifiedCandidate = GeneratedCandidate.extend({
  deezer_id: z.string(),
  duration_seconds: z.number(),
  artwork_url: z.string().nullable(),
  deezer_url: z.string(),
  preview_url: z.string().nullable(),
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
  direction_label: z.string(),
  start_seconds: z.number(),
  end_seconds: z.number(),
});
export type Pick = z.infer<typeof Pick>;

export const FinalRecommendation = Pick.extend({
  explanation: z.string(),
  spotify_url: z.string(),
  itunes_id: z.string().nullable(),
});
export type FinalRecommendation = z.infer<typeof FinalRecommendation>;

export const SubmissionStatus = z.enum(["uploaded","analyzing","recommending","ready","failed"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;
```

`src/shared/config.ts` exports:

```ts
export const MODELS = { analysis: "claude-fable-5-1", candidates: "claude-fable-5-1", scoring: "claude-fable-5-1", explain: "claude-sonnet-5-5", whisper: "whisper-1" } as const;
export const LIMITS = { maxUploadBytes: 150 * 1024 * 1024, maxDurationSeconds: 180, maxFrames: 60, frameWidth: 512, candidatesPerDirection: 25, deezerRps: 8, sectionMin: 12, sectionMax: 20, sectionDefault: 15, pipelineBudgetMs: 280_000 } as const;
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
// db queries follow the pattern: getSubmission(id), createSubmission({...}), setSubmissionStatus(id, status, error?), upsertAnalysis(...), replaceCandidates(submissionId, rows), replaceRecommendations(submissionId, rows), listSubmissions(), insertEvent(...), getActiveSubscription(creatorId), activateSubscription(...)
```

---
## Phase 0 — Foundations

**Demo when done:** `pnpm dev` serves the upload screen shell with the headline; local Supabase has every table from `docs/DATA_MODEL.md`; `pnpm db:types` produces `src/db/types.ts`; `pnpm typecheck` and `pnpm test` pass.

Notes for the implementer:
- Two columns are added to `candidates` beyond the current `docs/DATA_MODEL.md` because the engine types require them: `direction` (the `DirectionTag`) and `artwork_url`, `deezer_url`, `preview_url` (carried from `VerifiedCandidate` so `recommendations` can be built from candidate rows). Task 0.3 step 1 updates the doc first, per CLAUDE.md.
- `src/db/client.ts` imports `next/headers`, so the browser client lives in its own file `src/db/browser.ts`. Client components import only from `src/db/browser.ts`.
- All `src/db/queries/*` functions use the service-role client and are `server-only`. Ownership checks (is this the caller's submission?) happen in the route/page that calls them. RLS still protects any direct Supabase access from the browser.

---

### Task 0.1: Scaffold the Next.js app

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.gitignore`, `.env.example`, `.eslintrc.json`
- Create (temporary, replaced in Task 0.6): `app/layout.tsx`, `app/page.tsx`, `app/globals.css`

**Interfaces:**
- Produces: the `@/*` path alias mapping to the repo root (so `@/src/shared/types` resolves), the scripts every later task runs (`pnpm typecheck`, `pnpm test`, `pnpm db:types`, `pnpm db:reset`).

- [ ] **Step 1: Scaffold with create-next-app into the current folder**

Run from `/Users/dylanbryan/Songfit` (the folder already has `CLAUDE.md`, `README.md`, `docs/`; create-next-app accepts a non-empty dir only when it contains no conflicting files — these do not conflict):

```bash
pnpm create next-app@latest . --ts --eslint --app --no-src-dir --no-tailwind --import-alias "@/*" --use-pnpm --yes
```

Expected: `Success! Created songfit at /Users/dylanbryan/Songfit`. The folder now contains `app/`, `public/`, `next.config.ts`, `tsconfig.json`, `package.json`, `.gitignore`, `.eslintrc.json` (or `eslint.config.mjs`), `next-env.d.ts`.

If create-next-app refuses because of `README.md`, run it in a temp dir and move everything except `README.md` back:

```bash
pnpm create next-app@latest /tmp/songfit-scaffold --ts --eslint --app --no-src-dir --no-tailwind --import-alias "@/*" --use-pnpm --yes
rsync -a --exclude README.md --exclude .git /tmp/songfit-scaffold/ /Users/dylanbryan/Songfit/
```

- [ ] **Step 2: Install runtime and dev dependencies**

```bash
pnpm add next react react-dom @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk openai zod ffmpeg-static ffprobe-static stripe
pnpm add -D typescript vitest @types/node @types/react @types/react-dom tailwindcss@3 postcss autoprefixer eslint eslint-config-next
```

Expected: `pnpm-lock.yaml` updated, no peer-dependency errors. `ffmpeg-static` downloads a binary on install (~70 MB); if the download fails behind a proxy, re-run `pnpm install`.

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
    "db:types": "supabase gen types typescript --local > src/db/types.ts",
    "db:reset": "supabase db reset"
  }
}
```

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
  experimental: {
    serverComponentsExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net" },
      { protocol: "https", hostname: "cdn-images.dzcdn.net" },
      { protocol: "https", hostname: "is1-ssl.mzstatic.com" },
      { protocol: "https", hostname: "**.mzstatic.com" },
    ],
  },
};

export default nextConfig;
```

If `next build` warns that `serverComponentsExternalPackages` moved to top-level `serverExternalPackages` (Next 15+), move it to `serverExternalPackages: ["ffmpeg-static", "ffprobe-static"]` at the top level.

- [ ] **Step 7: Write `.env.example`**

```bash
# Supabase (Project Settings → API)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Models
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PAYMENT_LINK_URL=https://buy.stripe.com/replace-me

# App
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ADMIN_EMAILS=dylanbryan2002@gmail.com
```

- [ ] **Step 8: Write `.gitignore`**

Append to the scaffolded `.gitignore` (keep what create-next-app wrote):

```
# env
.env
.env.local
.env.*.local

# supabase local
supabase/.branches
supabase/.temp

# media scratch
tmp/
```

- [ ] **Step 9: Verify typecheck and build run**

```bash
pnpm typecheck
pnpm build
```

Expected: `pnpm typecheck` exits 0 with no output. `pnpm build` prints the route table with `○ /` and exits 0.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app with Tailwind, scripts and env example"
```

---

### Task 0.2: Shared config, types, errors, logger

**Files:**
- Create: `src/shared/config.ts`, `src/shared/types.ts`, `src/shared/errors.ts`, `src/shared/logger.ts`, `vitest.config.ts`
- Test: `tests/shared/types.test.ts`, `tests/shared/config.test.ts`

**Interfaces:**
- Produces: everything in the "Shared interfaces" block of the header: `VideoAnalysis`, `MusicBrief`, `AnalysisResult`, `DirectionTag`, `DIRECTION_LABEL`, `GeneratedCandidate`, `VerifiedCandidate`, `DIMENSIONS`, `Dimension`, `ComponentScore`, `ComponentScores`, `ScoredCandidate`, `Pick`, `FinalRecommendation`, `SubmissionStatus`; `MODELS`, `LIMITS`, `CONTENT_CATEGORIES`, `env()`; `PipelineError`; `log`.

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": process.cwd(),
    },
  },
});
```

- [ ] **Step 2: Write the failing tests**

`tests/shared/types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { VideoAnalysis, MusicBrief, DIRECTION_LABEL } from "@/src/shared/types";

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
import { env, LIMITS, CONTENT_CATEGORIES } from "@/src/shared/config";

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

describe("LIMITS", () => {
  it("keeps section bounds sane", () => {
    expect(LIMITS.sectionMin).toBeLessThan(LIMITS.sectionDefault);
    expect(LIMITS.sectionDefault).toBeLessThan(LIMITS.sectionMax);
    expect(LIMITS.maxDurationSeconds).toBe(180);
  });
  it("has 'other' as a content category", () => {
    expect(CONTENT_CATEGORIES).toContain("other");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm test
```

Expected: FAIL with `Cannot find module '@/src/shared/types'` (and the same for config).

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
  section_reason: z.string(),
  fit_reason: z.string(),
  direction: DirectionTag,
});
export type GeneratedCandidate = z.infer<typeof GeneratedCandidate>;

export const VerifiedCandidate = GeneratedCandidate.extend({
  deezer_id: z.string(),
  duration_seconds: z.number(),
  artwork_url: z.string().nullable(),
  deezer_url: z.string(),
  preview_url: z.string().nullable(),
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
  direction_label: z.string(),
  start_seconds: z.number(),
  end_seconds: z.number(),
});
export type Pick = z.infer<typeof Pick>;

export const FinalRecommendation = Pick.extend({
  explanation: z.string(),
  spotify_url: z.string(),
  itunes_id: z.string().nullable(),
});
export type FinalRecommendation = z.infer<typeof FinalRecommendation>;

export const SubmissionStatus = z.enum(["uploaded", "analyzing", "recommending", "ready", "failed"]);
export type SubmissionStatus = z.infer<typeof SubmissionStatus>;
```

- [ ] **Step 5: Write `src/shared/config.ts`**

```ts
export const MODELS = {
  analysis: "claude-fable-5-1",
  candidates: "claude-fable-5-1",
  scoring: "claude-fable-5-1",
  explain: "claude-sonnet-5-5",
  whisper: "whisper-1",
} as const;

export const LIMITS = {
  maxUploadBytes: 150 * 1024 * 1024,
  maxDurationSeconds: 180,
  maxFrames: 60,
  frameWidth: 512,
  candidatesPerDirection: 25,
  deezerRps: 8,
  sectionMin: 12,
  sectionMax: 20,
  sectionDefault: 15,
  pipelineBudgetMs: 280_000,
} as const;

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

export const log = {
  debug: (msg: string, data?: Record<string, unknown>) => write("debug", msg, data),
  info: (msg: string, data?: Record<string, unknown>) => write("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => write("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => write("error", msg, data),
};
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: `Test Files  2 passed`, `Tests  9 passed`.

- [ ] **Step 9: Typecheck and commit**

```bash
pnpm typecheck
git add vitest.config.ts src/shared tests/shared
git commit -m "Add shared config, Zod types, pipeline error and logger"
```

---

### Task 0.3: Supabase local project and migrations

**Files:**
- Modify: `docs/DATA_MODEL.md` (add `direction`, `artwork_url`, `deezer_url`, `preview_url` to candidates)
- Create: `supabase/config.toml` (generated by `supabase init`, then edited), `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_catalog.sql`, `supabase/migrations/0003_rls.sql`
- Create (generated): `src/db/types.ts`

**Interfaces:**
- Produces: every table in `docs/DATA_MODEL.md`, the `videos` storage bucket, and the generated `Database` type in `src/db/types.ts` that Task 0.4 imports.

- [ ] **Step 1: Update `docs/DATA_MODEL.md` candidates table**

In the `## candidates` table, add these rows after `generator_reason`:

```markdown
| direction         | text        | safe / current / unexpected (DirectionTag)         |
| artwork_url       | text        | nullable, from Deezer                              |
| deezer_url        | text        | nullable, from Deezer                              |
| preview_url       | text        | nullable, 30s Deezer preview                       |
```

- [ ] **Step 2: Install the Supabase CLI and init**

```bash
brew install supabase/tap/supabase   # or: npx supabase@latest --version to use npx
supabase init
```

Expected: `Finished supabase init.` and a new `supabase/config.toml`. (If `brew` is unavailable, prefix every `supabase` command below with `npx supabase@latest`.)

- [ ] **Step 3: Configure Google auth in `supabase/config.toml`**

Find the `[auth.external.google]` block (or add it) and set:

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
redirect_uri = ""
skip_nonce_check = true
```

Also under `[auth]` set:

```toml
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/auth/callback", "https://thissongfits.com/auth/callback"]
```

Add to `.env.example`:

```bash
# Supabase local Google provider (hosted project sets these in the dashboard)
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=
```

- [ ] **Step 4: Write `supabase/migrations/0001_init.sql`**

```sql
-- Songfit core tables. See docs/DATA_MODEL.md.
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
  created_at timestamptz not null default now()
);
create index submissions_creator_id_idx on public.submissions (creator_id);
create index submissions_status_idx on public.submissions (status);
create index submissions_created_at_idx on public.submissions (created_at desc);

-- video_analyses -----------------------------------------------------------
create table public.video_analyses (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete cascade,
  summary text not null,
  content_type text not null,
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
  song_id uuid, -- FK to songs added in 0002_catalog.sql
  title text not null,
  artist text not null,
  deezer_id text,
  itunes_id text,
  duration_seconds numeric,
  verified boolean not null default false,
  proposed_start numeric not null,
  proposed_end numeric not null,
  generator_reason text not null,
  direction text not null check (direction in ('safe', 'current', 'unexpected')),
  artwork_url text,
  deezer_url text,
  preview_url text,
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
create index events_created_at_idx on public.events (created_at desc);

-- subscriptions ------------------------------------------------------------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators (id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  status text not null check (status in ('active', 'canceled', 'past_due')),
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index subscriptions_creator_id_idx on public.subscriptions (creator_id);
create unique index subscriptions_stripe_subscription_id_idx
  on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- storage ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('videos', 'videos', false, 157286400)
on conflict (id) do nothing;
```

- [ ] **Step 5: Write `supabase/migrations/0002_catalog.sql`**

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
```

- [ ] **Step 6: Write `supabase/migrations/0003_rls.sql`**

```sql
-- Row Level Security. Creators see only their own rows. Tables with no
-- policies are service-role only (the service role bypasses RLS).

alter table public.creators enable row level security;
create policy "creators: read own" on public.creators
  for select to authenticated using (auth.uid() = id);
create policy "creators: update own" on public.creators
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

alter table public.submissions enable row level security;
create policy "submissions: read own" on public.submissions
  for select to authenticated using (auth.uid() = creator_id);
create policy "submissions: insert own" on public.submissions
  for insert to authenticated with check (auth.uid() = creator_id);

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

alter table public.songs enable row level security;
alter table public.song_segments enable row level security;
alter table public.song_trend_signals enable row level security;
-- no policies: service role only

-- Storage: creators upload to and read from their own folder in `videos`.
create policy "videos: upload own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "videos: read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);
```

- [ ] **Step 7: Start local Supabase and apply migrations**

```bash
supabase start
pnpm db:reset
```

Expected: `supabase start` prints `API URL: http://127.0.0.1:54321`, `anon key: ...`, `service_role key: ...`. `pnpm db:reset` prints `Applying migration 0001_init.sql`, `0002_catalog.sql`, `0003_rls.sql` and `Finished supabase db reset`.

Copy the printed anon and service_role keys into `.env.local` (create it from `.env.example`).

- [ ] **Step 8: Verify the tables exist**

```bash
supabase db query "select table_name from information_schema.tables where table_schema = 'public' order by 1"
```

(If that subcommand is unavailable in your CLI version, use `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\dt public.*"`.)

Expected rows: `candidates, creators, events, recommendations, song_segments, song_trend_signals, songs, submissions, subscriptions, video_analyses`.

```bash
supabase db query "select id, public, file_size_limit from storage.buckets"
```

Expected: one row `videos | false | 157286400`.

- [ ] **Step 9: Generate database types**

```bash
mkdir -p src/db
pnpm db:types
head -5 src/db/types.ts
```

Expected: file begins with `export type Json =` and contains `candidates: { Row: {` further down.

- [ ] **Step 10: Commit**

```bash
pnpm typecheck
git add docs/DATA_MODEL.md supabase src/db/types.ts .env.example
git commit -m "Add Supabase config, core and catalog migrations, RLS and generated types"
```

---

### Task 0.4: Database clients and typed queries

**Files:**
- Create: `src/db/client.ts`, `src/db/browser.ts`, `src/db/queries/creators.ts`, `src/db/queries/submissions.ts`, `src/db/queries/analyses.ts`, `src/db/queries/candidates.ts`, `src/db/queries/recommendations.ts`, `src/db/queries/events.ts`, `src/db/queries/subscriptions.ts`

**Interfaces:**
- Consumes: `Database` from `src/db/types.ts` (Task 0.3); `env()` from `src/shared/config.ts` (Task 0.2); `SubmissionStatus` from `src/shared/types.ts`.
- Produces:
  - `createServerClient(): Promise<SupabaseClient<Database>>`, `createServiceClient(): SupabaseClient<Database>` (in `client.ts`); `createBrowserClient(): SupabaseClient<Database>` (in `browser.ts`).
  - `ensureCreator(id, email, displayName?)`, `getCreatorByEmail(email)`, `getCreator(id)`
  - `getSubmission(id)`, `createSubmission({ creatorId, videoPath, creatorIntent })`, `setSubmissionStatus(id, status, error?)`, `setSubmissionAnalyzed(id, { durationSeconds, contentCategory })`, `markSubmissionViewed(id)`, `listSubmissions(limit?)`, `countSubmissionsForCreator(creatorId)`
  - `upsertAnalysis(row)`, `getAnalysis(submissionId)`
  - `replaceCandidates(submissionId, rows)`, `listCandidates(submissionId)`
  - `replaceRecommendations(submissionId, rows)`, `listRecommendations(submissionId)`
  - `insertEvent(row)`, `listEventsForSubmission(submissionId)`, `countEventsByName()`
  - `getActiveSubscription(creatorId)`, `activateSubscription({ creatorId, stripeCustomerId, stripeSubscriptionId })`, `setSubscriptionStatus(stripeSubscriptionId, status)`
  - Row type aliases: `SubmissionRow`, `AnalysisRow`, `CandidateRow`, `RecommendationRow`, `EventRow`, `SubscriptionRow`, `CreatorRow`, and `Insert` variants.

No unit tests in this task: every function is a thin typed wrapper over Supabase with no logic. Verified by `pnpm typecheck` against the generated `Database` type, and exercised end to end in Phase 1.

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

Install the `server-only` package so the import guard works:

```bash
pnpm add server-only
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

export type SubmissionRow = Database["public"]["Tables"]["submissions"]["Row"];

export async function getSubmission(id: string): Promise<SubmissionRow | null> {
  const { data, error } = await createServiceClient().from("submissions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createSubmission(input: {
  creatorId: string;
  videoPath: string;
  creatorIntent: string | null;
}): Promise<SubmissionRow> {
  const { data, error } = await createServiceClient()
    .from("submissions")
    .insert({
      creator_id: input.creatorId,
      video_path: input.videoPath,
      creator_intent: input.creatorIntent,
      status: "uploaded",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setSubmissionStatus(
  id: string,
  status: SubmissionStatus,
  error?: string | null,
): Promise<void> {
  const patch: Database["public"]["Tables"]["submissions"]["Update"] = { status, error: error ?? null };
  if (status === "ready") patch.recommended_at = new Date().toISOString();
  const { error: dbError } = await createServiceClient().from("submissions").update(patch).eq("id", id);
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

/** Paywall input: how many finished results this creator already has. */
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
import { VideoAnalysis, MusicBrief } from "../../shared/types";

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

/** Idempotent per stage run: deletes the submission's candidates and inserts the new set. */
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

/** Idempotent on stripe_subscription_id. */
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

- [ ] **Step 10: Typecheck and commit**

```bash
pnpm typecheck
```

Expected: exit 0. If `upsert(..., { onConflict: "stripe_subscription_id" })` fails typecheck because the partial unique index is not a constraint, change the migration: replace the partial unique index in `0001_init.sql` with a plain `unique (stripe_subscription_id)` column constraint (NULLs are allowed to repeat under a unique constraint), run `pnpm db:reset && pnpm db:types`, and re-run typecheck.

```bash
git add src/db package.json pnpm-lock.yaml
git commit -m "Add Supabase clients and typed query functions"
```

---

### Task 0.5: Event names and `logEvent`

**Files:**
- Create: `src/feedback/events.ts`
- Test: `tests/feedback/events.test.ts`

**Interfaces:**
- Consumes: `insertEvent` from `src/db/queries/events.ts` (Task 0.4).
- Produces: `EVENT_NAMES`, `EventName`, `isEventName(x): x is EventName`, `logEvent({ name, creatorId?, submissionId?, metadata? })`.

- [ ] **Step 1: Write the failing test**

`tests/feedback/events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { EVENT_NAMES, isEventName } from "@/src/feedback/events";

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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm test tests/feedback
```

Expected: FAIL with `Cannot find module '@/src/feedback/events'`.

- [ ] **Step 3: Write `src/feedback/events.ts`**

```ts
import { insertEvent } from "@/src/db/queries/events";
import { log } from "@/src/shared/logger";

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
 * creator's request. Errors are logged.
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
    log.error("logEvent failed", { name: e.name, error: String(err) });
  }
}
```

The test file imports `events.ts`, which imports `src/db/queries/events.ts`, which imports `server-only`. Vitest does not run in a Next server context, so `server-only` throws on import. Add this alias to `vitest.config.ts` so the guard is a no-op in tests:

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
      "server-only": path.join(process.cwd(), "tests", "stubs", "server-only.ts"),
    },
  },
});
```

And create `tests/stubs/server-only.ts`:

```ts
// Vitest stub: the real package throws outside Next's server runtime.
export {};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm test
```

Expected: `Test Files  3 passed`, all tests green. If the DATA_MODEL comparison fails, the list in the doc and in code differ — fix the code list, not the test.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add src/feedback/events.ts tests/feedback tests/stubs vitest.config.ts
git commit -m "Add event names with logEvent and doc-sync test"
```

---

### Task 0.6: App shell, palette, logo and upload screen placeholder

**Files:**
- Create: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`, `components/Logo.tsx`, `components/UploadForm.tsx`
- Delete: any `app/page.module.css`, `app/favicon.ico` references that create-next-app added to `page.tsx` (keep `favicon.ico` itself)

**Interfaces:**
- Produces: `<Logo />` (wordmark), `<UploadForm />` placeholder that Phase 1 Task 1.x replaces with the real client component (same file path, same default export name `UploadForm`).

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
export default function Logo({ className = "" }: { className?: string }) {
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
    </form>
  );
}
```

- [ ] **Step 5: Write `app/page.tsx`**

```tsx
import Logo from "@/components/Logo";
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

Add `muted` to the Tailwind palette so `text-muted` resolves. In `tailwind.config.ts` `colors`, add `muted: "#6B7280"`.

- [ ] **Step 6: Run the dev server and check the page**

```bash
pnpm dev &
sleep 5
curl -s http://localhost:3000 | grep -o "Find the right song for your content."
kill %1
```

Expected: the curl prints `Find the right song for your content.` once.

Open `http://localhost:3000` in a browser at a 390 px wide viewport: wordmark on top, headline, subline, dashed upload box, disabled input and button, no horizontal scroll.

- [ ] **Step 7: Typecheck, lint, test, commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add app components tailwind.config.ts
git commit -m "Add app shell, palette, logo and upload screen placeholder"
```

---

### Phase 0 demo check

- [ ] `pnpm dev` → `http://localhost:3000` shows the Songfit wordmark, headline "Find the right song for your content." and the placeholder upload form, correctly at phone width.
- [ ] `supabase status` shows the local stack running; `supabase db query "select count(*) from information_schema.tables where table_schema='public'"` returns `10`.
- [ ] `storage.buckets` contains `videos`, private, 150 MB limit.
- [ ] `src/db/types.ts` exists, is committed, and `pnpm typecheck` passes.
- [ ] `pnpm test` passes: schema tests, env tests, event-name sync test.
- [ ] `.env.example` lists every key; `.env.local` exists locally and is git-ignored.
- [ ] `git log --oneline` shows six commits for Tasks 0.1–0.6.
## Phase 1 — Upload → stored submission

**Demo when done:** From a phone on the LAN, sign in with Google, pick a Reel, watch it upload with a progress bar, land on a waiting page that polls a real `submissions` row.

Assumes Phase 0 is complete: scaffold, `src/shared/{types,config,logger,errors}.ts`, `src/db/client.ts` (`createBrowserClient`, `createServerClient`, `createServiceClient`), `src/db/queries/*`, `src/feedback/events.ts` (`EVENT_NAMES`, `logEvent`), `components/Logo.tsx`, `app/page.tsx` rendering a placeholder `<UploadForm />`.

Query functions from Phase 0 used here (signatures):

```ts
// src/db/queries/creators.ts
export async function ensureCreator(id: string, email: string, displayName?: string | null): Promise<CreatorRow>; // CreatorRow has created_at
// src/db/queries/submissions.ts
export async function getSubmission(id: string): Promise<SubmissionRow | null>;
export async function createSubmission(s: { id: string; creatorId: string; videoPath: string; creatorIntent: string | null }): Promise<SubmissionRow>;
export async function setSubmissionStatus(id: string, status: SubmissionStatus, error?: string | null): Promise<void>;
export async function countReadySubmissions(creatorId: string): Promise<number>;
// src/db/queries/subscriptions.ts
export async function getActiveSubscription(creatorId: string): Promise<{ id: string; status: string } | null>;
```

`SubmissionRow` is `Database["public"]["Tables"]["submissions"]["Row"]` from `src/db/types.ts`.

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
- Consumes: `createServerClient()` from `src/db/client.ts` (returns a Supabase client bound to Next cookies), `env()` from `src/shared/config.ts`, `ensureCreator()` from `src/db/queries/creators.ts`.
- Produces:
  - `isAdminEmail(email: string | null | undefined, list: string): boolean` (pure)
  - `getCreator(): Promise<{ id: string; email: string } | null>`
  - `requireCreator(): Promise<{ id: string; email: string }>` — redirects to `/` when signed out
  - `requireAdmin(): Promise<{ id: string; email: string }>` — redirects to `/` unless admin
  - `signInWithGoogle(next: string): Promise<void>` (client)

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

export async function requireAdmin(): Promise<Creator> {
  const creator = await getCreator();
  if (!creator || !isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "")) {
    redirect("/");
  }
  return creator;
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 8: Write the client sign-in helper**

```ts
// components/auth.ts
"use client";
import { createBrowserClient } from "@/src/db/client";

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

### Task 1.2: Signed upload URL, storage helpers, paywall decision

**Files:**
- Create: `src/media/storage.ts`
- Create: `src/billing/paywall.ts`
- Create: `app/api/upload-url/route.ts`
- Test: `tests/billing/paywall.test.ts`

**Interfaces:**
- Consumes: `createServiceClient()` from `src/db/client.ts`, `LIMITS` and `env()` from `src/shared/config.ts`, `getCreator()` from `src/auth/session.ts`, `countReadySubmissions()` from `src/db/queries/submissions.ts` and `getActiveSubscription()` from `src/db/queries/subscriptions.ts` (both defined in Phase 0, Task 0.4).
- Note for `storage.ts`: import `{ mkdtemp, writeFile }` from `node:fs/promises`, `os` from `node:os`, `path` from `node:path`. No shared `TMP_DIR` constant is needed.
- Produces:
  - `getSignedUploadUrl(creatorId, submissionId, ext): Promise<{ path; token; signedUrl }>`
  - `downloadToTmp(storagePath): Promise<string>` (local file path)
  - `getSignedPlaybackUrl(storagePath, seconds = 3600): Promise<string>`
  - `decideCanSubmit(readyCount: number, hasActiveSub: boolean): { ok: true } | { ok: false; reason: "needs_subscription" }` (pure)
  - `canSubmit(creatorId): Promise<ReturnType<typeof decideCanSubmit>>`
  - `POST /api/upload-url` → `200 { submissionId, path, token, signedUrl }` | `401` | `402 { reason: "needs_subscription" }` | `400`

- [ ] **Step 1: Write the failing paywall test**

```ts
// tests/billing/paywall.test.ts
import { describe, expect, it } from "vitest";
import { decideCanSubmit } from "../../src/billing/paywall";

describe("decideCanSubmit", () => {
  it("allows the first submission with no subscription", () => {
    expect(decideCanSubmit(0, false)).toEqual({ ok: true });
  });
  it("blocks a second submission without an active subscription", () => {
    expect(decideCanSubmit(1, false)).toEqual({ ok: false, reason: "needs_subscription" });
    expect(decideCanSubmit(5, false)).toEqual({ ok: false, reason: "needs_subscription" });
  });
  it("allows any submission with an active subscription", () => {
    expect(decideCanSubmit(0, true)).toEqual({ ok: true });
    expect(decideCanSubmit(9, true)).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/billing/paywall.test.ts`
Expected: FAIL — `Cannot find module '../../src/billing/paywall'`

- [ ] **Step 3: Write the paywall module**

```ts
// src/billing/paywall.ts
import { countReadySubmissions } from "@/src/db/queries/submissions";
import { getActiveSubscription } from "@/src/db/queries/subscriptions";

export type CanSubmit = { ok: true } | { ok: false; reason: "needs_subscription" };

/** Pure rule: one free result per creator; after that an active subscription is required. */
export function decideCanSubmit(readyCount: number, hasActiveSub: boolean): CanSubmit {
  if (hasActiveSub) return { ok: true };
  if (readyCount >= 1) return { ok: false, reason: "needs_subscription" };
  return { ok: true };
}

export async function canSubmit(creatorId: string): Promise<CanSubmit> {
  const [readyCount, sub] = await Promise.all([
    countReadySubmissions(creatorId),
    getActiveSubscription(creatorId),
  ]);
  return decideCanSubmit(readyCount, sub !== null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/billing/paywall.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the storage helpers**

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

export async function objectExists(storagePath: string): Promise<boolean> {
  const supabase = createServiceClient();
  const dir = path.posix.dirname(storagePath);
  const name = path.posix.basename(storagePath);
  const { data, error } = await supabase.storage.from(VIDEO_BUCKET).list(dir, { search: name });
  if (error) throw new Error(`storage list failed: ${error.message}`);
  return (data ?? []).some((o) => o.name === name);
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

- [ ] **Step 6: Write the upload-url route**

```ts
// app/api/upload-url/route.ts
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { canSubmit } from "@/src/billing/paywall";
import { getSignedUploadUrl } from "@/src/media/storage";
import { LIMITS } from "@/src/shared/config";

const Body = z.object({
  ext: z.enum(["mp4", "mov", "webm", "m4v"]),
  sizeBytes: z.number().int().positive().max(LIMITS.maxUploadBytes),
});

export async function POST(request: Request) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const gate = await canSubmit(creator.id);
  if (!gate.ok) return NextResponse.json({ reason: gate.reason }, { status: 402 });

  const submissionId = randomUUID();
  const { path, token, signedUrl } = await getSignedUploadUrl(creator.id, submissionId, parsed.data.ext);
  return NextResponse.json({ submissionId, path, token, signedUrl });
}
```

- [ ] **Step 7: Typecheck and run all tests**

Run: `pnpm typecheck && pnpm test`
Expected: typecheck exits 0; vitest PASS including `tests/billing/paywall.test.ts`

- [ ] **Step 8: Manual check with curl (signed-in cookie required, so use the browser instead)**

In a browser signed in on `http://localhost:3000`, open devtools console and run:

```js
await fetch("/api/upload-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ext: "mp4", sizeBytes: 1000 }) }).then(r => r.json())
```

Expected: `{ submissionId: "<uuid>", path: "<creatorId>/<uuid>.mp4", token: "...", signedUrl: "https://..." }`. Signed out, expected `401`.

- [ ] **Step 9: Commit**

```bash
git add src/media/storage.ts src/billing/paywall.ts app/api/upload-url tests/billing
git commit -m "Add signed upload URL route, storage helpers and paywall rule"
```

---

### Task 1.3: Submission creation, pipeline trigger, status endpoint

**Files:**
- Create: `src/pipeline/run.ts` (stub for this phase)
- Create: `app/api/submissions/route.ts`
- Create: `app/api/submissions/[id]/run/route.ts`
- Create: `app/api/submissions/[id]/route.ts`
- Modify: `.env.example` (add `INTERNAL_TOKEN`)

**Interfaces:**
- Consumes: `getCreator()`, `isAdminEmail()`, `objectExists()`, `createSubmission()`, `getSubmission()`, `setSubmissionStatus()`, `logEvent()`, `env()`.
- Produces:
  - `runSubmission(submissionId: string): Promise<void>` — Phase 2 replaces the body; signature is final.
  - `POST /api/submissions` body `{ submissionId, path, creatorIntent }` → `201 { id }`
  - `POST /api/submissions/[id]/run` header `x-internal-token` → `200 { ok: true }`
  - `GET /api/submissions/[id]` → `200 { status, error, recommendations: [] }` | `404`

- [ ] **Step 1: Add `INTERNAL_TOKEN` to `.env.example`**

Append:

```
# Shared secret so only this app can trigger pipeline runs. Generate: openssl rand -hex 32
INTERNAL_TOKEN=
```

Also add a real random value to your local `.env.local`.

- [ ] **Step 2: Write the pipeline stub**

```ts
// src/pipeline/run.ts
import { setSubmissionStatus } from "@/src/db/queries/submissions";
import { logger } from "@/src/shared/logger";

/**
 * Runs the full pipeline for a submission. Phase 1 stub: only advances the
 * status so the waiting page has something to poll. Phase 2 adds analysis,
 * Phase 3 adds recommendation.
 */
export async function runSubmission(submissionId: string): Promise<void> {
  logger.info("pipeline.start", { submissionId });
  await setSubmissionStatus(submissionId, "analyzing");
}
```

- [ ] **Step 3: Write the submission creation route**

```ts
// app/api/submissions/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { createSubmission, countSubmissionsForCreator } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";
import { objectExists } from "@/src/media/storage";
import { env } from "@/src/shared/config";
import { logger } from "@/src/shared/logger";

const Body = z.object({
  submissionId: z.string().uuid(),
  path: z.string().min(1),
  creatorIntent: z.string().trim().max(300).nullable().optional(),
});

export async function POST(request: Request) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { submissionId, path, creatorIntent } = parsed.data;

  // The path must belong to this creator and the object must really exist.
  if (!path.startsWith(`${creator.id}/`)) {
    return NextResponse.json({ error: "forbidden_path" }, { status: 403 });
  }
  if (!(await objectExists(path))) {
    return NextResponse.json({ error: "upload_not_found" }, { status: 400 });
  }

  const submission = await createSubmission({
    id: submissionId,
    creatorId: creator.id,
    videoPath: path,
    creatorIntent: creatorIntent?.length ? creatorIntent : null,
  });

  await logEvent({ name: "submission_created", creatorId: creator.id, submissionId: submission.id });
  await logEvent({ name: "upload_completed", creatorId: creator.id, submissionId: submission.id });
  if ((await countSubmissionsForCreator(creator.id)) >= 2) {
    await logEvent({ name: "returned_with_second_submission", creatorId: creator.id, submissionId: submission.id });
  }

  // Fire the pipeline without awaiting it. On Vercel the function may be
  // frozen once we return; `waitUntil` keeps the fetch alive. Locally it
  // simply runs in the background.
  const origin = new URL(request.url).origin;
  const trigger = fetch(`${origin}/api/submissions/${submission.id}/run`, {
    method: "POST",
    headers: { "x-internal-token": env("INTERNAL_TOKEN") },
  }).catch((err) => logger.error("pipeline.trigger_failed", { submissionId, err: String(err) }));

  try {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(trigger);
  } catch {
    // @vercel/functions not available (local dev without the package): fire and forget.
    void trigger;
  }

  return NextResponse.json({ id: submission.id }, { status: 201 });
}
```

Install the helper so the import resolves on Vercel: `pnpm add @vercel/functions`.

Risk note (document in README under "Known limitations"): if `@vercel/functions` is unavailable and the serverless function is frozen before the trigger request leaves, the pipeline never starts. The admin queue (Phase 4) has a Retry button that calls the run route directly, which covers this case.

- [ ] **Step 4: Write the run route**

```ts
// app/api/submissions/[id]/run/route.ts
import { NextResponse } from "next/server";
import { runSubmission } from "@/src/pipeline/run";
import { env } from "@/src/shared/config";
import { logger } from "@/src/shared/logger";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = request.headers.get("x-internal-token");
  if (!token || token !== env("INTERNAL_TOKEN")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  try {
    await runSubmission(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error("pipeline.unhandled", { submissionId: id, err: String(err) });
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 5: Write the status route**

```ts
// app/api/submissions/[id]/route.ts
import { NextResponse } from "next/server";
import { isAdminEmail } from "@/src/auth/admin";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await ctx.params;
  const submission = await getSubmission(id);
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const isOwner = submission.creator_id === creator.id;
  const isAdmin = isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "");
  if (!isOwner && !isAdmin) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    status: submission.status,
    error: submission.error,
    recommendations: [], // Phase 3 fills this from the recommendations table
  });
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0

- [ ] **Step 7: Manual check of the run route token guard**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/submissions/00000000-0000-0000-0000-000000000000/run`
Expected: `403`

Run: `curl -s -X POST -H "x-internal-token: $(grep INTERNAL_TOKEN .env.local | cut -d= -f2)" http://localhost:3000/api/submissions/00000000-0000-0000-0000-000000000000/run`
Expected: `{"ok":false,"error":"..."}` with a 500 (no such row) — proves the guard passed and `runSubmission` was called.

- [ ] **Step 8: Commit**

```bash
git add src/pipeline/run.ts app/api/submissions .env.example package.json pnpm-lock.yaml
git commit -m "Add submission creation, pipeline trigger and status routes"
```

---

### Task 1.4: UploadForm — pick video, sign in, upload with progress, create submission

**Files:**
- Create: `components/UploadForm.tsx`
- Create: `components/videoDuration.ts`
- Create: `components/uploadWithProgress.ts`
- Modify: `app/page.tsx`
- Test: `tests/components/fileExt.test.ts`

**Interfaces:**
- Consumes: `signInWithGoogle()` from `components/auth.ts`, `createBrowserClient()` from `src/db/client.ts`, `LIMITS` from `src/shared/config.ts`, `POST /api/upload-url`, `POST /api/submissions`.
- Produces:
  - `fileExt(file: { name: string; type: string }): "mp4" | "mov" | "webm" | "m4v" | null` (pure)
  - `readVideoDuration(file: File): Promise<number>` (client)
  - `uploadWithProgress(signedUrl: string, file: File, onProgress: (pct: number) => void): Promise<void>` (client, XHR PUT)
  - `<UploadForm creator={Creator | null} resume={boolean} />`

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

- [ ] **Step 6: Write the XHR uploader with progress**

Supabase's `uploadToSignedUrl` does not expose progress in the browser, so PUT directly to the signed URL. The signed upload URL from `createSignedUploadUrl` accepts a PUT with the file body and the token in the `Authorization` header is not required because the token is embedded in the URL query (`?token=...`).

```ts
// components/uploadWithProgress.ts
"use client";

export function uploadWithProgress(
  signedUrl: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl, true);
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
}
```

Fallback: if the PUT returns 400 in testing, switch to the SDK call (no progress):

```ts
const supabase = createBrowserClient();
const { error } = await supabase.storage.from("videos").uploadToSignedUrl(path, token, file, { contentType: file.type });
if (error) throw error;
```

- [ ] **Step 7: Write the UploadForm component**

```tsx
// components/UploadForm.tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithGoogle } from "./auth";
import { fileExt } from "./fileExt";
import { readVideoDuration } from "./videoDuration";
import { uploadWithProgress } from "./uploadWithProgress";
import { LIMITS } from "@/src/shared/config";

type Creator = { id: string; email: string } | null;
type Phase = "idle" | "checking" | "uploading" | "creating" | "error";

const PENDING_KEY = "songfit.pending";

export function UploadForm({ creator, resume }: { creator: Creator; resume: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [intent, setIntent] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Restore intent after the OAuth round-trip. The File cannot survive a redirect.
  useEffect(() => {
    if (!resume) return;
    try {
      const raw = sessionStorage.getItem(PENDING_KEY);
      if (raw) {
        const pending = JSON.parse(raw) as { intent?: string };
        if (pending.intent) setIntent(pending.intent);
        sessionStorage.removeItem(PENDING_KEY);
      }
    } catch {
      /* sessionStorage unavailable: nothing to restore */
    }
  }, [resume]);

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
    const f = e.target.files?.[0] ?? null;
    setError(null);
    setFile(f);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!creator) {
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ intent }));
      } catch {
        /* ignore */
      }
      await signInWithGoogle("/?resume=1");
      return;
    }

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
      if (!urlRes.ok) throw new Error("Couldn't start the upload. Try again.");
      const { submissionId, path, signedUrl } = (await urlRes.json()) as {
        submissionId: string;
        path: string;
        token: string;
        signedUrl: string;
      };

      setPhase("uploading");
      setProgress(0);
      await uploadWithProgress(signedUrl, file, setProgress);

      setPhase("creating");
      const createRes = await fetch("/api/submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId, path, creatorIntent: intent.trim() || null }),
      });
      if (!createRes.ok) throw new Error("Upload finished but we couldn't save it. Try again.");
      const { id } = (await createRes.json()) as { id: string };
      router.push(`/results/${id}`);
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
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
            <span className="text-lg font-semibold text-neutral-900">
              {resume && !file ? "Pick your video again to continue" : "Tap to add your Reel"}
            </span>
            <span className="text-sm text-neutral-500">MP4 or MOV, up to 3 minutes</span>
          </div>
        )}
        <input
          id="video"
          ref={inputRef}
          type="file"
          accept="video/*"
          className="sr-only"
          onChange={onPick}
          disabled={busy}
        />
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
        {(phase === "idle" || phase === "error") && (creator ? "Find my songs" : "Find my songs")}
      </button>
    </form>
  );
}
```

- [ ] **Step 8: Wire the page**

```tsx
// app/page.tsx
import { getCreator } from "@/src/auth/session";
import { Logo } from "@/components/Logo";
import { UploadForm } from "@/components/UploadForm";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ resume?: string }>;
}) {
  const [creator, params] = await Promise.all([getCreator(), searchParams]);
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
      <UploadForm creator={creator} resume={params.resume === "1"} />
    </main>
  );
}
```

- [ ] **Step 9: Typecheck and run tests**

Run: `pnpm typecheck && pnpm test`
Expected: exits 0; PASS including `tests/components/fileExt.test.ts`

- [ ] **Step 10: Manual check in the browser**

1. `pnpm dev`, open `http://localhost:3000` signed out. Type an intent, tap "Find my songs". Expected: Google sign-in; on return the URL is `/?resume=1`, the intent is restored, the tap target says "Pick your video again to continue".
2. Pick a short MP4, tap "Find my songs". Expected: button shows "Uploading NN%", then navigates to `/results/<uuid>`.
3. In Supabase Studio, Storage → `videos` → `<creatorId>/<uuid>.mp4` exists; `submissions` has one row with `status = analyzing`.

- [ ] **Step 11: Commit**

```bash
git add components/UploadForm.tsx components/fileExt.ts components/videoDuration.ts components/uploadWithProgress.ts app/page.tsx tests/components
git commit -m "Add upload form with Google sign-in, progress and submission creation"
```

---

### Task 1.5: Waiting page with status polling

**Files:**
- Create: `app/results/[id]/page.tsx`
- Create: `components/WaitingState.tsx`

**Interfaces:**
- Consumes: `getCreator()`, `isAdminEmail()`, `getSubmission()`, `GET /api/submissions/[id]`.
- Produces: `<WaitingState id={string} />`; `/results/[id]` renders waiting state until `status === "ready"`, then a placeholder (Phase 3 replaces the placeholder with the results list).

- [ ] **Step 1: Write the WaitingState client component**

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

export function WaitingState({ id }: { id: string }) {
  const router = useRouter();
  const [lineIdx, setLineIdx] = useState(0);
  const [slow, setSlow] = useState(false);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    const t = setInterval(() => setLineIdx((i) => (i + 1) % LINES.length), LINE_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch(`/api/submissions/${id}`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as { status: Status };
          if (body.status === "ready" && !cancelled) {
            router.refresh();
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
  }, [id, router]);

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
      <style jsx global>{`
        @keyframes slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
```

If `styled-jsx` is not enabled in the scaffold, move the keyframes into `app/globals.css`:

```css
@keyframes slide {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
```

and delete the `<style jsx global>` block.

- [ ] **Step 2: Write the results page (waiting branch now, results branch in Phase 3)**

```tsx
// app/results/[id]/page.tsx
import { notFound, redirect } from "next/navigation";
import { isAdminEmail } from "@/src/auth/admin";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { Logo } from "@/components/Logo";
import { WaitingState } from "@/components/WaitingState";

export const dynamic = "force-dynamic";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, creator] = await Promise.all([params, getCreator()]);
  if (!creator) redirect(`/?next=${encodeURIComponent(`/results/${id}`)}`);

  const submission = await getSubmission(id);
  if (!submission) notFound();
  const isOwner = submission.creator_id === creator.id;
  const isAdmin = isAdminEmail(creator.email, process.env.ADMIN_EMAILS ?? "");
  if (!isOwner && !isAdmin) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-10 px-4 pb-10 pt-10">
      <Logo />
      {submission.status === "ready" ? (
        // Phase 3 replaces this block with the recommendation cards.
        <h1 className="text-2xl font-semibold text-neutral-900">Ready</h1>
      ) : (
        <WaitingState id={id} />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0

- [ ] **Step 4: Manual check**

1. Upload a video (Task 1.4). Expected: `/results/<id>` shows the sliding bar and the rotating lines, changing every 4 s.
2. In Supabase Studio, set that row's `status` to `ready`. Expected: within 3 s the page shows "Ready".
3. Network tab: a `GET /api/submissions/<id>` every 3 s, `200`.
4. Open the same URL in a private window signed in as a different Google account. Expected: 404.

- [ ] **Step 5: Commit**

```bash
git add app/results components/WaitingState.tsx app/globals.css
git commit -m "Add waiting page that polls submission status"
```

---

### Task 1.6: Google provider setup (Dylan, no code)

**Files:** none. Supabase dashboard + Google Cloud Console.

**Interfaces:**
- Produces: a working Google provider on the Supabase project, with redirect URLs for local and production.

- [ ] **Step 1: Google Cloud Console — OAuth consent screen**

1. Go to `https://console.cloud.google.com/`, create or select a project named `Songfit`.
2. APIs & Services → OAuth consent screen → User type **External** → Create.
3. App name `Songfit`, user support email = your Gmail, developer contact = your Gmail. Save.
4. Scopes → Add → tick `.../auth/userinfo.email` and `.../auth/userinfo.profile` → Update → Save.
5. Publishing status: click **Publish app** so any Google account can sign in (otherwise only listed test users can).

- [ ] **Step 2: Google Cloud Console — OAuth client**

1. APIs & Services → Credentials → Create credentials → **OAuth client ID** → Application type **Web application**, name `Songfit web`.
2. Authorized JavaScript origins: `http://localhost:3000`, `https://thissongfits.com`.
3. Authorized redirect URIs:
   - `https://<project-ref>.supabase.co/auth/v1/callback` (project ref from Supabase → Settings → General)
   - `http://127.0.0.1:54321/auth/v1/callback` (local Supabase, only if using `supabase start`)
4. Create. Copy the **Client ID** and **Client secret**.

- [ ] **Step 3: Supabase dashboard — enable Google**

1. Authentication → Providers → Google → toggle **Enabled**.
2. Paste Client ID and Client secret. Save.
3. Authentication → URL Configuration:
   - Site URL: `https://thissongfits.com`
   - Redirect URLs (add each): `http://localhost:3000/auth/callback`, `http://localhost:3000/**`, `https://thissongfits.com/auth/callback`, `https://*.vercel.app/auth/callback`
4. Save.

- [ ] **Step 4: Local env**

In `.env.local` confirm `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` point at this project (or the local stack if using `supabase start`, in which case also enable Google in `supabase/config.toml` under `[auth.external.google]` with `enabled = true`, `client_id`, `secret` via env).

- [ ] **Step 5: Manual verify**

1. `pnpm dev`, open `http://localhost:3000`, tap "Find my songs".
2. Expected: Google account chooser → consent → redirected to `http://localhost:3000/?resume=1`.
3. Supabase → Authentication → Users shows your Gmail. Table `creators` has a matching row (created by `getCreator()` on the first server render after login).

---

### Phase 1 demo check

- [ ] **Step 1: Find your Mac's LAN IP and start dev on all interfaces**

Run: `ipconfig getifaddr en0` → e.g. `192.168.1.23`
Run: `pnpm dev -H 0.0.0.0`

Add `http://192.168.1.23:3000/auth/callback` to Supabase → Authentication → URL Configuration → Redirect URLs, and `http://192.168.1.23:3000` to the Google OAuth client's authorized JavaScript origins (Google rejects private IPs as redirect URIs, but the redirect goes to Supabase, not to the app, so only the origin matters).

- [ ] **Step 2: From a phone on the same Wi-Fi**

1. Open `http://192.168.1.23:3000` in Safari or Chrome.
2. Tap "Find my songs" → Google sign-in → back on the page with "Pick your video again to continue".
3. Tap the big target → camera roll → pick a ~20 s video. Tap "Find my songs".
4. Expected: progress climbs to 100%, then the waiting page with rotating lines.

- [ ] **Step 3: Confirm the data**

In Supabase Studio → Table editor:
- `submissions`: one row, `status = analyzing`, `video_path = <creatorId>/<uuid>.mov` (iPhone) or `.mp4`, `creator_intent` matches what you typed or is null.
- `events`: two rows for that `submission_id`: `submission_created` and `upload_completed`.
- Storage → `videos`: the object exists and plays via a signed URL.

If the status stays `uploaded`, the trigger fetch didn't reach the run route: check the dev server log for `pipeline.trigger_failed` and verify `INTERNAL_TOKEN` is set in `.env.local`.

- [ ] **Step 4: Commit any fixes found during the demo**

```bash
git add -A
git commit -m "Phase 1: upload to stored submission working on mobile"
```
## Phase 2 — Analysis

**Demo when done:** upload a real Reel; status moves `uploaded → analyzing → recommending`; `/admin/submissions/[id]` shows the video, a sensible structured analysis, the transcript and a music brief.

Assumes Phases 0–1 delivered: scaffold, `src/shared/{types,config,errors,logger}.ts`, `src/db/queries/*` (`getSubmission`, `setSubmissionStatus`, `upsertAnalysis`, `getAnalysis`, `listSubmissions`, `updateSubmission`), `src/media/storage.ts` (`downloadToTmp`, `getSignedPlaybackUrl`), `src/feedback/events.ts` (`logEvent`), `src/auth/session.ts` (`requireAdmin`), and a stub `src/pipeline/run.ts`.

`PipelineError` (from Phase 0, `src/shared/errors.ts`) has the shape:

```ts
export class PipelineError extends Error {
  constructor(public stage: "analyze" | "recommend", message: string, public raw?: string) {
    super(message);
    this.name = "PipelineError";
  }
}
```

---

### Task 2.1: Media extraction (ffprobe duration, ffmpeg frames + audio)

**Files:**
- Create: `src/media/extract.ts`
- Create: `src/media/extractHelpers.ts`
- Test: `tests/media/extractHelpers.test.ts`
- Test: `tests/media/extract.integration.test.ts`
- Modify: `package.json` (add deps)

**Interfaces:**
- Consumes: `LIMITS` from `src/shared/config.ts`; `PipelineError` from `src/shared/errors.ts`.
- Produces:
  ```ts
  export async function extractMedia(videoPath: string, workDir?: string): Promise<{
    durationSeconds: number;
    frames: { time: number; path: string }[];
    audioPath: string | null;
    workDir: string;
  }>;
  export function pickFps(durationSeconds: number, maxFrames: number): number;
  export function frameTimestamps(count: number, fps: number): number[];
  ```

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
import { pickFps, frameTimestamps } from "../../src/media/extractHelpers";

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/media/extractHelpers.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Write extractMedia**

`src/media/extract.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { LIMITS } from "../shared/config";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";
import { pickFps, frameTimestamps } from "./extractHelpers";

const run = promisify(execFile);

function bin(): { ffmpeg: string; ffprobe: string } {
  if (!ffmpegPath) throw new PipelineError("analyze", "ffmpeg binary not found");
  const ffprobe = ffprobeStatic.path;
  if (!ffprobe) throw new PipelineError("analyze", "ffprobe binary not found");
  return { ffmpeg: ffmpegPath, ffprobe };
}

async function probeDuration(ffprobe: string, input: string): Promise<number> {
  const { stdout } = await run(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "json",
    input,
  ]);
  const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
  const d = Number(parsed.format?.duration);
  if (!Number.isFinite(d) || d <= 0) throw new PipelineError("analyze", "could not read video duration", stdout);
  return d;
}

async function hasAudioStream(ffprobe: string, input: string): Promise<boolean> {
  const { stdout } = await run(ffprobe, [
    "-v", "error",
    "-select_streams", "a",
    "-show_streams",
    "-of", "json",
    input,
  ]);
  const parsed = JSON.parse(stdout) as { streams?: unknown[] };
  return Array.isArray(parsed.streams) && parsed.streams.length > 0;
}

export async function extractMedia(
  videoPath: string,
  workDir?: string,
): Promise<{
  durationSeconds: number;
  frames: { time: number; path: string }[];
  audioPath: string | null;
  workDir: string;
}> {
  const { ffmpeg, ffprobe } = bin();
  const dir = workDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "songfit-")));
  await fs.mkdir(dir, { recursive: true });

  const durationSeconds = await probeDuration(ffprobe, videoPath);
  if (durationSeconds > LIMITS.maxDurationSeconds) {
    throw new PipelineError("analyze", `video too long: ${Math.round(durationSeconds)}s > ${LIMITS.maxDurationSeconds}s`);
  }

  const fps = pickFps(durationSeconds, LIMITS.maxFrames);
  const framePattern = path.join(dir, "frame_%03d.jpg");
  await run(ffmpeg, [
    "-hide_banner", "-loglevel", "error",
    "-i", videoPath,
    "-vf", `fps=${fps},scale=${LIMITS.frameWidth}:-2`,
    "-q:v", "4",
    framePattern,
  ]);
  const names = (await fs.readdir(dir)).filter((n) => /^frame_\d{3}\.jpg$/.test(n)).sort();
  const times = frameTimestamps(names.length, fps);
  const frames = names.map((n, i) => ({ time: times[i], path: path.join(dir, n) }));
  if (frames.length === 0) throw new PipelineError("analyze", "no frames extracted");

  let audioPath: string | null = null;
  if (await hasAudioStream(ffprobe, videoPath)) {
    audioPath = path.join(dir, "audio.wav");
    await run(ffmpeg, [
      "-hide_banner", "-loglevel", "error",
      "-i", videoPath,
      "-vn", "-ac", "1", "-ar", "16000", "-f", "wav",
      audioPath,
    ]);
  }

  logger.info("media.extracted", { durationSeconds, frames: frames.length, fps, audio: audioPath !== null });
  return { durationSeconds, frames, audioPath, workDir: dir };
}
```

- [ ] **Step 7: Write the integration test (skips when binaries are missing)**

`tests/media/extract.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);

let ffmpeg: string | null = null;
try {
  ffmpeg = (await import("ffmpeg-static")).default as string | null;
} catch {
  ffmpeg = null;
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
});
```

- [ ] **Step 8: Run all media tests**

Run: `pnpm vitest run tests/media`
Expected: PASS. If `ffmpeg-static` failed to download its binary, the integration suite reports `skipped`; otherwise 8 tests pass.

Manual check if you want to see the frames: `ls $(node -e "console.log(require('os').tmpdir())")/songfit-*/` after running the test.

- [ ] **Step 9: Typecheck and commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml src/media/extract.ts src/media/extractHelpers.ts tests/media
git commit -m "Add ffmpeg media extraction for frames and audio"
```

---

### Task 2.2: Whisper transcription

**Files:**
- Create: `src/analysis/transcribe.ts`
- Test: `tests/analysis/transcribe.test.ts`

**Interfaces:**
- Consumes: `MODELS.whisper` from config; `env("OPENAI_API_KEY")`.
- Produces:
  ```ts
  export async function transcribe(audioPath: string | null, client?: OpenAI): Promise<string>;
  export function hasDialogue(transcript: string): boolean;
  ```

- [ ] **Step 1: Install the OpenAI SDK**

```bash
pnpm add openai
```

- [ ] **Step 2: Write the failing test**

`tests/analysis/transcribe.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { hasDialogue, transcribe } from "../../src/analysis/transcribe";

describe("hasDialogue", () => {
  it("is false for empty", () => expect(hasDialogue("")).toBe(false));
  it("is false under 5 words", () => expect(hasDialogue("yeah ok so um")).toBe(false));
  it("is true at 5 words", () => expect(hasDialogue("this is my new fit")).toBe(true));
  it("ignores surrounding whitespace", () => expect(hasDialogue("  a b c d e  ")).toBe(true));
});

describe("transcribe", () => {
  it("returns empty string when there is no audio", async () => {
    expect(await transcribe(null)).toBe("");
  });
  it("calls Whisper and trims the result", async () => {
    const create = vi.fn().mockResolvedValue("  hello world  ");
    const client = { audio: { transcriptions: { create } } } as unknown as import("openai").default;
    const text = await transcribe(__filename, client);
    expect(text).toBe("hello world");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "whisper-1", response_format: "text" }),
    );
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

let singleton: OpenAI | null = null;
function defaultClient(): OpenAI {
  if (!singleton) singleton = new OpenAI({ apiKey: env("OPENAI_API_KEY") });
  return singleton;
}

/** Speech only. Returns "" when there is no audio track. */
export async function transcribe(audioPath: string | null, client?: OpenAI): Promise<string> {
  if (!audioPath) return "";
  const c = client ?? defaultClient();
  const result = await c.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: MODELS.whisper,
    response_format: "text",
  });
  const text = String(result).trim();
  logger.info("analysis.transcribed", { chars: text.length });
  return text;
}

export function hasDialogue(transcript: string): boolean {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  return words.length >= 5;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/analysis/transcribe.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml src/analysis/transcribe.ts tests/analysis/transcribe.test.ts
git commit -m "Add Whisper transcription with dialogue detection"
```

---

### Task 2.3: Claude video analysis → VideoAnalysis + MusicBrief

**Files:**
- Create: `src/analysis/analyzeVideo.ts`
- Create: `src/shared/json.ts`
- Test: `tests/shared/json.test.ts`
- Test: `tests/analysis/analyzeVideo.test.ts`

**Interfaces:**
- Consumes: `VideoAnalysis`, `MusicBrief`, `AnalysisResult` from `src/shared/types.ts`; `MODELS.analysis`, `CONTENT_CATEGORIES`, `env("ANTHROPIC_API_KEY")`; `PipelineError`.
- Produces:
  ```ts
  export const PROMPT_VERSION = "analyze-v1";
  export async function analyzeVideo(
    input: { frames: { time: number; base64: string }[]; transcript: string; creatorIntent: string | null; durationSeconds: number },
    client?: Anthropic,
  ): Promise<AnalysisResult & { raw: string }>;
  // src/shared/json.ts
  export function extractJson(text: string): string;
  ```

- [ ] **Step 1: Install the Anthropic SDK**

```bash
pnpm add @anthropic-ai/sdk
```

- [ ] **Step 2: Write the failing test for extractJson**

`tests/shared/json.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractJson } from "../../src/shared/json";

describe("extractJson", () => {
  it("returns unfenced JSON untouched", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
  it("strips ```json fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("strips bare ``` fences", () => {
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("takes the first { to the last } when there is prose around it", () => {
    expect(extractJson('Here you go:\n{"a":{"b":2}}\nThanks')).toBe('{"a":{"b":2}}');
  });
  it("throws when no object is present", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/shared/json.test.ts`
Expected: FAIL with `Cannot find module '../../src/shared/json'`

- [ ] **Step 4: Implement extractJson**

`src/shared/json.ts`:

```ts
/** Pulls a single JSON object out of model text: strips code fences and surrounding prose. */
export function extractJson(text: string): string {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON object found in model output");
  return t.slice(start, end + 1);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/shared/json.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Write the failing tests for analyzeVideo**

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
    create.mockResolvedValueOnce({ content: [{ type: "text", text: r }] });
  }
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const input = {
  frames: [{ time: 0, base64: "AAAA" }, { time: 1, base64: "BBBB" }],
  transcript: "",
  creatorIntent: null,
  durationSeconds: 12,
};

describe("analyzeVideo", () => {
  it("parses a valid response into AnalysisResult", async () => {
    const { client, create } = fakeClient([JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, client);
    expect(out.analysis.content_category).toBe("fashion");
    expect(out.brief.fields.energy).toBe(0.72);
    expect(out.transcript).toBe("");
    expect(out.prompt_version).toBe(PROMPT_VERSION);
    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0][0];
    expect(call.model).toBeDefined();
    // two image blocks, each preceded by a timestamp label
    const content = call.messages[0].content as { type: string; text?: string }[];
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect(content.some((b) => b.type === "text" && b.text?.includes("t=1.0s"))).toBe(true);
  });

  it("accepts fenced JSON", async () => {
    const { client } = fakeClient(["```json\n" + JSON.stringify(validPayload) + "\n```"]);
    const out = await analyzeVideo(input, client);
    expect(out.analysis.summary).toContain("NYC");
  });

  it("retries once when the first response fails validation, then succeeds", async () => {
    const bad = JSON.stringify({ analysis: { summary: "x" }, brief: {} });
    const { client, create } = fakeClient([bad, JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, client);
    expect(out.analysis.content_category).toBe("fashion");
    expect(create).toHaveBeenCalledTimes(2);
    const retryMessages = create.mock.calls[1][0].messages;
    const lastText = JSON.stringify(retryMessages);
    expect(lastText).toContain("did not match the schema");
  });

  it("throws PipelineError with raw text after two invalid responses", async () => {
    const bad = "{\"nope\": true}";
    const { client } = fakeClient([bad, bad]);
    await expect(analyzeVideo(input, client)).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      raw: bad,
    });
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `pnpm vitest run tests/analysis/analyzeVideo.test.ts`
Expected: FAIL with `Cannot find module '../../src/analysis/analyzeVideo'`

- [ ] **Step 8: Implement analyzeVideo with the full prompt**

`src/analysis/analyzeVideo.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MODELS, CONTENT_CATEGORIES, env } from "../shared/config";
import { VideoAnalysis, MusicBrief, type AnalysisResult } from "../shared/types";
import { PipelineError } from "../shared/errors";
import { extractJson } from "../shared/json";
import { logger } from "../shared/logger";

export const PROMPT_VERSION = "analyze-v1";

const ModelOutput = z.object({ analysis: VideoAnalysis, brief: MusicBrief });

let singleton: Anthropic | null = null;
function defaultClient(): Anthropic {
  if (!singleton) singleton = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  return singleton;
}

const SYSTEM_PROMPT = `You are Songfit's video analyst. You watch short-form videos (Reels, TikToks, Shorts) and produce a precise, structured understanding of the content plus a music brief that a music supervisor could act on.

Rules:
- You are given sampled frames labelled with their timestamp (t=Ns), the transcript of any speech, the video duration, and optionally what the creator wants the video to feel like.
- IGNORE any music that may already be in the video. Treat it as silent except for speech. Never mention existing music.
- Describe what actually happens: people, setting, actions, visual aesthetic, story, motion, cuts, pacing, energy, emotional arc.
- important_moments: list the moments a song should react to, each with a timestamp in seconds taken from the frame labels: scene changes, the main visual reveal, a climax, a beat where energy shifts. Use type values like "scene_change", "main_visual_reveal", "climax", "energy_shift", "text_overlay", "ending". Include at most 6.
- content_category must be exactly one of: ${CONTENT_CATEGORIES.join(", ")}.
- energy is one of: low, medium, medium-high, high. pacing is one of: slow, medium, fast.
- dialogue_present is true only if someone speaks words meant to be heard (transcript has real speech).
- The music brief combines WHAT THE VIDEO IS with WHAT THE CREATOR WANTS IT TO BECOME. If the creator gave no intent, infer the most likely intended feel from the content and say in the brief text that it was inferred.
- brief.text is 3–6 sentences in plain language, written for a human music supervisor: the feel, the energy, the cultural register (current vs timeless, mainstream vs niche), vocal considerations given any dialogue, and where in the video a musical lift or hit should land (reference timestamps).
- brief.fields: moods (3–6 words), energy 0..1, tempo_preference (slow | medium | medium-high | high), vocal_preference (vocals | instrumental | either), genre_preferences (may be empty), genre_avoid (may be empty), dialogue_present, desired_cultural_relevance (low | medium | high), desired_familiarity (recognizable | recognizable_not_overused | unexpected).

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
    "important_moments": [{ "time": number, "type": string, "note"?: string }]
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

function buildUserContent(input: {
  frames: { time: number; base64: string }[];
  transcript: string;
  creatorIntent: string | null;
  durationSeconds: number;
}): Block[] {
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
  blocks.push({
    type: "text",
    text: `Transcript of speech (empty means no speech detected):\n"""${input.transcript}"""`,
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

async function callModel(client: Anthropic, content: Block[]): Promise<string> {
  const res = await client.messages.create({
    model: MODELS.analysis,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
  });
  const text = res.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return text;
}

function tryParse(raw: string): z.infer<typeof ModelOutput> | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch (e) {
    return { error: `not valid JSON: ${(e as Error).message}` };
  }
  const parsed = ModelOutput.safeParse(json);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return parsed.data;
}

export async function analyzeVideo(
  input: { frames: { time: number; base64: string }[]; transcript: string; creatorIntent: string | null; durationSeconds: number },
  client?: Anthropic,
): Promise<AnalysisResult & { raw: string }> {
  const c = client ?? defaultClient();
  const content = buildUserContent(input);

  const first = await callModel(c, content);
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
    raw = await callModel(c, retryContent);
    result = tryParse(raw);
  }

  if ("error" in result) {
    throw new PipelineError("analyze", `model output invalid: ${result.error}`, raw);
  }

  logger.info("analysis.done", { category: result.analysis.content_category, moments: result.analysis.important_moments.length });
  return {
    analysis: result.analysis,
    brief: result.brief,
    transcript: input.transcript,
    prompt_version: PROMPT_VERSION,
    raw,
  };
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm vitest run tests/analysis/analyzeVideo.test.ts tests/shared/json.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 10: Commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml src/shared/json.ts src/analysis/analyzeVideo.ts tests/shared/json.test.ts tests/analysis/analyzeVideo.test.ts
git commit -m "Add Claude video analysis producing VideoAnalysis and MusicBrief"
```

---

### Task 2.3b: Shared `callClaude` helper

**Files:**
- Create: `src/shared/anthropic.ts`
- Test: `tests/shared/anthropic.test.ts`

**Interfaces:**
- Consumes: `env()` from `src/shared/config.ts`.
- Produces (every Phase 3 stage depends on this exact shape):
  ```ts
  export type ClaudeCall = (args: { model: string; system: string; user: string; maxTokens?: number }) => Promise<string>;
  export const callClaude: ClaudeCall;
  export function makeClaudeCall(client: Pick<Anthropic, "messages">): ClaudeCall; // for tests
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/anthropic.test.ts
import { describe, expect, it, vi } from "vitest";
import { makeClaudeCall } from "../../src/shared/anthropic";

describe("makeClaudeCall", () => {
  it("sends system + user and returns concatenated text blocks", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }],
    });
    const call = makeClaudeCall({ messages: { create } } as never);
    const out = await call({ model: "m", system: "S", user: "U", maxTokens: 10 });
    expect(out).toBe("hello world");
    expect(create).toHaveBeenCalledWith({
      model: "m",
      max_tokens: 10,
      system: "S",
      messages: [{ role: "user", content: "U" }],
    });
  });

  it("throws when the response has no text", async () => {
    const create = vi.fn().mockResolvedValue({ content: [] });
    const call = makeClaudeCall({ messages: { create } } as never);
    await expect(call({ model: "m", system: "S", user: "U" })).rejects.toThrow(/no text/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test -- tests/shared/anthropic.test.ts`
Expected: FAIL, cannot find module `src/shared/anthropic`.

- [ ] **Step 3: Implement**

```ts
// src/shared/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./config";

export type ClaudeCall = (args: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}) => Promise<string>;

/** Builds a text-in / text-out caller around an Anthropic client. Tests inject a stub client. */
export function makeClaudeCall(client: Pick<Anthropic, "messages">): ClaudeCall {
  return async ({ model, system, user, maxTokens = 4000 }) => {
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
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

- [ ] **Step 4: Run tests**

Run: `pnpm test -- tests/shared/anthropic.test.ts`
Expected: PASS (2).

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/shared/anthropic.ts tests/shared/anthropic.test.ts
git commit -m "Add shared callClaude helper for text-only model stages"
```

---

### Task 2.4: analyzeSubmission orchestration and persistence

**Files:**
- Create: `src/analysis/index.ts`
- Test: `tests/analysis/analyzeSubmission.test.ts`

**Interfaces:**
- Consumes: `getSubmission(id)`, `upsertAnalysis(row)`, `updateSubmission(id, patch)` from `src/db/queries/{submissions,analyses}.ts`; `downloadToTmp(storagePath)` from `src/media/storage.ts`; `extractMedia`; `transcribe`; `analyzeVideo`; `logEvent`.
- Produces: `export async function analyzeSubmission(submissionId: string, deps?: Partial<AnalyzeDeps>): Promise<void>;`

Expected db query shapes (from Phase 1):

```ts
// src/db/queries/analyses.ts
export async function upsertAnalysis(row: {
  submission_id: string; summary: string; content_type: string; setting: string | null; story: string | null;
  aesthetic: string[]; mood: string[]; energy: string; pacing: string; dialogue_present: boolean;
  transcript: string | null; important_moments: unknown; music_brief: string; music_brief_fields: unknown;
  prompt_version: string; raw_response: unknown;
}): Promise<void>;
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
  prompt_version: "analyze-v1",
  raw: "{}",
};

function deps() {
  return {
    getSubmission: vi.fn().mockResolvedValue(submission),
    downloadToTmp: vi.fn().mockResolvedValue("/tmp/x/sub-1.mp4"),
    extractMedia: vi.fn().mockResolvedValue({
      durationSeconds: 12.3,
      frames: [{ time: 0, path: "/tmp/x/frame_001.jpg" }],
      audioPath: "/tmp/x/audio.wav",
      workDir: "/tmp/x",
    }),
    readFrame: vi.fn().mockResolvedValue("QUJD"),
    transcribe: vi.fn().mockResolvedValue(""),
    analyzeVideo: vi.fn().mockResolvedValue(analysisResult),
    upsertAnalysis: vi.fn().mockResolvedValue(undefined),
    updateSubmission: vi.fn().mockResolvedValue(undefined),
    logEvent: vi.fn().mockResolvedValue(undefined),
    removeDir: vi.fn().mockResolvedValue(undefined),
  };
}

describe("analyzeSubmission", () => {
  it("runs the stages in order and persists every column", async () => {
    const d = deps();
    await analyzeSubmission("sub-1", d);

    expect(d.downloadToTmp).toHaveBeenCalledWith("cre-1/sub-1.mp4");
    expect(d.analyzeVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        frames: [{ time: 0, base64: "QUJD" }],
        transcript: "",
        creatorIntent: "make it feel luxurious",
        durationSeconds: 12.3,
      }),
    );
    expect(d.upsertAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        submission_id: "sub-1",
        summary: "s",
        content_type: "fashion reel",
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
        prompt_version: "analyze-v1",
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
    await expect(analyzeSubmission("sub-1", d)).rejects.toThrow("boom");
    expect(d.removeDir).toHaveBeenCalledWith("/tmp/x");
    expect(d.upsertAnalysis).not.toHaveBeenCalled();
  });

  it("throws when the submission does not exist", async () => {
    const d = deps();
    d.getSubmission.mockResolvedValue(null);
    await expect(analyzeSubmission("nope", d)).rejects.toThrow(/not found/);
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

/** Stage 1 of the pipeline: media → transcript → Claude analysis → video_analyses row. Idempotent (upsert). */
export async function analyzeSubmission(submissionId: string, overrides: Partial<AnalyzeDeps> = {}): Promise<void> {
  const d: AnalyzeDeps = { ...defaultDeps, ...overrides };
  const sub = await d.getSubmission(submissionId);
  if (!sub) throw new PipelineError("analyze", `submission not found: ${submissionId}`);

  const videoPath = await d.downloadToTmp(sub.video_path);
  const workDir = path.dirname(videoPath);
  try {
    const media = await d.extractMedia(videoPath, workDir);
    const frames = await Promise.all(
      media.frames.map(async (f) => ({ time: f.time, base64: await d.readFrame(f.path) })),
    );
    const transcript = await d.transcribe(media.audioPath);
    const result = await d.analyzeVideo({
      frames,
      transcript,
      creatorIntent: sub.creator_intent ?? null,
      durationSeconds: media.durationSeconds,
    });

    await d.upsertAnalysis({
      submission_id: submissionId,
      summary: result.analysis.summary,
      content_type: result.analysis.content_type,
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

Note: `downloadToTmp` (Phase 1) must place the file inside its own fresh directory (e.g. `/tmp/songfit-<id>/video.mp4`) so `path.dirname` is safe to delete. If Phase 1 wrote it elsewhere, change `downloadToTmp` to use `fs.mkdtemp` and return the file path inside that directory.

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

### Task 2.5: Pipeline runner with status handling, retry-from-stage and time budget

**Files:**
- Modify: `src/pipeline/run.ts` (replace the Phase 1 stub)
- Create: `src/pipeline/stages.ts`
- Test: `tests/pipeline/stages.test.ts`
- Test: `tests/pipeline/run.test.ts`

**Interfaces:**
- Consumes: `getSubmission`, `setSubmissionStatus(id, status, error?)`, `getAnalysisRow(submissionId)` (returns the raw row or null; Phase 0), `listRecommendations(submissionId)` (returns array; Phase 1 may return `[]`), `analyzeSubmission`, `logEvent`, `LIMITS.pipelineBudgetMs`.
- Produces:
  ```ts
  // src/pipeline/stages.ts
  export type Stage = "analyze" | "recommend" | "done";
  export function nextStage(status: SubmissionStatus, hasAnalysis: boolean, hasRecommendations: boolean): Stage;
  // src/pipeline/run.ts
  export async function runSubmission(submissionId: string, deps?: Partial<RunDeps>): Promise<void>;
  ```
  Phase 3 fills `recommendSubmission` into `RunDeps`; until then it is a stub that throws `PipelineError("recommend", "not implemented")`, which is caught and recorded like any failure.

- [ ] **Step 1: Write the failing test for nextStage**

`tests/pipeline/stages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextStage } from "../../src/pipeline/stages";

describe("nextStage", () => {
  it("fresh upload → analyze", () => expect(nextStage("uploaded", false, false)).toBe("analyze"));
  it("failed before analysis → analyze", () => expect(nextStage("failed", false, false)).toBe("analyze"));
  it("failed after analysis → recommend (skips analyze)", () => expect(nextStage("failed", true, false)).toBe("recommend"));
  it("analyzing with analysis row present (crashed between) → recommend", () => expect(nextStage("analyzing", true, false)).toBe("recommend"));
  it("recommending → recommend", () => expect(nextStage("recommending", true, false)).toBe("recommend"));
  it("ready with recommendations → done", () => expect(nextStage("ready", true, true)).toBe("done"));
  it("ready but recommendations missing → recommend", () => expect(nextStage("ready", true, false)).toBe("recommend"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/pipeline/stages.test.ts`
Expected: FAIL with `Cannot find module '../../src/pipeline/stages'`

- [ ] **Step 3: Implement nextStage**

`src/pipeline/stages.ts`:

```ts
import type { SubmissionStatus } from "../shared/types";

export type Stage = "analyze" | "recommend" | "done";

/** Which stage to run next, derived from persisted state so retries resume where they failed. */
export function nextStage(status: SubmissionStatus, hasAnalysis: boolean, hasRecommendations: boolean): Stage {
  if (!hasAnalysis) return "analyze";
  if (!hasRecommendations) return "recommend";
  if (status === "ready") return "done";
  return "recommend";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/pipeline/stages.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the failing tests for runSubmission**

`tests/pipeline/run.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runSubmission } from "../../src/pipeline/run";
import { PipelineError } from "../../src/shared/errors";

function deps(over: Record<string, unknown> = {}) {
  const state = { status: "uploaded", hasAnalysis: false, hasRecs: false };
  const d = {
    getSubmission: vi.fn(async () => ({ id: "sub-1", creator_id: "cre-1", status: state.status })),
    getAnalysisRow: vi.fn(async () => (state.hasAnalysis ? { id: "an-1" } : null)),
    listRecommendations: vi.fn(async () => (state.hasRecs ? [{ id: "r1" }] : [])),
    setSubmissionStatus: vi.fn(async (_id: string, status: string) => { state.status = status; }),
    analyzeSubmission: vi.fn(async () => { state.hasAnalysis = true; }),
    recommendSubmission: vi.fn(async () => { state.hasRecs = true; }),
    logEvent: vi.fn(async () => undefined),
    now: () => 0,
    ...over,
  };
  return { d, state };
}

describe("runSubmission", () => {
  it("runs analyze then recommend and ends ready", async () => {
    const { d, state } = deps();
    await runSubmission("sub-1", d);
    const statuses = d.setSubmissionStatus.mock.calls.map((c) => c[1]);
    expect(statuses).toEqual(["analyzing", "recommending", "ready"]);
    expect(d.analyzeSubmission).toHaveBeenCalledTimes(1);
    expect(d.recommendSubmission).toHaveBeenCalledTimes(1);
    expect(state.status).toBe("ready");
  });

  it("skips analyze on retry when the analysis row exists", async () => {
    const { d } = deps();
    d.getAnalysisRow.mockResolvedValue({ id: "an-1" });
    d.getSubmission.mockResolvedValue({ id: "sub-1", creator_id: "cre-1", status: "failed" });
    await runSubmission("sub-1", d);
    expect(d.analyzeSubmission).not.toHaveBeenCalled();
    expect(d.recommendSubmission).toHaveBeenCalledTimes(1);
  });

  it("records failure with stage and error and does not throw", async () => {
    const { d } = deps();
    d.analyzeSubmission.mockRejectedValue(new PipelineError("analyze", "video too long"));
    await expect(runSubmission("sub-1", d)).resolves.toBeUndefined();
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", "video too long");
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: "pipeline_failed", submissionId: "sub-1", metadata: { stage: "analyze", error: "video too long" } }),
    );
  });

  it("wraps unknown errors with the current stage", async () => {
    const { d } = deps();
    d.recommendSubmission.mockRejectedValue(new Error("deezer down"));
    await runSubmission("sub-1", d);
    expect(d.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { stage: "recommend", error: "deezer down" } }),
    );
  });

  it("fails cleanly when the time budget is exceeded before a stage", async () => {
    let t = 0;
    const { d } = deps({ now: () => t });
    d.analyzeSubmission.mockImplementation(async () => { t = 290_000; });
    await runSubmission("sub-1", d);
    expect(d.recommendSubmission).not.toHaveBeenCalled();
    expect(d.setSubmissionStatus).toHaveBeenLastCalledWith("sub-1", "failed", expect.stringMatching(/budget exceeded/));
  });

  it("does nothing when already done", async () => {
    const { d } = deps();
    d.getSubmission.mockResolvedValue({ id: "sub-1", creator_id: "cre-1", status: "ready" });
    d.getAnalysisRow.mockResolvedValue({ id: "an-1" });
    d.listRecommendations.mockResolvedValue([{ id: "r1" }]);
    await runSubmission("sub-1", d);
    expect(d.setSubmissionStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm vitest run tests/pipeline/run.test.ts`
Expected: FAIL (the Phase 1 stub does not accept deps / does not call these functions)

- [ ] **Step 7: Implement runSubmission**

`src/pipeline/run.ts`:

```ts
import { getSubmission, setSubmissionStatus } from "../db/queries/submissions";
import { getAnalysisRowRow } from "../db/queries/analyses";
import { listRecommendations } from "../db/queries/recommendations";
import { analyzeSubmission } from "../analysis";
import { logEvent } from "../feedback/events";
import { LIMITS } from "../shared/config";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";
import { nextStage, type Stage } from "./stages";
import type { SubmissionStatus } from "../shared/types";

export type RunDeps = {
  getSubmission: (id: string) => Promise<{ id: string; creator_id: string; status: string } | null>;
  getAnalysisRow: (submissionId: string) => Promise<unknown | null>;
  listRecommendations: (submissionId: string) => Promise<unknown[]>;
  setSubmissionStatus: (id: string, status: SubmissionStatus, error?: string | null) => Promise<void>;
  analyzeSubmission: (id: string) => Promise<void>;
  recommendSubmission: (id: string) => Promise<void>;
  logEvent: typeof logEvent;
  now: () => number;
};

// Phase 3 replaces this with the real engine orchestrator.
async function recommendSubmissionStub(_id: string): Promise<void> {
  throw new PipelineError("recommend", "not implemented");
}

const defaultDeps: RunDeps = {
  getSubmission,
  getAnalysisRow,
  listRecommendations,
  setSubmissionStatus,
  analyzeSubmission,
  recommendSubmission: recommendSubmissionStub,
  logEvent,
  now: () => Date.now(),
};

const STAGE_STATUS: Record<Exclude<Stage, "done">, SubmissionStatus> = {
  analyze: "analyzing",
  recommend: "recommending",
};

/**
 * Runs the pipeline for one submission from whichever stage is next.
 * Never throws: failures are written to the submission and the events table.
 */
export async function runSubmission(submissionId: string, overrides: Partial<RunDeps> = {}): Promise<void> {
  const d: RunDeps = { ...defaultDeps, ...overrides };
  const started = d.now();

  const sub = await d.getSubmission(submissionId);
  if (!sub) {
    logger.error("pipeline.missing", { submissionId });
    return;
  }

  let stage: Stage = nextStage(
    sub.status as SubmissionStatus,
    (await d.getAnalysisRowRow(submissionId)) !== null,
    (await d.listRecommendations(submissionId)).length > 0,
  );
  let current: Exclude<Stage, "done"> = stage === "done" ? "analyze" : stage;

  try {
    while (stage !== "done") {
      current = stage;
      if (d.now() - started > LIMITS.pipelineBudgetMs) {
        throw new PipelineError(current, `budget exceeded before ${current}`);
      }
      await d.setSubmissionStatus(submissionId, STAGE_STATUS[current], null);
      logger.info("pipeline.stage", { submissionId, stage: current });

      if (current === "analyze") {
        await d.analyzeSubmission(submissionId);
        stage = "recommend";
      } else {
        await d.recommendSubmission(submissionId);
        stage = "done";
        await d.setSubmissionStatus(submissionId, "ready", null);
      }
    }
  } catch (err) {
    const e = err as Error & { stage?: string };
    const failedStage = e instanceof PipelineError ? e.stage : current;
    const message = e.message ?? String(err);
    logger.error("pipeline.failed", { submissionId, stage: failedStage, message });
    await d.setSubmissionStatus(submissionId, "failed", message);
    await d.logEvent({
      name: "pipeline_failed",
      submissionId,
      creatorId: sub.creator_id,
      metadata: { stage: failedStage, error: message },
    });
  }
}
```

`setSubmissionStatus` (Phase 1) must accept a third `error` argument and write it to `submissions.error` (null clears it). If Phase 1's version has only two parameters, add the third now.

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run tests/pipeline`
Expected: PASS (13 tests)

- [ ] **Step 9: Commit**

```bash
pnpm typecheck && pnpm test
git add src/pipeline/run.ts src/pipeline/stages.ts tests/pipeline
git commit -m "Add pipeline runner with stage resume, failure recording and time budget"
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
- Consumes: `requireAdmin()` from `src/auth/session.ts`; `listSubmissions()` and `getSubmission(id)` from `src/db/queries/submissions.ts`; `getAnalysisRow(submissionId)` from `src/db/queries/analyses.ts`; `getSignedPlaybackUrl(storagePath)` from `src/media/storage.ts`; `runSubmission` from `src/pipeline/run.ts`.
- Produces:
  ```ts
  // src/db/queries/admin.ts
  export function formatElapsed(fromIso: string | null, toIso: string | null): string; // "1m 12s" | "—"
  export function shortId(id: string): string; // first 8 chars
  // app/admin/submissions/[id]/actions.ts
  export async function retrySubmission(formData: FormData): Promise<void>; // server action
  ```

`listSubmissions()` is expected to return rows joined with creator email:

```ts
{ id: string; status: string; created_at: string; analyzed_at: string | null; recommended_at: string | null;
  content_category: string | null; error: string | null; creator: { email: string } | null }[]
```

Phase 0's `listSubmissions` already returns `SubmissionWithCreator[]` with `creator.email`.

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
import { listSubmissions } from "@/src/db/queries/submissions";
import { formatElapsed, shortId } from "@/src/db/queries/admin";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage() {
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

      {sub.error && <p className="rounded bg-red-50 p-3 text-sm text-red-800">Error: {sub.error}</p>}

      <section className="grid gap-6 md:grid-cols-[320px_1fr]">
        <video controls playsInline className="w-full rounded bg-black" src={videoUrl} />
        <dl className="text-sm">
          <Row label="Creator intent" value={sub.creator_intent ?? "—"} />
          <Row label="Duration" value={sub.duration_seconds ? `${sub.duration_seconds.toFixed(1)}s` : "—"} />
          <Row label="Category" value={sub.content_category ?? "—"} />
          <Row label="Created" value={new Date(sub.created_at).toLocaleString()} />
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
              <Row label="Setting" value={analysis.setting ?? "—"} />
              <Row label="Story" value={analysis.story ?? "—"} />
              <Row label="Aesthetic" value={analysis.aesthetic.join(", ")} />
              <Row label="Mood" value={analysis.mood.join(", ")} />
              <Row label="Energy / pacing" value={`${analysis.energy} / ${analysis.pacing}`} />
              <Row label="Dialogue" value={analysis.dialogue_present ? "yes" : "no"} />
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
              <h3 className="font-medium">Transcript</h3>
              <p className="whitespace-pre-wrap rounded bg-neutral-50 p-3">{analysis.transcript || "(no speech)"}</p>
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

`getAnalysis` must return the row with `aesthetic`, `mood` as `string[]`, `important_moments` and `music_brief_fields` as parsed JSON (Supabase returns jsonb as objects already). If Phase 1 typed these columns as `unknown`, cast at the query boundary in `src/db/queries/analyses.ts`, not in the page.

- [ ] **Step 9: Typecheck, run dev, and check the pages**

```bash
pnpm typecheck && pnpm test && pnpm dev
```

Open `http://localhost:3000/admin` signed in as the `ADMIN_EMAILS` account. Expected: the table lists submissions. Open a submission: the video plays, "No analysis yet." shows until the pipeline has run. Signed in as a non-admin: redirected or 403 per `requireAdmin()`.

- [ ] **Step 10: Commit**

```bash
git add app/admin src/db/queries/admin.ts tests/db/adminFormat.test.ts
git commit -m "Add admin queue and submission inspector with analysis view"
```

---

### Phase 2 demo check

1. `pnpm dev`, upload a real ~30 s Reel from the phone flow built in Phase 1.
2. Watch `/admin`: status goes `uploaded → analyzing → recommending`, then `failed` with error `not implemented` (the Phase 3 stub). That failure is expected and proves the runner records failures.
3. Open the inspector. Expected: the video plays; summary, category, moods and energy match what you see; `important_moments` timestamps line up with real cuts or the reveal; the brief reads like something a music supervisor could act on and mentions where the lift should land; the transcript is empty for a music-only Reel and populated for a talking one.
4. Click "Retry pipeline". Expected: `analyzeSubmission` is skipped (status jumps to `recommending`, then `failed` again) — confirms resume-from-stage.
5. Note the cost per run in the Anthropic console (expect roughly $0.05–0.15 for 60 frames at 512 px) and the OpenAI console (Whisper, under $0.01 for 30 s). Write both numbers into `docs/RESEARCH.md` under a new dated entry.
## Phase 3 — Engine → results

**Demo when done:** upload a real video → about 90 s later the results page shows 3 real songs with sections, reasons and playable previews; the admin inspector shows ~60 scored candidates.

Tasks are ordered by dependency: normalisation first (everything matches on it), then candidates, catalog, scoring, diversify, sections, explain, the orchestrator, and finally UI.

Conventions for every task in this phase:
- Imports use the `@/` alias (`@/src/shared/types`), which Next.js maps to the repo root.
- Model calls go through `callClaude` from `src/shared/anthropic.ts` (created in Phase 2, Task 2.3b). Its signature, which every stage depends on:
  ```ts
  export type ClaudeCall = (args: { model: string; system: string; user: string; maxTokens?: number }) => Promise<string>;
  export const callClaude: ClaudeCall;
  ```
  Each model-backed stage takes an optional `deps` argument so tests inject a stub instead of mocking modules.
- `extractJson(text: string): unknown` from `src/shared/json.ts` (Phase 2, Task 2.3) strips code fences and returns the first JSON value found. Stages call `extractJson` then Zod.
- `PipelineError` from `src/shared/errors.ts` (Phase 0): `new PipelineError(stage: string, message: string, raw?: string)`.
- Tests live in `tests/` mirroring `src/`, run with `pnpm test -- <path>`.

---

### Task 3.1: Title and artist normalisation

**Files:**
- Create: `src/engine/catalog/normalize.ts`
- Test: `tests/engine/catalog/normalize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export function normalizeTitle(s: string): string;
  export function normalizeArtist(s: string): string;   // primary artist only
  export function normalizeKey(title: string, artist: string): string; // `${title}|${artist}`
  export function titlesMatch(a: string, b: string): boolean;
  export function artistsMatch(a: string, b: string): boolean;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/catalog/normalize.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeTitle, normalizeArtist, normalizeKey, titlesMatch, artistsMatch,
} from "@/src/engine/catalog/normalize";

describe("normalizeTitle", () => {
  it("lowercases and strips punctuation", () => {
    expect(normalizeTitle("Don't Stop Me Now!")).toBe("don t stop me now");
  });
  it("strips diacritics", () => {
    expect(normalizeTitle("Señorita")).toBe("senorita");
  });
  it("removes bracketed suffixes", () => {
    expect(normalizeTitle("Blinding Lights (feat. Rosalía) [Remastered]")).toBe("blinding lights");
  });
  it("removes dash suffixes", () => {
    expect(normalizeTitle("Blinding Lights - Radio Edit")).toBe("blinding lights");
    expect(normalizeTitle("Running Up That Hill - From Stranger Things")).toBe("running up that hill");
  });
  it("removes feat clauses without brackets", () => {
    expect(normalizeTitle("Industry Baby feat. Jack Harlow")).toBe("industry baby");
  });
});

describe("normalizeArtist", () => {
  it("keeps the primary artist", () => {
    expect(normalizeArtist("Drake feat. Rihanna")).toBe("drake");
    expect(normalizeArtist("Lady Gaga & Bruno Mars")).toBe("lady gaga");
    expect(normalizeArtist("Jawsh 685, Jason Derulo")).toBe("jawsh 685");
    expect(normalizeArtist("Fred again.. x Skepta")).toBe("fred again");
  });
  it("strips diacritics", () => {
    expect(normalizeArtist("Beyoncé")).toBe("beyonce");
  });
});

describe("matching", () => {
  it("titlesMatch tolerates edits", () => {
    expect(titlesMatch("Blinding Lights", "Blinding Lights - Radio Edit")).toBe(true);
    expect(titlesMatch("Blinding Lights", "Blinding Lights (Live)")).toBe(true);
    expect(titlesMatch("Blinding Lights", "Save Your Tears")).toBe(false);
  });
  it("artistsMatch compares primary artists", () => {
    expect(artistsMatch("Beyoncé", "Beyonce")).toBe(true);
    expect(artistsMatch("Drake feat. Rihanna", "Drake")).toBe(true);
    expect(artistsMatch("Drake", "Rihanna")).toBe(false);
  });
  it("normalizeKey combines both", () => {
    expect(normalizeKey("Blinding Lights - Radio Edit", "The Weeknd")).toBe("blinding lights|the weeknd");
  });
  it("empty strings never match", () => {
    expect(titlesMatch("", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/catalog/normalize.test.ts`
Expected: FAIL, "Cannot find module '@/src/engine/catalog/normalize'".

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/normalize.ts
// Loose string matching so a model-proposed "Blinding Lights" matches Deezer's
// "Blinding Lights - Radio Edit". Both sides always go through the same function.

const BRACKET_SUFFIX_RE = /\s*[(\[][^)\]]*[)\]]/g;                  // "(feat. X)", "[Remastered]"
const DASH_SUFFIX_RE = /\s+-\s+.*$/;                                 // " - Radio Edit", " - From …"
const FEAT_RE = /\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i;             // "feat. Jack Harlow"
const ARTIST_SPLIT_RE = /\s+(?:feat\.?|ft\.?|featuring|&|x|with|and)\s+|\s*,\s*/i;

function base(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function squash(s: string): string {
  return s.replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeTitle(s: string): string {
  return squash(
    base(s).replace(BRACKET_SUFFIX_RE, "").replace(DASH_SUFFIX_RE, "").replace(FEAT_RE, ""),
  );
}

export function normalizeArtist(s: string): string {
  const primary = base(s).replace(BRACKET_SUFFIX_RE, "").split(ARTIST_SPLIT_RE)[0] ?? "";
  return squash(primary);
}

export function normalizeKey(title: string, artist: string): string {
  return `${normalizeTitle(title)}|${normalizeArtist(artist)}`;
}

export function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  return na === nb || na.startsWith(nb) || nb.startsWith(na);
}

export function artistsMatch(a: string, b: string): boolean {
  const na = normalizeArtist(a);
  const nb = normalizeArtist(b);
  if (!na || !nb) return false;
  return na === nb;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/catalog/normalize.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/normalize.ts tests/engine/catalog/normalize.test.ts
git commit -m "Add title and artist normalisation for song matching"
```

---

### Task 3.2: Candidate generation (three directions, deduplicated)

**Files:**
- Create: `src/engine/candidates/generateCandidates.ts`
- Test: `tests/engine/candidates/generateCandidates.test.ts`

**Interfaces:**
- Consumes: `MusicBrief`, `VideoAnalysis`, `GeneratedCandidate`, `DirectionTag` from `@/src/shared/types`; `MODELS`, `LIMITS` from `@/src/shared/config`; `callClaude`, `ClaudeCall` from `@/src/shared/anthropic`; `extractJson` from `@/src/shared/json`; `normalizeKey` from Task 3.1.
- Produces:
  ```ts
  export const PROMPT_VERSION = "candidates-v1";
  export function buildCandidatePrompt(direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis, note?: string): string;
  export function parseCandidates(text: string, direction: DirectionTag): GeneratedCandidate[];
  export function dedupeCandidates(cands: GeneratedCandidate[]): GeneratedCandidate[];
  export async function generateCandidates(brief: MusicBrief, analysis: VideoAnalysis, opts?: { note?: string; call?: ClaudeCall }): Promise<GeneratedCandidate[]>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/candidates/generateCandidates.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  dedupeCandidates, parseCandidates, generateCandidates, buildCandidatePrompt,
} from "@/src/engine/candidates/generateCandidates";
import type { GeneratedCandidate, MusicBrief, VideoAnalysis } from "@/src/shared/types";

const cand = (over: Partial<GeneratedCandidate>): GeneratedCandidate => ({
  title: "Blinding Lights", artist: "The Weeknd", proposed_start: 43, proposed_end: 58,
  section_reason: "chorus entry", fit_reason: "fits the night drive", direction: "safe", ...over,
});

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

describe("dedupeCandidates", () => {
  it("keeps the first occurrence, ignoring case and punctuation", () => {
    const out = dedupeCandidates([
      cand({ title: "Blinding Lights", direction: "safe" }),
      cand({ title: "blinding lights - radio edit", direction: "current" }),
      cand({ title: "Save Your Tears", direction: "current" }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.direction).toBe("safe");
    expect(out[1]!.title).toBe("Save Your Tears");
  });
});

describe("parseCandidates", () => {
  it("drops malformed items and keeps the rest, forcing the direction", () => {
    const text = "```json\n" + JSON.stringify([
      { title: "A", artist: "B", proposed_start: 10, proposed_end: 25, section_reason: "x", fit_reason: "y", direction: "safe" },
      { title: "Bad", artist: "C" },
      { title: "D", artist: "E", proposed_start: "30", proposed_end: 45, section_reason: "x", fit_reason: "y" },
    ]) + "\n```";
    const out = parseCandidates(text, "unexpected");
    expect(out.map((c) => c.title)).toEqual(["A"]);
    expect(out[0]!.direction).toBe("unexpected");
  });
  it("throws when no JSON array is present", () => {
    expect(() => parseCandidates("sorry, no", "safe")).toThrow(/candidates/);
  });
});

describe("generateCandidates", () => {
  it("makes three calls and merges results", async () => {
    const call = vi.fn(async ({ user }: { user: string }) => {
      const dir = user.includes("DIRECTION: safe") ? "safe" : user.includes("DIRECTION: current") ? "current" : "unexpected";
      return JSON.stringify([
        { title: `${dir} song`, artist: "X", proposed_start: 10, proposed_end: 25, section_reason: "s", fit_reason: "f", direction: dir },
        { title: "Shared Song", artist: "Y", proposed_start: 10, proposed_end: 25, section_reason: "s", fit_reason: "f", direction: dir },
      ]);
    });
    const out = await generateCandidates(brief, analysis, { call });
    expect(call).toHaveBeenCalledTimes(3);
    expect(out.map((c) => c.title).sort()).toEqual(["Shared Song", "current song", "safe song", "unexpected song"]);
  });
  it("includes the note when given", () => {
    expect(buildCandidatePrompt("safe", brief, analysis, "avoid previous list")).toContain("avoid previous list");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/candidates/generateCandidates.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

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
import { normalizeKey } from "@/src/engine/catalog/normalize";

export const PROMPT_VERSION = "candidates-v1";

const SYSTEM = `You are Songfit's music supervisor for short-form video (Instagram Reels, TikTok).
You know mainstream, independent and viral music across decades, and you know which songs
creators actually use on these platforms. You only ever name REAL, officially released songs by
the original artist that are very likely available in the Instagram and TikTok music libraries
in the United States. Never invent songs. Never suggest AI-generated music, unreleased tracks,
remixes by unknown accounts, or production-library stock music. Prefer the original artist's
version over covers and sped-up edits.`;

const DIRECTION_BRIEF: Record<DirectionTag, string> = {
  safe: "Recognisable, proven fits for this kind of content: songs a creator in this niche has seen work many times. Mainstream enough to be in both libraries.",
  current: "Popular on Instagram Reels and TikTok within the last 12 months, or trending-adjacent: artists and songs having a moment right now. Still real, released and easy to find.",
  unexpected: "Less obvious: older songs, niche genres, deep cuts from known artists, genre-crossing picks that a tasteful editor would reach for. Must still be real, released and findable in the libraries.",
};

export function buildCandidatePrompt(
  direction: DirectionTag, brief: MusicBrief, analysis: VideoAnalysis, note?: string,
): string {
  const moments = analysis.important_moments
    .map((m) => `- ${m.time.toFixed(1)}s: ${m.type}${m.note ? ` (${m.note})` : ""}`)
    .join("\n") || "- none identified";
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
Spoken dialogue present: ${analysis.dialogue_present ? "YES, vocals may fight the speech" : "no"}
Key moments:
${moments}

MUSIC BRIEF
${brief.text}
Fields: ${JSON.stringify(brief.fields)}
${note ? `\nNOTE: ${note}\n` : ""}
TASK
Propose exactly ${LIMITS.candidatesPerDirection} songs for this direction. For each song choose the single
best ${LIMITS.sectionMin}–${LIMITS.sectionMax} second window of the ORIGINAL recording for this video:
usually the chorus entry, the drop, or the moment the energy lifts. proposed_start is the second where
that musical moment begins; proposed_end is proposed_start plus the window length.

Return ONLY a JSON array, no prose, each item exactly:
{
  "title": string,
  "artist": string,
  "proposed_start": number,   // seconds into the song
  "proposed_end": number,     // seconds into the song
  "section_reason": string,   // what happens musically in that window (one sentence)
  "fit_reason": string,       // why it fits THIS video, referencing something specific in it (one sentence)
  "direction": "${direction}"
}`;
}

const ItemArray = z.array(z.unknown());

export function parseCandidates(text: string, direction: DirectionTag): GeneratedCandidate[] {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (e) {
    throw new PipelineError("recommend", `candidates: no JSON in model output (${direction})`, text);
  }
  const arr = ItemArray.safeParse(raw);
  if (!arr.success) {
    throw new PipelineError("recommend", `candidates: output is not an array (${direction})`, text);
  }
  const out: GeneratedCandidate[] = [];
  for (const item of arr.data) {
    const parsed = GeneratedCandidate.safeParse({ ...(item as object), direction });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function dedupeCandidates(cands: GeneratedCandidate[]): GeneratedCandidate[] {
  const seen = new Set<string>();
  const out: GeneratedCandidate[] = [];
  for (const c of cands) {
    const key = normalizeKey(c.title, c.artist);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

export async function generateCandidates(
  brief: MusicBrief,
  analysis: VideoAnalysis,
  opts: { note?: string; call?: ClaudeCall } = {},
): Promise<GeneratedCandidate[]> {
  const call = opts.call ?? callClaude;
  const lists = await Promise.all(
    DirectionTag.options.map(async (direction) => {
      const text = await call({
        model: MODELS.candidates,
        system: SYSTEM,
        user: buildCandidatePrompt(direction, brief, analysis, opts.note),
        maxTokens: 6000,
      });
      return parseCandidates(text, direction);
    }),
  );
  return dedupeCandidates(lists.flat());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/candidates/generateCandidates.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/candidates tests/engine/candidates
git commit -m "Add three-direction candidate generation with dedupe"
```

---

### Task 3.3: Deezer search, throttle and match

**Files:**
- Create: `src/engine/catalog/deezer.ts`
- Test: `tests/engine/catalog/deezer.test.ts`

**Interfaces:**
- Consumes: `LIMITS.deezerRps`; `titlesMatch`, `artistsMatch` from Task 3.1.
- Produces:
  ```ts
  export type DeezerTrack = { id: number; title: string; duration: number; preview: string | null; link: string; artist: { name: string }; album?: { cover_medium?: string | null; cover_big?: string | null } };
  export function createThrottle(rps: number): () => Promise<void>;
  export const deezerThrottle: () => Promise<void>;
  export async function searchDeezer(title: string, artist: string, fetchImpl?: typeof fetch): Promise<DeezerTrack[]>;
  export function pickDeezerMatch(cand: { title: string; artist: string }, results: DeezerTrack[]): DeezerTrack | null;
  export async function findDeezerMatch(cand: { title: string; artist: string }, fetchImpl?: typeof fetch): Promise<DeezerTrack | null>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/catalog/deezer.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createThrottle, pickDeezerMatch, searchDeezer, type DeezerTrack,
} from "@/src/engine/catalog/deezer";

const track = (over: Partial<DeezerTrack>): DeezerTrack => ({
  id: 1, title: "Blinding Lights", duration: 200, preview: "https://p/1.mp3",
  link: "https://www.deezer.com/track/1", artist: { name: "The Weeknd" },
  album: { cover_medium: "m.jpg", cover_big: "b.jpg" }, ...over,
});

afterEach(() => vi.useRealTimers());

describe("createThrottle", () => {
  it("spaces calls at 1000/rps ms", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const wait = createThrottle(8);
    const done: number[] = [];
    const p = Promise.all([0, 1, 2].map(() => wait().then(() => done.push(Date.now()))));
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toEqual([0]);
    await vi.advanceTimersByTimeAsync(125);
    expect(done).toEqual([0, 125]);
    await vi.advanceTimersByTimeAsync(125);
    await p;
    expect(done).toEqual([0, 125, 250]);
  });
});

describe("pickDeezerMatch", () => {
  it("returns the first result whose title and primary artist match", () => {
    const results = [
      track({ id: 9, title: "Blinding Lights", artist: { name: "Karaoke Hits" } }),
      track({ id: 2, title: "Blinding Lights - Radio Edit", artist: { name: "The Weeknd" } }),
    ];
    expect(pickDeezerMatch({ title: "Blinding Lights", artist: "The Weeknd" }, results)?.id).toBe(2);
  });
  it("returns null when nothing matches", () => {
    expect(pickDeezerMatch({ title: "Nope", artist: "Nobody" }, [track({})])).toBeNull();
  });
});

describe("searchDeezer", () => {
  it("falls back to a plain query when the strict one is empty", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const data = u.includes("artist%3A") ? [] : [track({})];
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    const out = await searchDeezer("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(out[0]!.id).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/catalog/deezer.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/deezer.ts
// Deezer's public search API: no auth, ~50 requests / 5 s per IP. See docs/RESEARCH.md.
import { z } from "zod";
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
    .object({
      cover_medium: z.string().nullable().optional(),
      cover_big: z.string().nullable().optional(),
    })
    .optional(),
});
const DeezerSearchSchema = z.object({ data: z.array(DeezerTrackSchema).default([]) });
export type DeezerTrack = z.infer<typeof DeezerTrackSchema>;

/** Simple pacing throttle: callers await it before each request; calls are spaced 1000/rps ms apart. */
export function createThrottle(rps: number): () => Promise<void> {
  const interval = 1000 / rps;
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + interval;
    if (at > now) await new Promise<void>((r) => setTimeout(r, at - now));
  };
}

export const deezerThrottle = createThrottle(LIMITS.deezerRps);

async function query(q: string, fetchImpl: typeof fetch): Promise<DeezerTrack[]> {
  await deezerThrottle();
  const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`;
  const res = await fetchImpl(url);
  if (!res.ok) return [];
  const parsed = DeezerSearchSchema.safeParse(await res.json());
  return parsed.success ? parsed.data.data : [];
}

export async function searchDeezer(
  title: string, artist: string, fetchImpl: typeof fetch = fetch,
): Promise<DeezerTrack[]> {
  const strict = await query(`artist:"${artist}" track:"${title}"`, fetchImpl);
  if (strict.length > 0) return strict;
  return query(`${title} ${artist}`, fetchImpl);
}

export function pickDeezerMatch(
  cand: { title: string; artist: string }, results: DeezerTrack[],
): DeezerTrack | null {
  for (const r of results) {
    if (titlesMatch(cand.title, r.title) && artistsMatch(cand.artist, r.artist.name)) return r;
  }
  return null;
}

export async function findDeezerMatch(
  cand: { title: string; artist: string }, fetchImpl: typeof fetch = fetch,
): Promise<DeezerTrack | null> {
  try {
    return pickDeezerMatch(cand, await searchDeezer(cand.title, cand.artist, fetchImpl));
  } catch {
    return null; // network failure on one candidate must not fail the stage
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/catalog/deezer.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/deezer.ts tests/engine/catalog/deezer.test.ts
git commit -m "Add Deezer search with throttle and loose matching"
```

---

### Task 3.4: iTunes preview fallback

**Files:**
- Create: `src/engine/catalog/itunes.ts`
- Test: `tests/engine/catalog/itunes.test.ts`

**Interfaces:**
- Consumes: `titlesMatch`, `artistsMatch`.
- Produces: `export async function findItunesPreview(title: string, artist: string, fetchImpl?: typeof fetch): Promise<{ itunesId: string; previewUrl: string | null } | null>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/catalog/itunes.test.ts
import { describe, it, expect, vi } from "vitest";
import { findItunesPreview } from "@/src/engine/catalog/itunes";

const body = {
  results: [
    { trackId: 11, trackName: "Blinding Lights (Karaoke)", artistName: "Karaoke Co", previewUrl: "https://k.m4a" },
    { trackId: 12, trackName: "Blinding Lights", artistName: "The Weeknd", previewUrl: "https://w.m4a" },
  ],
};

describe("findItunesPreview", () => {
  it("returns the matching track's id and preview", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    const out = await findItunesPreview("Blinding Lights", "The Weeknd", fetchImpl as unknown as typeof fetch);
    expect(out).toEqual({ itunesId: "12", previewUrl: "https://w.m4a" });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("country=US");
  });
  it("returns null on no match or error", async () => {
    const bad = vi.fn(async () => new Response("nope", { status: 403 }));
    expect(await findItunesPreview("X", "Y", bad as unknown as typeof fetch)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/engine/catalog/itunes.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/catalog/itunes.ts
// iTunes Search API: free, no auth, ~20 calls/min. Only call for the final 3 picks.
import { z } from "zod";
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
  try {
    const term = encodeURIComponent(`${title} ${artist}`);
    const res = await fetchImpl(`https://itunes.apple.com/search?term=${term}&entity=song&limit=5&country=US`);
    if (!res.ok) return null;
    const parsed = ItunesSearch.safeParse(await res.json());
    if (!parsed.success) return null;
    const hit = parsed.data.results.find(
      (r) => titlesMatch(title, r.trackName) && artistsMatch(artist, r.artistName),
    );
    return hit ? { itunesId: String(hit.trackId), previewUrl: hit.previewUrl ?? null } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/engine/catalog/itunes.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/itunes.ts tests/engine/catalog/itunes.test.ts
git commit -m "Add iTunes preview lookup for final picks"
```

---

### Task 3.5: Verify candidates against Deezer

**Files:**
- Create: `src/engine/catalog/verifyCandidates.ts`
- Test: `tests/engine/catalog/verifyCandidates.test.ts`

**Interfaces:**
- Consumes: `GeneratedCandidate`, `VerifiedCandidate`; `findDeezerMatch`, `DeezerTrack` (Task 3.3); `LIMITS.sectionMin`, `LIMITS.sectionDefault`.
- Produces:
  ```ts
  export function clampSection(start: number, end: number, duration: number): { start: number; end: number };
  export async function verifyCandidates(cands: GeneratedCandidate[], deps?: { find?: typeof findDeezerMatch }): Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/catalog/verifyCandidates.test.ts
import { describe, it, expect, vi } from "vitest";
import { clampSection, verifyCandidates } from "@/src/engine/catalog/verifyCandidates";
import type { GeneratedCandidate } from "@/src/shared/types";
import type { DeezerTrack } from "@/src/engine/catalog/deezer";

describe("clampSection", () => {
  it("leaves a valid window alone", () => {
    expect(clampSection(43, 58, 200)).toEqual({ start: 43, end: 58 });
  });
  it("clamps end to the track duration", () => {
    expect(clampSection(43, 260, 200)).toEqual({ start: 43, end: 200 });
  });
  it("moves a start too near the end back to a sensible window", () => {
    // 195 >= 200 - 12 → start = 200 - 15 - 5 = 180, end = 195
    expect(clampSection(195, 210, 200)).toEqual({ start: 180, end: 195 });
  });
  it("widens a window shorter than the minimum", () => {
    expect(clampSection(40, 45, 200)).toEqual({ start: 40, end: 55 });
  });
});

const gen = (title: string): GeneratedCandidate => ({
  title, artist: "The Weeknd", proposed_start: 43, proposed_end: 58,
  section_reason: "chorus", fit_reason: "fits", direction: "safe",
});

describe("verifyCandidates", () => {
  it("splits into verified and unverified and attaches Deezer fields", async () => {
    const find = vi.fn(async (c: { title: string }) =>
      c.title === "Found"
        ? ({ id: 7, title: "Found", duration: 200, preview: "https://p.mp3", link: "https://d/7",
            artist: { name: "The Weeknd" }, album: { cover_medium: "m.jpg", cover_big: "b.jpg" } } as DeezerTrack)
        : null,
    );
    const { verified, unverified } = await verifyCandidates([gen("Found"), gen("Missing")], { find });
    expect(unverified.map((c) => c.title)).toEqual(["Missing"]);
    expect(verified).toHaveLength(1);
    expect(verified[0]).toMatchObject({
      deezer_id: "7", duration_seconds: 200, artwork_url: "b.jpg",
      deezer_url: "https://d/7", preview_url: "https://p.mp3", proposed_start: 43, proposed_end: 58,
    });
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
import { LIMITS } from "@/src/shared/config";
import { findDeezerMatch } from "@/src/engine/catalog/deezer";
import { logger } from "@/src/shared/logger";

/** Keep a proposed window inside the real track and at least sectionMin long. */
export function clampSection(start: number, end: number, duration: number): { start: number; end: number } {
  if (duration <= 0) return { start, end };
  let s = Math.max(0, start);
  let e = Math.min(end, duration);
  if (s >= duration - LIMITS.sectionMin) {
    s = Math.max(0, duration - LIMITS.sectionDefault - 5);
    e = Math.min(duration, s + LIMITS.sectionDefault);
  }
  if (e - s < LIMITS.sectionMin) e = Math.min(duration, s + LIMITS.sectionDefault);
  return { start: s, end: e };
}

export async function verifyCandidates(
  cands: GeneratedCandidate[],
  deps: { find?: typeof findDeezerMatch } = {},
): Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }> {
  const find = deps.find ?? findDeezerMatch;
  const verified: VerifiedCandidate[] = [];
  const unverified: GeneratedCandidate[] = [];
  // Parallel is fine: findDeezerMatch awaits the shared throttle before each request.
  const results = await Promise.all(cands.map(async (c) => ({ c, hit: await find(c) })));
  for (const { c, hit } of results) {
    if (!hit) {
      unverified.push(c);
      continue;
    }
    const { start, end } = clampSection(c.proposed_start, c.proposed_end, hit.duration);
    verified.push({
      ...c,
      proposed_start: start,
      proposed_end: end,
      deezer_id: String(hit.id),
      duration_seconds: hit.duration,
      artwork_url: hit.album?.cover_big ?? hit.album?.cover_medium ?? null,
      deezer_url: hit.link,
      preview_url: hit.preview ?? null,
    });
  }
  logger.info("verifyCandidates", { total: cands.length, verified: verified.length });
  return { verified, unverified };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/catalog/verifyCandidates.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/catalog/verifyCandidates.ts tests/engine/catalog/verifyCandidates.test.ts
git commit -m "Verify candidates against Deezer and clamp sections"
```

---

### Task 3.6: Scoring (model dimensions, rules, weights)

**Files:**
- Create: `src/engine/scoring/dimensions.ts`, `src/engine/scoring/modelScores.ts`, `src/engine/scoring/dialogue.ts`, `src/engine/scoring/config/overused.ts`, `src/engine/scoring/overuse.ts`, `src/engine/scoring/weights.ts`, `src/engine/scoring/scoreCandidates.ts`
- Test: `tests/engine/scoring/rules.test.ts`, `tests/engine/scoring/scoreCandidates.test.ts`

**Interfaces:**
- Consumes: `VerifiedCandidate`, `ScoredCandidate`, `ComponentScore`, `ComponentScores`, `Dimension`, `DIMENSIONS`; `callClaude`; `extractJson`; `normalizeKey`.
- Produces:
  ```ts
  // dimensions.ts
  export { DIMENSIONS } from "@/src/shared/types";
  export const MODEL_DIMENSIONS = ["semantic","emotional","aesthetic","pacing","cultural","originality"] as const;
  export type ModelDimension = (typeof MODEL_DIMENSIONS)[number];
  // modelScores.ts
  export const PROMPT_VERSION = "scoring-v1";
  export async function modelScores(analysis, brief, cands: VerifiedCandidate[], deps?: { call?: ClaudeCall }): Promise<Record<ModelDimension, ComponentScore>[]>; // aligned with cands
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

- [ ] **Step 1: Write the failing rule tests**

```ts
// tests/engine/scoring/rules.test.ts
import { describe, it, expect } from "vitest";
import { combine, WEIGHTS } from "@/src/engine/scoring/weights";
import { dialogueScore } from "@/src/engine/scoring/dialogue";
import { overuseScore } from "@/src/engine/scoring/overuse";
import type { ComponentScores, VerifiedCandidate, VideoAnalysis } from "@/src/shared/types";
import { analysis } from "../candidates/generateCandidates.test";

const vc = (over: Partial<VerifiedCandidate>): VerifiedCandidate => ({
  title: "Song", artist: "Artist", proposed_start: 10, proposed_end: 25, section_reason: "instrumental build",
  fit_reason: "f", direction: "safe", deezer_id: "1", duration_seconds: 200, artwork_url: null,
  deezer_url: "https://d/1", preview_url: null, ...over,
});

describe("combine", () => {
  it("is a weighted mean", () => {
    const scores = Object.fromEntries(
      Object.keys(WEIGHTS).map((d) => [d, { score: 0.5, reason: "" }]),
    ) as ComponentScores;
    expect(combine(scores)).toBeCloseTo(0.5, 6);
    scores.semantic = { score: 1, reason: "" };
    const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(combine(scores)).toBeCloseTo((0.5 * (total - WEIGHTS.semantic) + WEIGHTS.semantic) / total, 6);
  });
});

describe("dialogueScore", () => {
  const talky: VideoAnalysis = { ...analysis, dialogue_present: true };
  it("is 1 when there is no dialogue", () => {
    expect(dialogueScore(analysis, vc({})).score).toBe(1);
  });
  it("penalises vocal sections when there is dialogue", () => {
    expect(dialogueScore(talky, vc({ section_reason: "the chorus vocals come in" })).score).toBe(0.3);
  });
  it("mildly penalises other sections when there is dialogue", () => {
    expect(dialogueScore(talky, vc({ section_reason: "instrumental build" })).score).toBe(0.8);
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

const VOCAL_RE = /vocal|chorus|sing|lyric|verse|hook|rap/i;

export function dialogueScore(analysis: VideoAnalysis, cand: VerifiedCandidate): ComponentScore {
  if (!analysis.dialogue_present) return { score: 1, reason: "no dialogue to compete with" };
  if (VOCAL_RE.test(cand.section_reason)) {
    return { score: 0.3, reason: "vocals will fight the dialogue" };
  }
  return { score: 0.8, reason: "section is mostly instrumental under speech" };
}
```

```ts
// src/engine/scoring/config/overused.ts
// Hand-maintained list of songs saturated on IG/TikTok. Replaced by song_trend_signals later.
// Edit freely; matching is loose (see normalize.ts).
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
  if (KEYS.has(normalizeKey(cand.title, cand.artist))) {
    return { score: 0.4, reason: "overused on social right now" };
  }
  return { score: 1, reason: "not on the overused list" };
}
```

- [ ] **Step 4: Run rule tests to verify they pass**

Run: `pnpm test -- tests/engine/scoring/rules.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing scoreCandidates test**

```ts
// tests/engine/scoring/scoreCandidates.test.ts
import { describe, it, expect, vi } from "vitest";
import { scoreCandidates } from "@/src/engine/scoring/scoreCandidates";
import { modelScores, PROMPT_VERSION } from "@/src/engine/scoring/modelScores";
import { DIMENSIONS, type VerifiedCandidate } from "@/src/shared/types";
import { analysis, brief } from "../candidates/generateCandidates.test";

const vc = (title: string, id: string): VerifiedCandidate => ({
  title, artist: "Artist", proposed_start: 10, proposed_end: 25, section_reason: "build",
  fit_reason: "f", direction: "safe", deezer_id: id, duration_seconds: 200, artwork_url: null,
  deezer_url: `https://d/${id}`, preview_url: null,
});

describe("scoreCandidates", () => {
  it("attaches all 7 dimensions and sorts by total descending", async () => {
    const scores = vi.fn(async (_a, _b, cands: VerifiedCandidate[]) =>
      cands.map((c) => {
        const s = c.title === "Great" ? 0.9 : 0.4;
        const one = { score: s, reason: "r" };
        return { semantic: one, emotional: one, aesthetic: one, pacing: one, cultural: one, originality: one };
      }),
    );
    const out = await scoreCandidates(analysis, brief, [vc("Meh", "1"), vc("Great", "2")], { scores });
    expect(out.map((c) => c.title)).toEqual(["Great", "Meh"]);
    for (const c of out) {
      expect(Object.keys(c.component_scores).sort()).toEqual([...DIMENSIONS].sort());
      expect(c.total_score).toBeGreaterThan(0);
    }
  });
});

describe("modelScores", () => {
  it("parses the batched response and fills missing items with 0.5", async () => {
    const call = vi.fn(async () => JSON.stringify([
      { index: 0, semantic: { score: 0.9, reason: "a" }, emotional: { score: 0.8, reason: "b" },
        aesthetic: { score: 0.7, reason: "c" }, pacing: { score: 0.6, reason: "d" },
        cultural: { score: 0.5, reason: "e" }, originality: { score: 0.4, reason: "f" } },
    ]));
    const out = await modelScores(analysis, brief, [vc("A", "1"), vc("B", "2")], { call });
    expect(out[0]!.semantic.score).toBe(0.9);
    expect(out[1]!.semantic).toEqual({ score: 0.5, reason: "unscored" });
    expect(PROMPT_VERSION).toBe("scoring-v1");
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
import { MODELS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { PipelineError } from "@/src/shared/errors";
import { MODEL_DIMENSIONS, type ModelDimension } from "@/src/engine/scoring/dimensions";

export const PROMPT_VERSION = "scoring-v1";

const SYSTEM = `You are Songfit's music supervisor. You score candidate song sections against a specific
short-form video. Be decisive and discriminating: use the full 0–1 range, do not give everything 0.7.
A 1.0 means "this is exactly the song a great editor would pick"; a 0.2 means "clearly wrong".`;

const DIMENSION_DEFINITIONS: Record<ModelDimension, string> = {
  semantic: "Does the song make sense for what is literally happening in the video (subject, setting, story)?",
  emotional: "Does the emotional character of this section match or productively contrast the video's feel and the creator's intent?",
  aesthetic: "Does the sound match the visual world (luxury vs raw, modern vs retro, polished vs lo-fi)?",
  pacing: "Do the energy and rhythm of this section fit the edit's pace and cuts, and does its musical moment land near the key moment?",
  cultural: "Would this creator realistically use this song on Instagram or TikTok right now, given their niche and audience?",
  originality: "Is it good without being painfully obvious or exhausted?",
};

const Item = z.object({ index: z.number().int() }).and(
  z.object(Object.fromEntries(MODEL_DIMENSIONS.map((d) => [d, ComponentScore])) as Record<ModelDimension, typeof ComponentScore>),
);

export function buildScoringPrompt(analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[]): string {
  const defs = MODEL_DIMENSIONS.map((d) => `- ${d}: ${DIMENSION_DEFINITIONS[d]}`).join("\n");
  const list = cands
    .map((c, i) =>
      `${i}. "${c.title}" — ${c.artist} | section ${c.proposed_start}s–${c.proposed_end}s | ${c.section_reason} | proposed because: ${c.fit_reason}`)
    .join("\n");
  const moments = analysis.important_moments.map((m) => `${m.time}s ${m.type}`).join("; ") || "none";
  return `VIDEO
${analysis.summary}
Category: ${analysis.content_category}. Aesthetic: ${analysis.aesthetic.join(", ")}. Mood: ${analysis.mood.join(", ")}.
Energy ${analysis.energy}, pacing ${analysis.pacing}. Dialogue: ${analysis.dialogue_present ? "yes" : "no"}. Key moments: ${moments}.

MUSIC BRIEF
${brief.text}

DIMENSIONS (score each 0–1 with a one-line reason)
${defs}

CANDIDATES
${list}

Return ONLY a JSON array with one object per candidate:
{ "index": number, "semantic": {"score": number, "reason": string}, "emotional": {...}, "aesthetic": {...}, "pacing": {...}, "cultural": {...}, "originality": {...} }`;
}

export async function modelScores(
  analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[],
  deps: { call?: ClaudeCall } = {},
): Promise<Record<ModelDimension, ComponentScore>[]> {
  const call = deps.call ?? callClaude;
  const text = await call({
    model: MODELS.scoring, system: SYSTEM, user: buildScoringPrompt(analysis, brief, cands), maxTokens: 16000,
  });
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    throw new PipelineError("recommend", "scoring: no JSON in model output", text);
  }
  const arr = z.array(z.unknown()).safeParse(raw);
  if (!arr.success) throw new PipelineError("recommend", "scoring: output is not an array", text);

  const byIndex = new Map<number, Record<ModelDimension, ComponentScore>>();
  for (const item of arr.data) {
    const parsed = Item.safeParse(item);
    if (parsed.success) {
      const { index, ...rest } = parsed.data;
      byIndex.set(index, rest as Record<ModelDimension, ComponentScore>);
    }
  }
  const unscored = (): Record<ModelDimension, ComponentScore> =>
    Object.fromEntries(MODEL_DIMENSIONS.map((d) => [d, { score: 0.5, reason: "unscored" }])) as Record<ModelDimension, ComponentScore>;
  return cands.map((_, i) => byIndex.get(i) ?? unscored());
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
      originality: minScore(fromModel[i]!.originality, overuseScore(c)),
    };
    return { ...c, component_scores, total_score: combine(component_scores) };
  });
  return scored.sort((a, b) => b.total_score - a.total_score);
}

/** The overuse rule caps originality: a saturated song cannot score high on originality. */
function minScore(a: { score: number; reason: string }, b: { score: number; reason: string }) {
  return a.score <= b.score ? a : b;
}
```

- [ ] **Step 8: Run all scoring tests**

Run: `pnpm test -- tests/engine/scoring`
Expected: PASS, 8 tests.

- [ ] **Step 9: Commit**

```bash
pnpm typecheck && git add src/engine/scoring tests/engine/scoring
git commit -m "Add candidate scoring: batched model dimensions, dialogue and overuse rules, weights"
```

---

### Task 3.7: Diversify into 3 directions

**Files:**
- Create: `src/engine/diversify/diversify.ts`
- Test: `tests/engine/diversify/diversify.test.ts`

**Interfaces:**
- Consumes: `ScoredCandidate`, `Pick`, `DirectionTag`, `DIRECTION_LABEL`; `normalizeArtist`; `PipelineError`.
- Produces: `export function diversify(scored: ScoredCandidate[]): Pick[]` (length 3, ranks 1–3).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/diversify/diversify.test.ts
import { describe, it, expect } from "vitest";
import { diversify } from "@/src/engine/diversify/diversify";
import type { ScoredCandidate, DirectionTag } from "@/src/shared/types";

let n = 0;
const sc = (title: string, direction: DirectionTag, total: number, artist = `Artist ${++n}`): ScoredCandidate => ({
  title, artist, proposed_start: 30, proposed_end: 45, section_reason: "chorus", fit_reason: "f", direction,
  deezer_id: String(n), duration_seconds: 200, artwork_url: null, deezer_url: "", preview_url: null,
  component_scores: {} as ScoredCandidate["component_scores"], total_score: total,
});

describe("diversify", () => {
  it("picks top overall, then the best of a different direction, then the remaining direction", () => {
    const out = diversify([
      sc("S1", "safe", 0.9), sc("S2", "safe", 0.85), sc("C1", "current", 0.8), sc("U1", "unexpected", 0.6), sc("C2", "current", 0.7),
    ]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "U1"]);
    expect(out.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(out.map((p) => p.direction_label)).toEqual(["Best fit", "More current", "Unexpected"]);
    expect(out[0]).toMatchObject({ start_seconds: 30, end_seconds: 45 });
  });
  it("falls back to next best overall when a direction is empty", () => {
    const out = diversify([sc("S1", "safe", 0.9), sc("S2", "safe", 0.85), sc("C1", "current", 0.8)]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "S2"]);
  });
  it("avoids repeating an artist when a close alternative exists", () => {
    const out = diversify([
      sc("S1", "safe", 0.9, "Drake"), sc("C1", "current", 0.8, "Drake"), sc("C2", "current", 0.75, "SZA"), sc("U1", "unexpected", 0.5, "Khruangbin"),
    ]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C2", "U1"]);
  });
  it("keeps the repeated artist when the alternative is far worse", () => {
    const out = diversify([
      sc("S1", "safe", 0.9, "Drake"), sc("C1", "current", 0.8, "Drake"), sc("C2", "current", 0.5, "SZA"), sc("U1", "unexpected", 0.5, "Khruangbin"),
    ]);
    expect(out[1]!.title).toBe("C1");
  });
  it("throws with fewer than 3 candidates", () => {
    expect(() => diversify([sc("S1", "safe", 0.9), sc("S2", "safe", 0.8)])).toThrow(/fewer than 3/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- tests/engine/diversify/diversify.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/engine/diversify/diversify.ts
import { DirectionTag, DIRECTION_LABEL, type Pick, type ScoredCandidate } from "@/src/shared/types";
import { PipelineError } from "@/src/shared/errors";
import { normalizeArtist } from "@/src/engine/catalog/normalize";

const ARTIST_TOLERANCE = 0.1;

export function diversify(scored: ScoredCandidate[]): Pick[] {
  if (scored.length < 3) {
    throw new PipelineError("recommend", `fewer than 3 verified candidates (${scored.length})`);
  }
  const sorted = [...scored].sort((a, b) => b.total_score - a.total_score);
  const picks: ScoredCandidate[] = [];
  const usedIds = new Set<string>();
  const usedArtists = new Set<string>();

  const take = (c: ScoredCandidate) => {
    picks.push(c);
    usedIds.add(c.deezer_id);
    usedArtists.add(normalizeArtist(c.artist));
  };
  const preferNewArtist = (pool: ScoredCandidate[]): ScoredCandidate | undefined => {
    const first = pool[0];
    if (!first || !usedArtists.has(normalizeArtist(first.artist))) return first;
    const alt = pool.find(
      (c) => !usedArtists.has(normalizeArtist(c.artist)) && first.total_score - c.total_score <= ARTIST_TOLERANCE,
    );
    return alt ?? first;
  };

  take(sorted[0]!);
  while (picks.length < 3) {
    const available = sorted.filter((c) => !usedIds.has(c.deezer_id));
    const takenDirs = new Set(picks.map((p) => p.direction));
    const fresh = available.filter((c) => !takenDirs.has(c.direction));
    const choice = preferNewArtist(fresh.length ? fresh : available);
    if (!choice) break;
    take(choice);
  }
  if (picks.length < 3) throw new PipelineError("recommend", "could not assemble 3 distinct picks");

  return picks.map((c, i) => ({
    ...c,
    rank: (i + 1) as 1 | 2 | 3,
    direction_label: DIRECTION_LABEL[c.direction],
    start_seconds: c.proposed_start,
    end_seconds: c.proposed_end,
  }));
}

// DirectionTag is imported so the module's contract with the enum is explicit; keep for readers.
void DirectionTag;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/diversify/diversify.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/diversify tests/engine/diversify
git commit -m "Add diversification into three directions"
```

---

### Task 3.8: Section selection and reveal alignment

**Files:**
- Create: `src/engine/sections/selectSections.ts`
- Test: `tests/engine/sections/selectSections.test.ts`

**Interfaces:**
- Consumes: `Pick`, `VideoAnalysis`, `LIMITS.sectionMin/sectionMax`.
- Produces:
  ```ts
  export function fitLength(start: number, end: number, duration: number): { start: number; end: number };
  export function alignToMoment(pick: Pick, analysis: VideoAnalysis): { start: number; end: number } | null;
  export function selectSections(picks: Pick[], analysis: VideoAnalysis): Pick[];
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/engine/sections/selectSections.test.ts
import { describe, it, expect } from "vitest";
import { fitLength, alignToMoment, selectSections } from "@/src/engine/sections/selectSections";
import type { Pick, VideoAnalysis } from "@/src/shared/types";
import { analysis } from "../candidates/generateCandidates.test";

const pick = (over: Partial<Pick>): Pick => ({
  title: "T", artist: "A", proposed_start: 43, proposed_end: 58, section_reason: "chorus hits", fit_reason: "f",
  direction: "safe", deezer_id: "1", duration_seconds: 200, artwork_url: null, deezer_url: "", preview_url: null,
  component_scores: {} as Pick["component_scores"], total_score: 0.8, rank: 1, direction_label: "Best fit",
  start_seconds: 43, end_seconds: 58, ...over,
});

describe("fitLength", () => {
  it("shrinks a long window around its midpoint", () => {
    expect(fitLength(40, 70, 200)).toEqual({ start: 45, end: 65 });
  });
  it("expands a short window around its midpoint", () => {
    expect(fitLength(50, 54, 200)).toEqual({ start: 46, end: 58 });
  });
  it("clamps at the start of the track", () => {
    expect(fitLength(0, 5, 200)).toEqual({ start: 0, end: 12 });
  });
});

describe("alignToMoment", () => {
  it("shifts the window so the hit lands on the reveal", () => {
    // reveal at 7.8 s, hit at 43 s → start at 35.2 s so the hit plays at video time 7.8
    const out = alignToMoment(pick({}), analysis);
    expect(out).toEqual({ start: 35.2, end: 50.2 });
  });
  it("returns null when the section reason is not a hit, or no key moment exists", () => {
    expect(alignToMoment(pick({ section_reason: "mellow verse" }), analysis)).toBeNull();
    const quiet: VideoAnalysis = { ...analysis, important_moments: [] };
    expect(alignToMoment(pick({}), quiet)).toBeNull();
  });
  it("clamps at 0 when the hit is earlier than the reveal", () => {
    expect(alignToMoment(pick({ proposed_start: 5, proposed_end: 20, start_seconds: 5, end_seconds: 20 }), analysis))
      .toEqual({ start: 0, end: 15 });
  });
});

describe("selectSections", () => {
  it("applies alignment, length rules, and nudges #2 when all lengths match", () => {
    const quiet: VideoAnalysis = { ...analysis, important_moments: [] };
    const out = selectSections(
      [pick({ rank: 1 }), pick({ rank: 2, deezer_id: "2" }), pick({ rank: 3, deezer_id: "3" })],
      quiet,
    );
    expect(out.map((p) => p.end_seconds - p.start_seconds)).toEqual([15, 17, 15]);
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
// The generator's proposed_start is the second where the song's musical "hit" begins
// (chorus entry, drop). A creator starts the chosen section at video time 0. So to make the
// hit land on a video moment at time T, the section must start at (proposed_start - T),
// clamped to 0, keeping the same length. Alignment only applies when T is inside the section.
import type { Pick, VideoAnalysis } from "@/src/shared/types";
import { LIMITS } from "@/src/shared/config";

const KEY_MOMENT_RE = /reveal|climax|drop|transition/i;
const HIT_RE = /chorus|drop|hit|build/i;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function fitLength(start: number, end: number, duration: number): { start: number; end: number } {
  const len = end - start;
  let s = start;
  let e = end;
  if (len > LIMITS.sectionMax || len < LIMITS.sectionMin) {
    const target = len > LIMITS.sectionMax ? LIMITS.sectionMax : LIMITS.sectionMin;
    const mid = (start + end) / 2;
    s = mid - target / 2;
    e = mid + target / 2;
  }
  if (s < 0) {
    e -= s;
    s = 0;
  }
  if (duration > 0 && e > duration) {
    s = Math.max(0, s - (e - duration));
    e = duration;
  }
  return { start: round1(s), end: round1(e) };
}

export function alignToMoment(pick: Pick, analysis: VideoAnalysis): { start: number; end: number } | null {
  if (!HIT_RE.test(pick.section_reason)) return null;
  const moment = [...analysis.important_moments]
    .filter((m) => KEY_MOMENT_RE.test(m.type))
    .sort((a, b) => a.time - b.time)[0];
  if (!moment) return null;
  const len = pick.end_seconds - pick.start_seconds;
  if (moment.time >= len) return null; // the hit could not fall inside a section this short
  const start = Math.max(0, pick.proposed_start - moment.time);
  return { start: round1(start), end: round1(start + len) };
}

export function selectSections(picks: Pick[], analysis: VideoAnalysis): Pick[] {
  const out = picks.map((p) => {
    const aligned = alignToMoment(p, analysis) ?? { start: p.start_seconds, end: p.end_seconds };
    const fitted = fitLength(aligned.start, aligned.end, p.duration_seconds);
    return { ...p, start_seconds: fitted.start, end_seconds: fitted.end };
  });
  const lengths = out.map((p) => round1(p.end_seconds - p.start_seconds));
  if (out.length === 3 && lengths.every((l) => l === lengths[0])) {
    const p2 = out[1]!;
    const nudgedEnd = Math.min(p2.duration_seconds, p2.end_seconds + 2);
    if (nudgedEnd - p2.start_seconds <= LIMITS.sectionMax) out[1] = { ...p2, end_seconds: round1(nudgedEnd) };
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- tests/engine/sections/selectSections.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/sections tests/engine/sections
git commit -m "Add section selection with reveal alignment and length rules"
```

---

### Task 3.9: Explanations in the Songfit voice

**Files:**
- Create: `src/engine/explain/explainPicks.ts`
- Test: `tests/engine/explain/explainPicks.test.ts`

**Interfaces:**
- Consumes: `Pick`, `FinalRecommendation`, `VideoAnalysis`, `MusicBrief`; `callClaude`; `extractJson`; `findItunesPreview` (Task 3.4); `DIMENSIONS`.
- Produces:
  ```ts
  export const PROMPT_VERSION = "explain-v1";
  export function spotifySearchUrl(title: string, artist: string): string;
  export async function explainPicks(picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief, deps?: { call?: ClaudeCall; itunes?: typeof findItunesPreview }): Promise<FinalRecommendation[]>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/engine/explain/explainPicks.test.ts
import { describe, it, expect, vi } from "vitest";
import { explainPicks, spotifySearchUrl } from "@/src/engine/explain/explainPicks";
import type { Pick } from "@/src/shared/types";
import { analysis, brief } from "../candidates/generateCandidates.test";

const pick = (rank: 1 | 2 | 3, preview: string | null): Pick => ({
  title: `Song ${rank}`, artist: "Artist", proposed_start: 43, proposed_end: 58, section_reason: "chorus", fit_reason: "fits",
  direction: "safe", deezer_id: String(rank), duration_seconds: 200, artwork_url: null, deezer_url: "", preview_url: preview,
  component_scores: {
    semantic: { score: 0.9, reason: "night city" }, emotional: { score: 0.8, reason: "confident" },
    aesthetic: { score: 0.5, reason: "" }, pacing: { score: 0.5, reason: "" }, dialogue: { score: 1, reason: "" },
    cultural: { score: 0.5, reason: "" }, originality: { score: 0.5, reason: "" },
  },
  total_score: 0.8, rank, direction_label: "Best fit", start_seconds: 43, end_seconds: 58,
});

describe("explainPicks", () => {
  it("attaches explanations, spotify url and iTunes preview fallback", async () => {
    const call = vi.fn(async () => JSON.stringify([
      { rank: 1, explanation: "One." }, { rank: 2, explanation: "Two." }, { rank: 3, explanation: "Three." },
    ]));
    const itunes = vi.fn(async (title: string) =>
      title === "Song 2" ? { itunesId: "99", previewUrl: "https://i.m4a" } : null);
    const out = await explainPicks([pick(1, "https://d.mp3"), pick(2, null), pick(3, null)], analysis, brief, { call, itunes });
    expect(out.map((r) => r.explanation)).toEqual(["One.", "Two.", "Three."]);
    expect(out[0]!.preview_url).toBe("https://d.mp3");
    expect(out[1]!.preview_url).toBe("https://i.m4a");
    expect(out[1]!.itunes_id).toBe("99");
    expect(out[2]!.preview_url).toBeNull();
    expect(out[0]!.spotify_url).toBe(spotifySearchUrl("Song 1", "Artist"));
  });
  it("falls back to the fit reason when the model misses a rank", async () => {
    const call = vi.fn(async () => JSON.stringify([{ rank: 1, explanation: "One." }]));
    const itunes = vi.fn(async () => null);
    const out = await explainPicks([pick(1, null), pick(2, null), pick(3, null)], analysis, brief, { call, itunes });
    expect(out[1]!.explanation).toBe("fits");
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
import { MODELS } from "@/src/shared/config";
import { callClaude, type ClaudeCall } from "@/src/shared/anthropic";
import { extractJson } from "@/src/shared/json";
import { findItunesPreview } from "@/src/engine/catalog/itunes";

export const PROMPT_VERSION = "explain-v1";

const SYSTEM = `You write the one-line reasons under Songfit's song picks. Voice: a sharp friend who edits
video. Second person. Two sentences, each under 20 words. No hype, no emojis, no exclamation marks,
no words like "perfect", "vibe", "elevate". Never mention scores, models, AI, or how the pick was made.
Each reason must name something specific from the video and say what the song section does for it.`;

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

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function buildExplainPrompt(picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief): string {
  const list = picks
    .map((p) => `#${p.rank} (${p.direction_label}): "${p.title}" — ${p.artist}, use ${fmt(p.start_seconds)}–${fmt(p.end_seconds)}.
   Section: ${p.section_reason}. Why proposed: ${p.fit_reason}. Strongest reasons: ${topReasons(p) || "n/a"}.`)
    .join("\n");
  return `VIDEO: ${analysis.summary}
Key moments: ${analysis.important_moments.map((m) => `${m.time}s ${m.type}`).join("; ") || "none"}
BRIEF: ${brief.text}

PICKS
${list}

Return ONLY a JSON array: [{ "rank": 1, "explanation": "..." }, { "rank": 2, ... }, { "rank": 3, ... }]`;
}

export function spotifySearchUrl(title: string, artist: string): string {
  return `https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`)}`;
}

export async function explainPicks(
  picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief,
  deps: { call?: ClaudeCall; itunes?: typeof findItunesPreview } = {},
): Promise<FinalRecommendation[]> {
  const call = deps.call ?? callClaude;
  const itunes = deps.itunes ?? findItunesPreview;

  const [text, previews] = await Promise.all([
    call({ model: MODELS.explain, system: SYSTEM, user: buildExplainPrompt(picks, analysis, brief), maxTokens: 1500 }),
    Promise.all(picks.map((p) => itunes(p.title, p.artist))),
  ]);

  const byRank = new Map<number, string>();
  try {
    const arr = z.array(z.unknown()).safeParse(extractJson(text));
    if (arr.success) {
      for (const item of arr.data) {
        const parsed = Item.safeParse(item);
        if (parsed.success) byRank.set(parsed.data.rank, parsed.data.explanation.trim());
      }
    }
  } catch {
    // fall through: every pick falls back to its fit_reason
  }

  return picks.map((p, i) => {
    const it = previews[i] ?? null;
    return {
      ...p,
      explanation: byRank.get(p.rank) ?? p.fit_reason,
      spotify_url: spotifySearchUrl(p.title, p.artist),
      itunes_id: it?.itunesId ?? null,
      preview_url: p.preview_url ?? it?.previewUrl ?? null,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/engine/explain/explainPicks.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck && git add src/engine/explain tests/engine/explain
git commit -m "Add Songfit-voice explanations with Spotify link and iTunes preview fallback"
```

---

### Task 3.10: Orchestrator `recommendSubmission` and pipeline wiring

**Files:**
- Modify: `src/db/queries/candidates.ts` (`replaceCandidates` returns inserted ids), `src/db/queries/recommendations.ts`
- Create: `src/engine/recommend.ts`
- Modify: `src/pipeline/run.ts`
- Test: `tests/engine/recommend.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3.2–3.9; from Phase 0/2: `getSubmission(id)`, `getAnalysis(submissionId): Promise<{ analysis: VideoAnalysis; brief: MusicBrief; row } | null>` (Phase 0, Task 0.4), `setSubmissionStatus(id, status, error?)`, `logEvent`, `PipelineError`, `analyzeSubmission`.
- Produces:
  ```ts
  // src/db/queries/candidates.ts
  export type CandidateRow = { submission_id: string; title: string; artist: string; deezer_id: string | null; itunes_id: string | null; duration_seconds: number | null; verified: boolean; proposed_start: number; proposed_end: number; generator_reason: string; direction: string; component_scores: ComponentScores | null; total_score: number | null; prompt_version: string };
  export async function replaceCandidates(submissionId: string, rows: CandidateRow[]): Promise<{ id: string; deezer_id: string | null }[]>;
  // src/db/queries/recommendations.ts
  export type RecommendationRow = { submission_id: string; candidate_id: string | null; rank: number; direction_label: string; title: string; artist: string; start_seconds: number; end_seconds: number; explanation: string; spotify_url: string; deezer_url: string | null; artwork_url: string | null; preview_url: string | null };
  export async function replaceRecommendations(submissionId: string, rows: RecommendationRow[]): Promise<void>;
  // src/engine/recommend.ts
  export async function recommendSubmission(submissionId: string, deps?: RecommendDeps): Promise<void>;
  ```

- [ ] **Step 1: Confirm the `direction` column exists**

Phase 0's `0001_init.sql` already adds `direction`, `artwork_url`, `deezer_url` and `preview_url` to `candidates` and documents them in `docs/DATA_MODEL.md`. No migration in this task.

Run: `grep -n "direction" supabase/migrations/0001_init.sql src/db/types.ts | head`
Expected: both files mention `direction` under candidates. If not, stop and fix Phase 0 Task 0.3 first.

- [ ] **Step 2: Make `replaceCandidates` return ids and define the row types**

```ts
// src/db/queries/candidates.ts
import { createServiceClient } from "@/src/db/client";
import type { ComponentScores } from "@/src/shared/types";

export type CandidateRow = {
  submission_id: string;
  title: string;
  artist: string;
  deezer_id: string | null;
  itunes_id: string | null;
  duration_seconds: number | null;
  verified: boolean;
  proposed_start: number;
  proposed_end: number;
  generator_reason: string;
  direction: string;
  component_scores: ComponentScores | null;
  total_score: number | null;
  prompt_version: string;
};

/** Idempotent: wipes this submission's candidates and inserts the new set. */
export async function replaceCandidates(
  submissionId: string, rows: CandidateRow[],
): Promise<{ id: string; deezer_id: string | null }[]> {
  const db = createServiceClient();
  const del = await db.from("candidates").delete().eq("submission_id", submissionId);
  if (del.error) throw del.error;
  if (rows.length === 0) return [];
  const ins = await db.from("candidates").insert(rows).select("id, deezer_id");
  if (ins.error) throw ins.error;
  return ins.data;
}

export async function listCandidates(submissionId: string) {
  const db = createServiceClient();
  const res = await db.from("candidates").select("*").eq("submission_id", submissionId)
    .order("total_score", { ascending: false, nullsFirst: false });
  if (res.error) throw res.error;
  return res.data;
}
```

```ts
// src/db/queries/recommendations.ts
import { createServiceClient } from "@/src/db/client";

export type RecommendationRow = {
  submission_id: string;
  candidate_id: string | null;
  rank: number;
  direction_label: string;
  title: string;
  artist: string;
  start_seconds: number;
  end_seconds: number;
  explanation: string;
  spotify_url: string;
  deezer_url: string | null;
  artwork_url: string | null;
  preview_url: string | null;
};

export async function replaceRecommendations(submissionId: string, rows: RecommendationRow[]): Promise<void> {
  const db = createServiceClient();
  const del = await db.from("recommendations").delete().eq("submission_id", submissionId);
  if (del.error) throw del.error;
  const ins = await db.from("recommendations").insert(rows);
  if (ins.error) throw ins.error;
}

export async function listRecommendations(submissionId: string) {
  const db = createServiceClient();
  const res = await db.from("recommendations").select("*").eq("submission_id", submissionId).order("rank");
  if (res.error) throw res.error;
  return res.data;
}
```

- [ ] **Step 3: Write the failing orchestrator test**

```ts
// tests/engine/recommend.test.ts
import { describe, it, expect, vi } from "vitest";
import { recommendSubmission, type RecommendDeps } from "@/src/engine/recommend";
import type { GeneratedCandidate, VerifiedCandidate, ScoredCandidate, Pick, FinalRecommendation } from "@/src/shared/types";
import { analysis, brief } from "./candidates/generateCandidates.test";

const gen = (title: string): GeneratedCandidate => ({
  title, artist: "A", proposed_start: 10, proposed_end: 25, section_reason: "chorus", fit_reason: "f", direction: "safe",
});
const ver = (c: GeneratedCandidate, id: string): VerifiedCandidate => ({
  ...c, deezer_id: id, duration_seconds: 200, artwork_url: null, deezer_url: `https://d/${id}`, preview_url: null,
});
const one = { score: 0.7, reason: "r" };
const scoredOf = (v: VerifiedCandidate): ScoredCandidate => ({
  ...v, total_score: 0.7,
  component_scores: { semantic: one, emotional: one, aesthetic: one, pacing: one, dialogue: one, cultural: one, originality: one },
});

describe("recommendSubmission", () => {
  it("runs the stages in order and persists unverified rows with verified=false", async () => {
    const calls: string[] = [];
    const generated = [gen("V1"), gen("V2"), gen("V3"), gen("Missing")];
    const verified = generated.slice(0, 3).map((c, i) => ver(c, String(i + 1)));
    const scored = verified.map(scoredOf);
    const picks: Pick[] = scored.map((s, i) => ({
      ...s, rank: (i + 1) as 1 | 2 | 3, direction_label: "Best fit", start_seconds: 10, end_seconds: 25,
    }));
    const finals: FinalRecommendation[] = picks.map((p) => ({ ...p, explanation: "e", spotify_url: "s", itunes_id: null }));
    const replaceCandidates = vi.fn(async (_id: string, rows: { deezer_id: string | null; verified: boolean }[]) => {
      calls.push("replaceCandidates");
      return rows.map((r, i) => ({ id: `cand-${i}`, deezer_id: r.deezer_id }));
    });
    const replaceRecommendations = vi.fn(async () => { calls.push("replaceRecommendations"); });
    const deps: RecommendDeps = {
      getAnalysis: vi.fn(async () => ({ analysis, brief })),
      generate: vi.fn(async () => { calls.push("generate"); return generated; }),
      verify: vi.fn(async () => { calls.push("verify"); return { verified, unverified: [generated[3]!] }; }),
      score: vi.fn(async () => { calls.push("score"); return scored; }),
      diversify: vi.fn(() => { calls.push("diversify"); return picks; }),
      sections: vi.fn(() => { calls.push("sections"); return picks; }),
      explain: vi.fn(async () => { calls.push("explain"); return finals; }),
      replaceCandidates,
      replaceRecommendations,
      setStatus: vi.fn(async () => { calls.push("setStatus"); }),
      logEvent: vi.fn(async () => {}),
    };
    await recommendSubmission("sub-1", deps);
    expect(calls).toEqual(["generate", "verify", "score", "replaceCandidates", "diversify", "sections", "explain", "replaceRecommendations", "setStatus"]);
    const rows = replaceCandidates.mock.calls[0]![1];
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => !r.verified)).toHaveLength(1);
    expect(deps.setStatus).toHaveBeenCalledWith("sub-1", "ready");
    const recRows = (replaceRecommendations.mock.calls[0] as unknown as [string, { candidate_id: string | null }[]])[1];
    expect(recRows.map((r) => r.candidate_id)).toEqual(["cand-0", "cand-1", "cand-2"]);
  });

  it("regenerates once when fewer than 3 verify, then fails if still short", async () => {
    const generate = vi.fn(async () => [gen("X")]);
    const deps: RecommendDeps = {
      getAnalysis: vi.fn(async () => ({ analysis, brief })),
      generate,
      verify: vi.fn(async () => ({ verified: [], unverified: [gen("X")] })),
      score: vi.fn(async () => []),
      diversify: vi.fn(() => []), sections: vi.fn(() => []), explain: vi.fn(async () => []),
      replaceCandidates: vi.fn(async () => []), replaceRecommendations: vi.fn(async () => {}),
      setStatus: vi.fn(async () => {}), logEvent: vi.fn(async () => {}),
    };
    await expect(recommendSubmission("sub-2", deps)).rejects.toThrow(/fewer than 3/);
    expect(generate).toHaveBeenCalledTimes(2);
    expect((generate.mock.calls[1] as unknown[])[2]).toMatchObject({ note: expect.stringContaining("Deezer") });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test -- tests/engine/recommend.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 5: Write the orchestrator**

```ts
// src/engine/recommend.ts
import type {
  FinalRecommendation, GeneratedCandidate, MusicBrief, Pick, ScoredCandidate, SubmissionStatus,
  VerifiedCandidate, VideoAnalysis,
} from "@/src/shared/types";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";
import { generateCandidates, PROMPT_VERSION as CANDIDATES_VERSION } from "@/src/engine/candidates/generateCandidates";
import { verifyCandidates } from "@/src/engine/catalog/verifyCandidates";
import { scoreCandidates } from "@/src/engine/scoring/scoreCandidates";
import { PROMPT_VERSION as SCORING_VERSION } from "@/src/engine/scoring/modelScores";
import { diversify } from "@/src/engine/diversify/diversify";
import { selectSections } from "@/src/engine/sections/selectSections";
import { explainPicks } from "@/src/engine/explain/explainPicks";
import { getAnalysis } from "@/src/db/queries/analyses";
import { replaceCandidates, type CandidateRow } from "@/src/db/queries/candidates";
import { replaceRecommendations, type RecommendationRow } from "@/src/db/queries/recommendations";
import { setSubmissionStatus } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";

export type RecommendDeps = {
  getAnalysis: (submissionId: string) => Promise<{ analysis: VideoAnalysis; brief: MusicBrief } | null>;
  generate: (brief: MusicBrief, analysis: VideoAnalysis, opts?: { note?: string }) => Promise<GeneratedCandidate[]>;
  verify: (cands: GeneratedCandidate[]) => Promise<{ verified: VerifiedCandidate[]; unverified: GeneratedCandidate[] }>;
  score: (analysis: VideoAnalysis, brief: MusicBrief, cands: VerifiedCandidate[]) => Promise<ScoredCandidate[]>;
  diversify: (scored: ScoredCandidate[]) => Pick[];
  sections: (picks: Pick[], analysis: VideoAnalysis) => Pick[];
  explain: (picks: Pick[], analysis: VideoAnalysis, brief: MusicBrief) => Promise<FinalRecommendation[]>;
  replaceCandidates: (submissionId: string, rows: CandidateRow[]) => Promise<{ id: string; deezer_id: string | null }[]>;
  replaceRecommendations: (submissionId: string, rows: RecommendationRow[]) => Promise<void>;
  setStatus: (id: string, status: SubmissionStatus, error?: string) => Promise<void>;
  logEvent: typeof logEvent;
};

const defaultDeps: RecommendDeps = {
  getAnalysis,
  generate: generateCandidates,
  verify: verifyCandidates,
  score: scoreCandidates,
  diversify,
  sections: selectSections,
  explain: explainPicks,
  replaceCandidates,
  replaceRecommendations,
  setStatus: setSubmissionStatus,
  logEvent,
};

const RETRY_NOTE = "Previous suggestions could not be found on Deezer; propose different, well-known songs by the original artists.";

function toCandidateRow(submissionId: string, c: GeneratedCandidate | ScoredCandidate, verified: boolean): CandidateRow {
  const s = c as Partial<ScoredCandidate>;
  return {
    submission_id: submissionId,
    title: c.title,
    artist: c.artist,
    deezer_id: s.deezer_id ?? null,
    itunes_id: null,
    duration_seconds: s.duration_seconds ?? null,
    verified,
    proposed_start: c.proposed_start,
    proposed_end: c.proposed_end,
    generator_reason: `${c.section_reason} / ${c.fit_reason}`,
    direction: c.direction,
    component_scores: s.component_scores ?? null,
    total_score: s.total_score ?? null,
    prompt_version: verified ? `${CANDIDATES_VERSION}+${SCORING_VERSION}` : CANDIDATES_VERSION,
  };
}

function toRecommendationRow(submissionId: string, candidateId: string | null, r: FinalRecommendation): RecommendationRow {
  return {
    submission_id: submissionId,
    candidate_id: candidateId,
    rank: r.rank,
    direction_label: r.direction_label,
    title: r.title,
    artist: r.artist,
    start_seconds: r.start_seconds,
    end_seconds: r.end_seconds,
    explanation: r.explanation,
    spotify_url: r.spotify_url,
    deezer_url: r.deezer_url || null,
    artwork_url: r.artwork_url,
    preview_url: r.preview_url,
  };
}

export async function recommendSubmission(submissionId: string, deps: RecommendDeps = defaultDeps): Promise<void> {
  const started = Date.now();
  const stored = await deps.getAnalysis(submissionId);
  if (!stored) throw new PipelineError("recommend", "no analysis stored for submission");
  const { analysis, brief } = stored;

  let generated = await deps.generate(brief, analysis);
  let { verified, unverified } = await deps.verify(generated);
  if (verified.length < 3) {
    logger.warn("recommend: regenerating, too few verified", { submissionId, verified: verified.length });
    generated = await deps.generate(brief, analysis, { note: RETRY_NOTE });
    ({ verified, unverified } = await deps.verify(generated));
  }

  const scored = await deps.score(analysis, brief, verified);
  const rows: CandidateRow[] = [
    ...scored.map((c) => toCandidateRow(submissionId, c, true)),
    ...unverified.map((c) => toCandidateRow(submissionId, c, false)),
  ];
  const inserted = await deps.replaceCandidates(submissionId, rows);
  const idByDeezer = new Map(inserted.filter((r) => r.deezer_id).map((r) => [r.deezer_id as string, r.id]));

  const picks = deps.sections(deps.diversify(scored), analysis);
  const finals = await deps.explain(picks, analysis, brief);

  await deps.replaceRecommendations(
    submissionId,
    finals.map((r) => toRecommendationRow(submissionId, idByDeezer.get(r.deezer_id) ?? null, r)),
  );
  await deps.setStatus(submissionId, "ready");
  await deps.logEvent({
    name: "recommendations_ready", submissionId,
    metadata: { candidates: rows.length, verified: verified.length, ms: Date.now() - started },
  });
}
```

`setSubmissionStatus(id, "ready")` (Phase 0) must also set `recommended_at = now()` when status is `ready`; if the Phase 0 implementation does not, add that branch there now:

```ts
// in src/db/queries/submissions.ts, inside setSubmissionStatus
const patch: Record<string, unknown> = { status, error: error ?? null };
if (status === "recommending") patch.analyzed_at = new Date().toISOString();
if (status === "ready") patch.recommended_at = new Date().toISOString();
```

- [ ] **Step 6: Wire into the pipeline**

```ts
// src/pipeline/run.ts  (replace the body written in Phase 2 with this)
import { analyzeSubmission } from "@/src/analysis";
import { recommendSubmission } from "@/src/engine/recommend";
import { getSubmission, setSubmissionStatus } from "@/src/db/queries/submissions";
import { logEvent } from "@/src/feedback/events";
import { PipelineError } from "@/src/shared/errors";
import { logger } from "@/src/shared/logger";

/** Resumable: picks up from the submission's current status. Safe to call again after a failure. */
export async function runSubmission(submissionId: string): Promise<void> {
  const sub = await getSubmission(submissionId);
  if (!sub) throw new Error(`submission ${submissionId} not found`);

  let stage: "analyze" | "recommend" =
    sub.status === "uploaded" || sub.status === "analyzing" ? "analyze" : "recommend";
  if (sub.status === "failed") stage = sub.error?.startsWith("recommend:") ? "recommend" : "analyze";
  if (sub.status === "ready") return;

  try {
    if (stage === "analyze") {
      await setSubmissionStatus(submissionId, "analyzing");
      await analyzeSubmission(submissionId);
      await setSubmissionStatus(submissionId, "recommending");
    } else {
      await setSubmissionStatus(submissionId, "recommending");
    }
    await recommendSubmission(submissionId);
  } catch (err) {
    const e = err instanceof PipelineError ? err : new PipelineError(stage, err instanceof Error ? err.message : String(err));
    logger.error("pipeline failed", { submissionId, stage: e.stage, message: e.message });
    await setSubmissionStatus(submissionId, "failed", `${e.stage}: ${e.message}`);
    await logEvent({ name: "pipeline_failed", submissionId, metadata: { stage: e.stage, error: e.message } });
    throw e;
  }
}
```

- [ ] **Step 7: Run tests**

Run: `pnpm test -- tests/engine`
Expected: PASS, all engine tests (recommend: 2).

- [ ] **Step 8: Commit**

```bash
pnpm typecheck && git add src/db src/engine/recommend.ts src/pipeline/run.ts tests/engine/recommend.test.ts
git commit -m "Add recommendation orchestrator and wire it into the pipeline"
```

---

### Task 3.11: Results page and recommendation cards

**Files:**
- Create: `src/shared/format.ts`, `components/RecommendationCard.tsx`, `components/ResultsView.tsx`
- Modify: `app/api/submissions/[id]/route.ts`, `app/results/[id]/page.tsx`
- Modify: `src/db/queries/submissions.ts` (add `markViewed`)
- Test: `tests/shared/format.test.ts`

**Interfaces:**
- Consumes: `listRecommendations` (Task 3.10), `getSubmission`, `getCreator` (Phase 1), `logEvent`, `<WaitingState submissionId>` (Phase 1).
- Produces:
  ```ts
  export function formatTime(seconds: number): string;             // "0:43"
  export type RecommendationView = { rank: number; direction_label: string; title: string; artist: string; start_seconds: number; end_seconds: number; explanation: string; artwork_url: string | null; preview_url: string | null; spotify_url: string };
  // GET /api/submissions/[id] → { status: SubmissionStatus; recommendations: RecommendationView[] }
  ```

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/shared/format.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `formatTime`**

```ts
// src/shared/format.ts
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/shared/format.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Return recommendations from the status route**

```ts
// app/api/submissions/[id]/route.ts
import { NextResponse } from "next/server";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import { listRecommendations } from "@/src/db/queries/recommendations";

export type RecommendationView = {
  rank: number; direction_label: string; title: string; artist: string;
  start_seconds: number; end_seconds: number; explanation: string;
  artwork_url: string | null; preview_url: string | null; spotify_url: string;
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sub = await getSubmission(id);
  if (!sub || sub.creator_id !== creator.id) return NextResponse.json({ error: "not found" }, { status: 404 });

  const recommendations: RecommendationView[] =
    sub.status === "ready"
      ? (await listRecommendations(id)).map((r) => ({
          rank: r.rank, direction_label: r.direction_label, title: r.title, artist: r.artist,
          start_seconds: Number(r.start_seconds), end_seconds: Number(r.end_seconds),
          explanation: r.explanation, artwork_url: r.artwork_url, preview_url: r.preview_url, spotify_url: r.spotify_url,
        }))
      : [];
  return NextResponse.json({ status: sub.status, recommendations });
}
```

- [ ] **Step 6: Add `markViewed` and render the results page**

```ts
// add to src/db/queries/submissions.ts
/** Sets viewed_at once; returns true the first time. */
export async function markViewed(id: string): Promise<boolean> {
  const db = createServiceClient();
  const res = await db.from("submissions").update({ viewed_at: new Date().toISOString() })
    .eq("id", id).is("viewed_at", null).select("id");
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
import { logEvent } from "@/src/feedback/events";
import { WaitingState } from "@/components/WaitingState";
import { ResultsView } from "@/components/ResultsView";

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const creator = await getCreator();
  if (!creator) redirect(`/?next=/results/${id}`);
  const sub = await getSubmission(id);
  if (!sub || sub.creator_id !== creator.id) notFound();

  if (sub.status !== "ready") return <WaitingState submissionId={id} />;

  if (await markViewed(id)) {
    await logEvent({ name: "recommendations_viewed", creatorId: creator.id, submissionId: id });
  }
  const recs = (await listRecommendations(id)).map((r) => ({
    rank: r.rank, direction_label: r.direction_label, title: r.title, artist: r.artist,
    start_seconds: Number(r.start_seconds), end_seconds: Number(r.end_seconds),
    explanation: r.explanation, artwork_url: r.artwork_url, preview_url: r.preview_url, spotify_url: r.spotify_url,
  }));
  return <ResultsView submissionId={id} recommendations={recs} />;
}
```

```tsx
// components/ResultsView.tsx
"use client";
import { useState } from "react";
import { RecommendationCard } from "@/components/RecommendationCard";
import type { RecommendationView } from "@/app/api/submissions/[id]/route";

export function ResultsView({ submissionId, recommendations }: { submissionId: string; recommendations: RecommendationView[] }) {
  // Phase 4 replaces these local-state handlers with calls to /api/submissions/[id]/feedback.
  const [selected, setSelected] = useState<number | null>(null);
  const [rejected, setRejected] = useState<Set<number>>(new Set());
  void submissionId;

  const visible = selected === null ? recommendations : recommendations.filter((r) => r.rank === selected);
  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your Songfit</h1>
      <p className="mt-1 text-sm text-ink/60">Three songs that fit this video. Tap one to use it.</p>
      <div className="mt-6 flex flex-col gap-4">
        {visible.map((r) => (
          <RecommendationCard
            key={r.rank}
            rec={r}
            featured={r.rank === 1}
            state={selected === r.rank ? "selected" : rejected.has(r.rank) ? "rejected" : "idle"}
            onSelect={(rank) => setSelected(rank)}
            onReject={(rank) => setRejected((s) => new Set(s).add(rank))}
          />
        ))}
      </div>
    </main>
  );
}
```

```tsx
// components/RecommendationCard.tsx
"use client";
import { useRef, useState } from "react";
import { formatTime } from "@/src/shared/format";
import type { RecommendationView } from "@/app/api/submissions/[id]/route";

type Props = {
  rec: RecommendationView;
  featured: boolean;
  state: "idle" | "selected" | "rejected";
  onSelect: (rank: number) => void;
  onReject: (rank: number) => void;
};

export function RecommendationCard({ rec, featured, state, onSelect, onReject }: Props) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); } else { void el.play(); setPlaying(true); }
  };

  return (
    <article
      className={[
        "rounded-2xl border border-ink/10 bg-white p-4 shadow-sm transition",
        featured ? "p-5" : "",
        state === "rejected" ? "opacity-40" : "",
      ].join(" ")}
    >
      <div className="flex gap-4">
        {rec.artwork_url ? (
          <img src={rec.artwork_url} alt="" className={featured ? "h-24 w-24 rounded-xl object-cover" : "h-16 w-16 rounded-lg object-cover"} />
        ) : (
          <div className={featured ? "h-24 w-24 rounded-xl bg-ink/5" : "h-16 w-16 rounded-lg bg-ink/5"} />
        )}
        <div className="min-w-0 flex-1">
          <span className="inline-block rounded-full bg-steel/10 px-2 py-0.5 text-xs font-medium text-steel">
            #{rec.rank} {rec.direction_label}
          </span>
          <h2 className={featured ? "mt-1 truncate text-lg font-semibold text-ink" : "mt-1 truncate font-semibold text-ink"}>{rec.title}</h2>
          <p className="truncate text-sm text-ink/60">{rec.artist}</p>
          <p className="mt-2 text-base font-bold text-ink">
            Use {formatTime(rec.start_seconds)}–{formatTime(rec.end_seconds)}
          </p>
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
        <a href={rec.spotify_url} target="_blank" rel="noopener noreferrer" className="text-steel underline-offset-2 hover:underline">
          Open in Spotify
        </a>
      </div>

      {state !== "selected" && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onSelect(rec.rank)} className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white">
            Use this
          </button>
          <button type="button" onClick={() => onReject(rec.rank)} className="rounded-xl border border-ink/15 px-4 py-3 text-sm font-medium text-ink">
            Not for me
          </button>
        </div>
      )}
      {state === "selected" && <p className="mt-4 text-sm font-medium text-steel">Chosen. Go make it.</p>}
    </article>
  );
}
```

Tailwind colour tokens `ink` (near-black `#141821`) and `steel` (`#5B7394`) are defined in `tailwind.config.ts` in Phase 0 (Task 0.2). If they are missing, add them there now:

```ts
// tailwind.config.ts → theme.extend.colors
colors: { ink: "#141821", steel: "#5B7394" },
```

- [ ] **Step 7: Check it renders**

Run: `pnpm typecheck && pnpm dev`, then open `/results/<id of a ready submission>` on a phone-width viewport (DevTools, 390 px).
Expected: heading "Your Songfit", three cards with #1 larger, "Use m:ss–m:ss" in bold, a working preview button where a preview exists, "Open in Spotify" opens a Spotify search in a new tab, "Use this" collapses to one card, "Not for me" dims a card. Refreshing does not log a second `recommendations_viewed` event (check the `events` table).

- [ ] **Step 8: Commit**

```bash
git add src/shared/format.ts tests/shared/format.test.ts components/RecommendationCard.tsx components/ResultsView.tsx app/results app/api/submissions src/db/queries/submissions.ts tailwind.config.ts
git commit -m "Add results page with recommendation cards and previews"
```

---

### Task 3.12: Admin inspector: candidates and final picks

**Files:**
- Create: `components/admin/CandidatesTable.tsx`
- Modify: `app/admin/submissions/[id]/page.tsx`

**Interfaces:**
- Consumes: `listCandidates` (Task 3.10), `listRecommendations`, `requireAdmin` (Phase 1), the existing inspector page from Phase 2 (video, analysis JSON, brief, transcript).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Write the table component**

```tsx
// components/admin/CandidatesTable.tsx
import { DIMENSIONS, type ComponentScores } from "@/src/shared/types";
import { formatTime } from "@/src/shared/format";

type Row = {
  id: string; title: string; artist: string; direction: string; verified: boolean;
  proposed_start: number; proposed_end: number; total_score: number | null;
  component_scores: ComponentScores | null; generator_reason: string; deezer_id: string | null;
};

export function CandidatesTable({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left">
            <th className="p-1">#</th><th className="p-1">Song</th><th className="p-1">Dir</th><th className="p-1">Verified</th>
            <th className="p-1">Section</th><th className="p-1">Total</th>
            {DIMENSIONS.map((d) => <th key={d} className="p-1">{d.slice(0, 4)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.verified ? "" : "text-gray-400"}>
              <td className="p-1">{i + 1}</td>
              <td className="p-1" title={r.generator_reason}>{r.title} — {r.artist}</td>
              <td className="p-1">{r.direction}</td>
              <td className="p-1">{r.verified ? "yes" : "no"}</td>
              <td className="p-1">{formatTime(Number(r.proposed_start))}–{formatTime(Number(r.proposed_end))}</td>
              <td className="p-1 font-mono">{r.total_score === null ? "—" : Number(r.total_score).toFixed(2)}</td>
              {DIMENSIONS.map((d) => {
                const s = r.component_scores?.[d];
                return (
                  <td key={d} className="p-1 font-mono" title={s?.reason ?? ""}>
                    {s ? s.score.toFixed(2) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Add the sections to the inspector page**

In `app/admin/submissions/[id]/page.tsx` (created in Phase 2), import and add after the brief/transcript sections:

```tsx
import { listCandidates } from "@/src/db/queries/candidates";
import { listRecommendations } from "@/src/db/queries/recommendations";
import { CandidatesTable } from "@/components/admin/CandidatesTable";
import { formatTime } from "@/src/shared/format";
import type { ComponentScores } from "@/src/shared/types";

// inside the component, after loading the submission:
const [candidates, recs] = await Promise.all([listCandidates(id), listRecommendations(id)]);

// in the JSX, after the analysis sections:
<section className="mt-8">
  <h2 className="text-lg font-semibold">Final 3</h2>
  {recs.length === 0 ? <p className="text-sm text-gray-500">none yet</p> : (
    <ol className="mt-2 space-y-2 text-sm">
      {recs.map((r) => (
        <li key={r.id}>
          <b>#{r.rank} {r.direction_label}</b>: {r.title} — {r.artist}, use {formatTime(Number(r.start_seconds))}–{formatTime(Number(r.end_seconds))}
          <div className="text-gray-600">{r.explanation}</div>
        </li>
      ))}
    </ol>
  )}
</section>
<section className="mt-8">
  <h2 className="text-lg font-semibold">Candidates ({candidates.length}, {candidates.filter((c) => c.verified).length} verified)</h2>
  <CandidatesTable rows={candidates.map((c) => ({
    id: c.id, title: c.title, artist: c.artist, direction: c.direction, verified: c.verified,
    proposed_start: Number(c.proposed_start), proposed_end: Number(c.proposed_end),
    total_score: c.total_score === null ? null : Number(c.total_score),
    component_scores: c.component_scores as ComponentScores | null,
    generator_reason: c.generator_reason, deezer_id: c.deezer_id,
  }))} />
</section>
```

- [ ] **Step 3: Check it renders**

Run: `pnpm typecheck && pnpm dev`, open `/admin/submissions/<id>` as the admin.
Expected: a "Final 3" list and a candidates table sorted by total with unverified rows greyed out; hovering a score cell shows its reason.

- [ ] **Step 4: Commit**

```bash
git add components/admin/CandidatesTable.tsx app/admin/submissions
git commit -m "Show candidates with component scores and final picks in admin inspector"
```

---

### Phase 3 demo check

Do this with real keys in `.env.local` and the local Supabase running.

- [ ] 1. Upload a real 20–60 s Reel from the upload screen (Phase 1 flow). Note the submission id from the URL.
- [ ] 2. Watch `pnpm dev` logs: `verifyCandidates { total: ~70, verified: ~55-65 }`, then `recommendations_ready` with `ms`. Record elapsed time. Target: under 120 s.
- [ ] 3. Results page: 3 real songs. For each, open the Spotify link and confirm the song exists by that artist. Confirm `start_seconds < end_seconds <= duration_seconds` (check in admin). Play each preview.
- [ ] 4. Admin inspector: candidates table shows roughly 60 scored rows plus greyed unverified rows; the three directions are all represented among verified rows; scores are not all identical (if they cluster at 0.7, tighten the scoring prompt's "use the full range" instruction and bump `PROMPT_VERSION` to `scoring-v2`).
- [ ] 5. Cost: from the Anthropic console, record tokens for this run. Expected order of magnitude: 3 candidate calls (~4k out each), 1 scoring call (~15k in / 8k out), 1 explain call. Write the per-run cost and elapsed time into `docs/RESEARCH.md` under a new dated entry "First end-to-end run".
- [ ] 6. Run the whole suite: `pnpm typecheck && pnpm test`. Expected: all green.
- [ ] 7. Commit any prompt tweaks with bumped `PROMPT_VERSION` constants.
## Phase 4 — Feedback, paywall, admin metrics, launch

**Demo when done:** on thissongfits.com from a phone: upload → results → "Use this" → offer → pay (Stripe test mode) → thanks → second upload allowed. A second creator who has not paid hits `/subscribe` on their second upload. `/admin/metrics` shows the funnel.

Assumes Phases 0–3 are merged: full pipeline, `app/results/[id]/page.tsx` rendering `RecommendationCard` with `onSelect(rank)` / `onReject(rank)` props, `logEvent` in `src/feedback/events.ts`, `canSubmit` in `src/billing/paywall.ts`, queries `insertEvent`, `getActiveSubscription`, `activateSubscription`, `listSubmissions`, `getSubmission`, `getCreator`, `requireAdmin`, admin queue and inspector pages.

---

### Task 4.1: Feedback actions, migration and API route

**Files:**
- Create: `supabase/migrations/0004_feedback.sql`
- Create: `src/feedback/actions.ts`
- Create: `app/api/submissions/[id]/feedback/route.ts`
- Modify: `src/db/queries/recommendations.ts` (add `markRecommendation`)
- Modify: `docs/DATA_MODEL.md` (recommendations table, new `stripe_events` table)
- Test: `tests/feedback/actions.test.ts`

**Interfaces:**
- Consumes: `logEvent({ name, creatorId, submissionId, metadata })` from `src/feedback/events.ts`; `getSubmission(id)` from `src/db/queries/submissions.ts` returning `{ id, creator_id, status, ... } | null`; `createServiceClient()` from `src/db/client.ts`; `getCreator()` from `src/auth/session.ts`.
- Produces:
  ```ts
  // src/db/queries/recommendations.ts
  export async function markRecommendation(submissionId: string, rank: 1 | 2 | 3, patch: { selected?: boolean; rejected?: boolean }): Promise<void>;
  // src/feedback/actions.ts
  export type FeedbackAction = "select" | "reject" | "all_rejected" | "offer_viewed" | "offer_clicked";
  export async function selectRecommendation(submissionId: string, rank: 1 | 2 | 3, creatorId: string): Promise<void>;
  export async function rejectRecommendation(submissionId: string, rank: 1 | 2 | 3, creatorId: string): Promise<void>;
  export async function allRejected(submissionId: string, creatorId: string): Promise<void>;
  export async function offerViewed(submissionId: string, creatorId: string): Promise<void>;
  export async function offerClicked(submissionId: string, creatorId: string): Promise<void>;
  ```
  Route: `POST /api/submissions/[id]/feedback` body `{ action: FeedbackAction; rank?: 1|2|3 }` → `204`, `400` bad body, `401` signed out, `403` not owner, `404` no submission.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0004_feedback.sql`:

```sql
-- Feedback flags on recommendations
alter table recommendations
  add column selected boolean not null default false,
  add column rejected boolean not null default false;

-- Stripe webhook idempotency
create table stripe_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);
alter table stripe_events enable row level security;
-- service role only: no policies.
```

- [ ] **Step 2: Apply it and regenerate types**

Run: `pnpm db:reset && pnpm db:types`
Expected: `Finished supabase db reset` and `src/db/types.ts` now contains `selected: boolean` under `recommendations` and a `stripe_events` table.

- [ ] **Step 3: Update docs/DATA_MODEL.md**

In the `## recommendations` table append two rows after `preview_url`:

```markdown
| selected        | boolean     | default false, set by "Use this"        |
| rejected        | boolean     | default false, set by "Not for me"      |
```

After the `## subscriptions` section add:

```markdown
## stripe_events
Idempotency log for the Stripe webhook. One row per processed Stripe event id.

| column     | type        | notes                      |
|------------|-------------|----------------------------|
| id         | text        | Stripe event id, primary key |
| type       | text        | Stripe event type          |
| created_at | timestamptz |                            |

RLS: service role only.
```

- [ ] **Step 4: Write the failing test**

`tests/feedback/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const markRecommendation = vi.fn();
const logEvent = vi.fn();
vi.mock("@/src/db/queries/recommendations", () => ({ markRecommendation }));
vi.mock("@/src/feedback/events", () => ({ logEvent }));

import { selectRecommendation, rejectRecommendation, allRejected, offerViewed, offerClicked } from "@/src/feedback/actions";

describe("feedback actions", () => {
  beforeEach(() => { markRecommendation.mockReset(); logEvent.mockReset(); });

  it("select marks the row and logs recommendation_selected with rank", async () => {
    await selectRecommendation("sub-1", 2, "cre-1");
    expect(markRecommendation).toHaveBeenCalledWith("sub-1", 2, { selected: true });
    expect(logEvent).toHaveBeenCalledWith({ name: "recommendation_selected", creatorId: "cre-1", submissionId: "sub-1", metadata: { rank: 2 } });
  });

  it("reject marks the row and logs recommendation_rejected with rank", async () => {
    await rejectRecommendation("sub-1", 3, "cre-1");
    expect(markRecommendation).toHaveBeenCalledWith("sub-1", 3, { rejected: true });
    expect(logEvent).toHaveBeenCalledWith({ name: "recommendation_rejected", creatorId: "cre-1", submissionId: "sub-1", metadata: { rank: 3 } });
  });

  it("allRejected logs all_rejected then more_like_this_requested", async () => {
    await allRejected("sub-1", "cre-1");
    expect(logEvent.mock.calls.map((c) => c[0].name)).toEqual(["all_rejected", "more_like_this_requested"]);
  });

  it("offer events log paid_offer_viewed / paid_offer_clicked", async () => {
    await offerViewed("sub-1", "cre-1");
    await offerClicked("sub-1", "cre-1");
    expect(logEvent.mock.calls.map((c) => c[0].name)).toEqual(["paid_offer_viewed", "paid_offer_clicked"]);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm vitest run tests/feedback/actions.test.ts`
Expected: FAIL — `Cannot find module '@/src/feedback/actions'`.

- [ ] **Step 6: Add the query**

Append to `src/db/queries/recommendations.ts`:

```ts
export async function markRecommendation(
  submissionId: string,
  rank: 1 | 2 | 3,
  patch: { selected?: boolean; rejected?: boolean },
): Promise<void> {
  const db = createServiceClient();
  const { error } = await db
    .from("recommendations")
    .update(patch)
    .eq("submission_id", submissionId)
    .eq("rank", rank);
  if (error) throw new Error(`markRecommendation: ${error.message}`);
}
```

(`createServiceClient` is already imported at the top of that file from `../client`.)

- [ ] **Step 7: Write the actions**

`src/feedback/actions.ts`:

```ts
import { markRecommendation } from "@/src/db/queries/recommendations";
import { logEvent } from "@/src/feedback/events";

export type FeedbackAction = "select" | "reject" | "all_rejected" | "offer_viewed" | "offer_clicked";
export type Rank = 1 | 2 | 3;

export async function selectRecommendation(submissionId: string, rank: Rank, creatorId: string): Promise<void> {
  await markRecommendation(submissionId, rank, { selected: true });
  await logEvent({ name: "recommendation_selected", creatorId, submissionId, metadata: { rank } });
}

export async function rejectRecommendation(submissionId: string, rank: Rank, creatorId: string): Promise<void> {
  await markRecommendation(submissionId, rank, { rejected: true });
  await logEvent({ name: "recommendation_rejected", creatorId, submissionId, metadata: { rank } });
}

export async function allRejected(submissionId: string, creatorId: string): Promise<void> {
  await logEvent({ name: "all_rejected", creatorId, submissionId });
  await logEvent({ name: "more_like_this_requested", creatorId, submissionId });
}

export async function offerViewed(submissionId: string, creatorId: string): Promise<void> {
  await logEvent({ name: "paid_offer_viewed", creatorId, submissionId });
}

export async function offerClicked(submissionId: string, creatorId: string): Promise<void> {
  await logEvent({ name: "paid_offer_clicked", creatorId, submissionId });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm vitest run tests/feedback/actions.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Write the route**

`app/api/submissions/[id]/feedback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCreator } from "@/src/auth/session";
import { getSubmission } from "@/src/db/queries/submissions";
import {
  selectRecommendation, rejectRecommendation, allRejected, offerViewed, offerClicked,
} from "@/src/feedback/actions";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select"), rank: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ action: z.literal("reject"), rank: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  z.object({ action: z.literal("all_rejected") }),
  z.object({ action: z.literal("offer_viewed") }),
  z.object({ action: z.literal("offer_clicked") }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const creator = await getCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const submission = await getSubmission(id);
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.creator_id !== creator.id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = parsed.data;
  switch (body.action) {
    case "select": await selectRecommendation(id, body.rank, creator.id); break;
    case "reject": await rejectRecommendation(id, body.rank, creator.id); break;
    case "all_rejected": await allRejected(id, creator.id); break;
    case "offer_viewed": await offerViewed(id, creator.id); break;
    case "offer_clicked": await offerClicked(id, creator.id); break;
  }
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 10: Typecheck and manual check**

Run: `pnpm typecheck && pnpm test`
Expected: no type errors, all tests pass.

Run (with `pnpm dev` up and a signed-in browser session; copy the `sb-*` cookie value from devtools, or use the browser console):

```js
await fetch("/api/submissions/<a ready submission id>/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "select", rank: 1 }) }).then(r => r.status)
```
Expected: `204`, and in Supabase Studio the `recommendations` row with rank 1 has `selected = true` and `events` has a `recommendation_selected` row.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/0004_feedback.sql src/db/types.ts src/db/queries/recommendations.ts src/feedback/actions.ts app/api/submissions/[id]/feedback/route.ts tests/feedback/actions.test.ts docs/DATA_MODEL.md
git commit -m "Add feedback actions, flags and API route"
```

---

### Task 4.2: Results state reducer and client wiring

**Files:**
- Create: `src/feedback/resultsState.ts`
- Create: `components/ResultsClient.tsx`
- Modify: `app/results/[id]/page.tsx` (render `ResultsClient` instead of mapping cards directly)
- Test: `tests/feedback/resultsState.test.ts`

**Interfaces:**
- Consumes: `RecommendationCard` props `{ rec: FinalRecommendation; onSelect: (rank: 1|2|3) => void; onReject: (rank: 1|2|3) => void; collapsed?: boolean; chosen?: boolean }` (add `collapsed`/`chosen` props to the card in this task if Phase 3 did not include them: `collapsed` hides everything but title/artist, `chosen` shows a "Your pick" badge and hides the buttons). `Offer` from Task 4.3 (create a stub in this task's Step 7 if executing out of order).
- Produces:
  ```ts
  // src/feedback/resultsState.ts
  export type ResultsState = { chosen: 1 | 2 | 3 | null; rejected: Set<1 | 2 | 3>; showOffer: boolean; allRejected: boolean };
  export type ResultsAction = { type: "select"; rank: 1 | 2 | 3 } | { type: "reject"; rank: 1 | 2 | 3 };
  export const initialResultsState: ResultsState;
  export function nextResultsState(state: ResultsState, action: ResultsAction): ResultsState;
  ```

- [ ] **Step 1: Write the failing test**

`tests/feedback/resultsState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { initialResultsState, nextResultsState } from "@/src/feedback/resultsState";

describe("nextResultsState", () => {
  it("select sets chosen and shows the offer", () => {
    const s = nextResultsState(initialResultsState, { type: "select", rank: 2 });
    expect(s.chosen).toBe(2);
    expect(s.showOffer).toBe(true);
    expect(s.allRejected).toBe(false);
  });

  it("rejecting one does not show the offer", () => {
    const s = nextResultsState(initialResultsState, { type: "reject", rank: 1 });
    expect(s.rejected.has(1)).toBe(true);
    expect(s.showOffer).toBe(false);
  });

  it("rejecting all three sets allRejected and shows the offer", () => {
    let s = initialResultsState;
    s = nextResultsState(s, { type: "reject", rank: 1 });
    s = nextResultsState(s, { type: "reject", rank: 2 });
    s = nextResultsState(s, { type: "reject", rank: 3 });
    expect(s.allRejected).toBe(true);
    expect(s.showOffer).toBe(true);
  });

  it("select after a chosen pick is ignored", () => {
    let s = nextResultsState(initialResultsState, { type: "select", rank: 1 });
    s = nextResultsState(s, { type: "select", rank: 3 });
    expect(s.chosen).toBe(1);
  });

  it("rejecting the chosen pick is ignored", () => {
    let s = nextResultsState(initialResultsState, { type: "select", rank: 1 });
    s = nextResultsState(s, { type: "reject", rank: 1 });
    expect(s.rejected.size).toBe(0);
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
export type ResultsState = { chosen: Rank | null; rejected: Set<Rank>; showOffer: boolean; allRejected: boolean };
export type ResultsAction = { type: "select"; rank: Rank } | { type: "reject"; rank: Rank };

export const initialResultsState: ResultsState = { chosen: null, rejected: new Set(), showOffer: false, allRejected: false };

export function nextResultsState(state: ResultsState, action: ResultsAction): ResultsState {
  if (state.chosen !== null) return state; // once chosen, nothing changes
  if (action.type === "select") {
    return { ...state, chosen: action.rank, showOffer: true, allRejected: false };
  }
  const rejected = new Set(state.rejected);
  rejected.add(action.rank);
  const all = rejected.size === 3;
  return { ...state, rejected, allRejected: all, showOffer: state.showOffer || all };
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
import type { FinalRecommendation } from "@/src/shared/types";
import { initialResultsState, nextResultsState, type Rank } from "@/src/feedback/resultsState";
import { RecommendationCard } from "@/components/RecommendationCard";
import { Offer } from "@/components/Offer";

type Props = { submissionId: string; recs: FinalRecommendation[]; creatorEmail: string; creatorId: string };

async function post(submissionId: string, body: Record<string, unknown>) {
  await fetch(`/api/submissions/${submissionId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined); // feedback is best-effort for the UI
}

export function ResultsClient({ submissionId, recs, creatorEmail, creatorId }: Props) {
  const [state, dispatch] = useReducer(nextResultsState, initialResultsState);

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

In `app/results/[id]/page.tsx`, where Phase 3 rendered the three cards, replace that block with:

```tsx
<ResultsClient
  submissionId={submission.id}
  recs={recommendations}
  creatorEmail={creator.email}
  creatorId={creator.id}
/>
```

and add `import { ResultsClient } from "@/components/ResultsClient";`. The page already has `creator` from `getCreator()` and `recommendations` as `FinalRecommendation[]`.

If `RecommendationCard` lacks `chosen`/`collapsed`, add to its props and render:

```tsx
// in RecommendationCard props type
chosen?: boolean;
collapsed?: boolean;
// in the JSX, at the top of the card
{chosen && <span className="rounded-full bg-black px-3 py-1 text-xs text-white">Your pick</span>}
// wrap the explanation, preview, Spotify link and buttons in:
{!collapsed && ( ...existing body... )}
// hide buttons when chosen:
{!chosen && !collapsed && ( ...Use this / Not for me buttons... )}
```

- [ ] **Step 7: Temporary Offer stub (only if Task 4.3 is not done yet)**

`components/Offer.tsx`:

```tsx
"use client";
export function Offer(_: { submissionId: string; creatorEmail: string; creatorId: string }) {
  return <div className="rounded-2xl border p-6 text-center">Offer goes here.</div>;
}
```

Task 4.3 replaces this file.

- [ ] **Step 8: Typecheck, run, verify in the browser**

Run: `pnpm typecheck && pnpm test`
Expected: pass.

Run `pnpm dev`, open a ready `/results/<id>` on a 390 px wide viewport. Tap "Use this" on #2: #1 and #3 collapse to title/artist, #2 shows "Your pick", the offer block appears. Reload, tap "Not for me" on all three: the "Want 3 different directions?" line and the offer appear. In Supabase Studio `events` contains `recommendation_selected`, `recommendation_rejected` ×3, `all_rejected`, `more_like_this_requested`.

- [ ] **Step 9: Commit**

```bash
git add src/feedback/resultsState.ts components/ResultsClient.tsx components/RecommendationCard.tsx components/Offer.tsx app/results/[id]/page.tsx tests/feedback/resultsState.test.ts
git commit -m "Wire results feedback with a state reducer and client wrapper"
```

---

### Task 4.3: Offer component and paywall pages

**Files:**
- Create (replace stub): `components/Offer.tsx`
- Create: `src/billing/paymentLink.ts`
- Create: `app/subscribe/page.tsx`
- Create: `app/subscribe/thanks/page.tsx`
- Modify: `.env.example` (add `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`)
- Test: `tests/billing/paymentLink.test.ts`

**Interfaces:**
- Consumes: `getCreator()`; `redirect` from `next/navigation`; `UploadForm` already redirects to `/subscribe` when `POST /api/upload-url` returns 402 (Phase 1).
- Produces:
  ```ts
  // src/billing/paymentLink.ts
  export function buildPaymentLink(base: string, creatorEmail: string, creatorId: string): string;
  // components/Offer.tsx
  export function Offer(props: { submissionId: string | null; creatorEmail: string; creatorId: string; headline?: string }): JSX.Element;
  ```
  Env: `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL` (public: it is a public Stripe URL; being `NEXT_PUBLIC_` lets the client component build the link).

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

- [ ] **Step 5: Write the Offer component**

`components/Offer.tsx` (replaces the Task 4.2 stub):

```tsx
"use client";
import { useEffect, useRef } from "react";
import { buildPaymentLink } from "@/src/billing/paymentLink";

type Props = { submissionId: string | null; creatorEmail: string; creatorId: string; headline?: string };

function track(submissionId: string | null, action: "offer_viewed" | "offer_clicked") {
  if (!submissionId) return;
  void fetch(`/api/submissions/${submissionId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
    keepalive: true,
  }).catch(() => undefined);
}

export function Offer({ submissionId, creatorEmail, creatorId, headline = "Want Songfit for your next posts?" }: Props) {
  const base = process.env.NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL ?? "";
  const href = base ? buildPaymentLink(base, creatorEmail, creatorId) : "#";
  const viewed = useRef(false);

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track(submissionId, "offer_viewed");
  }, [submissionId]);

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
      <h2 className="text-xl font-semibold tracking-tight">{headline}</h2>
      <p className="mt-2 text-neutral-600">$9.99/month, cancel anytime.</p>
      <a
        href={href}
        onClick={() => track(submissionId, "offer_clicked")}
        className="mt-5 inline-block w-full rounded-full bg-black px-6 py-3 text-base font-medium text-white"
      >
        Get Songfit
      </a>
    </section>
  );
}
```

- [ ] **Step 6: Write the paywall pages**

`app/subscribe/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCreator } from "@/src/auth/session";
import { Offer } from "@/components/Offer";
import { Logo } from "@/components/Logo";

export default async function SubscribePage() {
  const creator = await getCreator();
  if (!creator) redirect("/?signin=1");
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Logo />
      <p className="text-center text-neutral-700">You&apos;ve used your free Songfit. Subscribe to keep going.</p>
      <Offer submissionId={null} creatorEmail={creator.email} creatorId={creator.id} headline="Songfit for every post" />
    </main>
  );
}
```

`app/subscribe/thanks/page.tsx`:

```tsx
import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function ThanksPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <Logo />
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re in.</h1>
      <p className="text-neutral-700">Upload your next video.</p>
      <Link href="/" className="rounded-full bg-black px-6 py-3 font-medium text-white">Find my songs</Link>
    </main>
  );
}
```

`?signin=1` on `/`: `UploadForm` (Phase 1) opens Google sign-in when the button is tapped; if the Phase 1 form does not already read this param, add in `UploadForm`:

```tsx
useEffect(() => {
  if (new URLSearchParams(window.location.search).get("signin") === "1") void signInWithGoogle();
}, []);
```

- [ ] **Step 7: Env example**

Append to `.env.example`:

```
# Stripe
NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL=https://buy.stripe.com/test_replace_me
STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
```

- [ ] **Step 8: Typecheck and verify**

Run: `pnpm typecheck && pnpm test`
Expected: pass.

Run `pnpm dev`; sign in as a creator who already has one ready submission; tap "Find my songs" with a new file. Expected: redirected to `/subscribe`, offer shows, `events` gets `paid_offer_viewed` only when a `submissionId` is present (on `/subscribe` it is null, so none; on results it logs). The "Get Songfit" link opens the Stripe test link with your email prefilled.

- [ ] **Step 9: Commit**

```bash
git add components/Offer.tsx src/billing/paymentLink.ts app/subscribe/page.tsx app/subscribe/thanks/page.tsx .env.example tests/billing/paymentLink.test.ts components/UploadForm.tsx
git commit -m "Add offer component and subscribe pages"
```

---

### Task 4.4: Stripe webhook

**Files:**
- Create: `src/billing/stripe.ts`
- Create: `app/api/stripe/webhook/route.ts`
- Modify: `src/db/queries/subscriptions.ts` (add `setSubscriptionStatusByStripeId`), `src/db/queries/creators.ts` (add `getCreatorByEmail`), create `src/db/queries/stripeEvents.ts`
- Test: `tests/billing/stripe.test.ts`

**Interfaces:**
- Consumes: `activateSubscription({ creatorId, stripeCustomerId, stripeSubscriptionId })` (Phase 1/3 query: upserts a `subscriptions` row with `status = 'active'`, `started_at = now()`); `logEvent`.
- Produces:
  ```ts
  // src/db/queries/stripeEvents.ts
  export async function claimStripeEvent(id: string, type: string): Promise<boolean>; // true if newly inserted, false if already processed
  // src/db/queries/subscriptions.ts
  export async function setSubscriptionStatusByStripeId(stripeSubscriptionId: string, status: "active" | "canceled" | "past_due"): Promise<void>;
  // src/db/queries/creators.ts
  export async function getCreatorByEmail(email: string): Promise<{ id: string; email: string } | null>;
  // src/billing/stripe.ts
  export function verifyWebhook(rawBody: string, signature: string): Stripe.Event; // throws on bad signature
  export type StripeDeps = { claimStripeEvent; activateSubscription; setSubscriptionStatusByStripeId; getCreatorByEmail; logEvent };
  export async function handleStripeEvent(event: Stripe.Event, deps?: Partial<StripeDeps>): Promise<"processed" | "duplicate" | "ignored">;
  ```

- [ ] **Step 1: Install stripe**

Run: `pnpm add stripe`
Expected: `stripe` added to dependencies in `package.json`.

- [ ] **Step 2: Write the failing test**

`tests/billing/stripe.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { handleStripeEvent } from "@/src/billing/stripe";

function deps(over: Partial<Record<string, unknown>> = {}) {
  return {
    claimStripeEvent: vi.fn(async () => true),
    activateSubscription: vi.fn(async () => undefined),
    setSubscriptionStatusByStripeId: vi.fn(async () => undefined),
    getCreatorByEmail: vi.fn(async () => ({ id: "cre-by-email", email: "a@x.com" })),
    logEvent: vi.fn(async () => undefined),
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
        customer_details: { email: "a@x.com" },
        ...over,
      } as Stripe.Checkout.Session,
    },
  } as unknown as Stripe.Event;
}

describe("handleStripeEvent", () => {
  it("activates the subscription and logs paid on checkout.session.completed", async () => {
    const d = deps();
    const r = await handleStripeEvent(checkoutEvent(), d);
    expect(r).toBe("processed");
    expect(d.activateSubscription).toHaveBeenCalledWith({ creatorId: "cre-1", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" });
    expect(d.logEvent).toHaveBeenCalledWith({ name: "paid", creatorId: "cre-1", metadata: { stripeSubscriptionId: "sub_1" } });
  });

  it("falls back to email lookup when client_reference_id is missing", async () => {
    const d = deps();
    await handleStripeEvent(checkoutEvent({ client_reference_id: null }), d);
    expect(d.getCreatorByEmail).toHaveBeenCalledWith("a@x.com");
    expect(d.activateSubscription).toHaveBeenCalledWith(expect.objectContaining({ creatorId: "cre-by-email" }));
  });

  it("returns duplicate and does nothing when the event id was already claimed", async () => {
    const d = deps({ claimStripeEvent: vi.fn(async () => false) });
    const r = await handleStripeEvent(checkoutEvent(), d);
    expect(r).toBe("duplicate");
    expect(d.activateSubscription).not.toHaveBeenCalled();
  });

  it("marks canceled on customer.subscription.deleted", async () => {
    const d = deps();
    const ev = { id: "evt_2", type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled" } } } as unknown as Stripe.Event;
    const r = await handleStripeEvent(ev, d);
    expect(r).toBe("processed");
    expect(d.setSubscriptionStatusByStripeId).toHaveBeenCalledWith("sub_1", "canceled");
  });

  it("marks past_due on customer.subscription.updated with status past_due", async () => {
    const d = deps();
    const ev = { id: "evt_3", type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "past_due" } } } as unknown as Stripe.Event;
    await handleStripeEvent(ev, d);
    expect(d.setSubscriptionStatusByStripeId).toHaveBeenCalledWith("sub_1", "past_due");
  });

  it("ignores unknown event types", async () => {
    const d = deps();
    const ev = { id: "evt_4", type: "invoice.paid", data: { object: {} } } as unknown as Stripe.Event;
    expect(await handleStripeEvent(ev, d)).toBe("ignored");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/billing/stripe.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Add the queries**

`src/db/queries/stripeEvents.ts`:

```ts
import { createServiceClient } from "../client";

/** Insert the event id; returns false if it was already there (duplicate delivery). */
export async function claimStripeEvent(id: string, type: string): Promise<boolean> {
  const db = createServiceClient();
  const { error } = await db.from("stripe_events").insert({ id, type });
  if (!error) return true;
  if (error.code === "23505") return false; // unique_violation
  throw new Error(`claimStripeEvent: ${error.message}`);
}
```

Append to `src/db/queries/subscriptions.ts`:

```ts
export async function setSubscriptionStatusByStripeId(
  stripeSubscriptionId: string,
  status: "active" | "canceled" | "past_due",
): Promise<void> {
  const db = createServiceClient();
  const { error } = await db.from("subscriptions").update({ status }).eq("stripe_subscription_id", stripeSubscriptionId);
  if (error) throw new Error(`setSubscriptionStatusByStripeId: ${error.message}`);
}
```

Append to `src/db/queries/creators.ts`:

```ts
export async function getCreatorByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const db = createServiceClient();
  const { data, error } = await db.from("creators").select("id,email").ilike("email", email).maybeSingle();
  if (error) throw new Error(`getCreatorByEmail: ${error.message}`);
  return data;
}
```

- [ ] **Step 5: Write the Stripe module**

`src/billing/stripe.ts`:

```ts
import Stripe from "stripe";
import { env } from "@/src/shared/config";
import { logger } from "@/src/shared/logger";
import { claimStripeEvent as claimStripeEventDb } from "@/src/db/queries/stripeEvents";
import { activateSubscription as activateSubscriptionDb, setSubscriptionStatusByStripeId as setStatusDb } from "@/src/db/queries/subscriptions";
import { getCreatorByEmail as getCreatorByEmailDb } from "@/src/db/queries/creators";
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
  claimStripeEvent: typeof claimStripeEventDb;
  activateSubscription: typeof activateSubscriptionDb;
  setSubscriptionStatusByStripeId: typeof setStatusDb;
  getCreatorByEmail: typeof getCreatorByEmailDb;
  logEvent: typeof logEventDb;
};

const defaultDeps: StripeDeps = {
  claimStripeEvent: claimStripeEventDb,
  activateSubscription: activateSubscriptionDb,
  setSubscriptionStatusByStripeId: setStatusDb,
  getCreatorByEmail: getCreatorByEmailDb,
  logEvent: logEventDb,
};

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

export async function handleStripeEvent(
  event: Stripe.Event,
  overrides: Partial<StripeDeps> = {},
): Promise<"processed" | "duplicate" | "ignored"> {
  const deps = { ...defaultDeps, ...overrides };

  switch (event.type) {
    case "checkout.session.completed": {
      if (!(await deps.claimStripeEvent(event.id, event.type))) return "duplicate";
      const s = event.data.object as Stripe.Checkout.Session;
      let creatorId = s.client_reference_id ?? null;
      if (!creatorId) {
        const email = s.customer_details?.email ?? null;
        const creator = email ? await deps.getCreatorByEmail(email) : null;
        creatorId = creator?.id ?? null;
      }
      if (!creatorId) {
        logger.warn("stripe: checkout without resolvable creator", { sessionId: s.id });
        return "ignored";
      }
      const stripeCustomerId = idOf(s.customer) ?? "";
      const stripeSubscriptionId = idOf(s.subscription) ?? "";
      await deps.activateSubscription({ creatorId, stripeCustomerId, stripeSubscriptionId });
      await deps.logEvent({ name: "paid", creatorId, metadata: { stripeSubscriptionId } });
      return "processed";
    }
    case "customer.subscription.deleted":
    case "customer.subscription.updated": {
      if (!(await deps.claimStripeEvent(event.id, event.type))) return "duplicate";
      const sub = event.data.object as Stripe.Subscription;
      const status: "active" | "canceled" | "past_due" =
        event.type === "customer.subscription.deleted" ? "canceled"
        : sub.status === "active" || sub.status === "trialing" ? "active"
        : sub.status === "past_due" ? "past_due"
        : "canceled";
      await deps.setSubscriptionStatusByStripeId(sub.id, status);
      return "processed";
    }
    default:
      logger.info("stripe: ignored event", { type: event.type });
      return "ignored";
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/billing/stripe.test.ts`
Expected: PASS, 6 tests.

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
    logger.warn("stripe: bad signature", { message: (e as Error).message });
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    // Return 200 so Stripe does not retry forever; the error is logged for manual follow-up.
    logger.error("stripe: handler failed", { id: event.id, type: event.type, message: (e as Error).message });
    return NextResponse.json({ received: true, result: "error" });
  }
}
```

- [ ] **Step 8: Dylan's Stripe setup (do once, test mode first)**

- [ ] In Stripe Dashboard (test mode): Product catalog → Add product → name `Songfit`, recurring, `$9.99` monthly. Save.
- [ ] Payment Links → New → pick the Songfit price. Options: "Collect customers' email" on (default). After payment → "Don't show confirmation page" → redirect to `https://thissongfits.com/subscribe/thanks`. Create. Copy the link into `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`.
- [ ] Developers → API keys → copy the Secret key into `STRIPE_SECRET_KEY`.
- [ ] Developers → Webhooks → Add endpoint → `https://thissongfits.com/api/stripe/webhook` → events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` (in Vercel). For local use the CLI secret from the next step.
- [ ] Repeat all of the above in live mode on Wednesday evening, with live keys in Vercel.

- [ ] **Step 9: Local webhook test**

Install the Stripe CLI (`brew install stripe/stripe-cli/stripe` once Homebrew is available, or download from stripe.com/docs/stripe-cli) and run:

```bash
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the printed `whsec_...` into `.env.local` as `STRIPE_WEBHOOK_SECRET`, restart `pnpm dev`, then in another terminal:

```bash
stripe trigger checkout.session.completed
```

Expected: `pnpm dev` logs `stripe: checkout without resolvable creator` (the trigger has no `client_reference_id` and a fake email) and the response is `200 {"received":true,"result":"ignored"}`. Then do a real test checkout: open the Payment Link from `/subscribe` while signed in, pay with card `4242 4242 4242 4242`, any future date, any CVC. Expected: redirect to `/subscribe/thanks`; `subscriptions` row with `status = active` for your creator; `events` row `paid`; the upload screen now accepts a second video.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml src/billing/stripe.ts app/api/stripe/webhook/route.ts src/db/queries/stripeEvents.ts src/db/queries/subscriptions.ts src/db/queries/creators.ts tests/billing/stripe.test.ts
git commit -m "Add Stripe webhook with idempotent subscription activation"
```

---

### Task 4.5: Metrics SQL function and admin metrics page

**Files:**
- Create: `supabase/migrations/0005_metrics.sql`
- Create: `src/db/queries/metrics.ts`
- Create: `src/shared/stats.ts`
- Create: `app/admin/metrics/page.tsx`
- Modify: `app/admin/layout.tsx` (add a "Metrics" nav link)
- Test: `tests/shared/stats.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()`; `createServiceClient()`.
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
    returningCreators: number;
  };
  export async function getMetrics(): Promise<Metrics>;
  ```
  SQL function `metrics_summary()` returning one jsonb; `updated_at` column + trigger on `submissions` (also used by Task 4.7).

- [ ] **Step 1: Write the failing test**

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

`supabase/migrations/0005_metrics.sql`:

```sql
-- updated_at on submissions (used by the double-run guard and timing)
alter table submissions add column updated_at timestamptz not null default now();

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger submissions_set_updated_at
  before update on submissions
  for each row execute function set_updated_at();

-- One-shot metrics summary. Service role only.
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
by_category as (
  select coalesce(s.content_category, 'unknown') as category,
    count(*) filter (where s.status = 'ready')::int as ready,
    count(distinct e.submission_id) filter (where e.name = 'recommendation_selected')::int as selected
  from submissions s left join events e on e.submission_id = s.id
  group by 1
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
  'returningCreators', (select n from returning_creators)
);
$$;

revoke all on function metrics_summary() from public, anon, authenticated;
```

Run: `pnpm db:reset && pnpm db:types`
Expected: reset finishes; `src/db/types.ts` gains `updated_at` on `submissions` and a `metrics_summary` entry under `Functions`.

- [ ] **Step 6: Write the query**

`src/db/queries/metrics.ts`:

```ts
import { z } from "zod";
import { createServiceClient } from "../client";
import { median } from "@/src/shared/stats";

const Raw = z.object({
  eventCounts: z.array(z.object({ name: z.string(), count: z.number() })),
  funnel: z.array(z.object({ stage: z.string(), submissions: z.number(), creators: z.number() })),
  uploadToReadySeconds: z.array(z.number()),
  readyToSelectionSeconds: z.array(z.number()),
  byCategory: z.array(z.object({ category: z.string(), ready: z.number(), selected: z.number() })),
  returningCreators: z.number(),
});

export type Metrics = {
  eventCounts: { name: string; count: number }[];
  funnel: { stage: string; submissions: number; creators: number }[];
  medianUploadToReadySeconds: number | null;
  medianReadyToSelectionSeconds: number | null;
  byCategory: { category: string; ready: number; selected: number }[];
  returningCreators: number;
};

export async function getMetrics(): Promise<Metrics> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("metrics_summary");
  if (error) throw new Error(`metrics_summary: ${error.message}`);
  const raw = Raw.parse(data);
  return {
    eventCounts: raw.eventCounts,
    funnel: raw.funnel,
    medianUploadToReadySeconds: median(raw.uploadToReadySeconds),
    medianReadyToSelectionSeconds: median(raw.readyToSelectionSeconds),
    byCategory: raw.byCategory,
    returningCreators: raw.returningCreators,
  };
}
```

- [ ] **Step 7: Write the page**

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

      <section>
        <h2 className="mb-2 font-medium">Funnel</h2>
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th>Stage</th><th>Submissions</th><th>Creators</th></tr></thead>
          <tbody>
            {m.funnel.map((f) => (
              <tr key={f.stage} className="border-t"><td>{f.stage}</td><td>{f.submissions}</td><td>{f.creators}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Median upload → ready</div><div className="text-xl">{secs(m.medianUploadToReadySeconds)}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Median ready → selection</div><div className="text-xl">{secs(m.medianReadyToSelectionSeconds)}</div></div>
        <div className="rounded border p-4"><div className="text-xs text-neutral-500">Returning creators (≥2 uploads)</div><div className="text-xl">{m.returningCreators}</div></div>
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
        <h2 className="mb-2 font-medium">All events</h2>
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

- [ ] **Step 8: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: pass.

Open `/admin/metrics` signed in as the admin. Expected: funnel rows in order `submission_created … paid`, medians shown in seconds, a category table, and an event count table. Signed in as a non-admin: redirected away (existing `requireAdmin` behaviour).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0005_metrics.sql src/db/types.ts src/db/queries/metrics.ts src/shared/stats.ts app/admin/metrics/page.tsx app/admin/layout.tsx tests/shared/stats.test.ts
git commit -m "Add metrics summary function and admin metrics page"
```

---

### Task 4.6: Admin queue polish

**Files:**
- Modify: `app/admin/page.tsx`
- Modify: `src/db/queries/submissions.ts` (`listSubmissions` accepts an optional status filter)

**Interfaces:**
- Consumes: existing `listSubmissions()` returning rows with `id, creator_id, status, content_category, created_at, recommended_at, error` plus the Phase 3 Retry server action.
- Produces: `listSubmissions(filter?: { status?: SubmissionStatus }): Promise<SubmissionRow[]>`; the page reads `?status=` from search params.

- [ ] **Step 1: Extend the query**

In `src/db/queries/submissions.ts` change `listSubmissions` to:

```ts
export async function listSubmissions(filter: { status?: SubmissionStatus } = {}) {
  const db = createServiceClient();
  let q = db
    .from("submissions")
    .select("id,creator_id,status,content_category,created_at,recommended_at,error,creators(email)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter.status) q = q.eq("status", filter.status);
  const { data, error } = await q;
  if (error) throw new Error(`listSubmissions: ${error.message}`);
  return data;
}
```

(`SubmissionStatus` imported from `@/src/shared/types`.)

- [ ] **Step 2: Update the page**

`app/admin/page.tsx`:

```tsx
import Link from "next/link";
import { requireAdmin } from "@/src/auth/session";
import { listSubmissions } from "@/src/db/queries/submissions";
import { SubmissionStatus } from "@/src/shared/types";
import { retrySubmission } from "./submissions/[id]/actions"; // Phase 2 server action, takes FormData with `id`

export const dynamic = "force-dynamic";

const STATUSES = SubmissionStatus.options;

export default async function AdminQueue({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireAdmin();
  const { status } = await searchParams;
  const parsed = SubmissionStatus.safeParse(status);
  const rows = await listSubmissions(parsed.success ? { status: parsed.data } : {});

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Submissions</h1>
      <nav className="my-3 flex gap-3 text-sm">
        <Link href="/admin" className={!parsed.success ? "font-semibold underline" : "underline"}>all</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin?status=${s}`} className={parsed.success && parsed.data === s ? "font-semibold underline" : "underline"}>{s}</Link>
        ))}
      </nav>
      <table className="w-full text-sm">
        <thead><tr className="text-left"><th>Created</th><th>Creator</th><th>Status</th><th>Category</th><th>Upload → ready</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const secs = r.recommended_at ? Math.round((new Date(r.recommended_at).getTime() - new Date(r.created_at).getTime()) / 1000) : null;
            const failed = r.status === "failed";
            return (
              <tr key={r.id} className={`border-t ${failed ? "bg-red-50" : ""}`}>
                <td>{new Date(r.created_at).toLocaleString()}</td>
                <td>{(r.creators as { email: string } | null)?.email ?? r.creator_id}</td>
                <td>{r.status}{failed && r.error ? <div className="text-xs text-red-700">{r.error}</div> : null}</td>
                <td>{r.content_category ?? "—"}</td>
                <td>{secs === null ? "—" : `${secs} s`}</td>
                <td className="flex gap-2">
                  <Link href={`/admin/submissions/${r.id}`} className="underline">open</Link>
                  {failed && (
                    <form action={retrySubmission}><input type="hidden" name="id" value={r.id} /><button className="underline">retry</button></form>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck`
Expected: pass.
Open `/admin?status=failed`: only failed rows, red background, error text and a retry button. `/admin?status=ready` shows the upload→ready seconds.

- [ ] **Step 4: Commit**

```bash
git add app/admin/page.tsx src/db/queries/submissions.ts
git commit -m "Add status filter, timing column and failed highlighting to admin queue"
```

---

### Task 4.7: Hardening for launch

**Files:**
- Modify: `app/api/submissions/[id]/run/route.ts` (double-run guard)
- Modify: `app/api/upload-url/route.ts` (rate limit)
- Modify: `src/db/queries/submissions.ts` (`countRecentSubmissions`)
- Modify: `next.config.ts` (remote images)
- Modify: `app/layout.tsx` (viewport, theme-color)
- Create: `app/robots.ts`, `app/error.tsx`, `app/results/[id]/not-found.tsx`
- Test: `tests/pipeline/runGuard.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/pipeline/runGuard.ts
  export function shouldBlockRun(submission: { status: SubmissionStatus; updated_at: string }, now?: Date): boolean;
  // src/db/queries/submissions.ts
  export async function countRecentSubmissions(creatorId: string, withinMs: number): Promise<number>;
  ```

- [ ] **Step 1: Write the failing test**

`tests/pipeline/runGuard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldBlockRun } from "@/src/pipeline/runGuard";

const now = new Date("2026-10-08T10:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

describe("shouldBlockRun", () => {
  it("blocks when analyzing and updated 2 minutes ago", () => {
    expect(shouldBlockRun({ status: "analyzing", updated_at: ago(2) }, now)).toBe(true);
  });
  it("blocks when recommending and updated 5 minutes ago", () => {
    expect(shouldBlockRun({ status: "recommending", updated_at: ago(5) }, now)).toBe(true);
  });
  it("allows when recommending but stale for 7 minutes", () => {
    expect(shouldBlockRun({ status: "recommending", updated_at: ago(7) }, now)).toBe(false);
  });
  it("allows uploaded, failed and ready", () => {
    expect(shouldBlockRun({ status: "uploaded", updated_at: ago(0) }, now)).toBe(false);
    expect(shouldBlockRun({ status: "failed", updated_at: ago(0) }, now)).toBe(false);
    expect(shouldBlockRun({ status: "ready", updated_at: ago(0) }, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/pipeline/runGuard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the guard**

`src/pipeline/runGuard.ts`:

```ts
import type { SubmissionStatus } from "@/src/shared/types";

const IN_FLIGHT: SubmissionStatus[] = ["analyzing", "recommending"];
const STALE_MS = 6 * 60_000;

export function shouldBlockRun(
  submission: { status: SubmissionStatus; updated_at: string },
  now: Date = new Date(),
): boolean {
  if (!IN_FLIGHT.includes(submission.status)) return false;
  return now.getTime() - new Date(submission.updated_at).getTime() < STALE_MS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/pipeline/runGuard.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Apply the guard in the run route**

In `app/api/submissions/[id]/run/route.ts`, after the existing auth/ownership checks and `const submission = await getSubmission(id)`, add before calling `runSubmission`:

```ts
import { shouldBlockRun } from "@/src/pipeline/runGuard";
// ...
if (shouldBlockRun(submission)) {
  return NextResponse.json({ error: "already_running" }, { status: 409 });
}
```

`getSubmission` must select `updated_at`; if its `select` lists columns explicitly, add `updated_at` to it.

- [ ] **Step 6: Rate limit upload URLs**

Append to `src/db/queries/submissions.ts`:

```ts
export async function countRecentSubmissions(creatorId: string, withinMs: number): Promise<number> {
  const db = createServiceClient();
  const since = new Date(Date.now() - withinMs).toISOString();
  const { count, error } = await db
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("creator_id", creatorId)
    .gte("created_at", since);
  if (error) throw new Error(`countRecentSubmissions: ${error.message}`);
  return count ?? 0;
}
```

In `app/api/upload-url/route.ts`, after the creator is resolved and before the `canSubmit` check, add:

```ts
import { countRecentSubmissions } from "@/src/db/queries/submissions";
// ...
if ((await countRecentSubmissions(creator.id, 60_000)) >= 5) {
  return NextResponse.json({ error: "rate_limited" }, { status: 429 });
}
```

- [ ] **Step 7: Config and chrome**

`next.config.ts` — ensure it contains:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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

`app/layout.tsx` — add the exports (keep the existing `metadata` title/description):

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

`app/error.tsx`:

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

In `app/results/[id]/page.tsx`, where the submission is loaded, call `notFound()` from `next/navigation` when it is null or belongs to another creator (if Phase 3 returned a plain message instead).

- [ ] **Step 8: Verify**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all pass; build completes with no image-host warnings.

Manual: hit `POST /api/submissions/<in-flight id>/run` twice quickly → second returns 409. Open `/results/not-a-real-id` → not-found page. `curl -s localhost:3000/robots.txt` shows `Disallow: /admin`.

- [ ] **Step 9: Commit**

```bash
git add src/pipeline/runGuard.ts app/api/submissions/[id]/run/route.ts app/api/upload-url/route.ts src/db/queries/submissions.ts next.config.ts app/layout.tsx app/robots.ts app/error.tsx app/results/[id]/not-found.tsx app/results/[id]/page.tsx tests/pipeline/runGuard.test.ts
git commit -m "Harden pipeline run, uploads and error pages for launch"
```

---

### Task 4.8: Deploy to Vercel and thissongfits.com

**Files:**
- Modify: `README.md` (Deploy section)
- No code beyond the README; everything else is dashboard work.

- [ ] **Step 1: Push the repo to GitHub**

```bash
gh repo create songfit --private --source=. --push
```
Expected: repo URL printed; `git push` succeeds.

- [ ] **Step 2: Create the Vercel project**

- [ ] vercel.com → Add New → Project → import the `songfit` GitHub repo. Framework preset: Next.js (auto). Root directory: `/`. Build command default (`next build`), install command `pnpm install`.
- [ ] Environment variables (Production and Preview), copied from `.env.example` with real values:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NEXT_PUBLIC_STRIPE_PAYMENT_LINK_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_EMAILS`, `NEXT_PUBLIC_SITE_URL=https://thissongfits.com`, and `INTERNAL_TOKEN` generated with:
  ```bash
  openssl rand -hex 32
  ```
- [ ] Deploy. Expected: build green, `https://songfit-<hash>.vercel.app` loads the upload screen.

- [ ] **Step 3: Function duration**

`app/api/submissions/[id]/run/route.ts` exports `export const maxDuration = 300;` (Phase 3). Vercel honours up to 300 s on Hobby only with Fluid Compute enabled (Project → Settings → Functions → Fluid Compute → on), and on Pro by default. Check the plan in the Vercel dashboard; if the run route 504s after 60 s in the smoke test, enable Fluid Compute or upgrade to Pro before Thursday.

- [ ] **Step 4: Domain**

- [ ] Vercel → Project → Settings → Domains → add `thissongfits.com` and `www.thissongfits.com` (redirect www → apex).
- [ ] At the registrar's DNS: add the records Vercel shows (an `A` record for the apex to Vercel's IP and a `CNAME` for `www` to `cname.vercel-dns.com`). Wait for Vercel to show "Valid Configuration".
- [ ] Expected: `https://thissongfits.com` serves the app with a valid certificate.

- [ ] **Step 5: Auth URLs**

- [ ] Supabase → Authentication → URL Configuration: Site URL `https://thissongfits.com`; Redirect URLs add `https://thissongfits.com/auth/callback` and `https://*.vercel.app/auth/callback`.
- [ ] Google Cloud Console → the OAuth client from Phase 1: Authorized JavaScript origins add `https://thissongfits.com`; the authorized redirect URI stays the Supabase callback (`https://<project>.supabase.co/auth/v1/callback`).
- [ ] Stripe: ensure the live webhook endpoint from Task 4.4 points at `https://thissongfits.com/api/stripe/webhook`, and the live Payment Link redirects to `https://thissongfits.com/subscribe/thanks`.

- [ ] **Step 6: Smoke test from a phone on cellular**

- [ ] Open `https://thissongfits.com` on a phone, Wi-Fi off.
- [ ] Sign in with Google, upload a 30–60 s Reel from the camera roll, see the waiting state.
- [ ] Results appear within ~2 minutes with artwork and playable previews.
- [ ] "Use this" collapses the others and shows the offer.
- [ ] Admin: `/admin` shows the submission as `ready` with timing; `/admin/metrics` shows the funnel.

- [ ] **Step 7: README deploy section**

Append to `README.md`:

```markdown
## Deploy

Production runs on Vercel from the `main` branch at https://thissongfits.com.
Env vars live in Vercel (Settings → Environment Variables); `.env.example` is the list.
The pipeline route needs 300 s functions: Fluid Compute on Hobby, or Pro.
Supabase Auth Site URL and Google OAuth origins must include the production domain.
Stripe webhook: `https://thissongfits.com/api/stripe/webhook`.
```

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "Document deployment"
git push
```

---

### Task 4.9: Launch-day runbook

**Files:**
- Create: `docs/RUNBOOK.md`

- [ ] **Step 1: Write the runbook**

`docs/RUNBOOK.md`:

```markdown
# Songfit launch runbook

## Watch (every hour on launch days)
- `/admin?status=failed` — any failed submission. Read the `error` text:
  - `analyze:` prefix → ffmpeg/Whisper/Claude analysis problem. Retry once. If it fails again, open the inspector and check the video plays; a corrupt or 0-byte upload is the usual cause.
  - `recommend:` prefix with "fewer than 3 verified" → the generator named songs Deezer can't find. Retry (the retry prompt tells the model the last list was unverifiable).
  - `budget exceeded` → pipeline hit 280 s. Retry; it resumes from the failed stage.
- `/admin` — median upload→ready creeping past 150 s means Claude or Deezer is slow; nothing to do unless it fails.
- Anthropic console → Usage. Expect roughly $0.20–0.40 per submission. A spike means a retry loop; check for one submission with many `pipeline_failed` events in `events`.
- Vercel → Logs, filter `error`. 504 on `/api/submissions/*/run` means the function duration limit; see Deploy in README.

## Retry a submission
`/admin?status=failed` → retry. It re-runs from the failed stage. Candidates and recommendations for that submission are replaced, never duplicated.

## Fix a bad recommendation by hand
Supabase Studio → Table editor:
1. `recommendations` → filter `submission_id` → edit `title`, `artist`, `start_seconds`, `end_seconds`, `explanation`, `artwork_url`, `preview_url`, `spotify_url` directly. Rank stays 1–3. The creator's page shows the change on next load (it fetches live).
2. To swap in a different candidate: copy its row from `candidates` (same `submission_id`) into the recommendation row's fields; set `candidate_id` to that candidate's id.
3. To build a Spotify link by hand: `https://open.spotify.com/search/<Title>%20<Artist>`.
Log what you changed in `events` as `manual_fix` is NOT allowed (not in the list) — instead note it in this file's "Manual fixes" section below with the submission id.

## Overused songs
Edit `src/engine/scoring/config/overused.ts`: add `{ title, artist }` entries (normalised matching is case/punctuation-insensitive). Commit and push; Vercel redeploys in ~2 minutes. Entries get a 0.3 penalty on `originality`.

## Reading the metrics page for the deck
`/admin/metrics`:
- "Funnel → submission_created, creators" = creators who submitted (target 100).
- "Funnel → recommendations_ready, submissions" = results delivered.
- "recommendation_selected, submissions" ÷ "recommendations_viewed, submissions" = pick rate.
- "paid, creators" = paying creators (target 10). Cross-check against Stripe → Customers.
- "Median upload → ready" = time to result. "Median ready → selection" = decision time.
- "By category" = which niche picks most; use the select rate column.
- "Returning creators" = came back for a second video.

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

- [ ] Creator A (fresh Google account): upload → waiting → 3 results with previews → "Use this" on one → offer appears → "Get Songfit" → Stripe test checkout with `4242 4242 4242 4242` → lands on `/subscribe/thanks` → tap "Find my songs" → a second upload is accepted and produces results.
- [ ] Creator B (another Google account): first upload works; second upload attempt redirects to `/subscribe` with "You've used your free Songfit."
- [ ] Creator A rejects all three on the second result: "Want 3 different directions?" and the offer appear; `events` has `all_rejected` and `more_like_this_requested`.
- [ ] `/admin/metrics` shows: `submission_created` creators = 2, `paid` creators = 1, non-null medians, a category row, returning creators = 1.
- [ ] `/admin?status=failed` is empty, or every failed row has been retried to `ready`.
- [ ] `pnpm typecheck && pnpm test && pnpm build` pass on `main`; Vercel production deployment is green.

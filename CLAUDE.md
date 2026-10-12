# Songfit

Songfit finds the right song, and the exact section of it, for a creator's
Reel/TikTok. Creator uploads a video → engine analyzes it → returns 3 songs
with start/end timestamps and a reason.

Goal this week: 100 creators get recommendations, 10 subscribe. Ship over polish.

## Before writing any code
Read these in full, every session, before the first edit:
- docs/ARCHITECTURE.md  — module boundaries and engine stages
- docs/DATA_MODEL.md    — tables, columns, status values, event names
- docs/RESEARCH.md      — what we know about music APIs and trend data; append new findings
If a change needs a table, column, status or event that is not in
docs/DATA_MODEL.md, update that doc first, then write the migration, then code.

## How to work
- State assumptions before coding. Ask only when the answer changes the work.
- Present a simpler option when one exists.
- Minimum code that solves it. No speculative abstractions or config.
- Every changed line traces to the request. Don't tidy adjacent code.
- Turn tasks into verifiable goals: write the test or check first, then
  make it pass. Run it before saying it's done.

## Stack
Next.js (App Router) · TypeScript strict · Tailwind · Supabase (Postgres,
Auth with Google, Storage) · Anthropic SDK (analysis + candidates) · OpenAI
Whisper (speech) · Deezer public API (song verification, previews) · Stripe Payment Link
· Vitest · pnpm · Vercel

## Commands
pnpm dev            # localhost:3000
pnpm typecheck      # tsc --noEmit, must pass before any commit
pnpm lint
pnpm test           # vitest, unit tests only
pnpm db:types       # regenerate src/db/types.ts after any migration
pnpm db:reset       # apply all migrations from scratch (local Supabase)

## Map
app/                routes only. Thin: parse input, call src/, render.
src/media/          upload, storage, ffmpeg frame + audio extraction
src/analysis/       video → VideoAnalysis + MusicBrief
src/engine/         candidates/ catalog/ scoring/ diversify/ sections/ recommend.ts
src/pipeline/       runSubmission: analyze → recommend, status + retry handling
src/auth/           session helpers, admin gate
src/feedback/       selections, rejections, event log
src/billing/        Stripe link + webhook
src/db/             Supabase clients, typed query fns, generated types
supabase/migrations/  SQL, numbered, never edited after applying
docs/               ARCHITECTURE.md, DATA_MODEL.md, prompts changelog

## Architecture rules
- Engine stages communicate only through typed records (Zod schemas in
  src/shared/types). A stage takes one input type, returns one output type,
  and the orchestrator persists it. Never let a stage read another stage's
  table directly. Reason: every stage gets replaced by a smarter one later.
- src/engine and src/analysis must not import from app/ or next/.
- Scoring: one file per dimension in src/engine/scoring/, each returns
  { score: 0..1, reason: string }. Weights live only in src/engine/scoring/weights.ts.
  Store every component score on the candidate row.
- Recommendations are song *segments* (song + start + end), never bare songs.
- Pipeline is resumable: submission.status advances per stage; each stage
  is idempotent and retries from the failed stage, never from the start.
- Manual-now, automated-later is the design principle. Any manual step
  writes the same record the automated version will write.

## Model calls
- One function per call, prompt in the same file, exported PROMPT_VERSION
  string stored on the produced record. Bump it on every prompt change.
- Parse every model response with Zod. On failure, throw with the raw text
  attached. Never silently fall back to partial data.
- Use the model ids from src/shared/config.ts, never hardcode.
- Every candidate song must be verified via Deezer search before scoring.
  Unverified candidates are dropped and logged, never shown.

## Database
- All tables: id uuid default gen_random_uuid() primary key, created_at timestamptz.
- Foreign keys always state ON DELETE behavior.
- RLS on every table. Creators see only their own rows; admin routes
  use the service-role client and are gated by ADMIN_EMAILS.
- Never write raw Supabase queries in app/. Go through src/db/queries/*.
- Run pnpm db:types after every migration and commit the result.

## Product rules (creator-facing)
- Never show embeddings, scores, confidence, model names or jargon to creators.
- Copy is short and confident. "Use 0:43–0:58", not "we think maybe".
- Mobile first. Test upload on a phone-width viewport before calling UI done.
- Every creator action fires an event into the events table. Allowed names
  are listed in docs/DATA_MODEL.md; add there first.

## Do not build this week
Custom ML, scraping of any platform, song catalogs over 500 rows, password
auth, subscription logic beyond a Stripe link + webhook, queues, cron,
microservices, design systems, analytics beyond the events table, carousels.
(Exception: Dylan approved the 5,032-song dictionary for the new engine, 2026-10-11.)

## Hard guardrail (enforced by .claude/hooks/guard-secrets.py, not just prose)
No agent may read, write, cat, grep, glob, copy or even mention any env file (`.env`,
`.env.local`, `.env.*.local`, `.env.production`; only `.env.example` is allowed) in a
command, or run any spelling of `vercel link`, `vercel pull`, or `vercel env pull`
(including `vc`, `vercel@latest`, flags before the subcommand). The PreToolUse hook in
.claude/settings.json blocks the call for Bash, Edit, Write, Read, Grep and Glob, resolves
symlinks, and is case-insensitive. It is a pattern guard, not a sandbox: working around it
(variable expansion, quote splitting, recursive grep) is a rules violation, not a loophole.
Secrets are entered by Dylan only: locally in the env file, and in the Vercel dashboard for
production. If a task needs a secret value, stop and ask Dylan to enter it.
Test the guard with `python3 -I .claude/hooks/guard-secrets.test.py` (25 cases).

## Workflow
- Run pnpm typecheck && pnpm test before claiming anything works.
- Commit in small steps with imperative messages.
- Never edit .env*, generated types, or applied migrations by hand.
- Ask before: deleting data, changing weights.ts, changing a Zod schema
  that has rows already written against it.

## Gotchas
- Spotify Web API: no preview_url / audio features for apps made after Nov 2024,
  dev-mode quotas. Do not add a Spotify dependency. Deep link via search URL only.
- Deezer public API ~50 req / 5 s per IP. Throttle candidate verification.
- iTunes is not used (2026-10-07 rule: only songs with a Deezer sample are recommended).
- `vercel link` and `vercel env pull` OVERWRITE `.env.local` with Vercel's env. The project is already linked
  (`.vercel/`); never run either again. Back up `.env.local` before any Vercel CLI command that touches env.
- Recovery: VS Code keeps local history of edited files under
  ~/Library/Application Support/Code/User/History (used to restore .env.local on 2026-10-07).

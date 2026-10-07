# Songfit

Find the right song, and the exact section of it, for your Reel or TikTok.

Upload a video. Songfit understands what's in it and how you want it to feel,
then recommends 3 real songs with the precise start and end timestamps to use.

## How it works

1. Creator signs in with Google and uploads a video, optionally saying how it should feel.
2. Frames and speech are extracted and sent to a multimodal model, which produces a
   structured analysis and a natural-language music brief.
3. The recommendation engine generates candidate songs, verifies each against Deezer,
   scores them on several dimensions, picks 3 across distinct creative directions, and
   selects a section of each.
4. The creator sees the 3 picks, chooses one or rejects, and is offered a subscription.

Design docs:
- `docs/ARCHITECTURE.md` — modules, pipeline, rules that keep stages replaceable
- `docs/DATA_MODEL.md` — every table, status and event name
- `docs/RESEARCH.md` — findings on music APIs, trend data and recommendation literature
- `CLAUDE.md` — working rules for AI coding agents on this repo

## Stack

Next.js (App Router), TypeScript strict, Tailwind, Supabase (Postgres, Auth, Storage),
Anthropic SDK, OpenAI Whisper, Deezer public API, Stripe Payment Link, Vitest, pnpm, Vercel.

## Local setup

Prerequisites: Node 20+, pnpm, ffmpeg (`brew install ffmpeg`), Supabase CLI
(`brew install supabase/tap/supabase`).

```bash
pnpm install
cp .env.example .env.local      # fill in every key
supabase start                   # local Postgres + Auth + Storage
pnpm db:reset                    # apply migrations
pnpm db:types                    # generate src/db/types.ts
pnpm dev                         # http://localhost:3000
```

## Environment variables

See `.env.example`. Summary:

| key | purpose |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | server-side pipeline and admin |
| `ANTHROPIC_API_KEY` | video analysis, candidate generation, scoring |
| `OPENAI_API_KEY` | Whisper transcription |
| `STRIPE_PAYMENT_LINK_URL`, `STRIPE_WEBHOOK_SECRET` | subscription |
| `ADMIN_EMAILS` | comma-separated, gates `/admin` |

## External accounts needed

- Supabase project with Google provider enabled (needs a Google Cloud OAuth client)
- Anthropic and OpenAI API keys
- Stripe account with one subscription Payment Link and a webhook pointing at `/api/stripe/webhook`
- Vercel project linked to this repo

## Commands

```bash
pnpm dev          # run locally
pnpm typecheck    # tsc --noEmit
pnpm lint
pnpm test         # vitest unit tests
pnpm db:reset     # re-apply all migrations locally
pnpm db:types     # regenerate database types
```

## Project layout

```
app/        routes and pages, thin
src/        media, analysis, engine, feedback, billing, db, shared
supabase/   migrations
docs/       architecture and data model
```

## Status

Pre-launch build for an Entrepreneur First challenge. The engine is model-backed
with Deezer verification; catalog, vector retrieval and trend signals are
designed in but not yet populated.

## Deploy

Production: https://songfit.vercel.app (Vercel project `songfit`, GitHub `dylanbryan2002-wq/songfit`, branch `mvp`).

1. Plans: Vercel Pro and Supabase Pro; Supabase Storage global file size limit 150 MB.
2. The project is ALREADY linked (`.vercel/`, gitignored). Do not run `vercel link` or `vercel env pull` again: both overwrite your local env file with only a `VERCEL_OIDC_TOKEN`. Agents are blocked from these by `.claude/hooks/guard-secrets.py`. A human re-linking on a new machine must back the env file up first.
3. Set production env vars with `vercel env add <KEY> production` for every key in `.env.example` except `SUPABASE_DB_PASSWORD` and `STRIPE_*` (not needed at runtime yet). `NEXT_PUBLIC_SITE_URL` is the production URL.
4. Fluid Compute ON: Project > Settings > Functions.
5. Deploy: `npx vercel --prod --yes`.
6. Prove the budget: `curl "https://<url>/api/health?sleep=65"` returns `{"ok":true,"slept":65}`; once, `?sleep=290` with `--max-time 320`.
7. Supabase Auth: add the site URL and `https://<url>/**` to Redirect URLs. Google OAuth: add `https://<url>` to Authorized JavaScript origins.

## Known limitations

- `waitUntil` is not durable. The submission pipeline runs inside the `POST /api/submissions` request; if the instance dies mid-run the status stays in-flight. After `LIMITS.inFlightStaleMinutes` the claim becomes available again and the admin Retry re-runs it.

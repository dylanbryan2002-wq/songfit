# Songfit launch runbook

**Production:** https://thissongfits.com (also https://songfit.vercel.app)

## Uptime monitor

Monitor URL: **https://thissongfits.com/api/health** (GET, expect 200 and `{"ok":true,"slept":0}`). No auth, no
middleware, no database, no paid API: it answers in milliseconds, so a 5xx or timeout means the deployment itself
is down. Point any free uptime checker at it (1–5 min interval, alert after 2 failures). `?binaries=1` reports the
ffmpeg/ffprobe binaries (a deploy check, not for the monitor).

## Watch (every hour on launch days)

- `/admin` — failed rows are red (there is no status filter). Read the `error` text:
  - `analyze:` prefix → ffmpeg/Whisper/Claude analysis problem. Retry once. If it fails again, open the inspector and check the video plays; a corrupt or 0-byte upload is the usual cause.
  - `recommend:` prefix with "fewer than 3 verified" → the generator named songs Deezer can't find. Retry (the retry prompt carries exclusions and asks for better-known songs).
  - Any other error → check `/admin/submissions/<id>` (inspector: analysis output, brief, candidates, the 15 picks) for context.

- A run stuck in `uploaded`, `analyzing` or `recommending` for >6 minutes heals itself: the creator's waiting screen polls `GET /api/submissions/<id>`, which restarts a run untouched for `LIMITS.inFlightStaleMinutes` (log `pipeline.stale_restart`, event `stale_restart`). At most `LIMITS.maxStaleRestarts` (2) restarts per submission; after that the log says `pipeline.stale_restart_capped` and the run stays put until someone retries it. The atomic claim stops double runs. If no one is polling, open `/admin`, find the row, Retry. If `stale_restart` shows up more than once for a submission, check Vercel logs for early function termination.

- `/admin/metrics` — median upload→ready creeping past 150 s means Claude or Deezer is slow; nothing to do unless runs fail. "Couldn't find it" is the count of creators who tapped Tell us because a song was not in TikTok or Instagram; it is the miss rate for the deck, so watch it. The table lists every reported song with its report and creator counts; a song reported by 2 or more distinct creators is banned from future picks.

- **Vercel Logs** — filter `error`. 504 on `/api/submissions` = function duration limit; check Project > Settings > Functions that Fluid Compute is ON.

- **Anthropic API Usage** — expect ~$0.34 per run at Sonnet list prices for the recommend stage (67 s). A spike means a retry loop; search one submission's `pipeline_failed` event count.

- **Deezer** — "Quota limit exceeded" → paced and retried automatically. A persistent outage fails the recommend stage; Retry later.

- **Results URLs** — a link pasted into chat can get mangled. Direct creators to https://thissongfits.com/results/latest for their latest result.

## Retry a submission

`/admin` (failed rows are red) → Retry. It re-runs from the failed stage. Candidates and recommendations are replaced, never duplicated.

Creators can retry too: a failed run (or one still in flight after ~7 minutes on their screen) shows **Try again** (one per visit, `POST /api/submissions/<id>/retry`, owner only) and **Try another video**. Same claim, same retry-from-stage.

## Daily cap

Each creator can start at most `LIMITS.dailyUploadsPerCreator` (10) submissions per rolling 24 hours (3 for an anonymous visitor), on top of the 5-per-minute burst limit. The site as a whole starts at most `LIMITS.globalDailySubmissions` (150) per rolling 24 hours. Both caps are enforced inside `create_submission()` (migration 0010), so parallel requests cannot slip past them. Since 0011 they count the append-only `usage` ledger (one row per created submission), not `submissions`, so a deleted video does not give its upload back. `/api/upload-url` pre-checks the per-creator cap (429 `daily_limit`); `POST /api/submissions` answers 429 `daily_limit` or `global_limit`. The upload screen shows the allowance from the same 24 h count ("7 uploads left · Resets 24 hours after each upload"; anonymous "2 free tries left"), counted at render. The form says "You've used your 10 uploads for now. Each one frees up 24 hours after it was made." (anonymous: "You've used your 3 free tries for now. Sign in to upload more.") or "We're at capacity right now. Try again in a bit."

To change a cap: it is a literal in the SQL function AND in `src/shared/config.ts`. Write a new migration that redefines `create_submission()` with the new number, change config to match (`tests/shared/limitsMatchMigration.test.ts` fails until both agree), `pnpm db:push`, then deploy.

## Emergency stop

Spend is running away (a bot is minting anonymous sessions, or a retry loop):

1. **Stop new anonymous visitors (under a minute, no deploy):** Supabase Dashboard → Authentication → Sign In / Providers → Anonymous sign-ins → off. Visitors fall back to "Continue with Google" automatically.
2. **Stop every model call (under a minute):** Anthropic Console → API keys → revoke the production key (and the OpenAI key for Whisper). Runs fail at the analyze stage; creators see Try again. Make a new key and have Dylan enter it in Vercel when it is safe.
3. **Lower the caps (deploy):** see Daily cap above (a migration plus config). `PREVIEWS_ENABLED = false` in `src/shared/config.ts` hides every Deezer sample if Deezer is the problem (commit, push, ~2 min).
4. Bot flood on the site itself: Vercel → Firewall → Attack Challenge Mode.

## Deletion on request

Creators can delete themselves: on `/account`, "Delete" on a video row (or "Delete this video" on its results page) calls `DELETE /api/submissions/<id>`, and "Delete my account" (type DELETE) calls `DELETE /api/account`. Both refuse while a run is in flight (`uploaded`/`analyzing`/`recommending`); both log (`submission_deleted`, `account_deleted`) only after every step succeeded. A video delete removes its storage objects (never one another run references), its `wanted_instead` events, then the row; its other events stay with `submission_id` nulled. An account delete runs the same steps as the script below. `usage` rows stay (bare uuid + timestamp, no content) so the caps hold. A video stuck in flight past the stale restarts blocks self-serve account deletion: mark it `failed` in Studio, or use the script.

The operator script remains for requests by email. A creator emails the address on `/privacy` asking to be deleted:

```bash
pnpm local scripts/delete-creator.ts <their-email>          # dry run: prints every file, row and user it would delete
pnpm local scripts/delete-creator.ts <their-email> --yes    # deletes
```

It deletes, in order: every storage object of their submissions (original + playback copy), including runs they claimed from an anonymous session (those files sit under the anonymous id's folder), plus any stray uploads in those folders and their sub-folders, never a file another submission still references; their `events` rows and those of their submissions (events are SET NULL on delete, not cascaded, and hold `wanted_instead` free text); the anonymous auth users their runs came from, each only if it is anonymous and has no submission and no file left; then their auth user, which cascades `creators` → `submissions` → `video_analyses`, `candidates`, `recommendations`, and `subscriptions`. Reply to the creator when it is done and note it in "Manual fixes" (date, no email).

**Unclaimed anonymous runs: purge monthly** (manual for now; the privacy page promises 30 days). On the 1st of each month:

```bash
pnpm local scripts/purge-anonymous.ts          # dry run
pnpm local scripts/purge-anonymous.ts --yes    # deletes
```

It removes every anonymous creator (`email is null`) created more than 30 days ago with no run in the last 30 days: their files (never a file a Google creator's claimed run still uses), events and auth user.

## Fix a bad recommendation by hand

Supabase Studio → Table editor:

1. `recommendations` → filter `submission_id` → edit `title`, `artist`, `start_seconds`, `end_seconds`, `explanation`, `artwork_url`, `spotify_url` directly. Ranks run 1–15 (shown 5 at a time); keep each rank unique.
2. To swap in a different candidate: copy its row from `candidates` (same `submission_id`) into the recommendation row's fields; set `candidate_id` to that candidate's id.
3. To build a Spotify link: `https://open.spotify.com/search/<Title>%20<Artist>`.

Note every manual change in "Manual fixes" below with the submission id.

## Disable previews / toggle launch flags

`src/shared/config.ts`: `PREVIEWS_ENABLED` is `true` (30-second Deezer samples on the results screen). Set it to `false` to hide every play button if Deezer says no or samples misbehave. Change, commit, push; Vercel redeploys in ~2 minutes.

## Overused songs

Edit `src/engine/scoring/config/overused.ts`: add `{ title, artist }` entries (case/punctuation-insensitive). Commit and push.

## Reading the metrics page for the pitch

`/admin/metrics`:

- "Paying creators (active)" = active subscriptions right now (target: 10).
- "Funnel → submission_created, creators" = distinct creators who submitted (target: 100).
- "Funnel → recommendations_ready, submissions/creators" = results delivered.
- "recommendation_selected ÷ recommendations_viewed" = pick rate.
- "Median upload → ready" = time to result.
- "By category" = which niches pick most; use the select-rate column.
- "Returning creators" = second video from a creator.

## Local debugging

```bash
pnpm pipeline:local <submission-id>    # run engine against hosted Supabase with logs
pnpm db:push                           # apply schema changes
pnpm test                              # unit tests
pnpm typecheck && pnpm test && pnpm build  # full gate before shipping
```

## Stripe (not yet enabled)

Not built yet: no Payment Link, no webhook route, no subscribe page. `PAYWALL_ENABLED` is `false`, so nobody is gated (migration 0006 lifts the database rule too). "Paying creators" on the metrics page stays 0 until Stripe ships.

## Manual fixes

(date, submission_id, what changed, why)

---

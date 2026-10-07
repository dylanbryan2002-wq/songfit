# Songfit launch runbook

**Production:** https://thissongfits.com (also https://songfit.vercel.app)

## Watch (every hour on launch days)

- `/admin?status=failed` — any failed submission. Read the `error` text:
  - `analyze:` prefix → ffmpeg/Whisper/Claude analysis problem. Retry once. If it fails again, open the inspector and check the video plays; a corrupt or 0-byte upload is the usual cause.
  - `recommend:` prefix with "fewer than 3 verified" → the generator named songs Deezer can't find. Retry (the retry prompt carries exclusions and asks for better-known songs).
  - Any other error → check `/admin/submissions/<id>` (inspector: analysis output, brief, candidates, final 3) for context.

- A run stuck in `analyzing` or `recommending` for >6 minutes: open `/admin`, find the row, Retry. The claim expires after `LIMITS.inFlightStaleMinutes` so stale takeover works. If it happens >once, check Vercel logs for early function termination.

- `/admin/metrics` — median upload→ready creeping past 150 s means Claude or Deezer is slow; nothing to do unless runs fail. "Couldn't find it" is the count of creators who tapped Tell us because a song was not in TikTok or Instagram; it is the miss rate for the deck, so watch it.

- **Vercel Logs** — filter `error`. 504 on `/api/submissions` = function duration limit; check Project > Settings > Functions that Fluid Compute is ON.

- **Anthropic API Usage** — expect ~$0.34 per run at Sonnet list prices for the recommend stage (67 s). A spike means a retry loop; search one submission's `pipeline_failed` event count.

- **Deezer** — "Quota limit exceeded" → paced and retried automatically. A persistent outage fails the recommend stage; Retry later.

- **Results URLs** — a link pasted into chat can get mangled. Direct creators to https://thissongfits.com/results/latest for their latest result.

## Retry a submission

`/admin` (failed rows are red) → Retry. It re-runs from the failed stage. Candidates and recommendations are replaced, never duplicated.

## Fix a bad recommendation by hand

Supabase Studio → Table editor:

1. `recommendations` → filter `submission_id` → edit `title`, `artist`, `start_seconds`, `end_seconds`, `explanation`, `artwork_url`, `spotify_url` directly. Rank stays 1–3.
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

Set up when the offer pages are ready:

1. Create a Stripe Payment Link for annual subscriptions.
2. Copy its signing secret to `STRIPE_WEBHOOK_SECRET` (Vercel production env).
3. Point Stripe Webhooks to `https://thissongfits.com/api/stripe/webhook`.

Until then, all creators see the `/subscribe` paywall but cannot check out.

## Manual fixes

(date, submission_id, what changed, why)

---

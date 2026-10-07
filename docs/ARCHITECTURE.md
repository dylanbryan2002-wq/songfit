# Songfit architecture

One Next.js app. Modules under src/ are the system boundaries from the
product spec. Routes in app/ are thin and only call into src/.

```
app/
  page.tsx                  upload screen
  results/[id]/page.tsx     results screen (polls status until ready)
  admin/                    submissions queue, per-submission inspector, metrics
  api/                      route handlers: upload, run pipeline, feedback, stripe webhook
src/
  media/        upload to Storage, ffprobe duration, ffmpeg frames + audio track
  analysis/     frames + transcript (+ creator intent) → VideoAnalysis + MusicBrief
  engine/
    candidates/ MusicBrief → Candidate[]           (model-backed today; catalog retrieval later)
    catalog/    Candidate → verified Candidate      (Deezer search; song identity, duration, artwork, preview; iTunes fallback)
    scoring/    one file per dimension → { score, reason }; weights.ts combines
    diversify/  scored Candidate[] → 3 picks across distinct directions
    sections/   pick start/end for each pick       (model-proposed today; temporal model later)
    recommend.ts orchestrates: candidates → catalog → scoring → diversify → sections → persist
  pipeline/     run.ts: runSubmission(id) — analyze → recommend with status handling and retry-from-stage
  auth/         session.ts: getCreator(), requireAdmin()
  feedback/     selections, rejections, more-like-this, event log
  billing/      Stripe payment link + webhook → subscriptions
  db/           Supabase clients (anon, server, service-role), typed query fns, generated types
  shared/       Zod types, config (model ids, limits), logger
supabase/migrations/
docs/
```

## Pipeline

```
upload (client → Storage)
  → submissions.status = uploaded, event submission_created
analyze
  → media: extract ~1 frame/sec (cap 60) + audio track → Whisper transcript
  → analysis: Claude (frames + transcript + intent) → VideoAnalysis + MusicBrief (Zod)
  → write video_analyses, status = analyzing → recommending, event analysis_completed
recommend
  → candidates: Claude (brief) → 20–30 real songs, each with proposed section + reason
  → catalog: Deezer search per candidate (throttled); drop unverified
  → scoring: each dimension scores every verified candidate; store component_scores
  → diversify: pick 3 across directions (best fit / more current / unexpected)
  → sections: confirm start/end per pick (15 s default, must contain the video's key moment)
  → write candidates + recommendations, status = ready, event recommendations_ready
results page polls status; on ready renders recommendations, event recommendations_viewed
feedback → events; paid offer → Stripe link → webhook → subscriptions
```

## Rules that keep stages replaceable
- Each stage: typed input → typed output. The orchestrator persists; stages do not touch tables.
- Stages are idempotent. Re-running a stage for a submission overwrites that stage's rows only.
- Model-backed stages export PROMPT_VERSION and stamp it on the rows they produce.
- Scoring dimensions are independent pure functions over (VideoAnalysis, MusicBrief, Candidate).
  Some are model-assisted (one batched call scoring all candidates), some are rule-based
  (dialogue conflict, overuse list). Weights in weights.ts only.
- The catalog tables exist from day one. When populated, candidates/ gains a second source
  (vector retrieval over song_segments) merged with the model-generated list.

## What is deliberately simple for launch
- Pipeline runs inside a single API request (Vercel function, 300 s limit) with status polling.
  No queue. If this times out in practice, move to a background function.
- Admin and metrics pages are server-rendered tables.
- Payment is a Stripe Payment Link; the webhook only flips subscriptions.status.

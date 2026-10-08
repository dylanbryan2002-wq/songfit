# Songfit architecture

One Next.js app. Modules under src/ are the system boundaries from the
product spec. Routes in app/ are thin and only call into src/.

```
app/
  page.tsx                  upload screen
  results/[id]/page.tsx     results screen (polls status until ready; Try again when failed)
  admin/                    submissions queue, per-submission inspector, metrics
  api/                      route handlers: upload, submissions (create, status, retry), feedback, events, preview
src/
  media/        upload to Storage, ffprobe duration, ffmpeg frames + audio track
  analysis/     frames + transcript (+ creator intent, vibe tags + note) → VideoAnalysis + MusicBrief
  engine/
    candidates/ MusicBrief → Candidate[]           (model-backed today; catalog retrieval later)
    catalog/    Candidate → verified Candidate      (Deezer search; song identity, canonical names, duration, preview; no preview → dropped)
    scoring/    one file per dimension → { score, reason }; weights.ts combines
    diversify/  scored Candidate[] → 15 ranked picks across directions (PICKS_TOTAL), shown in batches of 5
    sections/   pick start/end for each pick       (model-proposed today; temporal model later)
    recommend.ts orchestrates: candidates → catalog → scoring → diversify → sections → persist
  pipeline/     run.ts: runSubmission(id) — analyze → recommend with status handling and retry-from-stage
  auth/         session.ts: getViewer() (Google or anonymous), getCreator() (Google only), requireAdmin(); gate.ts, claim.ts
  feedback/     selections, rejections, more-like-this, event log
  billing/      paywall pre-check, upload rate + daily cap (Stripe not built yet)
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
  → media: extract ~1 frame/sec (cap 60) + audio track → Whisper transcript;
    H.264 playback copy (≤720 px, no audio) → submissions.playback_path, so every phone can play the video
  → analysis: Claude (frames + transcript + intent) → VideoAnalysis + MusicBrief (Zod)
  → write video_analyses, status = analyzing → recommending, event analysis_completed
recommend
  → candidates: Claude (brief) → 20–30 real songs, each with proposed section + reason
  → catalog: Deezer search per candidate (throttled); the preview is read here. Samples-only rule:
    no Deezer preview, no recommendation. Unverified or sample-less candidates are dropped and logged
  → scoring: each dimension scores every verified candidate; store component_scores
  → diversify: 15 ranked picks across directions (rank 1 best fit; safe / more current / unexpected);
    fewer than 3 verified fails the stage
  → sections: confirm start/end per pick (15 s default, must contain the video's key moment)
  → write candidates + recommendations, status = ready, event recommendations_ready
results page polls GET /api/submissions/[id] (status only); on ready the server renders the picker
  (5 picks at a time, previews played over the muted playback copy), event recommendations_viewed.
  A poll that finds a run in flight and untouched for 6 minutes restarts it (self-heal).
feedback → events; (Stripe link + webhook: not built yet)
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
- Pipeline runs inside the submit request via `waitUntil` (Vercel function, maxDuration 300) with status polling.
  Entry is always `runSubmission(id)`, which first takes an atomic claim (`claim_submission_run`), so a
  double trigger or an admin retry can never run the same submission twice. No queue.
- Paywall is enforced in the `create_submission` SQL function (atomic), not in route code.
- Stripe webhook: process, then record the event id. A failure before recording stays retryable.
- Admin and metrics pages are server-rendered tables.
- Payment is a Stripe Payment Link; the webhook only flips subscriptions.status.

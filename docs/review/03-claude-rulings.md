# Claude rulings on Codex review — 2026-10-06

Verified Codex's concrete claims against the plan text before ruling; the
ones cited as bugs are real. Rulings below are applied to the plan in the
same commit. Items marked **DYLAN** need a founder decision and are listed
at the end with a recommendation and a default.

Legend: ACCEPT = applied as proposed. MODIFY = applied in a simpler form fit
for Thursday. DEFER = correct, scheduled after Sunday. REJECT = not applied.

## Critical

- **C1 JSON contract — ACCEPT.** `extractJson` now returns `unknown`: strips
  fences, finds the first `{` or `[`, parses, and throws with the raw text on
  failure. All model-backed stages use it then Zod. Incomplete sets fail the
  stage after one retry with the validation error; no fabricated 0.5 scores,
  no silent item dropping. Analysis uses the same helper.
- **C2 Paywall / write authorization — MODIFY.** Entitlement is enforced at
  submission creation, atomically, via a Postgres function
  `create_submission(creator_id, submission_id, video_path, intent)` that
  counts this creator's `ready` + in-flight (`uploaded|analyzing|recommending`
  younger than 10 min) rows and refuses when ≥1 and no active subscription.
  The upload-url route keeps its early check as UX only. The submissions
  table has no authenticated INSERT policy (service role only). Storage
  INSERT policy stays prefix-scoped (signed upload still uses it). Path/ID
  binding is validated server-side. Not doing: lease tables, free-allowance
  consumption on delivery, failed-attempt accounting — a failed run just
  doesn't count as ready.
- **C3 Runner — MODIFY.** One runner: Phase 3 extends Phase 2's
  `runSubmission` (adds the recommend stage to the same deps object) instead
  of replacing it. Stage tracking by stored outputs (analysis row exists →
  skip analyze; recommendations exist → done). Double-run guard becomes an
  atomic conditional update (`update … set status='analyzing',
  updated_at=now() where id=$1 and status in ('uploaded','failed') or
  updated_at < now() - interval '6 minutes'` returning the row); the admin
  retry goes through the same entry point. A soft deadline is passed to the
  Anthropic calls (`timeout` option) and ffmpeg (`timeout` on execFile).
  Not doing: attempt IDs, lease tables, transactional stage writes.
- **C4 Stripe — ACCEPT.** Order: process → activate → then record the event
  id; a failure before the record leaves the event retryable. `stripe_events`
  stores `status` (processed) only on success. Unique constraint on
  `stripe_subscription_id` is a plain nullable UNIQUE. Checkout and
  subscription events each upsert from the Stripe object's current `status`,
  so order doesn't matter. Validate `client_reference_id`, `customer`,
  `subscription` non-empty; email fallback removed. Price-id validation
  added against `STRIPE_PRICE_ID` env.
- **C5 Cross-task contracts — ACCEPT.** Fixed in plan text: `logger` export
  (all callers), `createSubmission` accepts `id`, `video_analyses` gains
  `content_category` (migration + doc + upsert), `getAnalysisRowRow` typo,
  Task 3.10 uses the generated `Insert` types, `Logo` named export,
  `WaitingState` prop `submissionId`, Task 4.2 consumes the same
  `RecommendationView` DTO Phase 3 returns (no `FinalRecommendation` to the
  browser). Full `pnpm typecheck && pnpm test && pnpm build` is a gate at
  the end of every phase.
- **C6 Sections / alignment — MODIFY + DYLAN.** Data: candidates carry
  `anchor_seconds` (the model's claimed musical hit) separately from
  `proposed_start/end`. Alignment only when the final window contains the
  anchor and `anchor − start = T` is feasible; otherwise the window is kept
  and no alignment is claimed (explanation prompt is told whether alignment
  happened). Impossible timestamps (anchor ≥ duration) drop the candidate
  rather than clamping. Copy wording is Dylan's call (see below).
- **C7 Deployment/upload prerequisites — ACCEPT + DYLAN.** Phase 1 ends with
  a deployed-to-Vercel phone upload test, and Phase 2 ends with a deployed
  iPhone MOV/HEVC extraction test (moved up from 4.8). `next.config.ts`
  keeps `serverExternalPackages` for ffmpeg/ffprobe through 4.7. Versions
  pinned in 0.1. Plans (Supabase Pro for >50 MB, Vercel Pro) are Dylan's.
- **C8 Music API rights — DYLAN.** See below. Default: ship without
  previews; use Deezer for identity verification only.

## Important

- **I1 Cost/model — MODIFY.** Fable stays for video analysis only.
  Candidates, scoring and explanations move to Sonnet 5.5 (`MODELS`
  updated). Scoring reasons capped at 12 words; `max_tokens` sized for 75
  items. Per-stage logging of latency, tokens, stop reason. Shortlist stays
  75 (Dylan's decision). Smoke calls to each provider become Task 0.7.
- **I2 waitUntil — ACCEPT (simplest form).** Submission route calls
  `waitUntil(runSubmission(id))` directly with `maxDuration = 300`; the
  separate run route remains for admin retry only. Codex's point about the
  caller's timeout applying is why the submit route gets the 300 s.
- **I3 Matching — MODIFY.** Title equality after conservative normalisation
  (no prefix matching); version markers (live, remix, acoustic, sped up,
  slowed, instrumental, karaoke, cover) are preserved and must match.
  Featuring stripped from both sides before artist comparison; no splitting
  on "and". Diacritics folded only for comparison, stored provider strings
  kept canonical. Dedupe verified by `deezer_id`. Plain search tried when
  strict search yields no acceptable match.
- **I4 Regenerate-once — ACCEPT.** Keep first attempt's verified set, pass
  exclusions, merge by `deezer_id`, test for ≥3 distinct recordings.
  Provider errors (network/429/5xx) retried with backoff, not regenerated.
- **I5 Rate limiting/previews — MODIFY.** Bounded concurrency (p-limit 6)
  and per-request timeout for Deezer; 429 → backoff. Previews are optional
  and never block results. iTunes only when a preview is missing, and only
  if previews are enabled (C8). Store preview source + provider id.
- **I6 Sign-in journey — DYLAN.** Default: sign in before picking the file
  (Google button is the first tap; the form appears after). Resumable
  uploads via Supabase's TUS endpoint for files > 6 MB.
- **I7 Metrics — ACCEPT.** `creatorId` on every milestone event;
  `by_category` aggregates before joining; `/subscribe` offer events carry
  creator id without a submission; first `recommended_at` preserved across
  retries; SQL tested against a seeded fixture.
- **I8 Provenance — MODIFY.** Candidates store `section_reason`,
  `fit_reason`, `anchor_seconds`, `source` ('model' now), and keep nullable
  `song_id`/`segment_id`. Explanation prompt version persisted on
  recommendations. Delete-then-insert stays (single-writer per submission).
- **I9 Labels and dialogue — MODIFY.** Dedup keeps all direction
  memberships. Rank 1 is always labeled "Best fit"; direction labels go on
  ranks 2–3 only. Analysis prompt asks explicitly for spoken dialogue vs
  singing; candidate prompt asks whether the proposed section is vocal.
  "Current" direction stays as the model's best knowledge, labeled in the
  admin as unverified; creator-facing copy never claims trend status.
- **I10 Failure/billing UX — MODIFY.** After `failed`, the results page
  shows "Something went wrong on our side. We're on it." and stops polling;
  admin retry restores it. Thanks page polls entitlement before "You're
  in". Stripe customer portal link for cancellation (Stripe-hosted, no
  code). Selection is exclusive (selecting clears other selections);
  feedback state loads from the server on refresh.

## Minor

- **M1 — ACCEPT.** 4.6 cut; 3.12 reduced to a plain table; section-length
  nudge removed; catalog tables stay (cheap), pgvector column stays.
- **M2 — ACCEPT.** Task 0.3 rewritten for hosted Supabase (link/push/types
  by project id). Metrics RPC grants fixed. `updated_at` documented.
- **M3 — ACCEPT.** Admin gate in each admin query entry (`requireAdmin()`
  in every page/action). Redirect allowlist = localhost + thissongfits.com.
  No raw provider errors to creators. Retention disclosure line on the
  upload screen.
- **M4 — DEFER** to Friday: a 10-clip eval set.

## Rejected
- Lease/attempt tables, transactional stage writes, durable job system:
  over-built for ≤100 submissions in 5 days; the atomic status claim covers
  the realistic race. Revisit if a run is lost in practice.
- IndexedDB blob persistence across OAuth: replaced by the sign-in-first flow.
- Consuming the free allowance "on delivery" with failed-attempt accounting:
  a failed run simply never becomes `ready`, which already has that effect.

## Decisions for Dylan — ANSWERED 2026-10-06 ~21:40: 1 default (no previews), 2 option A (footer line), 3 yes (Vercel Pro + Supabase Pro), 4 yes (sign-in first). Original options kept below for the record.
1. **Previews and API rights (C8).** Default: no audio previews at launch;
   cards show artwork-free title/artist/section/reason + "Open in Spotify"
   search link. Deezer used only to verify the song exists. Alternative:
   keep Deezer previews and accept the terms risk for a 5-day pilot.
2. **Timestamp wording (C6).** Default: "Use 0:43–0:58" stays, with a
   one-line footer "Sections are our best estimate. Check it against the track."
3. **Paid plans (C7).** Default: Vercel Pro ($20/mo) and Supabase Pro
   ($25/mo) on Wednesday. Alternative: stay free and cap uploads at 50 MB.
4. **Sign-in first (I6).** Default: Google button is the first tap.

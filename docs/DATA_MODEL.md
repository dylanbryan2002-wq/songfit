# Songfit data model

Source of truth for tables, columns, status values and event names.
Update this file before writing a migration. Supabase Postgres.

Conventions (all tables): `id uuid default gen_random_uuid() primary key`,
`created_at timestamptz default now()`. Foreign keys state ON DELETE.
RLS enabled on every table.

Client access (0010): the app reads and writes every table through the service role in API routes
and server components; the browser uses the anon key only for Auth and the Storage upload. So
`anon` and `authenticated` hold NO insert/update/delete grant on any `public` table
(`revoke insert, update, delete on all tables in schema public from anon, authenticated`), and the
only client policies left are `creators: read own` and `subscriptions: read own` (harmless, unused).
A new client policy needs a new grant too, on purpose.

## creators
One row per sign-in (Google or anonymous). Mirrors `auth.users`.

| column        | type        | notes                              |
|---------------|-------------|------------------------------------|
| id            | uuid        | = auth.users.id                    |
| email         | text        | unique, nullable since 0009: null = anonymous visitor (Supabase anonymous sign-in) |
| claim_token_hash | text     | nullable, unique; sha256 hex of the one-time `sf_claim` cookie token set by `POST /api/claim` on an anonymous row; nulled by `claim_anonymous()` |
| display_name  | text        | nullable                           |
| preferences   | jsonb       | nullable, future CreatorPreference |
| created_at    | timestamptz |                                    |

RLS: creator reads own row. No update policy (dropped in 0010: it let a visitor rewrite `email`
and squat someone else's address). Written only by the service role and the auth trigger.

Anonymous creators (email null) upload and run like any creator, capped at
`LIMITS.dailyUploadsAnonymous` (3) per 24 h, and never see the picker: the results page shows a
sign-in gate. On Google sign-in the callback moves their submissions and events to the Google
creator with `claim_anonymous()`. The emptied anonymous row stays.

## submissions
A creator's upload and its pipeline state.

| column            | type        | notes                                             |
|-------------------|-------------|---------------------------------------------------|
| id                | uuid        |                                                   |
| creator_id        | uuid        | → creators ON DELETE CASCADE                      |
| video_path        | text        | Supabase Storage path, bucket `videos`            |
| playback_path     | text        | nullable, storage path of the H.264 mp4 playback copy (`<creator>/<submission>.playback.mp4`, next to the original); null when the transcode failed, was skipped, or has not run. Results page plays it when set |
| duration_seconds  | numeric     | nullable until probed                             |
| creator_intent    | text        | nullable, the "Anything else?" note (trimmed, ≤ 140 chars since 0008; older rows ≤ 300, "what do you want this to feel like") |
| vibe_tags         | text[]      | not null default '{}'; "How should it feel?" chips, 0–3, each one of VIBE_TAGS (`src/shared/vibe.ts`) |
| content_category  | text        | nullable, set by analysis; used for niche metrics |
| status            | text        | see Status                                        |
| error             | text        | nullable, last failure message                    |
| analyzed_at       | timestamptz | nullable                                          |
| recommended_at    | timestamptz | nullable                                          |
| viewed_at         | timestamptz | nullable, first results view                      |
| updated_at        | timestamptz | set by trigger on every update; used for stale-run detection |
| created_at        | timestamptz |                                                   |

Status (advance in order, retry from the failed stage):
`uploaded` → `analyzing` → `recommending` → `ready`, or `failed`.

RLS: service role only since 0010 (the "read own" policy was unused and let an anonymous visitor
read the raw `error`). NO authenticated insert policy: rows are created only by the service role
through `create_submission()`.

## video_analyses
One per submission. Output of src/analysis.

| column              | type        | notes                                   |
|---------------------|-------------|-----------------------------------------|
| id                  | uuid        |                                         |
| submission_id       | uuid        | → submissions ON DELETE CASCADE, unique |
| summary             | text        |                                         |
| content_type        | text        |                                         |
| setting             | text        | nullable                                |
| story               | text        | nullable                                |
| aesthetic           | text[]      |                                         |
| mood                | text[]      |                                         |
| energy              | text        | low / medium / medium-high / high       |
| pacing              | text        | slow / medium / fast                    |
| dialogue_present    | boolean     |                                         |
| transcript          | text        | nullable, from Whisper                  |
| important_moments   | jsonb       | [{ time: number, type: string, note?: string }] |
| content_category    | text        | one of CONTENT_CATEGORIES; mirrored onto submissions   |
| music_brief         | text        | natural-language brief                  |
| music_brief_fields  | jsonb       | structured brief (moods, energy 0..1, tempo, vocals, genres, familiarity; `music_job` since analyze-v6: quiet_bed / drive_energy / emotional_lift / comic_cue / familiar_anthem, absent on older rows) |
| prompt_version      | text        |                                         |
| raw_response        | jsonb       | nullable, for debugging                 |
| video_profile       | jsonb       | nullable. New engine (Dylan, 2026-10-11): the video read into the song dictionary — feelings (11, 0–1), source readings (words, colour, voice, faces), combined energy and mood, vocals preference, lyric themes fit/avoid, content type (+ story feeling), key moments, confidence. Written only when the new engine is on. |
| profile_prompt_version | text     | nullable, PROMPT_VERSION of the video-profile call |
| measured_pacing     | jsonb       | nullable. Measured by ffmpeg on the upload: cuts_per_minute, median_shot, motion_peak, energy (0–1). |
| created_at          | timestamptz |                                         |

RLS: service role only since 0010 (the unused "read own" policy exposed `raw_response`).

## candidates
Every song the engine considered for a submission. Makes ranking inspectable.

| column            | type        | notes                                              |
|-------------------|-------------|----------------------------------------------------|
| id                | uuid        |                                                    |
| submission_id     | uuid        | → submissions ON DELETE CASCADE                    |
| song_id           | uuid        | nullable, → songs ON DELETE SET NULL (catalog, later) |
| title             | text        |                                                    |
| artist            | text        |                                                    |
| deezer_id         | text        | nullable; set when verified via Deezer, and on an unverified row whose Deezer match had no sample (no_sample) |
| duration_seconds  | numeric     | nullable, from the verifying provider              |
| verified          | boolean     | true only for a Deezer match with a 30 s preview (samples-only rule, 2026-10-07); false = dropped, never shown |
| proposed_start    | numeric     | seconds                                            |
| proposed_end      | numeric     | seconds                                            |
| anchor_seconds    | numeric     | the model's claimed musical hit inside the window   |
| section_is_vocal  | boolean     | lead vocals in the proposed section                 |
| section_reason    | text        | what happens musically at the section               |
| fit_reason        | text        | why it fits this video                              |
| directions        | text[]      | every generation direction that proposed it         |
| canonical_title   | text        | nullable, provider's title verbatim                 |
| canonical_artist  | text        | nullable, provider's artist verbatim                |
| artwork_url       | text        | nullable, from the verifying provider               |
| deezer_url        | text        | nullable, from Deezer                               |
| preview_url       | text        | nullable; always set on verified rows since 2026-10-07 (snapshot, expires ~1 h; the picker re-fetches by deezer_id) |
| preview_source    | text        | nullable, 'deezer' ('itunes' never written)          |
| itunes_id         | text        | nullable; set only on older rows verified via the removed C1 iTunes fallback; always null for new rows |
| source            | text        | 'model', or 'catalog' for a song matched from the song library (src/engine/catalog/library.data.json) |
| segment_id        | uuid        | nullable, → song_segments ON DELETE SET NULL (later) |
| aligned_to_moment | numeric     | nullable, video time the anchor was aligned to      |
| component_scores  | jsonb       | { semantic, emotional, aesthetic, pacing, dialogue, cultural, originality } each { score, reason } |
| total_score       | numeric     | nullable until scored                              |
| prompt_version    | text        |                                                    |
| engine            | text        | nullable. 'old' or 'new' (closeness matching, 2026-10-11): which engine made the row |
| created_at        | timestamptz |                                                    |

RLS: service role only. Creators never read candidates.

## recommendations
The ranked picks shown to the creator: up to 15 (at least 3), shown 5 at a time.

| column          | type        | notes                                   |
|-----------------|-------------|-----------------------------------------|
| id              | uuid        |                                         |
| submission_id   | uuid        | → submissions ON DELETE CASCADE         |
| candidate_id    | uuid        | → candidates ON DELETE SET NULL         |
| rank            | int         | 1..15; unique per submission (0005)     |
| direction_label | text        | "Best fit", "Safe bet", "Recent" (older rows: "More current"), "Unexpected" |
| title           | text        |                                         |
| artist          | text        |                                         |
| start_seconds   | numeric     |                                         |
| end_seconds     | numeric     |                                         |
| explanation     | text        | creator-facing, tied to the video       |
| spotify_url     | text        | constructed search link, no API         |
| deezer_url      | text        | nullable                                |
| artwork_url     | text        | nullable                                |
| preview_url     | text        | nullable, 30s Deezer preview snapshot   |
| selected              | boolean     | default false; at most one true per submission     |
| rejected              | boolean     | default false                                      |
| explain_prompt_version| text        | nullable                                           |
| aligned_to_moment     | numeric     | nullable                                           |
| engine                | text        | nullable. 'old' or 'new': which engine made the pick (rollback and comparison) |
| created_at      | timestamptz |                                         |

RLS: service role only since 0010 (the unused "read own" policy let an anonymous visitor read
the picks past the sign-in gate).

## events
Metrics. One row per creator action or pipeline milestone.

| column         | type        | notes                             |
|----------------|-------------|-----------------------------------|
| id             | uuid        |                                   |
| creator_id     | uuid        | nullable, → creators ON DELETE SET NULL |
| submission_id  | uuid        | nullable, → submissions ON DELETE SET NULL |
| name           | text        | one of the names below            |
| metadata       | jsonb       | nullable, e.g. { rank: 1 }        |
| created_at     | timestamptz |                                   |

Allowed event names (add here before using):
```
signed_up
submission_created
upload_completed
analysis_completed
recommendations_ready
recommendations_viewed
recommendation_selected      metadata.rank
recommendation_rejected      metadata.rank
all_rejected
more_like_this_requested     metadata.rank
paid_offer_viewed
paid_offer_clicked
paid
returned_with_second_submission
pipeline_failed              metadata.stage, metadata.error
song_previewed               metadata.rank
explanation_opened           metadata.rank
title_copied                 metadata.rank
open_app                     metadata.rank, metadata.destination (tiktok|instagram|spotify)
song_not_found               metadata.rank  (creator could not find the song in TikTok/Instagram)
more_requested               metadata.batch (2|3)  (creator tapped "Show 5 more")
wanted_instead               metadata.text (≤ 200 chars)  ("None of these?" answer)
landing_viewed               metadata.flow_id  (creator_id null; signed-out landing page shown)
video_chosen                 metadata.flow_id  (creator_id null; a valid video chosen before sign-in)
sign_in_started              metadata.flow_id  (creator_id null; "Continue with Google" tapped, file kept on device)
sign_in_completed            metadata.flow_id  (creator set; back from Google and the kept file was found)
vibe_set                     metadata.tags, metadata.has_note  (at submission creation, only when tags or creator_intent are non-empty; has_note = creator_intent non-empty)
feel_filter_relaxed          metadata.tags, metadata.step (2 or 3), metadata.count  (new engine: the feel-button filter left too few songs and was loosened; step 2 = low/flagged labels, 3 = neighbour feeling + unlabelled songs)
anon_session_started         metadata.flow_id  (creator = the new anonymous id; landing page signed in anonymously after a valid pick)
results_gate_viewed          (creator = anonymous id, submission set; anonymous viewer shown the sign-in gate on a ready result)
results_gate_signed_in       metadata.moved  (creator = Google creator; back from Google with an sf_claim cookie, moved = submissions claimed)
stale_restart                metadata.status  (creator = submission owner; the status poll restarted a run untouched for 6 min; at most LIMITS.maxStaleRestarts (2) per submission, counted from these rows)
signed_out                   (creator set; "Sign out" tapped on the upload screen or the results header, before the session is cleared)
account_viewed               (creator set; "My Songfits" at /account rendered for a Google creator, every page of it)
submission_deleted           metadata.had_choice  (creator set, submission null; a Google creator deleted one of their videos, logged only after the deletion succeeded; had_choice = a song was selected)
account_deleted              metadata.submissions  (creator null; a Google creator deleted their account, logged only after every step succeeded; submissions = how many were deleted)
welcome_email_sent           (creator set; first Google sign-in, logged only when Resend answered 2xx; never logged without RESEND_API_KEY)
```

RLS: service role only.

The four landing events are written by `POST /api/landing-events` (body `{ name, flow_id }` only,
≤ 200 bytes, 30/min per IP). `flow_id` is a random UUID per browser tab; no filename, size or
duration is ever sent. `sign_in_completed` requires a session. `anon_session_started` uses the same
route and requires an anonymous session.

## usage
Append-only ledger of spend against the 24 h caps (0011). One row per created submission, written by
`create_submission()` in the same transaction. The caps count this table, not `submissions`, so deleting a
video never gives the allowance back.

| column      | type        | notes                                                        |
|-------------|-------------|--------------------------------------------------------------|
| id          | uuid        |                                                              |
| creator_id  | uuid        | NOT NULL, deliberately NO foreign key: the row must survive the deletion of the submission and of the creator |
| kind        | text        | check in (`submission`)                                      |
| created_at  | timestamptz | default now()                                                |

Index `(creator_id, created_at)`. RLS enabled, no policies; all privileges revoked from `anon` and
`authenticated` (service role and `create_submission()` only).
Kept after account deletion: abuse accounting only. A row holds a bare uuid and a timestamp, no content,
no email, nothing that links back to a person once the auth user is gone. Backfilled in 0011 from the
submissions of the last 24 h.

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
  — takes a global advisory lock, then the per-creator one. Idempotent on `p_id` for the same
  creator (an existing id returns the row before any cap). Then, in order (0010):
  1. **daily cap**: `usage` rows of this creator in the last 24 h (since 0011; before, submissions) ≥ 15 (10 until 0013)
     (`LIMITS.dailyUploadsPerCreator`), or ≥ 3 (`LIMITS.dailyUploadsAnonymous`) when the
     creator's `email is null` → raises `daily_limit`. The route answers 429 `{ error: "daily_limit" }`.
  2. **global ceiling**: `usage` rows site-wide in the last 24 h (since 0011) ≥ 150 → raises
     `global_limit`. The route answers 429 `{ error: "global_limit" }`; the form says
     "We're at capacity right now. Try again in a bit."
  3. **paywall**: counts the creator's `ready` rows plus in-flight rows
     (`uploaded|analyzing|recommending` updated in the last 10 minutes), raises
     `needs_subscription` when count ≥ 1000 (0006, paywall off) and not subscribed.
  Otherwise inserts the row and one `usage` row (0011), and returns the submission. The current body is in 0013. The numbers are literals in the function; a unit test
  (`tests/shared/limitsMatchMigration.test.ts`) keeps them equal to `src/shared/config.ts`.
- `claim_submission_run(p_id uuid) returns submissions` — one conditional
  update: moves `uploaded|failed` to `analyzing`, or re-claims an in-flight
  row whose `updated_at` is older than 6 minutes (status unchanged so the
  runner resumes from stored outputs). Never touches `ready`. Returns the
  row, or null when nothing was claimed.
- `metrics_summary() returns jsonb` — one jsonb: eventCounts, funnel (distinct submissions and
  distinct creators per milestone; since 0009 a creator counts only when `creators.email is not null`,
  and the creator of a submission event is `submissions.creator_id`, so events logged under the
  anonymous id before a claim still count for the real creator and unclaimed runs never count as creators), uploadToReadySeconds[], readyToSelectionSeconds[], byCategory
  (submissions aggregated before any event join), paidCreators (distinct creators with an active
  subscription), paidEvents, returningCreators (>= 2 submissions, email not null). Read by `src/db/queries/metrics.ts`.
- `set_recommendation_feedback(p_submission_id uuid, p_rank int, p_selected boolean, p_rejected boolean) returns int`
  — select or reject one recommendation by rank (1..15; the table check bounds it). Selecting clears
  `rejected` on that row and `selected` on the others. Returns rows updated.
- `claim_anonymous(p_token_hash text, p_creator_id uuid) returns int` (0009) — locks the anonymous
  creator row with that `claim_token_hash` (email null, id ≠ p_creator_id), moves its submissions and
  events to `p_creator_id`, nulls the hash, returns submissions moved (0 when no row matches, so a
  second call is a no-op). Called by `/auth/callback` with the service role.
- `exec_sql(sql text) returns void` — test helper that runs a SQL script (loads
  `supabase/seed/metrics_fixture.sql` in the integration test). Service role only.

## subscriptions
Written by the Stripe webhook.

| column              | type        | notes                              |
|---------------------|-------------|------------------------------------|
| id                  | uuid        |                                    |
| creator_id          | uuid        | → creators ON DELETE CASCADE       |
| stripe_customer_id  | text        |                                    |
| stripe_subscription_id | text     | nullable, plain UNIQUE (nulls allowed) |
| status              | text        | active / canceled / past_due       |
| started_at          | timestamptz |                                    |
| created_at          | timestamptz |                                    |

RLS: creator reads own.

## Catalog tables (created now, empty until after launch)

### songs
id, title, artist, deezer_id (unique, nullable), itunes_id (nullable), genres text[], moods text[],
aesthetics text[], energy numeric nullable, bpm numeric nullable,
vocal_type text nullable, language text nullable, cultural_tags text[],
created_at.

### song_segments
id, song_id → songs ON DELETE CASCADE, start_seconds, end_seconds,
label text (intro/verse/pre-chorus/chorus/drop/bridge/break/hook),
description text, moods text[], energy numeric nullable,
lyrics_snippet text nullable, embedding vector(1536) nullable (pgvector),
created_at.

### song_trend_signals
id, song_id → songs ON DELETE CASCADE, platform text (tiktok/instagram),
popularity_score numeric, growth_score numeric, saturation_score numeric,
content_categories text[], observed_at timestamptz, source text (manual/api),
created_at.

RLS on all three: service role only.

## Storage
Bucket `videos`, private. Path `{creator_id}/{submission_id}.{ext}`.
`allowed_mime_types` (0010): `video/mp4`, `video/quicktime`, `video/x-m4v`, `video/webm`, `video/3gpp`.
Policies on `storage.objects`: `videos: read own folder` (select), and `videos: upload own folder`
(insert, authenticated), which since 0010 also requires the name to be exactly
`<auth.uid()>/<uuid>.(mp4|mov|webm|m4v)`. The insert policy stays because files over 6 MB go up by
TUS with the user's own JWT (`components/upload.ts`); small files use the server-issued signed URL.
Drop the policy only after TUS moves to the signed-upload token (`/upload/resumable/sign` +
`x-signature`).
Max upload 150 MB (the `videos` bucket limit from 0001; the Supabase dashboard global upload cap must be set to at least 150 MB, Pro plan), max duration 180 s. Signed URLs for admin playback.

## Paywall status (2026-10-07)

Dylan lifted the one-free-result gate until Stripe ships: `0006_paywall_off.sql` redefines
`create_submission()` with the free limit raised to 1000 per creator, and `PAYWALL_ENABLED = false`
in `src/shared/config.ts` skips the UX pre-check. Re-tighten both when the paywall ships (Phase 4
Task 4.3).

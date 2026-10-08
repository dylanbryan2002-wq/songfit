# Songfit data model

Source of truth for tables, columns, status values and event names.
Update this file before writing a migration. Supabase Postgres.

Conventions (all tables): `id uuid default gen_random_uuid() primary key`,
`created_at timestamptz default now()`. Foreign keys state ON DELETE.
RLS enabled on every table.

## creators
One row per Google sign-in. Mirrors `auth.users`.

| column        | type        | notes                              |
|---------------|-------------|------------------------------------|
| id            | uuid        | = auth.users.id                    |
| email         | text        | unique                             |
| display_name  | text        | nullable                           |
| preferences   | jsonb       | nullable, future CreatorPreference |
| created_at    | timestamptz |                                    |

RLS: creator reads/updates own row.

## submissions
A creator's upload and its pipeline state.

| column            | type        | notes                                             |
|-------------------|-------------|---------------------------------------------------|
| id                | uuid        |                                                   |
| creator_id        | uuid        | → creators ON DELETE CASCADE                      |
| video_path        | text        | Supabase Storage path, bucket `videos`            |
| playback_path     | text        | nullable, storage path of the H.264 mp4 playback copy (`<creator>/<submission>.playback.mp4`, next to the original); null when the transcode failed, was skipped, or has not run. Results page plays it when set |
| duration_seconds  | numeric     | nullable until probed                             |
| creator_intent    | text        | nullable, "what do you want this to feel like"    |
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

RLS: creator reads own rows. NO authenticated insert policy: rows are created only by the
service role through `create_submission()`.

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
| music_brief_fields  | jsonb       | structured brief (moods, energy 0..1, tempo, vocals, genres, familiarity) |
| prompt_version      | text        |                                         |
| raw_response        | jsonb       | nullable, for debugging                 |
| created_at          | timestamptz |                                         |

RLS: creator reads own (via submission). Writes via service role.

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
| source            | text        | 'model' now; 'catalog' later                        |
| segment_id        | uuid        | nullable, → song_segments ON DELETE SET NULL (later) |
| aligned_to_moment | numeric     | nullable, video time the anchor was aligned to      |
| component_scores  | jsonb       | { semantic, emotional, aesthetic, pacing, dialogue, cultural, originality } each { score, reason } |
| total_score       | numeric     | nullable until scored                              |
| prompt_version    | text        |                                                    |
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
| direction_label | text        | "Best fit", "More current", "Unexpected" |
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
| created_at      | timestamptz |                                         |

RLS: creator reads own (via submission).

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
```

RLS: service role only.

The four landing events are written by `POST /api/landing-events` (body `{ name, flow_id }` only,
≤ 200 bytes, 30/min per IP). `flow_id` is a random UUID per browser tab; no filename, size or
duration is ever sent. `sign_in_completed` requires a session.

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
- `metrics_summary() returns jsonb` — one jsonb: eventCounts, funnel (distinct submissions and
  distinct creators per milestone), uploadToReadySeconds[], readyToSelectionSeconds[], byCategory
  (submissions aggregated before any event join), paidCreators (distinct creators with an active
  subscription), paidEvents, returningCreators (>= 2 submissions). Read by `src/db/queries/metrics.ts`.
- `set_recommendation_feedback(p_submission_id uuid, p_rank int, p_selected boolean, p_rejected boolean) returns int`
  — select or reject one recommendation by rank (1..15; the table check bounds it). Selecting clears
  `rejected` on that row and `selected` on the others. Returns rows updated.
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
Max upload 50 MB (Supabase free-tier per-object limit; bucket limit in 0001 is higher but the global cap wins), max duration 180 s. Signed URLs for admin playback.

## Paywall status (2026-10-07)

Dylan lifted the one-free-result gate until Stripe ships: `0006_paywall_off.sql` redefines
`create_submission()` with the free limit raised to 1000 per creator, and `PAYWALL_ENABLED = false`
in `src/shared/config.ts` skips the UX pre-check. Re-tighten both when the paywall ships (Phase 4
Task 4.3).

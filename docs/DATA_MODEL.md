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
| duration_seconds  | numeric     | nullable until probed                             |
| creator_intent    | text        | nullable, "what do you want this to feel like"    |
| content_category  | text        | nullable, set by analysis; used for niche metrics |
| status            | text        | see Status                                        |
| error             | text        | nullable, last failure message                    |
| analyzed_at       | timestamptz | nullable                                          |
| recommended_at    | timestamptz | nullable                                          |
| viewed_at         | timestamptz | nullable, first results view                      |
| updated_at        | timestamptz | trigger-maintained; used by the run claim         |
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
| content_category    | text        | nullable, same value copied to submissions |
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
| deezer_id         | text        | nullable until verified                            |
| itunes_id         | text        | nullable, set for final picks only                 |
| duration_seconds  | numeric     | nullable, from Deezer                              |
| verified          | boolean     | false = dropped, never shown                       |
| proposed_start    | numeric     | seconds                                            |
| proposed_end      | numeric     | seconds                                            |
| canonical_title   | text        | nullable, provider's title verbatim                |
| canonical_artist  | text        | nullable, provider's artist verbatim               |
| anchor_seconds    | numeric     | the model's claimed musical hit inside the window  |
| section_is_vocal  | boolean     | lead vocals in the proposed section                |
| directions        | text[]      | every generation direction that proposed it        |
| section_reason    | text        | what happens musically there                       |
| fit_reason        | text        | why it fits this video                             |
| source            | text        | 'model' now; 'catalog' later                       |
| segment_id        | uuid        | nullable, → song_segments (later)                  |
| component_scores  | jsonb       | { semantic, emotional, aesthetic, pacing, dialogue, cultural, originality } each { score, reason } |
| total_score       | numeric     | nullable until scored                              |
| prompt_version    | text        |                                                    |
| created_at        | timestamptz |                                                    |

RLS: service role only. Creators never read candidates.

## recommendations
The final 3 shown to the creator.

| column          | type        | notes                                   |
|-----------------|-------------|-----------------------------------------|
| id              | uuid        |                                         |
| submission_id   | uuid        | → submissions ON DELETE CASCADE         |
| candidate_id    | uuid        | → candidates ON DELETE SET NULL         |
| rank            | int         | 1, 2, 3; unique per submission          |
| direction_label | text        | "Best fit", "More current", "Unexpected" |
| title           | text        |                                         |
| artist          | text        |                                         |
| start_seconds   | numeric     |                                         |
| end_seconds     | numeric     |                                         |
| aligned_to_moment | numeric   | nullable, video time the anchor was aligned to |
| explanation     | text        | creator-facing, tied to the video       |
| explain_prompt_version | text | nullable                                |
| selected        | boolean     | default false; exclusive per submission |
| rejected        | boolean     | default false                           |
| spotify_url     | text        | constructed search link, no API         |
| deezer_url      | text        | nullable                                |
| artwork_url     | text        | nullable                                |
| preview_url     | text        | nullable, 30s Deezer or iTunes preview  |
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
```

RLS: service role only.

## stripe_events
Idempotency for the webhook. A row is written ONLY after an event was fully
processed; a failure before that leaves the event retryable.

| column       | type        |
|--------------|-------------|
| id           | text pk     | Stripe event id |
| type         | text        |                 |
| processed_at | timestamptz |                 |

## SQL functions (security definer, execute granted to service_role only)
- `create_submission(p_id, p_creator_id, p_video_path, p_intent) returns submissions`
  — counts the creator's `ready` rows plus in-flight rows (`uploaded|analyzing|recommending`,
  `updated_at` within 10 min); if ≥ FREE_RESULTS_PER_CREATOR and no `active` subscription,
  raises `needs_subscription`; else inserts and returns the row. The paywall lives here.
- `claim_submission_run(p_id) returns submissions` — single conditional update to
  `analyzing` when status is `uploaded|failed` or the row is stale (> 6 min); returns the
  row or nothing. Every pipeline run starts here.
- `metrics_summary() returns jsonb` — funnel by distinct submissions and creators, medians,
  by-category, paid, returning.

## subscriptions
Written by the Stripe webhook.

| column              | type        | notes                              |
|---------------------|-------------|------------------------------------|
| id                  | uuid        |                                    |
| creator_id          | uuid        | → creators ON DELETE CASCADE       |
| stripe_customer_id  | text        |                                    |
| stripe_subscription_id | text     | nullable, unique                   |
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
Max upload 150 MB, max duration 180 s. Signed URLs for admin playback.

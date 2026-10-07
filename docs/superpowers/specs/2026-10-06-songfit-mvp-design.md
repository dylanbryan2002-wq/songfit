# Songfit MVP design

Date: 2026-10-06. Target: working end to end by Thursday 2026-10-08 morning;
100 creators with recommendations and 10 subscribers by Sunday 2026-10-11.

Companion docs: docs/ARCHITECTURE.md (modules, pipeline), docs/DATA_MODEL.md
(tables, events), docs/RESEARCH.md (APIs, trend data). This spec records the
decisions and the behaviour; those docs record the structure.

## 1. Product

A creator uploads a video and optionally says how it should feel. Songfit
returns 3 real songs, each with an exact section to use and a short reason
tied to the video. The creator picks one or rejects all. The first result is
free; using Songfit again requires a $9.99/month subscription.

Not in this build: carousels, "more like this", accounts beyond Google
sign-in, catalog retrieval, trend feeds, automated audio analysis of songs.
Tables for the catalog and trend signals are created but stay empty.

## 2. Decisions (made by Dylan)

| decision | choice |
|---|---|
| Starting point | From scratch. Visual direction from the concept board: light, minimal, near-black + steel-blue gradient, Apple-like. |
| Stack | Next.js App Router, TypeScript strict, Tailwind, Supabase (Postgres, Auth, Storage), Vercel. |
| Models | Claude (analysis, candidates, scoring, explanations). OpenAI Whisper (speech). No Gemini. |
| Song pool | Model knowledge of real, released songs likely in IG/TikTok libraries. Verified via Deezer. |
| Shortlist | 75 candidates per submission (3 × 25, config value). |
| Identity | Google sign-in via Supabase Auth, asked for at the moment of submitting, not before. |
| Paywall | Hard. One free result per creator; second submission requires an active subscription. |
| Price | $9.99/month via Stripe Payment Link. |
| Domain | thissongfits.com on Vercel. |
| Scope | Video only, up to 3 minutes and 150 MB. Mobile first. |
| Retention | Keep uploaded files. |
| Market | US. Deezer/iTunes lookups and trend lists are US-oriented. |
| Existing audio in uploads | Ignored. Only speech is extracted. |
| Voice | Explanations read like a sharp friend who edits video. Second person, no hype, no emojis. |
| Admin | ADMIN_EMAILS = Dylan's Gmail only. |
| Sunday deliverable | Live demo + funnel numbers from the metrics page, in a deck. |

## 3. Creator experience

### Upload screen (`/`)
Logo. Headline "Find the right song for your content." Subline "Upload your
Reel and Songfit will find the songs that fit it best, and exactly which part
to use." One large tap target that opens the camera roll (accept video/*).
Optional single-line field "What do you want this to feel like?" Button
"Find my songs".

Tapping the button when signed out opens Google sign-in; on return the
upload starts automatically with the chosen file and intent preserved
(stored in sessionStorage). Upload goes directly from the browser to Supabase
Storage with a signed upload URL, with a progress bar. On completion the
server creates the submission and starts the pipeline.

If the creator already has a result and no active subscription, the button
leads to the paywall screen instead of uploading.

### Waiting state (`/results/[id]` while status ≠ ready)
Video thumbnail, soft progress, rotating lines: "Watching your video",
"Understanding the feel", "Finding your songs". Polls status every 3 s.
Expected 60–120 s. After 4 minutes with no result, show "This is taking
longer than usual, we'll keep trying" and keep polling; the admin sees the
failure.

### Results screen (`/results/[id]` when ready)
Heading "Your Songfit". Three cards, #1 larger. Card: artwork, title, artist,
direction label (Best fit / More current / Unexpected), bold "Use 0:43–0:58",
two-sentence explanation, preview play button when a preview exists, "Open in
Spotify" link (search URL). Buttons: "Use this", "Not for me".

"Use this": marks it chosen, collapses the other two, shows the offer "Want
Songfit for your next posts?" with the subscribe button. "Not for me" on all
three: shows "Want 3 different directions?" which logs `all_rejected` and
`more_like_this_requested` and shows the same offer. Every action writes an
event.

### Paywall (`/subscribe`)
Shown when a creator with a prior result tries to submit again. One line of
value, price, Stripe Payment Link button prefilled with their email
(`?prefilled_email=`). Events: `paid_offer_viewed`, `paid_offer_clicked`.
After payment Stripe redirects to `/subscribe/thanks`; the webhook marks the
subscription active; the upload screen unlocks.

## 4. Pipeline behaviour

Status: uploaded → analyzing → recommending → ready | failed. Each stage is
idempotent and retried from the failed stage. The pipeline runs inside
`POST /api/submissions/[id]/run` (Vercel function, maxDuration 300).

### Analyze
1. Download the video to /tmp. ffprobe for duration; reject > 180 s.
2. ffmpeg: 1 frame per second, capped at 60 frames evenly spread, 512 px wide,
   JPEG. Audio track to 16 kHz mono wav.
3. Whisper transcription of the audio. Empty or music-only audio yields an
   empty transcript; `dialogue_present = transcript has ≥ 5 words`.
4. Claude call `analyzeVideo`: frames (with timestamps), transcript, creator
   intent, duration → VideoAnalysis + MusicBrief (Zod). The brief combines
   what the video is with what the creator wants it to become. If no intent,
   the model infers a likely direction and says so in the brief.
5. Persist video_analyses; set content_category on the submission.

### Recommend
1. `generateCandidates`: three parallel Claude calls with the brief and key
   moments, each asking for 25 real songs with a different emphasis: safe and
   recognisable; currently popular on IG/TikTok; unexpected or niche. Each
   item: title, artist, proposed_start, proposed_end, section reason, fit
   reason, direction tag. Deduplicate by normalised title + artist.
2. `verifyCandidates`: Deezer search per candidate, throttled to ~8/s.
   Accept when normalised title and artist both match. Attach deezer_id,
   duration, artwork, link. Clamp or drop sections outside the track.
   Unverified candidates stay in the table with verified = false.
3. `scoreCandidates`: one batched Claude call returns, per verified
   candidate, scores and one-line reasons for semantic, emotional,
   aesthetic, pacing, cultural, originality. Rule-based: dialogue fit
   (penalise vocal sections when dialogue_present), overuse penalty from
   `config/overused.ts`. Weights in `weights.ts`. Store component_scores and
   total_score on each candidate row.
4. `diversify`: #1 = top total. #2 = top among a different direction tag.
   #3 = top among the remaining tag. Fallback to next best overall when a
   tag is empty.
5. `selectSections`: enforce 12–20 s inside the track; if the video has a
   `main_visual_reveal` or equivalent at time T, shift so the described hit
   lands at T; ensure the three picks are not all the same section length.
6. `explain`: one Claude call rewrites the three explanations in the Songfit
   voice from the scoring reasons and the analysis.
7. Fetch previews for the 3 picks (Deezer preview; iTunes fallback). Persist
   recommendations, status = ready, event `recommendations_ready`.

### Model and prompt rules
Every call lives in one file with its prompt and an exported PROMPT_VERSION,
stamped on the rows it produces. Responses parsed with Zod; on failure the
raw text is attached to the error and the stage fails. Model ids come from
`src/shared/config.ts`.

## 5. Error handling

- Any stage failure: submission.status = failed, submission.error = message,
  event `pipeline_failed` with stage and error. The creator keeps seeing the
  waiting state with the "taking longer" line; the admin queue shows the
  failure with a Retry button that re-runs from the failed stage.
- Fewer than 3 verified candidates after verification: re-run candidate
  generation once with a note that the previous list could not be found on
  Deezer; if still < 3, fail the stage.
- Model returns malformed JSON: one retry with the parse error in the prompt,
  then fail.
- Upload interruptions: the client retries the signed upload; a submission
  row is only created after Storage confirms the object.
- Stripe webhook: verify signature, idempotent on event id, log and 200 on
  unknown event types.
- Timeouts: if the pipeline nears 280 s, persist what exists and fail the
  current stage cleanly so Retry can continue.

## 6. Admin (`/admin`, gated by ADMIN_EMAILS)

- Queue: submissions table with creator email, status, timings
  (upload → ready), category, buttons: open, retry.
- Inspector: video player (signed URL), analysis JSON, brief, transcript,
  every candidate sorted by total with verified flag and component scores,
  the final 3, the creator's events for this submission.
- Metrics: counts for each event name, funnel (created → ready → viewed →
  selected / rejected → offer viewed → clicked → paid), median upload→ready
  and ready→selection, breakdown by content_category, returning creators.
  Server-rendered, no charts.

## 7. Testing

Unit tests (Vitest) on pure logic with model calls stubbed:
- Zod schemas: accept good model output, reject malformed.
- Normalised title/artist matching for Deezer verification.
- Scoring combination and weights; dialogue penalty; overuse penalty.
- Diversification picks across tags and falls back correctly.
- Section selection: clamping, reveal alignment, length rules.
- Event name validation.
- Paywall rule: free first result, blocked second without subscription.

Integration check before Thursday: one real video through the pipeline
locally, then one on Vercel, then one from a phone over the public URL.
No UI tests.

## 8. Setup on Dylan's side

1. `sudo xcodebuild -license accept` (unblocks git, ffmpeg install).
2. Supabase project; enable Google provider; create a Google Cloud OAuth
   client with the Supabase callback URL.
3. Anthropic and OpenAI API keys.
4. Stripe account; one $9.99/month product; Payment Link with success URL
   `/subscribe/thanks`; webhook to `/api/stripe/webhook`.
5. Vercel project linked to the GitHub repo; add thissongfits.com.
6. Env vars from `.env.example` into Vercel.

## 9. Out of scope, designed for

Catalog tables and vector column exist. `candidates/` has a single source
today; a second source (vector retrieval over song_segments) merges in later.
`sections/` is a separate module to be replaced by audio-structure analysis.
`song_trend_signals` is empty; the Instagram Audio API is the first feed to
add. "More like this" and carousels are events and UI only, no engine change.

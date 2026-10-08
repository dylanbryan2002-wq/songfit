# 18 — Ground-truth eval: viral clips vs our engine, with Gemini as a second watcher

2026-10-08. Dylan's go: "ok ill take your rec but i want gemini doing the analysis then sending
that back to you to figure out how that then makes the rec engine better."

## Goal

A repeatable script that takes screen recordings of viral Reels/TikToks whose song and start
second we know, runs our production engine on them (muted), has Gemini watch the same clips
natively (video + audio), and writes one report that says: hit rate, section error, and for every
miss which stage lost it. Claude reads the report and proposes the next prompt changes.
Nothing here ships to creators. Nothing is persisted to Supabase.

## Terms read (2026-10-08, ai.google.dev/gemini-api/terms, /docs/pricing, /docs/video-understanding)

- Unpaid tier: "Google uses the content you submit to the Services and any generated responses to
  provide, improve, and develop" its products, and "human reviewers may read, annotate, and process
  your API input and output." Paid tier: "Google doesn't use your prompts or responses to improve our
  products"; "Google logs prompts and responses for a limited period of time, solely for detecting
  and preventing violations." Pricing page, free tier: "Content used to improve our products"; paid:
  "Content not used to improve our products."
  → **Use the paid tier only** (billing enabled on the Google AI Studio project). The clips are other
  people's content; we do not hand them to a training set.
- "You may not use the Services to develop models that compete with the Services." We tune prompts
  for a song recommender; we do not train a model. No benchmarking or evaluation ban found.
- "for developers building with Google AI models for professional or business purposes … not for
  consumer use." Our use is internal evaluation. Fine.
- Video: "Frames are extracted at 1 FPS and placed into context." "Audio is processed at 1Kbps
  (single channel)", "processing information from both the audio and visual streams." Custom `fps`
  and `start_offset`/`end_offset` clipping supported. ~100 tokens per video second at low media
  resolution, ~300 at high. Files API: "Files are automatically deleted after 48 hours."
  → Gemini's frame rate is the same as ours (1 fps). What it adds is native audio and whole-clip
  temporal context. We set `fps` to 4 for clips under 30 s so it sees cuts and beats we miss.
- Model: `gemini-3.1-pro-preview` ($2 / $12 per M tokens, ≤200k prompts). A 30 s clip at high
  resolution is ~9k tokens → about 2 cents per pass. `gemini-3.8-flash` as the cheap fallback.
- SDK: `@google/genai`, `import { GoogleGenAI } from "@google/genai"`, reads `GEMINI_API_KEY`.
  The implementer verifies `files.upload` + `generateContent` with video against the SDK's README
  (the docs page shows the Interactions API, not generateContent).

## Inputs (Dylan)

`~/Songfit-groundtruth/videos/<any-name>.(mp4|mov)` and `~/Songfit-groundtruth/clips.csv` with
columns: `file, link, niche, song, artist, start_seconds, views, typical_views, notes`.
`typical_views` and `notes` may be empty. One row per file. Nothing from this folder is ever
committed, uploaded to Supabase, or sent anywhere except the Gemini and Anthropic APIs.

Secret: `GEMINI_API_KEY` in the local env file, entered by Dylan (paid tier). The script fails fast
with a plain message when it is missing.

## Steps per clip

1. **Mute.** ffmpeg `-an` → `~/Songfit-groundtruth/work/<id>.muted.mp4`. Also probe duration.
2. **Our engine, muted.** Run the production analysis (frames + Whisper on the muted file → Whisper
   returns nothing, expected) and the full recommend stage (candidates → Deezer verify → score →
   diversify → sections → explain) exactly as production, DB writes stubbed like
   `scripts/quality-run.ts`. Keep: VideoAnalysis, MusicBrief, the full candidate list with
   verification status and scores, the 15 picks with sections.
3. **Gemini, muted.** `gemini-3.1-pro-preview`, `fps: 4` when duration ≤ 30 s, prompt asks for the
   same shape as our VideoAnalysis + MusicBrief (summary, content type, key moments with seconds,
   energy, pacing, mood, aesthetic, the brief in words and fields). Parsed with Zod. Raw text kept.
4. **Gemini, with sound.** Same model on the original. Prompt: identify what the music is doing at
   each visual moment (where the hook/drop/vocal entry lands relative to cuts and the key moment),
   describe the song's role (contrast, amplify, punchline, trend-recognition), and say in one line
   why this song works for this clip. Also asks Gemini to name the song if it recognises it
   (recorded, not trusted; Dylan's CSV is the truth).
5. **Compare.**
   - Hit: real song (title+artist, loose match like `src/engine/catalog` normalisation) is in our 15.
     Artist-hit: same artist, different song. Miss otherwise.
   - On hits: our start second minus the real start second (absolute error), and our rank.
   - On misses, which stage lost it: `not_generated` (never in the candidate list),
     `unverified` (generated, dropped by Deezer / no sample), `scored_out` (verified, below the 15),
     `diversified_out` (top 15 by score but cut by diversify).
   - Brief diff: our analysis vs Gemini-muted on energy, pacing, mood, category, key-moment seconds.
   - Role diff: what Gemini-with-sound says the song does vs what our brief asked for.
6. **Report.** `~/Songfit-groundtruth/reports/<date>-<tag>.md`: one summary table (clips, hit rate,
   artist-hit rate, median section error, misses by stage), then one section per clip with the
   real song, our top 5, the stage verdict, and the three briefs side by side. Plus `<date>-<tag>.json`
   with everything, for the next round to diff against.

## What Claude does with the report

Reads it, groups the misses by stage, and proposes prompt changes (candidates-v6, scoring-v4,
analyze-v5 as needed) with the specific clips that motivated each. Reruns the script after each
change with a new tag; the hit rate must not fall. Gemini's briefs are evidence for what our
analysis prompt should ask for; its "song role" lines are evidence for what the candidates prompt
should ask for. Gemini is not wired into production.

## Build

`scripts/groundtruth/` (run with `pnpm local scripts/groundtruth/run.ts [--tag t] [--only id]`):
`intake.ts` (CSV + ffmpeg), `ours.ts` (engine run, stubbed DB), `gemini.ts` (two calls, Zod),
`compare.ts` (pure, unit-tested), `report.ts`. Dependency added: `@google/genai`. Unit tests for
`compare.ts` (hit / artist-hit / stage attribution / section error) and the CSV parser. No app code
changes. Engine code is imported, never modified.

Cost per clip: our engine ≈ $0.40, Gemini ≈ $0.05, Whisper on silence ≈ $0.01. 20 clips ≈ $10 per pass.

## Risks

- Muting removes voiceover. Clips whose speech matters get a worse brief from our side than
  production would give. Recorded per clip in the CSV `notes`; accepted for round one.
- Gemini's song identification can be wrong; it is never used as truth.
- Screen recordings may carry the platform UI (captions, like counts). The analysis prompt is told
  it is a screen recording and to ignore the overlay.

## Revision 2026-10-08: Gemini via the app, pasted answers

Dylan's go: no API key, no `@google/genai`. He uploads each clip (with sound) to the consumer Gemini
app himself with the prompt in `scripts/groundtruth/GEMINI_PROMPT.md` (exported as `GEMINI_PROMPT`,
`PROMPT_VERSION` = `gemini-paste-v1`) and pastes the whole reply into
`~/Songfit-groundtruth/gemini/<id>.md`, where `<id>` is the clip's slug (the file name, lower-cased,
non-alphanumerics → `-`, no extension; the script prints it). Steps 3 and 4 above collapse into that
one reply: a free-text section plus one ```json block carrying our analysis fields, the song as Gemini
heard it (recorded, never trusted), the music section (section start in the song, what the music does at
each visual moment, role, why it works) and a brief in our MusicBrief vocabulary. `gemini.ts` extracts the
first ```json block, parses it with Zod (extra keys dropped, listed keys strict) and throws with the raw
paste attached; a missing file shows as "no Gemini analysis yet" in the report and does not stop the run.
`--skip-gemini` means "do not read the gemini folder". The terms section above still applies to the app:
use a paid Google account so the clips are not used for training.

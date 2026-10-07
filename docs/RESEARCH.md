# Research notes

Running log of what we learn about the music / short-form space. Append, date
each entry, link sources. Used to make engine and data decisions.

## 2026-10-06 — Song identity, previews, trend data, structure analysis

### Spotify Web API is no longer a good default for new apps
- Nov 27 2024: Spotify removed `audio_features`, `audio_analysis`, and
  `preview_url` for apps created after that date. No replacement.
- New apps sit in Development Mode: capped test users, per-developer quota,
  search `limit` reduced to 10, owner must hold Premium (2026 changes).
  Extended access needs a registered business with 250k MAU.
- Decision: do NOT depend on Spotify for verification or previews. Deep link
  creators to Spotify via a search URL (`open.spotify.com/search/<title> <artist>`),
  which needs no API.
- Sources: https://developers.brizm.dev/blog/spotify-api-changes-2026/ ,
  https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access ,
  https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates

### Deezer public API — chosen for song verification
- No auth for public read endpoints. Search: `https://api.deezer.com/search?q=artist:"X" track:"Y"`.
- Returns title, artist, duration (s), 30 s `preview` mp3, album cover sizes, link.
- Community-documented quota ~50 requests / 5 s per IP. Enough for 75
  candidates per submission with light throttling.
- Risk: preview links can expire; store the Deezer track id and re-fetch on
  render. US catalog coverage is good for mainstream releases.
- Source: https://providers.apievangelist.com/providers/deezer/ ,
  https://minim.readthedocs.io/en/dev/api-ref/minim.api.deezer.DeezerAPIClient.html

### iTunes Search API — preview fallback
- Free, no auth, stable 30 s `previewUrl`, `trackTimeMillis`, artwork.
- ~20 calls / minute, so only use it for the final 3, not for 75 candidates.
- Source: https://performance-partners.apple.com/resources/documentation/itunes-store-web-service-search-api/

### Trend data: what is legitimately available
- **Instagram Audio API (official, Meta).** `GET /ig_audio?audio_type=music&user_id=…`
  returns trending music by default when no query is given. Fields: audio_id,
  title, display_artist, duration_in_ms, cover art, is_ads_eligible.
  Needs an Instagram Business/Creator account, a connected Facebook Page, a
  Facebook app, and `instagram_content_publish` permission (app review).
  This is the best legitimate source for "what's trending on IG right now".
  Plan: set up after launch, poll daily into `song_trend_signals` with
  platform = instagram, source = api.
  Source: https://developers.facebook.com/documentation/instagram-platform/content-publishing/audio-api
- **TikTok Creative Center** removed its public trending songs list in the
  2026 redesign. No official trending-sounds API for third parties.
  Source: https://bir.ch/blog/tiktok-creative-center
- **TikTok Commercial Music Library (CML)** trending lists are reachable only
  through posting-API wrappers (bundle.social, upload-post.com) that need a
  connected TikTok Business account and a paid plan. CML is the
  pre-cleared business catalog, not the consumer library, so its trending
  list is a weak proxy for creator trends. Low priority.
  Sources: https://bundle.social/tiktok-commercial-music-library ,
  https://docs.upload-post.com/api/get-tiktok-music
- **Soundcharts / Chartmetric** aggregate TikTok and Instagram usage metrics
  per song (TikTok velocity, social growth) via paid APIs. Right source for a
  real `song_trend_signals` feed later. Soundcharts has a free tier.
  Sources: https://soundcharts.com/en/blog/music-data-api ,
  https://orphiq.com/resources/music-analytics-platforms-compared
- Scrapers (Apify TikTok/IG audio scrapers) exist but violate platform
  terms. Out of scope by product rule.

### Audio understanding and song structure (for automated timestamps later)
- **allin1** (All-In-One Music Structure Analyzer, `pip install allin1`):
  open source, predicts BPM, beats, downbeats, and functional segments
  (intro/verse/chorus/bridge/outro) with start/end times. Needs the audio
  file. Could run on 30 s previews to locate hooks within the preview, or on
  licensed full tracks later. https://github.com/mir-aidj/all-in-one
- **pychorus**: lighter chorus finder, Goto-based. https://github.com/spinamp/pychorus
- **Cyanite**: commercial API for mood/genre/energy tagging, similarity and
  free-text search over audio; free tier; analyzes uploaded audio. Candidate
  for the catalog phase once we have audio rights. https://cyanite.ai
- **ReccoBeats**: free API returning Spotify-style features (energy,
  danceability…) from an audio file. https://reccobeats.com

### Recommendation architecture: what the literature does
- Two-stage retrieve-then-rerank is the standard for LLM music rec.
  Candidate pools of 100–500, then an LLM or cross-encoder reranker.
  Our 75-candidate shortlist is on the small side of normal; make it a config value.
- Multi-signal retrieval fused with Reciprocal Rank Fusion (dense embeddings +
  lexical + artist match) beats any single retriever. Relevant when the
  catalog exists.
- Offline, asynchronous LLM rationale generation is how YouTube Music ships
  explanations at scale. Our per-submission explanation call is fine at our volume.
- Sources: https://aclanthology.org/2026.nlp4musa-1.8.pdf ,
  https://arxiv.org/abs/2608.23484 , https://arxiv.org/abs/2609.23877

### Implications for the launch build
1. Verification provider = Deezer. Spotify dev app is no longer a setup step.
2. Candidate rows store `deezer_id`, `itunes_id` (nullable), `spotify_url`
   (constructed search link). Catalog `songs` table gets the same.
3. Preview on results page = Deezer preview, iTunes fallback, fetched for
   the final 3 only.
4. Trend signals: manual list this week; Instagram Audio API is the first
   automated feed to add after launch.

## 2026-10-07 — First real analysis run (Phase 2)
- Fable 5.1 on 1 fps frames + Whisper transcript, 4.5 s iPhone comedy clip: correct category, story, punchline moment (2.0 s), and a usable music brief with inferred ironic-contrast direction. Prompt version analyze-v3.
- Whisper (whisper-1, verbose_json) hallucinates stock phrases on near-silent audio (returned Korean "thanks for watching"). Mitigation to add: drop transcript when all segments have `no_speech_prob` > 0.8 or avg_logprob < -1, and strip a short list of known hallucination strings.
- Deployment gotcha: Vercel does not trace `ffmpeg-static`/`ffprobe-static` binaries by default → `outputFileTracingIncludes` per route group; `/api/health?binaries=1` verifies.

## 2026-10-07 — First end-to-end run (Phase 3 demo check)

Submission 09e00825 (4.5 s comedy clip, analysis already stored from Phase 2). Recommend stage run locally
with `pnpm pipeline:local <id>` against the hosted Supabase project.

What broke before it worked, in order:
1. Candidate generation truncated at 6000 output tokens. Sonnet 5.5 at default effort spent ~8k hidden
   reasoning tokens per 25-song list (text was only ~2k tokens). Fix: `effort: "medium"` on candidates and
   scoring (76 s → 21 s per call, same song/timing quality; `low` gave lazy 0–14 s windows), compact JSON,
   ≤18-word reasons, cap 12k. Prompt `candidates-v3`.
2. Deezer "error 4: Quota limit exceeded" on 29/68 lookups: 6-way concurrency alone blew ~50 req / 5 s.
   Fix: 120 ms spacing between request starts plus retry-with-backoff on the quota body.
3. Scoring truncated: 60 candidates × 6 dims needs ~170 output tokens per item, not 90. Fix: score in
   parallel chunks of 20, 220 tokens/item budget, ≤10-word reasons. Prompt `scoring-v2`.
4. One malformed candidate row forced a 21 s full retry. Fix: drop bad rows, retry only if < 20 remain.

Final run (recommend stage only; analysis stage timings are in the Phase 2 entry):

| step | calls | input tok | output tok | wall |
|---|---|---|---|---|
| candidates (3 directions, parallel) | 3 | 5.4k | 9.8k | 23 s |
| Deezer verify (69 → 47 verified, 22 not found, 0 failed) | ~90 req | — | — | 11 s |
| scoring (47 candidates, 3 chunks parallel) | 3 | 7.9k | 9.5k | 24 s |
| explain | 1 | 1.3k | 0.3k | 3 s |
| **recommend total** | 7 | 14.6k | 19.6k | **67 s** |

Cost estimate at Sonnet-class list prices ($3 / M input, $15 / M output): ≈ $0.34 per recommend run.
Confirm against the Anthropic console; add the analysis stage (Fable 5.1 + Whisper) for the per-upload total.

Output quality: 3 real songs (Darude, Sabrina Carpenter, Neil Diamond), all three directions represented,
every pick aligned to the key moment at 0:02, explanations specific to the clip. Component scores were not
clustered. 22 of 69 candidates were not found on Deezer (mostly multi-artist credits and exact-title
mismatches); worth a look at the normaliser later, not blocking.

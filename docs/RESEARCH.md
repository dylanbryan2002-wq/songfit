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

### iTunes Search API — verification fallback (not a preview source)
- Free, no auth, stable 30 s `previewUrl`, `trackTimeMillis`, artwork.
- ~20 calls / minute: paced at one per 3 s, at most 12 Deezer misses per run (C1).
- 2026-10-07 ruling: previews are Deezer-only; iTunes `previewUrl` is never read or stored.
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
3. Preview on results page = Deezer preview only (iTunes fallback dropped
   2026-10-07, C1 ruling), fetched for the final 3 only.
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

## 2026-10-07 — In-browser song previews for a TikTok-style picker

Verified by hand today (curl + Whisper on real clips), the rest from web research (agents' reports
summarised in docs/superpowers/specs/2026-10-07-song-picker-design.md):

- Deezer `preview`: 30.0 s MP3 (~480 KB, 128 kbps). CDN `cdnt-preview.dzcdn.net` sends
  `access-control-allow-origin: *` and `accept-ranges: bytes`, so the browser can both play it and
  decode it with Web Audio for a waveform. URLs are signed (`hdnea=exp=…`) and expire in about an
  hour: fetch a fresh one by track id at page load. Terms (developers.deezer.com/guidelines): no
  local/offline storage of audio, not downloadable by the end user, attribution/logo page applies.
- Which part of the song the clip is: NOT documented, so I transcribed two. Sweet Caroline's clip
  runs "Hands, touching hands…" into "Sweet Caroline" at 14 s; Manchild's runs the pre-chorus into
  "Manchild" at 17 s. Deezer cuts around the hook. Our engine's section for Sweet Caroline
  (0:44–1:00) sits just before the real chorus (~1:09), so the clip may be a better guide than the
  model's timestamp. Future idea: Whisper-timestamp the clip to anchor the section more precisely.
- iTunes `previewUrl`: 30 s M4A, CORS unconfirmed for the audio host, terms say previews are
  promotional only and must not be "synchronized with other media". Not used: previews are
  Deezer-only (C1 ruling, 2026-10-07).
- Spotify Embed iFrame API: `loadEntity`/`play`/`seek` exist, but mobile browsers get the preview
  length only, and track ids need a Web API app. Not used.
- Apple MusicKit JS: full songs for subscribers; needs the $99 Developer Program, a MusicKit key and a
  signed developer token. Realistic later route to "hear the exact section". Not this week.
- YouTube IFrame API: `start`/`seekTo` work, player must stay visible (≥ 200×200), Data API search
  quota ≈ 100 searches/day. Possible later for the top pick only.
- "Use this sound" deep links into TikTok/Instagram: no official way to get sound ids for arbitrary
  commercial songs (TikTok Commercial Music Library and Instagram Audio API cover cleared/partner
  catalogues and publish flows only). Fallback: copy "title · artist" + open the app.
- Mobile playback: Supabase signed video URL answers Range (206, verified). iOS needs `muted` +
  `playsInline` on the video and both `play()` calls inside the same tap. Dylan's `.mov` is
  `video/quicktime`; Android Chrome may need H.264 mp4 (transcode later).
- No competitor found that returns real commercial songs with an exact section for the user's video.
- **Deezer developer terms (verified 2026-10-07, developers.deezer.com/termsofuse and the CGU PDF):**
  "the use of the Services is strictly limited for a non-commercial purpose and in a non-commercial
  environment"; any other use "shall be beforehand reviewed and approved by DEEZER"; full-length
  streaming only for Premium users, "otherwise accessible only up to 30 seconds". This covers our
  verification calls too, not only previews. Codex flagged it (docs/review/07). Mitigations: kill
  switch `PREVIEWS_ENABLED`, no audio storage, attribution, approval request to Deezer, and Apple Music
  API / MusicKit as the licensed route for catalogue + previews after the challenge.

## 2026-10-07 — Why famous songs were dropped as "not found" (C1)

Measured with `scripts/probe-match2.ts` on the two real submissions (69 + 65 candidates): 33
distinct songs were dropped as unverified, most of them famous.

- **Matching too strict: 12 of 33.** Deezer's title carries a descriptor ("Dreams (2004 Remaster)",
  "Running Up That Hill (A Deal With God)", "Sunflower (Spider-Man: Into the Spider-Verse)",
  "Pure Imagination (From … Soundtrack)") or credits only the lead artist ("Post Malone" for
  "Post Malone & Swae Lee", "Mark Ronson" for "Mark Ronson & Bruno Mars", "Kendrick Lamar" for
  "Kendrick Lamar & SZA"). Fix: core title + non-disqualifying descriptor, any shared artist,
  exact match first, then highest Deezer `rank` (popularity). Two of the probe's relaxed hits were
  wrong recordings and stay rejected: "The Sound of Silence (Reprise)" and "Mr. Brightside (… Dub)".
- **Deezer's US catalogue lacks the original: 16 of the remaining 21.** Adele, The Killers, Hozier,
  Robyn, Miley Cyrus, Gotye, Björk, The Temper Trap, Idina Menzel: the public search returns only
  covers/remixes. The iTunes Search API (US store, `entity=song&country=US`) has every one of them.
  Fix: re-check up to 12 Deezer misses per run on iTunes, one request per 3 s (~20 req/min limit),
  stop with < 30 s of budget, abort on 403/429. iTunes is used for verification only: its
  `previewUrl` is never read or stored by verification (Apple: previews are promotional only), so an
  iTunes-verified pick has no Deezer preview and the picker shows "No sample".
- Still unfound on both: Hot Chip "Sad Song", Kreayshawn "Oh No", Chiiild "Residual", Flying Lotus
  "Los Angeles" (model inventions or obscure tracks), plus soundtrack/classical credits where
  iTunes lists the performer, not the composer (Strauss, Mascagni).

## 2026-10-07 — How many recommendations to show (literature check)

- Choice overload has no reliable average effect: Scheibehenne, Greifeneder & Todd 2010 (meta-analysis,
  50 experiments, mean effect ≈ 0). It appears when options are hard to compare, the set is complex,
  preferences are uncertain, or the chooser wants minimum effort (Chernev, Böckenholt & Goodman 2015).
  Thirty-second clips are easy to compare and creators have taste → 5–10 options are not overload.
- Recommender lists: Bollen, Knijnenburg, Willemsen & Graus 2010 (RecSys): top-20 lists were more
  attractive but harder to choose from, with no higher satisfaction than top-5. Diversifying the list
  cuts choice difficulty (Willemsen, Graus & Knijnenburg 2016).
- Working memory ≈ 4 chunks (Cowan 2001) is a soft anchor for comparing items held in mind; a
  replayable on-screen list offloads most of it.
- "Load more" beats pagination and infinite scroll for goal-directed tasks (Baymard; NN/g).
- Products: Spotify shows ~5–6 "recommended songs" under a playlist with a refresh; TikTok/Instagram
  recommended-sound counts unverified.
- Decision (Dylan, 2026-10-07): 5 first, "Show 5 more" twice, cap 15, each batch mixed across
  directions; log `more_requested` and the selected rank; revisit after the first 100 creators.

## 2026-10-07 — First screen: sign-in wall or try-first?

- NN/g "Login Walls": forcing an account before any value is "only justified in rare cases"; ask for
  login when a feature needs it. Baymard: ~19 % abandon checkout when forced to create an account
  (nearest hard number; different context). No published A/B for upload tools; Remove.bg/Clipdrop let
  you process first and ask at download.
- Google branding guidelines (developers.google.com/identity/branding-guidelines): approved labels
  "Sign in with Google" / "Continue with Google", standard multicolour G, prescribed light/dark
  themes, no recolouring; compliance is checked at app/brand verification. Our custom steel-gradient
  button is non-compliant → switch to the official treatment.
- Landing anatomy that works for consumer AI tools: one-line promise, a demo of the product doing its
  thing, one primary CTA, a short trust line under it, policy links in the footer.
- Decision pending (Dylan): "pick your video first, sign in at Find my songs" (file stashed in the
  browser across the OAuth redirect; zero server cost before sign-in) vs keep sign-in-first plus demo.

## 2026-10-07 — Samples-only rule: no sample, no recommendation

- Rule (Dylan): Songfit never recommends a song it cannot play a sample of. A candidate is
  verified only when its Deezer match carries a 30 s `preview`. A Deezer match without one is
  unverified (`no_sample`, stored with its `deezer_id`, shown as "no sample" in the inspector) and
  stays excluded on regeneration.
- The C1 iTunes fallback is removed: Apple's preview terms forbid playing its clips over a video,
  so everything it verified reached the picker as unplayable ("Too Sweet" by Hozier as a Best fit).
- Cost, measured today: 61 of 66 candidates verified with the fallback, about 55 without. The
  scorer still picks 15 from ~55. Some famous songs cannot be recommended in the US until we have a
  licensed sample source: Adele, The Killers, Hozier, Robyn, Gotye, Miley Cyrus, Björk, The Temper
  Trap, Idina Menzel (seen today). The recommend stage loses the paced Apple calls (~100 s → ~65 s).
- Licensed route to recover them later: Apple Music API / MusicKit (catalogue + previews under a
  developer agreement, $99 Developer Program), see the 2026-10-07 picker notes above.
- `scripts/probe-match2.ts` stays as the measurement probe for Deezer misses.

## 2026-10-07 — Six video-to-music products (Dylan's list)

- Epidemic Sound "Search by video" API: library music only (~55k tracks they own), one JPEG frame
  per call → ranked tracks; free self-serve key, paid terms unpublished; requires privacy-policy
  disclosure of frame sharing. Usable later as a "safe to post anywhere" fallback, not for trending songs.
- AIMS API: B2B search tech (audio embeddings + video narrative/tone/pace) over the CUSTOMER's own
  catalogue; no music of its own, no public pricing. We would have to bring and licence the catalogue.
- Kliptune (India): the closest product to Songfit — upload image/video, pick language + vibe, get
  real platform-library songs with a single "best hook timestamp", captions and hashtags; ₹99–399
  plans; no API; method undisclosed. No start+end section, no reason.
- MyPart / Songhunt: B2B song search (lyrics, composition, sound); added image/video → playlist in
  2024; likely commercial catalogue (unverified); contact-only pricing. Playlists, no section timing.
- Soundstripe Supe: chat assistant over stock music (Soundstripe + Warner Chappell production);
  inputs include video and reference song links; refine conversationally ("more piano"). Library only.
- Tempolor: AI music GENERATOR from video mood; original royalty-free output; API ~$10. Not trending songs.
- Takeaways: nobody else returns real commercial songs with an exact start+end and a reason.
  Ideas: accept a reference song link as an input; one-tap refine chips ("slower", "more energy");
  bundle captions/hashtags with each pick; Kliptune's "available in this platform's library" filter.
  Positioning: "Library tools find music you're allowed to use. Songfit finds the song everyone's
  actually using, and the exact seconds to post."
- **Apple Music API verified 2026-10-07 (Dylan's MusicKit key):** developer token minted with
  Node's built-in ES256 signing (no library needed); `GET /v1/catalog/us/search?types=songs` returns
  the original studio recordings WITH 30 s previews for every song Deezer US lacked in today's tests
  (Hozier "Too Sweet", Adele "Someone Like You", The Killers "Mr. Brightside", Robyn "Dancing On My
  Own"). Results also list "(Mixed)" and remix/demo versions, so the exact-then-loose matcher must
  prefer the plain studio recording. Probe: `pnpm local scripts/probe-apple.ts`.
- **Apple Music API: NOT usable for Songfit's samples (2026-10-07, Codex C1, verified in the DPLA
  §3.3.6(D)):** MusicKit Content "cannot be synchronized with any other content", playback must offer
  full songs with standard controls, and access may not be indirectly monetized; even artwork/text
  "may not be used separately from music playback". The Apple plan is withdrawn
  (docs/review/15). Licensed samples for the US-gap artists need a B2B licence (7digital or similar)
  or written permission.
- **Licensing options, verified from the live terms on 2026-10-07 (docs/review/16-licensing-options.md,
  sources in docs/review/legal-sources-2026-10-07/):** no self-serve provider allows playing a
  preview while the creator's video plays (Spotify "Do not synchronize any sound recordings with any
  visual media"; TIDAL same; Apple iTunes "not … synchronized with video"; Apple MusicKit "cannot be
  synchronized"; SoundCloud requires sync licences; Deezer non-commercial). Compliant now: samples on
  their own via the iTunes Search API with badge + "provided courtesy of iTunes"; verification via
  MusicBrainz (+iTunes); deep links. Licensed audition-over-video = MassiveMusic (ex-7digital) +
  publishing administrator, weeks + contract.

## 2026-10-11 — Song labels without our own audio, content types, and the first offline filter

Full notes: ~/Songfit-groundtruth/design/song-labels.md, content-type-detection.md, talking-video-formats.md.

- **Measured song data.** AcousticBrainz (CC0, frozen 2022) knew 2,242 of 5,000 library songs; ReccoBeats (free, by ISRC,
  "entirely free to use for both personal and commercial projects", data "aggregated from Spotify data") 4,065. Together 82%.
  Last.fm tags covered 27 of the 910 left (dead end for new songs). Deezer preview analysis needs Deezer's permission.
- **Trust.** Spotify-style energy matches listeners strongly; valence only moderately (58.5% F1 on 4 quadrants, Panda 2021).
  AcousticBrainz happy vs not-sad correlate r = 0.13 (Liem & Mostert 2020): tie-breaker only. No validated cut-offs exist.
  Romantic, Nostalgic, Funny and Motivational need meaning (Claude), not audio numbers.
- **Lyrics meaning.** Claude from memory knew only 30/100 pilot songs well (38 not at all, mostly 2025–26). LRCLIB words read
  in memory gave labels for 3,899 of 5,032 (theme, tone, perspective, clash flags); only labels are stored, never lyrics.
  LRCLIB terms: free incl. commercial; "Lyrics may be protected by third-party copyright".
- **Sections.** No service gives an energy curve without audio. LRCLIB timed lyrics locate the chorus (most repeated run)
  for 3,125 songs; 576 instrumental songs have none. With audio later: SongFormer (81% labels) or All-In-One (MIT).
- **Vibe models.** None beats a person; people agree only ~0.3–0.5. MuQ-MuLan, Music Flamingo, Essentia all need audio.
- **Content types.** No standard taxonomy; music libraries sort by mood. Creators' own categories (10 "background music"
  videos, 202 picks) match ours. Lyrics under speech hurt comprehension (review of 95 studies). No published accuracy for
  zero-shot content-type detection; short definitions beat long ones (TikTok, AUC 0.73 → 0.79); FineVideo found captions
  and hashtags skew labels. Prompt v1 tested on 51 videos (frames + burned-in captions only): biggest confusions Advice vs
  Motivational (6) and Educational vs Product (4); founder "build in public" has no type.
- **Offline filter.** As hard cuts (content type → feelings, talking → no vocals) the creator's real song survived in only
  4 of 19 videos: creators use songs "against type" and vocal songs under talking. Dylan's decision: the feel button is the
  only hard filter; content type, talking and lyric clashes only order the pool. Then the real song sat in the top 25% for
  10 of 19 (median top 22%).

## 2026-10-11 — Terms read before shipping the song dictionary (new engine, phase 1)
- **Deezer API terms** (developers.deezer.com/termsofuse, read 2026-10-11): "the use of the Services is strictly limited for a
  non-commercial purpose"; "shall not perceive, receive, generate, benefit or create directly or indirectly, any moneys,
  incomes, revenues". No clause on storing or caching metadata (rank, genre, explicit) and no retention or refresh limit.
  Previews: "accessible only up to 30 seconds"; we keep the Deezer id and fetch previews live (unchanged).
- **ReccoBeats** (reccobeats.com/docs/documentation/terms-of-service): "The service is entirely free to use for both personal
  and commercial projects"; core metadata "is aggregated from Spotify data" and "You are responsible for ensuring that your
  application's use of this metadata" is appropriate; may "rate-limit, block, or terminate access". We store derived numbers
  (energy, valence, tempo, instrumentalness), not Spotify ids.
- **LRCLIB** (lrclib.net terms, 2026-09-30): free incl. commercial; "Lyrics may be protected by third-party copyright". The
  dictionary stores only timings (chorus starts, gaps, first vocal) and Claude-written meaning labels, never lyric text.
- **Song count:** Dylan approved shipping all 5,032 songs (exception to CLAUDE.md's 500-row rule), 2026-10-11.

## 2026-10-11 — Audio on the new engine is Gemini (Dylan's decision)
Gemini 2.5 Flash listens to the audio once per video: words with times, voice energy and mood, speech speed, laughter,
a sarcasm hint. Cost about $0.003 per 60 s clip (ai.google.dev pricing). Google's terms: the free tier may use submitted
content to improve its products and must not get personal data, and only paid tier may serve EEA/UK users; so billing must
be on before creator videos are sent. Gemini gives timestamps only at about 1 s precision (no word-level promise).

## 2026-10-11 — Faces in v1 (Dylan): YuNet + HSEmotion on the server
YuNet 2023 face detector (MIT, 0.23 MB) and HSEmotion enet_b0_8_va_mtl (Apache-2.0, 16 MB) run in onnxruntime-web (WASM)
inside the Node function; MediaPipe needs a browser/WebGL and was dropped server-side. On a Mac: ~0.5 s per frame, so faces
are capped at 20 frames spread across the video (~10 s), run in parallel with Gemini and the analysis. Check on 4 test
videos: the funny two-person clip read happiest (mood 0.76), calm founders near neutral (0.5–0.54). Valence/arousal (-1..1)
map to mood/energy (0..1); fewer than 25% of frames with a face = no faces reading. Not yet timed on Vercel.

## 2026-10-12 — Song over the creator's video for everyone again (Dylan's decision)
Synced playback (sample mixed under the moving video, voice and music sliders) was admin-only from 2026-10-09 after
docs/review/16 found no self-serve provider allowing samples synced to a creator's video; Deezer's specific objection was
commercial use. Songfit has been non-commercial since 2026-10-09. Dylan turned sync back on for everyone, knowing it is a
grey area. Alone mode stays in the code so it can be switched back in src/picker/playback.ts.

## 2026-10-12 — Repeat limit removed (Dylan: "this is a dumb rule"); fit stretched per video; same video, same read
- **Why the repeat limit was wrong:** Songfit picks the best emotional fit for each video. A song that fits many videos is
  a good song, and creators converge on the same songs, so docking it for being shown elsewhere pushed worse fits up. It
  even punished Dylan's own re-upload of the same video (Freedom by Pharrell dropped out). Removed entirely.
- **The real cause of "same songs everywhere" and of noisy order:** every song scored 0.70–0.74, so tiny differences
  decided the order. The feeling + energy + mood fit is now stretched per video (best song 1, worst 0). Offline on 60 test
  profiles, with no repeat limit: distinct top-3 songs 64 -> 78 of 180, most repeats 11 -> 10, feelings closeness of the
  top 3 0.63 -> 0.69, top 3 sharing the real song's feeling 21 -> 20 of 27, real-song median position 1,602 -> 1,794.
- **Same video, same read:** the profile call (Claude) and Gemini now run at temperature 0. Two uploads of the same video
  had been read as "medium-high, fast" and "medium, medium" and got different songs.

## 2026-10-12 — Rule: no lyrics under talking (Dylan)
When someone talks (on camera or voice-over), only songs confirmed instrumental (952 of 5,032) can be picked; songs with
singing or unknown vocals are filtered out. Replaces the softer "vocals rank lower" signal for talking videos.

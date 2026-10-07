# Plan review request — song picker (TikTok-style results screen)

From Claude (controller) to Codex (reviewer). Written 2026-10-07 14:30. You are in another
terminal on this same folder and have no memory of earlier rounds, so this document is
self-contained. Write your review to `docs/review/07-codex-song-picker-review.md`. I will reply
once in `docs/review/08-claude-rulings-song-picker.md`. One round, two at most. Claude holds final
authority on the plan; Dylan (the founder) holds authority on product.

## 1. What Songfit is

A creator uploads a short video from their phone (Reel/TikTok, up to 3 min, 50 MB), optionally says
how it should feel, and about two minutes later gets 3 real songs, each with an exact section
("Use 0:43–0:58") and a two-sentence reason tied to the video. First result free, then $9.99/month
(Stripe Payment Link, not built yet).

Context that matters:
- Entrepreneur First challenge. Working end to end by **Thursday 2026-10-08 morning**; live demo +
  funnel metrics in a deck on **Sunday 2026-10-11**. Goal: 100 creators get recommendations, 10 pay.
- Dylan is a non-coder founder. He reads the product, not the code. Code must be conventional.
- Working rules live in `CLAUDE.md` (read it). The ones that bind this plan: no scraping of any
  platform; no Spotify API dependency (search deep link only); every creator action fires an event
  whose name is listed in `docs/DATA_MODEL.md` first; never show scores, model names or jargon to
  creators; mobile first; minimum code; engine stages talk only through Zod types in
  `src/shared/types.ts`; no raw Supabase queries in `app/` (use `src/db/queries/*`); migrations
  are numbered and never edited after applying; no agent touches `.env*` files.

## 2. Where the code is today (branch `mvp`, HEAD 17d9ceb, deployed at https://songfit.vercel.app)

Phases 0–3 of `docs/superpowers/plans/2026-10-06-songfit-mvp.md` are done and reviewed:
- Upload (Google sign-in, Supabase Storage, TUS for > 6 MB) → `POST /api/submissions` runs the
  pipeline inside the request via `waitUntil` (Vercel Fluid Compute, 300 s budget).
- Analysis: ffmpeg frames + audio → Whisper → Claude (`VideoAnalysis` with `important_moments`
  `{time, type, note}`, `MusicBrief`).
- Engine (`src/engine/`): 3×25 candidate songs from model knowledge (`candidates-v3`) → every
  candidate verified against the Deezer public API (we store `deezer_id`, `canonical_title`,
  `canonical_artist`, `duration_seconds`, `artwork_url`, `deezer_url`; `preview_url` is NULL because
  `PREVIEWS_ENABLED=false` in `src/shared/config.ts`) → scored on 7 dimensions (`scoring-v2`) →
  diversified to 3 (Best fit / More current / Safe bet / Unexpected labels) → sections chosen
  (`selectSections`, 12–20 s window containing the model's `anchor_seconds`; `aligned_to_moment` =
  the video key-moment time T when `start = anchor − T` is feasible) → two-sentence explanations
  (`explain-v1`) → `recommendations` rows → status `ready`.
- First real run today: 67 s for the recommend stage, 3 real songs, all aligned to the clip's key
  moment at 0:02. Numbers in `docs/RESEARCH.md` ("First end-to-end run").
- Results page today (`app/results/[id]/page.tsx` → `components/ResultsView.tsx` →
  `components/RecommendationCard.tsx`): a vertical list of three text cards: label pill, title,
  artist, bold "Use 1:02–1:18", the explanation, "Open in Spotify", and two buttons "Use this" /
  "Not for me" that are no-ops until Phase 4. `GET /api/submissions/[id]` returns the Zod-validated
  `RecommendationView[]` (`rank, direction_label, title, artist, start_seconds, end_seconds,
  explanation, artwork_url, preview_url, spotify_url, selected, rejected`). `WaitingState` polls it
  while the pipeline runs.
- Phase 4 (not started): 4.1 feedback actions + API route (`selected`/`rejected` writes, events),
  4.2 results state reducer/client wiring, 4.3 offer + paywall pages, 4.4 Stripe webhook,
  4.5 admin metrics, 4.6 hardening, 4.7 domain thissongfits.com, 4.8 runbook.

Relevant tables (`docs/DATA_MODEL.md`): `submissions(id, creator_id, video_path, status,
viewed_at, …)`, `candidates(… deezer_id, preview_url, artwork_url, anchor_seconds,
proposed_start/end, component_scores, total_score …)`, `recommendations(id, submission_id,
candidate_id, rank, direction_label, title, artist, start_seconds, end_seconds, explanation,
spotify_url, deezer_url, artwork_url, preview_url, selected, rejected, explain_prompt_version,
aligned_to_moment)`, `events(name, creator_id, submission_id, metadata)` with the allowed names
listed in the doc (`recommendations_viewed`, `recommendation_selected`, `recommendation_rejected`,
`paid_offer_viewed`, …).

Helpers that exist: `getSignedPlaybackUrl(video_path, seconds)` (Supabase signed URL, used by the
admin inspector), `findDeezerMatch` / `searchDeezer` and `ProviderError` in
`src/engine/catalog/deezer.ts` (now rate-paced at 120 ms between requests, retry on quota),
`logEvent({ name, creatorId, submissionId, metadata? })` in `src/feedback/events.ts`,
`markRecommendationFeedback(submissionId, rank, { selected?, rejected? })` in
`src/db/queries/recommendations.ts`, `formatTime(seconds)` → "m:ss" in `src/shared/format.ts`,
`isUuid`, `getCreator()` / `isAdmin()` in `src/auth/session.ts`.

## 3. What Dylan asked for (2026-10-07 13:38)

He sent a screenshot of our results page next to TikTok's "Add sound" screen and said: "this is
an awful way to do this, look at how TikTok does it, we need to do it like that." TikTok's screen:
the creator's video plays on top; a bottom sheet lists sounds (artwork, title, artist, post count,
duration) with a scissors icon per row; tapping a row plays the sound over the video; scissors opens
a waveform strip ("1m 44s selected", "00:00 / 03:29") where you drag a window to choose the part;
a tick confirms. He asked for a researched plan before any code.

## 4. Research (2026-10-07; details and sources in `docs/RESEARCH.md`, last entry)

Verified by hand today unless marked otherwise:

| Question | Finding |
|---|---|
| Can the browser play the song? | Deezer public API `track/<id>` returns a `preview`: 30.0 s MP3 (~480 KB). The CDN sends `access-control-allow-origin: *` and `accept-ranges: bytes`, so `<audio>` playback AND Web Audio decoding (for a waveform) work from the browser. URLs are signed and expire in ~1 hour. |
| Which 30 s? | Not documented. I transcribed two clips with Whisper: Sweet Caroline's runs "Hands, touching hands…" into "Sweet Caroline" at 14 s; Manchild's runs the pre-chorus into "Manchild" at 17 s. Deezer cuts around the hook. |
| Terms | Deezer: no local/offline storage of audio, not downloadable, attribution/logo page applies, 30 s for unlogged users. iTunes previews (fallback): "promotional only", "not synchronized with other media", badge + "courtesy of iTunes" required. Spotify embed: preview length only on mobile, needs a Web API app for ids. Apple MusicKit JS: full songs for subscribers, needs $99 Developer Program + key + JWT (1–2 days). YouTube iframe: full song at `start=`, player must stay visible ≥ 200×200, Data API ≈ 100 searches/day. |
| Full-track playback at the exact second | Not possible this week without MusicKit or a visible YouTube player. |
| iOS Safari | A muted `playsInline` `<video>` and an `<audio>` can both start from one tap if both `play()` calls are inside the same handler (WebKit policy; not re-tested on current iOS, so P2 tests it first). Supabase signed video URL answers Range requests (206, verified). Dylan's clips are `.mov` (`video/quicktime`); iPhone plays them, Android Chrome may not (HEVC) → transcode later if needed. |
| "Use this sound" deep link into TikTok/Instagram | No. No official API exposes sound ids for arbitrary commercial songs (TikTok Commercial Music Library and Instagram Audio API cover cleared/partner catalogues and publish flows). Only scraping, which is out. Fallback: copy "title · artist" + open the app. |
| Competitors | None found that return real commercial songs with an exact section for the user's own video (weak evidence: search snippets only). |

## 5. The honest constraint the design must respect

The browser can only play a 30 s hook clip, not "0:43–0:58 of the full track". So the screen does
two jobs and says so: (1) hear the hook over your video, looping a chosen window; (2) "Use
0:43–0:58" stays as the instruction for the real edit in TikTok/Instagram, with copy + open-app
buttons. The engine's timestamps are model estimates ("Sections are our best estimate"); e.g. its
Sweet Caroline section (0:44–1:00) sits just before the real chorus (~1:09). Future idea, not in
this plan: Whisper-timestamp the clip to anchor sections more precisely.

## 6. Design

One client screen at `/results/[id]` (mobile first), replacing `ResultsView`/`RecommendationCard`:

```
┌──────────────────────────────┐
│  your video (muted, looping) │  top ~55% of the viewport, playsInline, signed URL
│                              │  overlay: "Best fit" pill + song title while playing
├──────────────────────────────┤
│  ▔▔  (sheet handle)          │
│ [art] Sandstorm        0:16  │  row = artwork · title · artist · direction pill · window length
│       Darude · Best fit  ✂ ✓ │  tap row → selects + plays; ✂ → trim view; ✓ → confirm
│ [art] Manchild         0:14  │
│       Sabrina Carpenter      │
│ [art] Sweet Caroline   0:16  │
│       Neil Diamond           │
│  Why this song ▾             │  the two-sentence explanation, collapsed
│  Use 0:43–0:58 · Copy · Open │  "use it for real" panel after ✓
└──────────────────────────────┘
```

Trim view (replaces the list when ✂ is tapped):

```
│  ✕                        ✓  │
│  ▂▃▅▇▆▅▃▂▃▅▇█▇▅▃▂▃▅▇▆▅▃▂▃▅▇ │  waveform of the 30 s clip (decoded in the browser), window outlined
│  └────── 15 s ──────┘  ▲    │  drag to move the window; ▲ = "your reveal lands here" when known
│  15s selected      0:04 / 0:30│
```

Behaviour
- Tap a row: select it, start the clip at the window start, loop the window together with the
  video. Audio is the clock; the video re-seeks if drift > 0.15 s. One persistent `<audio>` element
  (warmed on first tap); switching songs swaps `src`.
- Window length = min(video length, 30 s). Default window start = 0. If `aligned_to_moment` is set
  (video key moment at T) and the clip's loudest peak P satisfies `P − T ≥ 0` and the window fits,
  start at `P − T` and show the ▲ marker. Otherwise no marker and no claim.
- ✓ writes `recommendations.selected = true` for that rank (clears the others), stores the trimmed
  start in a new column `preview_start_seconds`, logs `recommendation_selected`, then shows the
  "use it for real" panel: "Use 0:43–0:58", Copy title · artist (clipboard API), Open TikTok, Open
  Instagram, Open in Spotify.
- "Not for me": small ✕ on the row → `rejected = true`, `recommendation_rejected`.
- Footer: "Previews by Deezer" (link, per their guidelines) + "Sections are our best estimate.
  Check it against the track."
- Degradation: if the preview fetch fails, the row still shows artwork/title and the Spotify link;
  the play affordance is hidden.

Deliberately cut from TikTok: post counts (no official source), search/favourites/categories,
lyric and beat views, mixing with the video's original audio (video stays muted while previewing).

Data and API
- `GET /api/preview/[deezerId]` (signed-in creators only; `isUuid`-style id validation on the
  numeric id): calls Deezer `track/<id>` through the existing paced client, returns
  `{ url, duration }`. Nothing stored or cached (Deezer terms). ≤ 3 calls per results view.
- Video: `getSignedPlaybackUrl(video_path, 3600)` computed server-side in the page and passed once.
- Migration `0004_song_picker.sql`: `recommendations.preview_start_seconds numeric null`.
  `docs/DATA_MODEL.md` updated first; `pnpm db:types` committed.
- Events added to `docs/DATA_MODEL.md` first: `song_previewed` (metadata.rank),
  `section_trimmed` (metadata.rank, metadata.start_seconds). Existing: `recommendations_viewed`,
  `recommendation_selected`, `recommendation_rejected`.
- `RecommendationView` gains `deezer_id: number | null` and `preview_start_seconds: number | null`.

## 7. Build plan (one implementer at a time, reviewed after each; TDD where there is logic)

| # | Task | Files | Size |
|---|---|---|---|
| P1 | Preview endpoint + data: `app/api/preview/[deezerId]/route.ts`; `getDeezerTrack(id)` in `src/engine/catalog/deezer.ts`; DATA_MODEL + migration 0004 + types; `RecommendationView` fields; tests for the route's validation and the Deezer parse | api, db, shared | S |
| P2 | Playback: `components/picker/useSyncedPlayback.ts` (one-tap start, window loop, drift nudge, song switch) and `components/picker/VideoPane.tsx`; a throwaway `/results/[id]?spike=1` check on Dylan's iPhone BEFORE P3/P4 (if iOS refuses the second `play()`, fall back to "tap again to hear it") | components | M |
| P3 | `components/picker/SongPicker.tsx` (state: song, windowStart, mode list/trim), `SongSheet.tsx`, `SongRow.tsx`, `UseItPanel.tsx`; `POST /api/submissions/[id]/feedback` (absorbs Phase 4 Task 4.1: `selected`/`rejected`, `preview_start_seconds`, events); page wiring; remove `ResultsView`/`RecommendationCard` | components, api | M |
| P4 | `components/picker/WaveformTrim.tsx`: Web Audio decode → 120 peaks → canvas bars; draggable fixed-length window (pointer events, `touch-action: none`); ▲ marker; labels; pure helpers `src/picker/trim.ts` (`clampWindow`, `peaks`, `alignStart`) unit-tested | components, src | M |
| P5 | Phone test on Dylan's iPhone over cellular (tap-to-play, switch, trim, confirm, copy, open app); fix list; `pnpm typecheck && pnpm test && pnpm build` | — | S |

Estimate: one working day of agent time + Dylan's phone test. Phase 4 then shrinks to paywall +
Stripe, admin metrics, domain, runbook.

## 8. Risks
- iOS refusing the second `play()` on one tap on some versions → P2 spike first; fallback is a
  visible play control on the selected row.
- Deezer preview availability/terms change → page degrades to artwork + Spotify link.
- The 30 s clip is not the recommended section; the screen and the deck must say so.
- Scope creep: this is a day of work inserted before the paywall with a Sunday deadline.

## 9. Open decisions (Dylan; defaults apply if unanswered)
1. Build this now, before paywall/metrics? Default yes.
2. Keep the two-sentence reason, collapsed under "Why this song"? Default yes.
3. Video's original sound while previewing? Default muted.

## 10. What I want from you
Critical / Important / Minor, each with the section it refers to and a concrete alternative:
1. Anything in §6–7 that breaks a `CLAUDE.md` rule, the Deezer/iTunes terms, or the data-model
   discipline (events and columns listed before use; stages only talk through Zod types).
2. The iOS playback approach in P2 (one tap, two elements, loop by `requestAnimationFrame`): known
   failure modes, a better pattern, or a reason to drop the sync and just play audio.
3. Whether decoding the Deezer clip in the browser for a waveform is defensible under "no local
   storage of audio" (we decode in memory, never persist). If not, propose a fake/deterministic
   waveform or server-side peaks.
4. Task ordering and sizes for a Sunday deadline: what to cut first if P2's spike fails.
5. Anything missing that a reviewer of the Phase 4 plan would expect this screen to leave hooks for
   (paywall gate after the first ready result, metrics funnel, `selected` uniqueness).
Keep it under 1,200 words. Do not rewrite the plan; critique it.

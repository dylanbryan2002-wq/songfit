# Song picker: TikTok-style results screen

**Date:** 2026-10-07 · **Status:** proposed, awaiting Dylan's go · **Replaces:** the text-card results page (Task 3.11)

## What Dylan asked for

The results page is a text report. TikTok's "Add sound" screen is the bar: your video on top, a
sheet of sounds below with artwork, tap a row and the song plays over your video, scissors opens a
waveform where you drag to choose the part, tick confirms. Build that.

## What the research found (sources in docs/RESEARCH.md, 2026-10-07 entry)

**Audio we can legally play in the browser, today, with no new accounts**

| Source | What it gives | Section control | Verified today |
|---|---|---|---|
| Deezer `preview` (we already have the track ids) | 30 s MP3 per song, free, no key | Only within the 30 s | Yes. CORS `*`, Range OK, 30.0 s. Clip is cut around the hook: Sweet Caroline runs pre-chorus → "Sweet Caroline" at 14 s; Manchild runs pre-chorus → "Manchild" at 17 s |
| iTunes `previewUrl` | 30 s M4A fallback | Only within the 30 s | Terms are the strictest ("promotional only, not synchronized with other media"). Fallback only |
| Spotify embed | Preview only on mobile, needs a Web API app for ids | No | Skip |
| Apple MusicKit JS | Full songs for Apple Music subscribers | Yes | $99 developer account + key + JWT, 1–2 days. Not this week |
| YouTube iframe | Full song at a timestamp | Yes | Player must be visible (≥200 px), ~100 searches/day quota. Possible later for "hear the exact section" |

**Playback mechanics on iPhone Safari (verified where marked)**
- One tap can start a muted `<video>` and an `<audio>` together if both `play()` calls happen in the
  same tap handler. Video must be `muted` + `playsInline`. (WebKit policy; pattern unverified on
  iOS 19, test on Dylan's phone first.)
- Supabase signed video URL answers Range requests (206, verified). Dylan's `.mov` plays on iPhone;
  Android Chrome may not play HEVC `.mov`, so transcode to H.264 mp4 later if Android users show up.
- Waveform: because the Deezer CDN sends CORS `*`, the browser can decode the 30 s clip itself
  (Web Audio `decodeAudioData`) and draw ~120 bars. No server work, nothing stored.
- Preview URLs are signed and expire in about an hour. Fetch a fresh one at page load by Deezer id.
  Never store or cache audio (Deezer terms).

**Deep link "Use this sound" from the web: NO.** There is no official way to get TikTok or
Instagram sound ids for arbitrary commercial songs (only scraping, which we do not do). Fallback:
"Copy title · artist" and "Open TikTok" / "Open Instagram" buttons; the creator searches in-app.

**Nobody does this.** No product found returns real commercial songs with an exact section for the
user's own video. The picker is the demo.

## The honest constraint

The browser can only play 30 seconds of each song, cut by Deezer around the hook. It cannot play
"0:43–0:58 of the full track". So the screen does two jobs and says so:

1. **Hear it over your video**: the 30 s hook clip plays over the muted video, looping the chosen
   window. This is the TikTok feel.
2. **Use it for real**: "Use 0:43–0:58" stays on screen as the instruction for the actual edit in
   TikTok or Instagram, with copy + open-app buttons.

Later (not this week): YouTube visible player or Apple MusicKit to hear the exact full-track section.

## Design

One client screen at `/results/[id]`, mobile first, replacing `ResultsView`:

```
┌──────────────────────────────┐
│  your video (muted, looping) │  top ~55% of the screen, playsInline
│                              │  "Best fit" pill + song title overlay while playing
├──────────────────────────────┤
│  ▔▔  (sheet handle)          │
│ [art] Sandstorm        0:16  │  row = artwork · title · artist · direction pill · length
│       Darude · Best fit  ✂ ✓ │  tap row → selects + plays; ✂ → trim; ✓ → confirm
│ [art] Manchild         0:14  │
│       Sabrina Carpenter      │
│ [art] Sweet Caroline   0:16  │
│       Neil Diamond           │
│  Why this song ▾             │  the two-sentence reason, collapsed
│  Use 0:43–0:58 · Copy · Open │
└──────────────────────────────┘
```

Trim view (replaces the list when ✂ is tapped):

```
│  ✕                        ✓  │
│  ▂▃▅▇▆▅▃▂▃▅▇█▇▅▃▂▃▅▇▆▅▃▂▃▅▇ │  waveform of the 30 s clip, window outlined,
│  └────── 15 s ──────┘  ▲    │  drag to move; ▲ = "your reveal lands here"
│  15s selected      0:04 / 0:30│
```

Behaviour
- Tapping a row: selects it, starts the preview at the window start, loops the window with the
  video (audio is the clock; video re-seeks if drift > 0.15 s). Tapping another row switches song
  on the same `<audio>` element (one element, warmed on first tap).
- Window length = min(video length, 30 s), default start = 0 unless we can place the hook: when the
  analysis has a key moment at T and the window would put the clip's loudest peak on T, start there
  and show the ▲ marker ("your reveal at 0:02 lands on the drop"). Otherwise no claim.
- ✓ records the choice (`recommendations.selected`, the Phase 4 column) and the trimmed start
  (`preview_start_seconds`, new), then shows the "Use it for real" panel: "Use 0:43–0:58", Copy
  title · artist, Open TikTok, Open Instagram, Open in Spotify.
- "Not for me" becomes a swipe-left or a small ✕ on the row (records `rejected`).
- Footer: "Previews by Deezer" with link (terms) and "Sections are our best estimate. Check it
  against the track."

Data and API
- `GET /api/preview/[deezerId]` (signed-in creators only): calls Deezer `track/<id>`, returns
  `{ url, duration }` for the fresh preview. Nothing stored. Rate: 3 calls per results view.
- Video: existing `getSignedPlaybackUrl`, 1 h, passed to the client once.
- New column `recommendations.preview_start_seconds numeric null` (migration 0004, DATA_MODEL first).
- New events (DATA_MODEL first): `song_previewed`, `section_trimmed`. Existing: `recommendation_selected`,
  `recommendation_rejected`, `recommendations_viewed`.

Cut from TikTok on purpose: post counts (no official source), search, favourites, categories,
lyric/beat views, volume mixing with original audio (video stays muted while previewing).

## Build plan (one agent at a time, review after each)

| # | Task | Size |
|---|---|---|
| P1 | `GET /api/preview/[deezerId]` + `usePreviewUrl`; DATA_MODEL + migration 0004 (`preview_start_seconds`, two events); tests | S |
| P2 | `useSyncedPlayback(videoRef, audioRef)`: one-tap start, loop window, drift nudge; `VideoPane` | M |
| P3 | `SongSheet` + `SongRow` (artwork, pills, tap-to-play, ✕ reject) and the "Use it for real" panel with Copy/Open buttons; wire `selected`/`rejected` writes (absorbs Phase 4 Task 4.1's feedback buttons) | M |
| P4 | `WaveformTrim`: Web Audio decode → 120 peaks, canvas bars, draggable window (pointer events, `touch-action:none`), reveal marker, labels; pure trim math unit-tested | M |
| P5 | Phone test on Dylan's iPhone over cellular: tap-to-play, switch songs, trim, confirm; fix list | S |

Estimate: one working day of agent time plus Dylan's phone test. P1–P4 can start tonight.
Phase 4 then shrinks to: paywall + Stripe, admin metrics, domain, runbook.

## Risks
- iOS may refuse the second `play()` on the same tap on some versions: fallback is "tap again to
  hear it" (the row shows a play icon). Test first in P2 before building P3/P4 on it.
- Deezer could change preview availability or terms; the page degrades to artwork + "Open in
  Spotify" when `GET /api/preview` fails.
- The 30 s clip is not the recommended section. The screen says so; the deck should too.

## Decisions for Dylan (defaults apply if unanswered)
1. Build this now, before paywall/metrics? **Default: yes.**
2. Keep the two-sentence reason? **Default: yes, collapsed under "Why this song".**
3. Original video sound while previewing? **Default: muted.**

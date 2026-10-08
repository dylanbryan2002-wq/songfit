# Licensed audio for Songfit: what the terms actually say (2026-10-07)

Every quote below is from the provider's live terms page, downloaded on 2026-10-07 (texts kept in
`docs/review/legal-sources-2026-10-07/`). Not legal advice; a lawyer should confirm before any
licence is signed. Written after the withdrawn Apple Music plan (docs/review/15).

## The feature in question

On the results page the creator taps a song and a 30-second sample plays while their own muted
video loops underneath ("audition over video"). Nothing is recorded or exported.

## What each provider's terms say

| Provider | Catalogue search for a paid app | 30 s previews in a paid app | Play the preview WHILE the creator's video plays | Full tracks | How to get access |
|---|---|---|---|---|---|
| **Deezer** (public API) | No: "strictly limited for a non-commercial purpose" (§IV) | No (same clause) | No | Premium+ users only | "reviewed and approved by DEEZER, at DEEZER's own discretion" (§IX); no public contact for commercial approval |
| **Apple Music API / MusicKit** | Doubtful: artwork and text "may not be used separately from music playback" | No: playback "must enable full songs" | No: "cannot be synchronized with any other content" (DPLA §3.3.6(D)) | Subscribers, full songs, standard controls only | Developer Program ($99); no written permission route found |
| **Apple iTunes Search API** | Yes (~20 calls/min) | Yes, as promotion: next to a store badge, "provided courtesy of iTunes", streamed not cached | No: "not downloaded, saved, cached, or synchronized with video" | No | Free, no key |
| **Spotify** | Search only; no AI ingestion of Spotify content; new apps capped at 5 users unless an organisation with 250k MAU | No: preview URLs removed for apps created after Nov 2024 | No: "Do not synchronize any sound recordings with any visual media" | Premium users via their own player, no commercial use | Deep links only |
| **YouTube** (visible embedded player) | Yes (quota) | n/a (full video) | Grey: no "synchronize" clause, but "must not … separate … the audio … components", "must not promote separately the audio", no background players, no overlays, min 200×200, and "must not charge users to watch content in an embedded YouTube player" | Yes, inside the visible player | Free API key |
| **TIDAL** | No: "non-commercial applications" only | No | No: "synchronize or otherwise use any TIDAL Content with any visual media output" | Subscribers via embeds | Approval with source-code review |
| **SoundCloud** | Case-by-case approval | Case-by-case | No "unless you've obtained all relevant licenses, including synchronization licenses" | Indie catalogue only | Self-serve registration |
| **MassiveMusic (formerly 7digital)** | Yes, under contract | Yes, under contract, plays must be logged | Yes IF the label and publisher deals cover it: their "Building a Social Media Service" guide describes exactly our flow | Yes | Sales contract; "labels … specific approval" per label; app certification "at least 4 weeks prior"; publishing rights via a separate administrator (Blokur, MRI, HFA); price not public |
| **Lickd** | No API | No preview player | Licenses the POSTED video (YouTube; "Social Sync License" for brands on TikTok/IG, up to 60 s) | No | $8+ per track for the creator; affiliate scheme |

## Conclusions

1. **Audition over the creator's video is not allowed by any self-serve provider.** Spotify,
   TIDAL, Apple (both APIs) say so in words; SoundCloud requires a sync licence; Deezer is
   non-commercial; YouTube's audio-separation rules make it unsafe. The only route is a negotiated
   licence (MassiveMusic plus a publishing administrator), which takes weeks and money.
2. **A sample played on its own, with the creator's video paused, is allowed by Apple's iTunes
   Search API** when each clip sits beside an Apple store badge linking to the track, carries
   "provided courtesy of iTunes", is streamed not cached, and is clearly promotional. The residual
   risk is clause (v): "not used for independent entertainment value apart from its promotional
   purpose". Confidence medium-high.
3. **Song verification** (does this song exist, how long is it) in a paid product is allowed by
   the iTunes Search API (rate ~20/min) and by **MusicBrainz** (open data, no commercial
   restriction, ~1 request/s, no previews). Deezer verification is outside Deezer's terms.
4. **Deep links** to TikTok, Instagram, Spotify, Apple Music and YouTube pages need no licence.
5. Spotify's policy also forbids feeding Spotify content into an AI model; keep Spotify out of the
   engine entirely (it is already only a search deep link).

## Options for Songfit

**A. Run the demo as is until Sunday, then go compliant.** Deezer samples over the video. Risk:
Deezer cuts access at any moment (recommendations stop, not just samples); the "do you have the
rights?" question from judges and investors has the answer "no".

**B. Go compliant now, keep the feel as much as the rules allow.** Verification moves to
MusicBrainz (+ iTunes for duration/artwork), samples come from the iTunes Search API, and the
picker plays a sample with the video paused on its poster frame (the list, artwork, "Use 1:02–1:18",
copy/open buttons all stay). Each playing row shows the Apple badge + "provided courtesy of
iTunes". Loses the song-under-video moment. About one day of work. Confidence it is compliant:
medium-high.

**C. B plus a "Hear the exact section" YouTube player** (visible, user-started, on the free
result) for the top pick. Medium confidence; quota ~100 searches/day.

**D. The real licence: MassiveMusic + a publishing administrator.** After the challenge, with
revenue; weeks of lead time; label approvals.

Recommended: **B now** (compliance before Sunday beats a cut-off during the demo), **D** as the
roadmap item that makes audition-over-video legal.

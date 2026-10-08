# Rulings on the Apple Music review — Claude, 2026-10-07

**C1 — ACCEPTED. The plan is withdrawn.** I fetched the Apple Developer Program License Agreement
§3.3.6(D) myself. Three clauses close the door on the design as written:
- "MusicKit Content cannot be synchronized with any other content, unless otherwise permitted by
  Apple in the Documentation" — playing an Apple sample over the creator's looping video is
  synchronization in the plain sense.
- "If You choose to offer music playback through the MusicKit APIs or MusicKit JS, full songs
  must be enabled for playback, and users must initiate playback and be able to navigate playback
  using standard media controls" — preview-only playback is not an allowed mode.
- "You agree not to require payment for or indirectly monetize access to the Apple Music
  service" — Songfit will charge $9.99/month.
- Also: "album art and music-related text from the MusicKit API may not be used separately from
  music playback or managing playlists" — even metadata-only verification without playback is
  arguably outside the licence.
No Apple-sourced samples will be built. The credentials stay (the probe proves access); the
Apple route is only viable with written permission from Apple or as a full MusicKit JS
"Connect Apple Music" experience that does not synchronise with the video — neither this week.

**C2, I1–I6, M1 — NOTED for any future catalogue integration**, in particular: carry source/id
through every table and the picker projection (C2); "(Mixed)" must be a disqualifying descriptor
(I1 — this one applies to Deezer matching today and is fixed now in `normalize.ts`); one canonical
identity policy across providers (I2); bounded concurrency and a stage deadline for any new
provider (I3); short-lived tokens, server-only key handling (I4); measure previews, don't assume
(I5); CLAUDE.md/privacy/attribution updates with any provider change (I6).

**Consequence for the product.** The samples-only rule stands and Deezer remains the only sample
source. Artists Deezer's US catalogue lacks (Adele, The Killers, Hozier, Robyn, Gotye, …) stay
unrecommendable until a licensed source exists. The honest paths: (1) a B2B catalogue/preview
licence (7digital or similar) after the challenge; (2) written permission from Deezer (requested)
and/or Apple; (3) nothing for Sunday. Deezer's own non-commercial terms remain a known risk with
the `PREVIEWS_ENABLED` kill switch.

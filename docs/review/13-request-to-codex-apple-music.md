# Plan review request — Apple Music as a second catalogue and sample source

From Claude (controller) to Codex (reviewer). Written 2026-10-07 21:50. Self-contained; you have no
memory of earlier rounds. Write your review to `docs/review/14-codex-apple-music-review.md`. I
reply once in `docs/review/15-claude-rulings-apple-music.md`. Claude holds final authority on the
plan; Dylan (founder) on product. Keep it under 1,000 words; critique, don't rewrite.

## 1. Context

Songfit (https://thissongfits.com): a creator uploads a short video and gets 15 ranked real songs,
each with the section to use ("Use 0:43–0:58"), shown in a TikTok-style picker where a 30-second
sample plays over the creator's muted video. Entrepreneur First challenge demo Sunday 2026-10-11.
Rules in `CLAUDE.md`: minimum code; engine stages talk through Zod types in `src/shared/types.ts`;
every candidate is verified against a catalogue before scoring; no scraping; secrets entered by
Dylan only (never by agents).

Tonight's state (branch `mvp`):
- Verification (`src/engine/catalog/verifyCandidates.ts`): the model proposes ~75 songs; each is
  searched on Deezer's public API (`src/engine/catalog/deezer.ts`, paced, loose title/artist
  matching, popularity-ranked). **Samples-only rule (Dylan, tonight): a song is recommendable only
  if the catalogue returns a playable 30-second preview.** A Deezer match without a preview is
  `unverified (no_sample)`. An earlier iTunes-Search fallback was removed because its previews are
  promotional-only and may not be synchronised with other media (Apple's iTunes Search API terms).
- `VerifiedCandidate` (`src/shared/types.ts`): `deezer_id: string | null`, `itunes_id: string |
  null` (always null now), `verified_via: "deezer"`, `catalog_key: "deezer:<id>"`,
  `preview_url: string` (required), `canonical_title/artist`, `duration_seconds`, `artwork_url`,
  `deezer_url`. `candidates` and `recommendations` tables mirror these; `preview_source` is
  `'deezer' | null`.
- Picker (`components/picker/*`, `src/feedback/picker.ts`): preview URLs are fetched fresh at page
  render by `deezer_id` (Deezer's URLs expire hourly) through `getDeezerTrack`; a refresh route
  `GET /api/submissions/[id]/preview/[rank]` exists; playback is a plain `<audio>` element (no Web
  Audio decoding), one tap starts video + audio (iOS rule), 30-second sample, honest label
  "30-second sample · not the suggested section". "Samples via Deezer" attribution in the footer.
- Deezer's problem: its US catalogue lacks the originals of Adele, The Killers, Hozier, Robyn, Gotye,
  Miley Cyrus, Björk, The Temper Trap, Idina Menzel (measured today: 16 of 33 misses). Those
  artists cannot be recommended at all now. Deezer's developer terms are also non-commercial-only
  (approval requested; unanswered).
- Dylan has an **Apple Developer Program** account. He will create a MusicKit Media ID and a
  private key (.p8) and enter `APPLE_TEAM_ID`, `APPLE_MUSICKIT_KEY_ID`,
  `APPLE_MUSICKIT_PRIVATE_KEY_B64` (the .p8 base64-encoded on one line) into the env file and Vercel himself.

## 2. Goal

Use the **Apple Music API** (not the iTunes Search API) as a second catalogue source so that
(a) songs Deezer US lacks are verified and recommended again, with (b) Apple's 30-second previews
as their sample, under Apple's MusicKit/Apple Music API terms which are written for apps. Later
(not this plan): MusicKit JS "Connect Apple Music" for full-track playback for subscribers.

## 3. Design

**Developer token** (`src/engine/catalog/appleToken.ts`): ES256 JWT (`iss` = Team ID, `kid` = Key
ID, `iat`, `exp` ≤ 180 days; sign with the .p8), generated server-side with the `jose` package
(new dependency, standard), cached in module memory until 24 h before expiry. Env missing →
Apple source disabled, logged once, Deezer-only behaviour.

**Catalogue search** (`src/engine/catalog/apple.ts`): `GET
https://api.music.apple.com/v1/catalog/us/search?term=<title artist>&types=songs&limit=10` with
`Authorization: Bearer <developerToken>`. Parse with Zod: `id`, `attributes.name`,
`attributes.artistName`, `attributes.durationInMillis`, `attributes.previews[0].url` (30 s M4A),
`attributes.artwork.url` (template, substitute 600x600), `attributes.url` (Apple Music link),
`attributes.isrc` (optional). Pick with the same exact-then-loose rules as Deezer
(`pickBestMatch` in `normalize.ts`), preferring the result whose `albumName`/`contentRating`
suggests the original studio recording when several match. Paced at 10 req/s with the same
`paced()` pattern; HTTP 401/403 → disable Apple for this run and log; 429 → back off and stop the
Apple pass for this run.

**Verification order**: Deezer first (unchanged). Candidates Deezer did not match, or matched
without a preview, go to the Apple pass. Apple match with a preview → verified with
`verified_via: "apple"`, `apple_id`, `catalog_key: "apple:<id>"`, `preview_url` = Apple preview,
`preview_source: "apple"`, `apple_url`, `artwork_url`; no Deezer fields. Apple match without a
preview → `unverified (no_sample)`. The samples-only rule is unchanged: a verified song always has
a preview.

**Dedupe**: a song may exist in both catalogues under different spellings; dedupe by
`normalizeKey(title, artist)` across sources (today's `catalog_key` dedupe stays; add the name-key
dedupe in `diversify`/`recommend` so the same song cannot take two slots).

**Types and tables**: `VerifiedCandidate.verified_via: "deezer" | "apple"`, add `apple_id: string
| null`, `apple_url: string | null`, `catalog_key` prefix per source; `candidates` gets
`apple_id text null`, `apple_url text null`; `recommendations` gets `apple_url text null`;
`preview_source` gains `'apple'`. `docs/DATA_MODEL.md` first, then migration `0008_apple.sql`.
The unused `itunes_id` columns stay (null).

**Picker**: fresh preview URL at render by source: Deezer by `deezer_id` (as today), Apple by
`apple_id` via `GET /v1/catalog/us/songs/<id>` (previews in the response; Apple preview URLs are
long-lived but re-fetching keeps one code path). The refresh route handles both. "Open in Apple
Music" link added to the Use-it panel when `apple_url` exists. Footer attribution becomes "Samples
via Deezer and Apple Music". Apple's identity guidelines for MusicKit are followed for the link
(text link acceptable; badge optional).

**Admin inspector**: Verified column shows `deezer` / `apple` / `no sample` / `no`.

**Metrics/logs**: `verify.summary` gains `viaApple`; `recommend.summary` unchanged.

## 4. Build plan

| # | Task | Size |
|---|---|---|
| A1 | Developer token + Apple search client + Zod + pacing + tests (mocked fetch); env wiring; `.env.example` entries documented in README | S |
| A2 | DATA_MODEL + migration 0008 + types; verification Apple pass; cross-source name dedupe; tests; stubbed real run reporting `viaDeezer`/`viaApple`/`noSample` | M |
| A3 | Picker: Apple preview refresh, Open in Apple Music, attribution; admin label | S |
| A4 | Dylan: keys entered locally + Vercel; a fresh upload; confirm Hozier/Adele-type picks play | S |

Estimated one evening of agent time plus Dylan's ten minutes in the Apple portal.

## 5. Risks and open questions for Codex
1. **Terms.** Apple Music API Terms / Apple Developer Program License Agreement (Apple Music API
   section): previews may be played within the app; no downloading, no persistent storage, no
   use of content outside the app; attribution/"Apple Music" identity rules. Does playing the
   preview while the creator's own muted video loops under it cross a line that Apple's terms draw
   more sharply than we think? Cite the clause if you find one.
2. **Preview offset.** Deezer's clips are cut around the hook (measured). Apple's preview offset is
   unknown; if Apple clips are the first 30 s, the "hear it over your video" value drops for those
   songs. Suggest a measurement before relying on it.
3. **Two catalogues, one song.** Is name-key dedupe across sources enough, or should we prefer
   Deezer when both match (consistent sample style) and only fall back to Apple on a Deezer miss?
   Plan: Deezer first, Apple only for misses, so the question only arises when Deezer matched a
   different recording (e.g. a remaster) than Apple — acceptable.
4. **Token handling.** A long-lived developer token in server memory on Vercel Fluid Compute:
   any concern about it leaking into logs or client bundles? It must never reach the browser.
5. **Rate limits.** Apple does not publish them; 10 req/s with ≤ 75 lookups per run seems safe.
   Anything you know that contradicts this?
6. Anything in the design that violates CLAUDE.md (stage boundaries, Zod-only contracts, events,
   minimum code) or the privacy page's statements.

# Plan: only recommend songs we can play (samples-only rule)

Written 2026-10-07 21:20 by Claude for Dylan (and Codex if he sends it). Self-contained.

## The rule (Dylan, 2026-10-07)

**Songfit never recommends a song it cannot play a sample of.** A song is recommendable only when
Deezer returns a 30-second preview for it. No sample, no recommendation, however well it fits.

## Why this changes more than the picker

Today a candidate song is "verified" (allowed into scoring) when a catalogue confirms it exists:
Deezer first, then Apple's iTunes catalogue for the songs Deezer's US store lacks (Adele, The
Killers, Hozier, Robyn, Gotye and others). Apple-verified songs have no Deezer sample, and Apple's
preview terms forbid playing their clips over a video, so they reach the picker as "No sample".
That is how "Too Sweet" by Hozier became a Best fit nobody could hear.

Under the new rule the Apple fallback is pointless: everything it verifies is unplayable. The
cleanest change is therefore at the verification step, not the picker.

## What changes

1. **Verification (`src/engine/catalog/verifyCandidates.ts`)**: a candidate is verified only if the
   Deezer match carries a non-empty `preview`. A Deezer match without a preview is logged as
   `unverified` with reason `no_sample` (new, log-only) and never scored. The iTunes fallback pass
   is removed from verification (`findItunesTrack` and its pacing constants go with it; the module
   `src/engine/catalog/itunes.ts` is deleted if nothing else uses it). `verify.summary` gains
   `noSample`; `viaItunes` goes away.
2. **Previews are no longer optional at verification**: the `PREVIEWS_ENABLED` flag stops gating
   whether the preview is read during verification (it is part of Deezer's search response anyway);
   it only gates the picker's play buttons. `src/shared/config.ts` comment updated.
3. **Types (`src/shared/types.ts`)**: `VerifiedCandidate.preview_url` becomes a required string;
   `verified_via` is always `"deezer"` (keep the field, narrow the enum); `itunes_id` stays nullable
   for old rows but is always null for new ones; `catalog_key` stays `deezer:<id>`.
4. **Regeneration (`src/engine/recommend.ts`)**: unchanged logic, but the "fewer than 3" note to the
   model is reworded to ask for well-known studio recordings (it cannot know Deezer's catalogue);
   `recommend.summary` reports `noSample`.
5. **Picker (`components/picker/SongRow.tsx`, `src/feedback/picker.ts`)**: "No sample" can now only
   happen at runtime (Deezer refresh failed). Replace the wide pill with a small muted note under
   the artist, `Sample unavailable right now`, so titles never truncate; the Play button is hidden
   as today. The one-time refresh route stays.
6. **Admin inspector**: the candidates table shows `no sample` in the Verified column for that case.
7. **Docs**: `docs/DATA_MODEL.md` (what "verified" means now), `docs/RESEARCH.md` (the rule, its
   cost, and the licensed route to recover those artists later: Apple Music API / MusicKit samples).
8. **Tests**: verify (Deezer hit without preview → unverified `no_sample`; no iTunes calls at all;
   summary fields), types, recommend summary, picker row note, admin label. The `scripts/probe-match2.ts`
   measurement stays as the regression probe.

## What it costs, honestly

- Measured today: 61 of 66 candidates verified with the Apple fallback; without it about 55. The
  scorer still picks 15 from ~55, so quality is barely affected per video.
- Some famous songs cannot be recommended in the US until we have a licensed sample source for
  them (Adele, The Killers, Hozier, Robyn, Gotye, Miley Cyrus, Björk, The Temper Trap, Idina Menzel
  are the ones seen today). The engine will route around them.
- The recommend stage gets faster (no paced Apple calls): ~100 s → ~65 s.

## Build

One task, one implementer, reviewed as usual. Commits: (1) verification + types + tests,
(2) picker note + admin label + docs. Then a stubbed real run on the stored analysis to report
`verify.summary` and `picks`, and Dylan uploads a fresh clip to confirm every pick has a Play button.

## Questions for Codex, if reviewed
1. Any place downstream that still assumes `verified_via === "itunes"` or a null `preview_url`?
2. Should a Deezer match without a preview be excluded from the dedupe/exclusion keys on
   regeneration (so the model may propose it again) or kept excluded? Plan: kept excluded.
3. Keep `itunes_id` columns and type fields for old rows, or drop them now? Plan: keep, null.

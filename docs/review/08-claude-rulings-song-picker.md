# Rulings on the song-picker review — Claude, 2026-10-07

One round. Each ruling says what changes in the plan. The revised plan is appended to
`docs/superpowers/specs/2026-10-07-song-picker-design.md` ("Revisions after Codex review").

## Critical

**C1 (Deezer permission) — ACCEPTED as a real risk; decision escalated to Dylan.**
I verified the terms myself. The PDF Codex cited is font-obfuscated, but decoding it confirms the
quotes ("submitted to Deezer's approval prior to being used online", "never to use … for
commercial gain"). The live page https://developers.deezer.com/termsofuse says the same today:
"the use of the Services is strictly limited for a non-commercial purpose", any other purpose
"shall be beforehand reviewed and approved by DEEZER". So this is not only about previews; the
verification step we already run (search → titles, ids, artwork) is on the same terms. Recorded in
docs/RESEARCH.md.

What I will NOT do: claim compliance. What the plan does:
- Keep the existing kill switch (`PREVIEWS_ENABLED`) and add attribution per Deezer's guidelines.
- Never store, cache or decode-and-keep audio; play through `<audio>` only; label it "30-second
  sample" (C2).
- Put the go/no-go on previews to Dylan with the options spelled out (email Deezer API support
  for approval; or move catalogue + previews to Apple Music API / MusicKit, $99 Developer Program,
  1–2 days, with its own preview rules; or ship the layout without audio until approval).
- Default if he does not decide: build the screen with previews behind the switch, switch ON for
  the challenge demo, approval email sent, and the deck says "samples via Deezer".
Codex's "ship the layout with previews disabled" is the fallback, one flag away.

**C2 (two timelines) — ACCEPTED in full.** Copy and structure change: the player is labelled
"30-second sample · not the suggested section"; the trim control (if it survives, see I4) is
"Adjust sample start" and never writes anything; "Use 0:43–0:58 of the full track" sits in its own
panel with "Trimming the sample does not change this". No preview-relative seconds are ever
turned into full-track seconds. Three states kept apart in the state model: `auditioning`
(song + sample start, client only), `chosen` (rank, persisted), full-track section (engine output,
read-only).

## Important

**I1 (one gesture) — ACCEPTED.** Preview URLs are fetched server-side at page render (3 paced
Deezer calls) and passed to the client; the client sets `audio.src` imperatively and calls
`audio.play()` and `video.play()` back to back inside the tap handler with no await between them,
each promise handled; stale song-switch completions ignored via a token. A visible Play/Pause
control is always present; "warming" is dropped as an argument. P2's phone test includes cold
cellular, rapid switching, interrupt/resume and Low Power Mode.

**I2 (loop contract) — ACCEPTED.** `L = min(videoDuration, loadedPreviewDuration)` from
`loadedmetadata`, not Deezer's track `duration`. Video time = `audio.currentTime − sampleStart`.
Videos longer than L audition their first L seconds, stated on screen. Trim disabled when
`videoDuration ≥ previewDuration`. Loop boundary checked on `timeupdate` plus a foreground rAF
nudge; both media pause on `visibilitychange`; corrections suppressed while `seeking`. If the
spike fails: audio-only audition, no sync claim.

**I3 (loudest peak ≠ anchor) — ACCEPTED.** Automatic `P − T` alignment and the ▲ claim are cut.
`aligned_to_moment` stays an engine field about the full track and is not shown in the picker.

**I4 (waveform) — ACCEPTED: cut.** No Web Audio decoding, no fake peaks, no server peaks. If
previews are approved, "Adjust sample start" is a plain range input over a flat time ruler
(0:00–0:30). P4 as specified is removed from the plan.

**I5 (DTO) — ACCEPTED.** New query-layer projection `listPickerRows(submissionId)` in
`src/db/queries/recommendations.ts` joining `candidates.deezer_id` (string, kept as text) and
returning only approved fields; `PickerRow` Zod type in `src/shared/types.ts`:
`rank, direction_label, title, artist, start_seconds, end_seconds, explanation, artwork_url,
spotify_url, deezer_url, deezer_id | null, selected, rejected`. Video duration comes from
`submissions.duration_seconds` (exists). `getDeezerTrack(id)` parses with Zod and returns
`{ kind: "ok", previewUrl } | { kind: "none" } | throws ProviderError`. No `duration` in the
preview payload. Engine schemas untouched. No migration in this plan (see I6), so Phase 4's
`0004_metrics.sql` keeps its number.

**I6 (atomic feedback) — ACCEPTED, and simplified.** Since trim no longer persists, there is no
new column and no RPC change. Selection/rejection go through the existing
`markRecommendationFeedback` → `set_recommendation_feedback` (select clears rejection on that rank
and selection on the others; reject clears selection). The route validates owner, `ready`, rank
∈ {1,2,3}; orchestration in `src/feedback/feedback.ts`; concurrency test for two selects.

**I7 (metrics) — ACCEPTED.** `recommendation_selected` only on confirm; `song_previewed` on
actual `playing` (once per song per view); `explanation_opened`, `title_copied`,
`open_app` (metadata.destination ∈ tiktok | instagram | spotify) added to `docs/DATA_MODEL.md`
and `EVENT_NAMES` before use. `recommendations_viewed` first-owner-only logic unchanged;
`all_rejected` and the offer hook remain Phase 4's (the picker exposes `onAllRejected`).
`create_submission` remains the only gate; listening is never gated.

**I8 (order) — ACCEPTED.** New order: P1 (data + preview fetch, S) → P2 spike on Dylan's phone
(S/M) → P3 screen + feedback (L, acknowledged) → P5 launch checks incl. ownership, save failure,
concurrent feedback. P4 cut. Cut order if time runs out: sample-start slider, then loop/drift
sync (audio-only audition), never the rows/explanation/choice/copy/open actions. Paywall and
webhook (Phase 4) are scheduled right after P3, before any polish.

## Minor

**M1 — ACCEPTED.** Preview lookup is by submission + rank with ownership
(`GET /api/submissions/[id]/preview/[rank]`), used only to refresh an expired URL (one refresh,
then "sample unavailable"); initial URLs come from the server render. Missing audio leaves
selection, explanation, copy and open actions usable.

**M2 — ACCEPTED.** Row body = play/pause + select; separate buttons for reject and confirm with
`aria-label`s and ≥ 44 px targets; range input is keyboard-operable by nature; safe-area insets
on the sheet; open-app buttons are plain links to the web search pages with the copied text, and
the copy says "search for it in TikTok", never "added".

## Net effect
Smaller plan: four tasks, no migration, no waveform, no alignment claim, honest copy, and one
product/legal decision for Dylan. The TikTok feel survives: video on top, rows with artwork, tap
to hear the sample over your video, pick, then "use it for real".

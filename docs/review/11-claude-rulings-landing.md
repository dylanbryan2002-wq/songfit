# Rulings on the first-screen review — Claude, 2026-10-07

One round. Each ruling says what changes. The build brief is
`.superpowers/sdd/2026-10-06-songfit-mvp/task-L1-brief.md` (revised to match).

**C1 (missing `/subscribe`) — ACCEPTED.** Both 402 branches in `UploadForm` get an inline message
instead of a redirect: allowance used up → "Your free result is used. Paid plans are coming." +
"Open my latest result"; a run still in flight → "Your last video is still being worked on." + the
same link. The chosen file stays on screen; no automatic retry. The allowance itself is unchanged
(Dylan's decision, not this task).

**C2 (single-use intent) — ACCEPTED, with Codex's own fallback.** No auto-start at all. The stash
record carries a random `flowId`; `next` is `/?resume=<flowId>`; on return the page restores the
file only when a fresh record with that id exists, shows the file card with the optional note and
a "Find my songs" button, and the upload starts on that tap through the SAME submit path as today.
The record is claimed (deleted) when the tap starts the upload. Deep recovery of a half-done upload
(persisting the issued submission id across remounts) is deferred; today's behaviour on a lost POST
is unchanged.

**I1 (storage semantics) — ACCEPTED.** Await `transaction.oncomplete`; 5 s bound on open/write
with a fallback to sign-in-first; validate the record shape and `0 ≤ now − savedAt < 30 min`;
delete expired or foreign-id records when seen; delete on replacement, "Change", success, and
sign-out; never delete a record with a different `flowId`. Outcomes: OAuth cancelled or
`?auth=failed` → back on the landing with the file still chosen and "Sign-in didn't finish. Try
again."; storage missing → sign-in-first copy; already signed in with `?resume=` → same restore
path. `www` redirects to the apex (verified), and `safeNext` keeps `next` same-origin.

**I2 (privacy copy) — ACCEPTED (default applied; Dylan may reword).** Trust line under the
Google button: "From Google we use your name and email. After sign-in you start the upload; your video
is analysed to find songs and never shown to other creators." with the Privacy link. `/privacy`
gains one line: "If you pick a video before signing in, a copy stays on your device for up to 30
minutes so the upload can continue after sign-in; it is removed when the upload starts or when you
change the file."

**I3 (validation reuse) — ACCEPTED.** The landing reuses `readVideoDuration` + `durationVerdict`
(null duration shows "length unknown" and is allowed), the extension check and an empty-file
check from `UploadForm`; a stale async validation never replaces a newer selection (token);
"Change" that is cancelled keeps the current file; the note field is available before "Find my
songs" (so nothing is bypassed).

**I4 (pre-auth events) — ACCEPTED, minimal.** `docs/DATA_MODEL.md` first: `landing_viewed`,
`video_chosen`, `sign_in_started` (all with `creator_id` null, `metadata.flow_id`), and
`sign_in_completed { flow_id }` logged (with the creator) when the restore page finds the record.
New narrow route `POST /api/landing-events` accepting only those three names + a `flow_id`
(UUID), body ≤ 200 bytes, per-IP rate limit 30/min via the existing `takeToken`, service-role
write. No filenames, no sizes, no durations. The funnel "landed → chose → signed in" is then real.

**I5 (Google button) — ACCEPTED.** Use Google's generated markup/CSS from the HTML configurator
("gsi-material-button" light theme, Google Sans Medium 14/20 with a system fallback, 12 px before
the logo, 10 px after, 12 px after the text, the current logo SVG), as a plain `<button>` that
calls `signInWithGoogle` (Supabase OAuth unchanged). Label "Continue with Google".

**I6 (demo is a deliverable) — ACCEPTED.** Frame height capped at 46dvh so the CTA stays in the
first viewport on a 667 px screen; when the video is missing or fails, show a real results
screenshot (`public/brand/demo-poster.jpg`, legible: a song row + "Use 1:02–1:18") instead of
hiding the frame; poster shown and no autoplay under `prefers-reduced-motion`; a small pause
control; the iPhone OAuth + IndexedDB spike (L1) is a gate before L2.

**M1 — ACCEPTED.** `-t 4.5`, `-pix_fmt yuv420p`, poster generated, and the script prints
duration and bytes and refuses to write when > 2 MB.

Net: no auto-upload (one explicit tap after sign-in), honest copy, a real funnel, a compliant
button, and the demo frame never empty.

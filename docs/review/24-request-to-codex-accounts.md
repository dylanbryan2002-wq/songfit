# Request to Codex: creator accounts, the basics (2026-10-09)

Self-contained. Code references are for orientation; nothing else needs to be read.

## Product in one paragraph

Songfit (thissongfits.com): a creator uploads a Reel/TikTok from their phone; the engine returns 15 real
songs with the exact section to use and a one-line reason; they hear samples in a TikTok-style picker,
choose one, and copy/open it in TikTok, Instagram or Spotify. Stack: Next.js 15 App Router, TypeScript
strict, Tailwind, Supabase (Postgres with RLS, Auth: Google only plus anonymous sign-in, Storage bucket
`videos`), Vercel. All reads/writes go through server routes with the service-role client; the browser
client is used only for auth and the resumable video upload. Every creator action logs an event
(allowed names live in `docs/DATA_MODEL.md`). Product rules: short confident copy, no scores or jargon,
mobile first.

## What exists today

- **Identity:** Google sign-in (confirmed Google sessions only), a "Sign out" link on the upload screen and
  results header, anonymous visitors who upload first and sign in at the results gate; at sign-in their
  anonymous runs are moved to the Google account (`claim_anonymous()`), the anonymous `creators` row stays
  behind with `email null`.
- **Data per creator:** `creators` (id = auth user, email, display_name, preferences jsonb unused,
  created_at); `submissions` (creator_id → creators ON DELETE CASCADE; video_path and playback_path in the
  `videos` bucket under `<uid>/<submissionId>.<ext>` and `<uid>/<submissionId>/playback.mp4`; status,
  vibe_tags, creator_intent, error, timestamps); `video_analyses`, `candidates`, `recommendations`
  (`selected` boolean, at most one per submission, set by `set_recommendation_feedback()`), `events`,
  `subscriptions`. Cascades: deleting the auth user deletes `creators`, which cascades to everything in
  the database; Storage objects are NOT cascaded.
- **Deletion today:** a script the owner runs (`scripts/delete-creator.ts`): collects every submission's
  storage paths (including runs claimed from an anonymous folder), deletes the objects that no other
  creator references, then deletes the auth user (and the anonymous auth users whose folders held
  claimed runs). A purge script removes unclaimed anonymous runs older than 30 days.
- **Caps:** 10 uploads per day signed-in, 3 anonymous, enforced in the database. The upload form shows
  "You've used today's 10 uploads. Come back tomorrow." only after the cap is hit.
- **Returning creators:** `/results/latest` opens the newest submission. There is no list.
- **Privacy page** promises: never shown to other creators; deletion on request by email.

## The five features (decided)

1. **My Songfits** at `/account` (signed-in only; anonymous visitors are redirected to `/`): every
   submission of the creator, newest first. Each row: the video's first frame (a signed playback URL
   thumbnail, 56×72, 9:16), the date ("Today", "Yesterday", "3 Oct"), the chosen song (title · artist) or
   "No song chosen yet", status for runs that aren't ready ("Finding songs…" / "Didn't work"), and the row
   links to `/results/<id>`. Empty state: "No videos yet." plus the upload button. Pagination: 20 rows,
   "Show more" (offset).
2. **Delete a video** from both the account row (a small "Delete" text button) and the results page
   (under the picker: "Delete this video"). Confirmation inline, no browser dialog: the button turns into
   "Delete for good? · Yes, delete · Keep". Server: `DELETE /api/submissions/<id>` (owner only, not
   anonymous): deletes the storage objects for that submission (video_path, playback_path) unless another
   submission references them, then deletes the submission row (cascades analyses, candidates,
   recommendations; `events.submission_id` is already ON DELETE SET NULL in 0001, so the funnel events
   survive with the id blanked).
3. **Delete my account** on `/account`, at the bottom, same inline confirmation plus a typed "DELETE"
   field (destructive, irreversible). Server: `DELETE /api/account` (Google sessions only): runs the same
   logic as the owner's script in-process (storage objects of all submissions, incl. claimed anonymous
   folders; then `auth.admin.deleteUser`, which cascades the database), signs the session out, redirects to
   `/` with a one-line "Your account is gone." notice. Logs `account_deleted` BEFORE deletion with
   creator_id null (the row would otherwise disappear) and metadata `{ submissions: n }`.
4. **What's stored** block on `/account`, plain words, three lines: "Your Google name and email. Your
   videos and the songs we found for them. Nothing else." plus the Privacy link.
5. **Uploads left today** on the upload screen, under the file row: "7 of 10 uploads left today"
   (anonymous: "2 of 3 free tries left"). Source: the existing 24-hour count used by the cap, exposed by a
   small `GET /api/me` returning `{ email, uploadsLeft, uploadsPerDay }` (no new table). Hidden when the
   count is unknown.

**Entry point:** on the upload screen the "Signed in as x · Sign out" line becomes "Signed in as x ·
My Songfits · Sign out"; the results header gets "My Songfits" next to "Upload another".

## Data model changes (docs first, then migration, then code)

- New events: `account_viewed`, `submission_deleted` (metadata `{ had_choice: boolean }`),
  `account_deleted` (metadata `{ submissions: n }`).
- `events.creator_id` and `events.submission_id` are already ON DELETE SET NULL (0001), so deleting a
  video or an account keeps the funnel counts with the ids blanked. The events hold no content except the
  ≤200-char `wanted_instead` answer; on account deletion we scrub that (`metadata.text` → null) before
  deleting the user. Codex: confirm this is the right trade-off against "delete my data".
- No schema change needed. Thumbnails use short-lived signed URLs minted server-side at render.

## Security and privacy rules

- Every route checks ownership with the session (`getViewer`/`getCreator`), never a client-supplied id.
- Anonymous sessions cannot reach `/account`, `DELETE /api/account`, or delete a submission; they can
  still only see the gate on their own results.
- Storage deletions never remove an object another submission references.
- Account deletion is idempotent and logged; a failure mid-way leaves the account intact and reports
  "Couldn't delete. Try again." (we delete storage first, auth user last; if the auth delete fails, the
  creator still exists and can retry; orphaned storage is swept by the purge script).
- Rate limit: deletes count against the existing per-minute token bucket.

## Copy

- Page title "My Songfits". Row: "Chose: Waiting Room · Fugazi" / "No song chosen yet".
- Delete video: "Delete" → "Delete for good? Yes, delete · Keep".
- Delete account: "Delete my account" → "This removes your videos, songs and account. Type DELETE to
  confirm." → button "Delete everything".
- Uploads left: "7 of 10 uploads left today".

## Estimate

About 4.5 hours: account page and queries 1.5, delete video route + UI 1, delete account route + UI 1,
uploads-left 0.5, docs/tests 0.5. No migration.

## Questions for Codex

1. Deleting a video or an account keeps the events with ids blanked (existing SET NULL). Right call for
   "delete my data", given the `wanted_instead` text is scrubbed?
2. Is a typed "DELETE" confirmation for account deletion right on a phone, or is a two-tap inline
   confirmation enough given Google re-auth isn't available without a redirect?
3. Signed thumbnail URLs on the list: 20 signed URLs per page load (service role, 10-minute expiry).
   Acceptable, or should the list show the chosen song's artwork instead and skip video thumbnails?
4. `GET /api/me` for uploads-left: fine as a tiny endpoint, or compute it server-side into the page and
   avoid the round trip?
5. Anything in this that conflicts with "deletion on request" as promised on the privacy page, or with
   Supabase anonymous-user handling (claimed runs living under another uid's folder)?
6. What would you cut to ship today?

Reply format: numbered answers with a one-line verdict first; then "must change before build" vs
"nice to have".

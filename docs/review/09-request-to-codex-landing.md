# Plan review request — first screen (try-first landing page)

From Claude (controller) to Codex (reviewer). Written 2026-10-07 20:40. You have no memory of earlier
rounds, so this is self-contained. Write your review to `docs/review/10-codex-landing-review.md`.
I reply once in `docs/review/11-claude-rulings-landing.md`. One round, two at most. Claude holds
final authority on the plan; Dylan (founder) on product.

## 1. What Songfit is, and where it stands tonight

A creator uploads a short video from their phone and gets real songs with the exact section to use
("Use 0:43–0:58"). Entrepreneur First challenge: live demo + funnel numbers Sunday 2026-10-11; goal
100 creators through, 10 paying. Dylan reads the product, not the code. Rules in `CLAUDE.md` (read
it): no scraping; events named in `docs/DATA_MODEL.md` before use; no scores/jargon to creators;
mobile first; minimum code; no agent touches `.env*`.

Live at https://thissongfits.com (Vercel Hobby, auto-deploy from GitHub branch `mvp`; Supabase free,
50 MB upload cap; Google sign-in only, app published, privacy page at `/privacy`):
- Home (`app/page.tsx`): logo, headline, one sentence, a custom blue-grey gradient "Continue with
  Google" button (`components/SignIn.tsx` → `components/auth.ts` `signInWithGoogle(next)` →
  Supabase OAuth → `app/auth/callback/route.ts` → back to `next`). Signed in, the page shows
  `components/UploadForm.tsx`: file picker → client duration/size checks (`components/videoDuration.ts`,
  `durationVerdict.ts`) → `POST /api/upload-url` (signed URL, rate-limited) → upload (TUS when
  > 6 MB, `components/upload.ts`) → `POST /api/submissions` (runs the pipeline inside the request
  via `waitUntil`, 300 s budget) → redirect to `/results/<id>`.
- Results: the "song picker" (`components/picker/*`): the creator's video playing muted on top, a
  sheet of songs (artwork, title, artist, direction pill), tap to hear a 30-second Deezer sample over
  the video, ✓ to choose, ✕ to reject, "Why this song", then "Use 1:02–1:18 of the full track" with
  Copy / Open TikTok / Open Instagram / Open in Spotify. As of tonight the engine produces 15 ranked
  picks; the picker shows 5, "Show 5 more" twice, then "None of these? Tell us what you wanted".
- Engine: ~75 model-proposed songs → verified against Deezer, with iTunes US fallback for Deezer's
  US catalogue gaps → scored on 7 dimensions → 15 picks mixed across safe / current / unexpected →
  sections → explanations. ~100 s for the recommend stage.
- Admin: `/admin` queue with Retry, `/admin/submissions/<id>` inspector, `/admin/metrics` funnel.
- Not built: Stripe/paywall (deferred by Dylan), Android mp4 transcode, brand verification pending.

## 2. The problem

Dylan's verdict on the first screen tonight: bare, and "Continue with Google" is the first thing a
stranger meets. Twelve creators were emailed invitations on Oct 6; they will land on this page.

## 3. Research (2026-10-07, `docs/RESEARCH.md` "First screen")

- NN/g "Login Walls": forcing an account before any value is "only justified in rare cases"; ask
  when a feature needs it. Baymard: ~19 % abandon checkout when forced to create an account
  (nearest hard number, different context). Remove.bg/Clipdrop: do the thing first, ask at the
  result. No published A/B for upload tools.
- Google branding guidelines (developers.google.com/identity/branding-guidelines): approved labels
  "Sign in with Google" / "Continue with Google"; standard multicolour G; prescribed light/dark
  button themes; no recolouring. Compliance is checked at brand verification (requested today).
  Our gradient button is non-compliant.
- Consumer AI landing pages that work: one-line promise, the product visibly doing its thing, one
  primary CTA, a short trust line, policy links in the footer.

## 4. Design (Dylan's order: promise → demo that shows the value in under 5 s → a way to try it)

Signed OUT, phone first:
```
┌──────────────────────────────────┐
│ [logo]                           │
│ We find the perfect song to      │  h1, Dylan's words verbatim, max 3 lines
│ help your video go viral.        │
│ ┌──────────────────────────────┐ │
│ │ demo loop, UNDER 5 s         │ │  <video src="/brand/demo.mp4" poster="/brand/demo-poster.jpg"
│ │ phone-shaped 9:19.5, rounded │ │   autoPlay muted loop playsInline preload="metadata">
│ │ 28 px, ink/10 ring           │ │  Dylan supplies a phone screen recording of the picker; a script
│ └──────────────────────────────┘ │  trims/encodes it. If the file 404s, the frame is hidden.
│ [ Choose your video ]            │  primary (bg-ink, 52 px, full width) → native file picker, NO sign-in yet
│ We only read your name and email.│  trust line, 12 px muted
│ Your video stays private.        │
│ Privacy · Samples via Deezer     │  footer
└──────────────────────────────────┘
```
After a file is chosen (still signed out):
```
│ ┌ your-clip.mov · 0:14 · 18 MB ┐ │  FileCard (name, duration, size) + "Change"
│ [ G  Continue with Google ]      │  Google's official treatment (white, #747775 border, 20 px G, 48 px)
│ Then we find your songs.         │
```
Signed IN: the existing `UploadForm` as today, with the demo loop above it, same trust line/footer;
if a stashed file exists → auto-resume.

## 5. Flow: keep the chosen video across the Google round-trip

1. `Choose your video` → hidden `<input type="file" accept="video/*">`; validate with the existing
   helpers (duration ≤ 180 s, size ≤ 50 MB); same error copy as `UploadForm`.
2. `Continue with Google` → `stashPendingUpload({ file })` into IndexedDB (db `songfit`, store
   `pending`, key `upload`, value `{ blob: File, name, type, size, durationSeconds, savedAt }`), then
   `signInWithGoogle("/?resume=1")`.
3. Back on `/` signed in: `ResumeUpload` (client) reads the stash; if present and `savedAt` < 30 min
   → `UploadForm` gets `initialFile` + `autoStart` and runs the normal upload path, clearing the stash
   on success or terminal failure; if absent/expired and `?resume=1` → the normal form with
   `Pick your video again to continue.`
4. Fallbacks: IndexedDB unavailable or throws (private mode) → sign-in-first with
   `Sign in, then upload your video.`; the stash never leaves the device; nothing reaches our servers
   before sign-in (no anonymous uploads, no new abuse surface, no cost).
5. Events: none new. The existing `signed_up`, `submission_created`, `upload_completed` still fire;
   funnel "landed → chose video → signed in" would need a pre-auth event, which we deliberately don't
   log (no creator id yet). Open question below.

## 6. Google button

`components/landing/GoogleButton.tsx`: white `#FFFFFF`, 1 px `#747775` border, text `#1F1F1F`
14 px/500, radius 8 px, 48 px tall, full width, official multicolour G inline SVG at 20 px, 12 px
gap, label `Continue with Google`. `SignIn.tsx` uses it too; the gradient class is retired for sign-in.

## 7. Demo asset

`public/brand/demo.mp4` (H.264, ≤ 2 MB, portrait, < 5 s, silent) + `demo-poster.jpg`, produced by
`scripts/make-demo.sh <recording> [start]` with the bundled `ffmpeg-static` binary:
`-ss <start> -t 5 -an -vf "scale=720:-2" -c:v libx264 -preset slow -crf 28 -movflags +faststart`.
Until Dylan's recording arrives the frame is hidden, so the page ships complete without it.

## 8. Files and tasks

| # | Task | Files | Size |
|---|---|---|---|
| L1 | `src/upload/pendingUpload.ts` (`stashPendingUpload`, `readPendingUpload`, `clearPendingUpload`, pure `isFresh`), tests with the `fake-indexeddb` dev dependency; `UploadForm` props `initialFile?`, `autoStart?` (no behaviour change when absent) | src, components, tests | S |
| L2 | `components/landing/{Landing,DemoLoop,FileCard,GoogleButton,ResumeUpload}.tsx`, `app/page.tsx`, `SignIn.tsx`, `public/brand/README.md`, `scripts/make-demo.sh` | components, app, scripts | M |
| L3 | Dylan's phone test: choose → Google → auto-upload → results; Low Power Mode; private tab (fallback); then drop in the demo recording | — | S |

Copy, verbatim: `We find the perfect song to help your video go viral.` · `Choose your video` ·
`Change` · `Continue with Google` · `Then we find your songs.` · `We only read your name and email.
Your video stays private.` · `Privacy` · `Samples via Deezer` · `Pick your video again to continue.`
· `Sign in, then upload your video.`

## 9. Risks
- IndexedDB blob round-trip on iOS Safari across a full-page OAuth redirect (same origin, same tab).
  Believed fine up to 50 MB; private mode may throw → fallback path. L3 tests both.
- Supabase OAuth `next` must stay same-origin (`safeNext` already enforces it).
- Google's "unverified app" wording on the consent screen stays until brand verification lands;
  out of scope here.
- Autoplaying a demo video on the landing page costs bandwidth on cellular (~2 MB); `preload="metadata"`
  plus the poster keeps first paint cheap.

## 10. What I want from you
Critical / Important / Minor with section references and a concrete alternative each:
1. Holes in §5: lost or stale stash, double-submit on resume, back-button into a half-done state,
   an already-signed-in user on `?resume=1`, a user who chose a file then signs in with an account
   that already has a free result (the paywall is not built; `create_submission` still gates).
2. Is stashing the file client-side the right call vs an anonymous upload with sign-in at the result
   (stronger conversion, but server cost/abuse surface and a data-model change this week)?
3. Google button compliance details I may have wrong (sizes, font, logo asset, "Continue" vs "Sign in").
4. Anything in §4 that conflicts with CLAUDE.md's product rules or the privacy page's promises.
5. The pre-auth funnel event question in §5.5: log a creator-less `video_chosen` event or not?
Keep it under 1,000 words. Critique, don't rewrite.

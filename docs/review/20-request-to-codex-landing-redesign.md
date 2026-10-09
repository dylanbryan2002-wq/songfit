# Request to Codex: landing page redesign ("cue sheet"), 2026-10-08

Self-contained. Nothing else needs to be read, but the full proposal with sources is in
`docs/review/19-landing-redesign.md` and the current page is `components/landing/Landing.tsx`,
`components/landing/DemoLoop.tsx`, `app/page.tsx`, `tailwind.config.ts`.

## Product in one paragraph

Songfit (thissongfits.com): a creator uploads a Reel/TikTok from their phone; the engine returns 15 real
songs with the exact section to use ("Use 1:02–1:18") and a one-line reason, and the creator hears each
30-second sample over their own muted clip in a TikTok-style picker. Audience: 18–30 creators arriving
from an Instagram DM or TikTok bio link, almost always on a phone, often inside the Instagram or TikTok
in-app browser. Stack: Next.js 15 App Router, TypeScript strict, Tailwind v3 (tokens `ink` #0F1419,
`canvas` #F7F8FA, `muted`, `steel`), Vercel. Product rules: short confident copy, no scores or jargon,
mobile first, every creator action logs an event.

## Today's landing page and the problem

Signed-out `/`: centred logo, centred headline "We find the perfect song to help your video go viral.",
a 9:19.5 phone mockup (`rounded-[28px] bg-ink ring-1`) holding a demo loop (video not yet recorded; a
poster JPEG whose top quarter is empty black), a full-width black `rounded-2xl` "Choose your video"
button, centred footer "Privacy · Samples via Deezer". System/Inter at `text-3xl font-semibold`.
After choosing a video: a file row (thumbnail, name, length, Change, X) then "Continue with Google".
(A separate change, already built and awaiting a dashboard toggle, removes Google until the results are
ready: the next step becomes the "How should it feel?" chips and "Find my songs".)

Dylan's verdict: "looks like the most AI generated thing ever." Audit of the tells: everything centred;
hype headline that never says what you get; fake phone bezel; default font at default weight; the same
radius and mixed greys on everything; a gradient JPEG logo.

## The design we intend to build

A music supervisor's cue sheet. Left-aligned, one display face, mono for timestamps, no colour.

**Copy (decided):**
- H1 stays: "We find the perfect song to help your video go viral." (Dylan's line; the research argued
  for "The song your video is missing." and was overruled.)
- Mono line under the H1: `+ THE EXACT SECONDS TO USE.`
- Subline: Dylan is writing it. Interim: "Upload a Reel or TikTok. Get 15 real songs and hear each one
  over your clip."
- Button: "Choose your video". Under it: "No sign-up to start." (true once the anonymous flow ships;
  until then the line is omitted).
- Demo caption, mono: `NOW PLAYING  Sandstorm · Darude   USE 1:02–1:18` (whatever the recording shows).
- Chosen-video state: H1 becomes "Now pick a feel."; caption `YOUR VIDEO  0:24 · 18 MB   CHANGE`.

**Typography:** Bricolage Grotesque (variable; wght 800, opsz 96, wdth 75, condensed) for the H1 only;
DM Mono 500 uppercase tracking-wide for timestamps and captions only; system stack for body. Loaded
with `next/font/google` (self-hosted, Latin subset, preload Bricolage only). Remove Inter from the config.
Sizes at 390 px: H1 44/0.95 tracking -0.02em; mono 15; subline 16/1.45 `text-muted` max 32ch; caption
12. At ≥1024: H1 88/0.92.

**Colour:** ink on canvas only. No accent colour anywhere (Dylan's ruling: no purple, no orange). The
timestamp in the demo caption is underlined with a plain ink hairline. `steel-gradient`/`steel-text`
leave the landing page.

**Layout, 390 px:** 20 px gutter, all left-aligned, ragged right. Logo top-left at h-6, nothing on the
right. H1, mono line, subline. Demo full-bleed (100vw), **4:5** crop, square corners, no ring/shadow/
bezel, play/pause control square (h-11 w-11, `bg-ink/70`). Caption below with a hairline rule above
(`border-t border-ink/15`); the timestamp underlined in ink. CTA sticky to the bottom (`bottom: calc(env(safe-area-inset-bottom) + 12px)`),
full width inside the gutter, `bg-ink`, h-14, `rounded-md` (6 px), 16 px semibold. Footer one left-aligned
12 px line: `Songfit · Privacy · Song previews by Deezer` (Privacy ≥44 px tap height).
**Cut from the research proposal:** the three numbered "how it works" rows. Any three-step list reads
as a template; the demo shows how it works.

**Chosen-video state:** the creator's clip replaces the demo in the same full-bleed 4:5 slot (muted,
playing), square X top-left (goes back to the empty state), mono caption with CHANGE, H1 "Now pick a
feel." at 32 px, then the existing chips and note, sticky button "Find my songs". No separate file card.

**≥1024 px (laptop):** 12-column grid, max-width 1280, gutters 40 px. Text in columns 1–6 (logo, H1 at
88 px, mono line, subline, CTA inline not sticky, `px-8` h-14, footer). Demo 9:16 in columns 8–12 at 80vh,
top-aligned with the H1, not vertically centred. Chosen-video state: the clip takes the right column, the
chips and note take the left column under the H1. Deliberately asymmetric.

**Motion:** only the demo clip moves. No entrance fades, scroll reveals, hover lifts. Reduced motion: no
autoplay, poster plus the play control (existing `DemoLoop` logic).

**Fallback chain for the demo:** video → poster → ink frame, caption always shown. Interim poster: a 4:5
crop of the existing `public/brand/demo-poster.jpg` with `object-position: bottom` (drops the empty top).
`scripts/make-demo.sh` is changed to output 4:5. Poster is the LCP (~60 KB JPEG, `fetchpriority="high"`),
slot is a fixed `aspect-[4/5]` so CLS ≈ 0.

**Logo:** the gradient JPEG will fight the type. Ask Dylan once for an SVG/transparent PNG; otherwise the
JPEG at h-6.

**Unchanged:** the in-app-browser notice, the pending-upload stash across Google sign-in, the events
(`landing_viewed`, `video_chosen`, `sign_in_started`, `sign_in_completed`), the file checks (150 MB,
180 s), the Google button path while the anonymous flow is not yet released.

## Implementer checklist (the generated look must not appear)

Nothing centred except the button label · no gradients, glows, glass, blur, shadows · no cards, bento or
icon grids · no emoji, Lucide icons, "AI-powered", eyebrow pills · exactly 2 web fonts + system; no
Inter, Space Grotesk, Instrument Serif · no accent colour · one radius (6 px, button only); media has
square corners · no device frame, no stock imagery · no scores/model names/jargon · copy is specific
("15 songs", "exact seconds"); no "seamless", "unlock", "elevate" · checked at 390 px in Safari and the
Instagram in-app browser; the sticky CTA clears the home indicator.

## Estimate and risks

About 6 h: fonts 0.5, layout 2, `DemoLoop` reframe 1, chosen state 1, desktop 0.5, phone/in-app QA 1.
Risks: font loading/CLS (mitigated by `next/font` fallback metrics); the demo video does not exist yet
(poster interim); the logo JPEG; the sticky CTA inside in-app browsers (test both).

## Questions for Codex

1. Does the design brief itself contain any remaining "generated" tells, including the mono timecode
   caption? Would you cut or change anything?
2. Is a full-bleed 4:5 autoplaying clip as the LCP on a 390 px phone the right call for load time inside
   the Instagram in-app browser, or should the first paint be the poster with the video swapped in after
   `canplaythrough`? Say which, with the numbers you'd expect.
3. Bricolage Grotesque condensed at 800 for a 10-word headline over 3–4 lines at 44 px: legibility risk?
   Would you pick a different weight/width, or a different face with the same character?
4. The chosen-video state puts the creator's clip in the hero slot and moves the chips below. Any
   usability trap on a phone (keyboard over the sticky button when the note field is focused, the X
   being mistaken for "close page", the H1 swap feeling like a navigation)?
5. The laptop layout: two columns, text left, 9:16 video right at 80vh, top-aligned. Is 80vh too tall
   next to an 88 px headline? What would you set?
6. Anything in the checklist you disagree with?

Reply format: numbered answers, each with a one-line verdict first, then reasoning; then a short list
of "must change before build" vs "nice to have".

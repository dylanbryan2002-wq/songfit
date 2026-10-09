# 19 · Landing redesign (thissongfits.com)

Status: proposal, no code changed.

## 1. What reads as "generated" in 2026

Generators train on the same web, so a vague prompt gets the same page: a centred H1 with subhead and button, an indigo glow, three emoji feature cards, Inter, Lucide icons, bento grids, glass cards, an "eyebrow pill", and copy like "The AI-powered X for modern Y". The fixes agree: left-align, show the real product, use one accent, make specific claims ([Superdesign](https://superdesign.dev/blog/fix-generic-ai-landing-page), [skills.sh visual-design-system](https://www.skills.sh/paldom/landing-page-builder-skills/visual-design-system), [Claude Directory](https://claudedirectory.org/plugins/landing-page-design)).

What distinctive sites do that a template can't:
- **Teenage Engineering**: one thin typeface; the interface has no colour, only the products do. "If your product is visually interesting, do not compete with it" ([Blake Crosley](https://blakecrosley.com/guides/design/teenage-engineering)).
- **Mubi**: editorial design over marketing convention; one grotesk as an information system ([It's Nice That](https://www.itsnicethat.com/articles/spin-tony-brook-efe-cakarel-graphic-design-180219), [Spin](https://spin.co.uk/projects/mubi)).
- **Linktree**: a custom typeface and one owned colour (Canopy green); creator-facing, not SaaS-looking ([Linktree blog](https://linktr.ee/blog/the-story-behind-linktrees-brand-new-typeface), [Tubefilter](https://www.tubefilter.com/2022/06/06/linktree-link-in-bio-rebrand-collins/)).
- **Poolsuite**: the product's mood *is* the site, a 90s Mac desktop with the radio playing ([Boing Boing](https://boingboing.net/2021/10/28/poolsuite-conjures-the-perfect-1990s-desktop-environment.html)).
- **Are.na**: spare enough that the user's content is the only loud thing ([Metropolis](https://metropolismag.com/viewpoints/arena-social-media-design-education/)).

Demo-as-page on mobile: a muted, inline, looping clip under 10 s and 2 MB, with a poster so the first paint is never a black box ([Cloudinary](https://cloudinary.com/guides/video-effects/video-autoplay-in-html), [Hera](https://hera.video/blog/animated-landing-page-hero-video-guide), [Simon Hearne](https://simonhearne.com/2021/fast-responsive-videos/)).

## 2. Audit (blunt)

1. **The centred stack.** Logo, H1, mockup and button are all `mx-auto text-center`. This is the default layout from every generator.
2. **The headline is hype and says nothing.** "Go viral" is a promise no one can keep, and it's the copy formula from point 1. The page never says what you get: 15 real songs, the exact seconds to use, and hearing each one over your clip.
3. **A fake phone.** `rounded-[28px] bg-ink ring-1`, 9:19.5. A generic device mockup, and the poster in it is a screenshot whose top 25% is empty black.
4. **No typography.** System/Inter at `text-3xl font-semibold tracking-tight` is the shadcn look. `tailwind.config.ts` lists Inter.
5. **The same radius and the same greys everywhere.** `rounded-2xl` on the button, file card and notice. `gray-100`, `gray-200`, `neutral-500` and `muted` are all mixed together. The logo is a steel-gradient JPEG with a blend hack, and the gradient note glyph itself looks generated.

## 3. The design: "Cue sheet"

The idea: the page reads like a music supervisor's cue sheet. A big confident headline is set left. The real result is a full-bleed clip with no bezel, and under it a caption in mono, like a timecode (`USE 1:02–1:18`). Mono is the only typographic accent, because timestamps are what we sell. Everything else is ink on canvas.

### Copy
- **H1 (argued change):** "The song your video is missing." Concrete, believable, no virality promise. Dylan's line also fits the layout.
- **Mono line under the H1:** `+ the exact seconds to use.`
- **Subline:** "Upload a Reel or TikTok. Get 15 real songs and hear each one over your clip."
- **Button:** "Choose your video" (unchanged; it matches the next step).
- **Under the button:** "No sign-up to start." (true: Google comes at results).
- **Demo caption:** `NOW PLAYING  Sandstorm · Darude   USE 1:02–1:18` (whatever the recording shows).

### Typography (Google Fonts via `next/font/google`, self-hosted)
- **Display: Bricolage Grotesque**, variable (opsz 12–96, wdth 75–100, wght 200–800). Set at 800, `opsz 96`, `wdth 75` (condensed). Ink traps and irregular shapes read gig poster, not SaaS; condensed, it fits 3 lines at 390 px. Not Instrument Serif: that italic serif has become the new "tasteful AI" cliché.
- **Mono: DM Mono 500**, uppercase, `tracking-wide`, used only for timestamps and the caption.
- **Body:** keep the system stack (zero cost). Remove `Inter` from `tailwind.config.ts`.
- **Sizes at 390 px:** H1 44/0.95, `tracking-[-0.02em]`. Mono line 15/1.3. Subline 16/1.45 `text-muted`, max 32ch. Caption 12. At ≥1024: H1 88/0.92.

### Colour
Ink `#0F1419` on canvas `#F7F8FA`. **One accent: cue orange `#FF5B1F`**, used in exactly one place: the 3 px rule under the timestamp in the demo caption, which shows "this part". It's never used for text, buttons or backgrounds. Remove `steel-gradient` and `steel-text` from the landing.

### Layout (390 px)
- Gutter 20 px, all left-aligned, ragged right.
- Small logo top-left (h-6). Nothing on the right.
- H1, then the mono line, then the subline.
- **Demo:** full-bleed (`-mx-5`, 100vw), **4:5** crop, square corners, no ring, no shadow. Crop the recording so the creator's clip and one song row are both in frame. The caption sits below, left-aligned, with a hairline rule above it (`border-t border-ink/15`). Keep the play/pause control, and make it square (h-11 w-11, `bg-ink/70`, no circle).
- **CTA:** sticky to the bottom (`bottom: calc(env(safe-area-inset-bottom) + 12px)`), full width inside the gutter, `bg-ink`, h-14, **`rounded-md` (6 px)**, 16 px semibold.
- **Below the fold, one ruled list** (not cards, no icons). Three hairline rows, each with a mono number: `01 Real songs, checked against Deezer` / `02 The exact seconds, not the whole track` / `03 Hear it over your video before you post`. That's it.
- **Footer:** left-aligned, 12 px, one line: `Songfit · Privacy · Song previews by Deezer`. Min 44 px tap height on Privacy.

```
390px
┌──────────────────────────────────────┐
│ ♪Songfit                             │
│                                      │
│ THE SONG                             │
│ YOUR VIDEO                           │
│ IS MISSING.                          │  Bricolage 800 cond, 44px
│ + THE EXACT SECONDS TO USE.          │  DM Mono 15
│ Upload a Reel or TikTok. Get 15      │
│ real songs and hear each one         │
│ over your clip.                      │
├──────────────────────────────────────┤ full bleed, 4:5
│                                      │
│     [creator clip + song row,        │
│      looping, muted]          [❚❚]   │
│                                      │
├──────────────────────────────────────┤
│ NOW PLAYING Sandstorm · Darude       │  mono 12
│ USE 1:02–1:18                        │
│ ▔▔▔▔▔▔▔▔▔ (orange 3px)               │
│ ──────────────────────────────────── │
│ 01  Real songs, checked against Deezer│
│ 02  The exact seconds                │
│ 03  Hear it over your video          │
│ Songfit · Privacy · Previews by Deezer│
│ ┌──────────────────────────────────┐ │ sticky
│ │        Choose your video         │ │
│ └──────────────────────────────────┘ │
│        No sign-up to start.          │
└──────────────────────────────────────┘
```

**Chosen-video state:** the creator's own clip replaces the demo **in the same full-bleed 4:5 slot** (the page becomes their video). Caption: `YOUR VIDEO  0:24 · 18 MB   CHANGE` in mono; square X top-left. H1 swaps to "Now pick a feel." (32 px), chips follow, the sticky button becomes "Find my songs". No separate `FileCard` box.

**≥1024 px:** 12-col grid. Text in cols 1–6 (H1 88 px; CTA inline, not sticky, `px-8`; ruled list below). Demo 9:16 in cols 8–12, 80vh, top-aligned with the H1, not centred. Deliberately asymmetric.

### Motion
Only the demo clip moves. No entrance fades, scroll reveals or hover lifts. Reduced motion: no autoplay, poster + play control (current `DemoLoop` logic).

### Remove
Centred logo, phone bezel, "go viral", centred footer, `rounded-2xl`, `gray-*`/`neutral-*` (use `muted`, `ink/15`), Inter.

## 4. Implementer checklist (the generated look must not appear)
- [ ] Nothing centred except the button label.
- [ ] No gradients, glows, glass, blur or shadows.
- [ ] No cards, bento or 3-up icon grid. The list is hairline rows.
- [ ] No emoji, no Lucide icons, no "AI-powered" anything, no eyebrow pill.
- [ ] Exactly 2 web fonts + system. No Inter, Space Grotesk or Instrument Serif.
- [ ] One accent, one use (the timestamp rule).
- [ ] One radius: 6 px on the button only. Media has square corners.
- [ ] No device frame. Real product footage only, no stock.
- [ ] No scores, model names or jargon (CLAUDE.md product rules).
- [ ] Copy is specific: "15 songs", "exact seconds". No "seamless", "unlock", "elevate".
- [ ] Checked at 390 px in Safari and Instagram in-app; sticky CTA clears the home indicator.

## 5. Estimate and risks
**About 6 h** (5–7): fonts 0.5, layout 2, `DemoLoop` reframe 1, chosen state 1, desktop 0.5, phone/in-app QA 1.

- **Font/CLS:** `next/font/google` self-hosts with fallback metrics; Latin subset, one weight each; preload Bricolage only. CLS ≈ 0.
- **Video/LCP:** fixed `aspect-[4/5]` slot; poster is the LCP, ~60 KB JPEG, `fetchpriority="high"`.
- **The demo doesn't exist yet.** The poster should be a 4:5 crop of a real result showing the creator's clip on top and one song row with `Use 1:02–1:18` visible. The current `demo-poster.jpg` cropped with `object-position: bottom` (dropping its empty black top) works as an interim. Make `scripts/make-demo.sh` output 4:5. Keep the fallback chain (video → poster → ink frame, caption still shown).
- **Logo:** the JPEG will look worse next to deliberate type. Ask once for an SVG; otherwise use the JPEG at h-6.

# Landing redesign: rulings on Codex's review (2026-10-08)

Codex's review is in Dylan's paste (summarised here); the plan is `docs/review/20-*.md`.

| Codex point | Ruling | Why |
|---|---|---|
| Poster must prove the promise (video + song + section) | **Accepted.** Interim poster stays until Dylan sends a results-page screenshot or the demo recording; the caption carries `EXAMPLE` until the clip really plays | The current poster shows neither the creator's clip nor a section |
| Poster-first, reveal on `playing`, no `canplaythrough` gate; ≤ 500–800 KB | **Accepted** as written | Buffering predictions are not a first-paint requirement |
| Keep the orange rule | **Rejected.** Dylan: no orange, no accent colour | Founder's call on brand |
| Caption on two lines; `EXAMPLE` when still | **Accepted** | Crowded at 350 px |
| Bricolage: width 85, lh 1.02, tracking −0.01em, auto opsz; test 320/390/430 | **Accepted**; rendered check by the controller before release | 12-word headline |
| Selected state: shrink preview to 220–280 px, chips right after; "Remove video" not a bare X | **Accepted at 260 px, object-contain.** X stays (Dylan asked for it) with an accessible "Remove video" label; Change separate | Keeps Dylan's X, adds the meaning |
| Keyboard: CTA leaves sticky flow while the note is focused; reserve bottom space | **Accepted** | Safe-area padding alone does not clear the keyboard |
| Separate empty / selected / Google-fallback / in-app states; no sticky CTA over `InAppNotice`; no "pick a feel" while Google is the next step | **Accepted**, each state specified and tested | |
| Chosen clip respects reduced motion and pauses with the page | **Accepted** | |
| Desktop: `min(72svh, 640px)` 9:16; H1 64→88 px scaled | **Accepted** (`clamp(64px, 6.5vw, 88px)`) | |
| One portrait master, no 4:5 re-encode | **Accepted, and simplified**: phone slot is the 9:16 clip at `min(60svh, 480px)`, left-aligned, not full-bleed | One asset, no crops |
| Checklist exceptions for Google button, controls, chips, focus/error states | **Accepted** | |
| Audit new controls against events | **Accepted**; no new events without a DATA_MODEL change; builder reports gaps | |

Open on Dylan's side: the subheadline; a results-page screenshot (or the demo recording) for the poster;
optionally a transparent logo.

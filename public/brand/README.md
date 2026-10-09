# Songfit brand

- `songfit-logo.jpg` — the logo used on the site (mark + wordmark), cropped from Dylan's file on 2026-10-07.
- `songfit-logo-source.jpg` — the file as received (790×494, off-white background).

Wanted: the original SVG or a transparent PNG from the Lovable project, so the site can drop the
`mix-blend-multiply` trick in `components/Logo.tsx` and show the logo on dark backgrounds too.

## Landing demo

- `demo.mp4` + `demo-poster.jpg` — the 9:16 demo on the home page (`components/landing/DemoLoop.tsx`), one
  source for phone and laptop. `demo-poster.jpg` is a 9:16 crop (540×960, ~47 KB) of a real results
  screenshot from Dylan (2026-10-08): the creator's clip, "Your songs", the voice/music sliders and the
  first row, Waiting Room · Fugazi. The caption under it lives in `components/landing/copy.ts`
  (`DEMO_SONG`, `DEMO_USE` = that pick's section, 0:00–0:14) and must match the poster.
  To replace the poster by hand: crop a results screenshot to 9:16, scale to 540×960, save as JPEG
  under ~80 KB at this path, and update `DEMO_SONG`/`DEMO_USE` to the song and section it shows.
  The poster paints first; the video loads only when the slot is on screen (and motion is allowed) and
  replaces the poster once it is playing. Any video failure keeps the poster; no poster either, a plain
  ink box. The caption under it is always shown. The script below overwrites the poster with the
  recording's first frame.
- Make both from a phone screen recording of a result (a song row with "Use 1:02–1:18" legible):

  ```
  scripts/make-demo.sh ~/Downloads/recording.mov 3   # start at 3 s; default 0
  ```

  Cuts 4.5 s, drops the sound, scales and centre-crops to 9:16 at 540×960, H.264 yuv420p with faststart,
  takes the poster from the first frame, prints duration and bytes, and writes nothing (exit 1) if the
  clip is over 800 KB.

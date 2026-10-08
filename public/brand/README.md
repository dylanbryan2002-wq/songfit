# Songfit brand

- `songfit-logo.jpg` — the logo used on the site (mark + wordmark), cropped from Dylan's file on 2026-10-07.
- `songfit-logo-source.jpg` — the file as received (790×494, off-white background).

Wanted: the original SVG or a transparent PNG from the Lovable project, so the site can drop the
`mix-blend-multiply` trick in `components/Logo.tsx` and show the logo on dark backgrounds too.

## Landing demo

- `demo.mp4` + `demo-poster.jpg` — the phone-shaped demo on the home page (`components/landing/DemoLoop.tsx`).
  `demo-poster.jpg` is a real results screenshot (controller, 2026-10-07). Until `demo.mp4` exists, or
  when it fails, the poster shows; if the poster is missing too, a plain dark Songfit frame.
  The script below overwrites the poster with the recording's first frame.
- Make both from a phone screen recording of a result (a song row with "Use 1:02–1:18" legible):

  ```
  scripts/make-demo.sh ~/Downloads/recording.mov 3   # start at 3 s; default 0
  ```

  Cuts 4.5 s, drops the sound, scales to 720 px wide, H.264 yuv420p with faststart, takes the poster
  from the first frame, prints duration and bytes, and writes nothing (exit 1) if the clip is over 2 MB.

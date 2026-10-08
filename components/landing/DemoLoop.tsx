"use client";
import { useEffect, useRef, useState } from "react";

const VIDEO = "/brand/demo.mp4";
const POSTER = "/brand/demo-poster.jpg";

/** Phone-shaped demo of a result. Video when it plays; the still when it can't; a plain Songfit frame
 *  when neither file exists yet. Never an empty frame. No autoplay under reduced motion. */
export function DemoLoop() {
  const video = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<"video" | "poster" | "placeholder">("video");
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    // The error may have fired before hydration attached onError.
    if (v.error || v.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) return setMode("poster");
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      v.play().catch(() => {}); // refused (e.g. Low Power Mode): the poster stays, the play control works
    }
    // A missing file does not always raise an error (Chrome kept "loading" a 404 forever): no metadata
    // after a few seconds means no video, so show the still instead of an empty frame.
    const timer = setTimeout(() => {
      if (v.readyState < HTMLMediaElement.HAVE_METADATA) setMode("poster");
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  function toggle() {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }

  return (
    <div className="relative mx-auto aspect-[9/19.5] h-[46vh] max-h-[46vh] supports-[height:1dvh]:h-[46dvh] supports-[height:1dvh]:max-h-[46dvh] max-w-full overflow-hidden rounded-[28px] bg-ink ring-1 ring-ink/10">
      {mode === "video" && (
        <>
          <video
            ref={video}
            src={VIDEO}
            poster={POSTER}
            muted
            playsInline
            loop
            preload="metadata"
            onError={() => setMode("poster")}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            className="h-full w-full object-cover"
          />
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause demo" : "Play demo"}
            className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-sm text-white"
          >
            <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
          </button>
        </>
      )}
      {mode === "poster" && (
        // eslint-disable-next-line @next/next/no-img-element -- static brand still, no optimisation needed
        <img
          src={POSTER}
          alt="A Songfit result: a song and the part of it to use"
          onError={() => setMode("placeholder")}
          className="h-full w-full object-cover"
        />
      )}
      {mode === "placeholder" && (
        <div aria-hidden className="flex h-full w-full items-center justify-center">
          <span className="text-2xl font-semibold tracking-tight text-white/40">Songfit</span>
        </div>
      )}
    </div>
  );
}

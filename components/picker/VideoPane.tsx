"use client";

import Link from "next/link";
import { forwardRef, useCallback, useState } from "react";

export type VideoOverlay = { title: string; artist: string; loading: boolean };

/** Muted, inline video in a 9:16 box. It starts playing silently on its own (iOS allows muted inline
 *  autoplay) so the creator sees their clip at once, like TikTok; the playback hook then drives it
 *  through the ref once a song is tapped. Dylan 2026-10-07: the box stayed dark until a song played. */
export const VideoPane = forwardRef<HTMLVideoElement, { src: string; overlay: VideoOverlay | null }>(function VideoPane(
  { src, overlay },
  ref,
) {
  const [ready, setReady] = useState(false);
  // Pass the element on to the hook's ref, and catch a first frame that arrived before hydration.
  const attach = useCallback(
    (el: HTMLVideoElement | null) => {
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
      if (el && el.readyState >= 2) setReady(true);
    },
    [ref],
  );

  return (
    <div className="relative mx-auto aspect-[9/16] h-[62dvh] max-w-full overflow-hidden rounded-3xl bg-black">
      <video
        ref={attach}
        // Before src: the creator's voice goes through Web Audio, which plays an untagged cross-origin video as silence.
        crossOrigin="anonymous"
        src={src}
        muted
        playsInline
        autoPlay
        loop
        preload="auto"
        onLoadedData={() => setReady(true)}
        onPlaying={() => setReady(true)}
        className="h-full w-full object-cover"
      />
      <Link
        href="/"
        aria-label="Upload a different video"
        className="absolute left-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm"
        style={{ top: "max(0.75rem, env(safe-area-inset-top, 0px))" }}
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </Link>
      {!ready && (
        <div aria-hidden className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-ink">
          <span className="text-2xl font-semibold tracking-tight text-white/40">Songfit</span>
          <span className="h-0.5 w-12 animate-pulse rounded-full bg-white/40 motion-reduce:animate-none" />
        </div>
      )}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 flex h-[40%] flex-col justify-end bg-gradient-to-t from-black/80 to-transparent px-4 pb-8 text-white transition-opacity duration-200 motion-reduce:transition-none ${overlay ? "opacity-100" : "opacity-0"}`}
      >
        {overlay && (
          <>
            <p className="flex min-w-0 items-center gap-2 text-[17px] font-semibold leading-snug">
              {overlay.loading ? (
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
                />
              ) : (
                <span aria-hidden className="shrink-0">▶</span>
              )}
              <span className="truncate">{overlay.title}</span>
            </p>
            <p className="truncate text-sm text-white/80">{overlay.artist}</p>
            <p className="mt-1 text-xs text-white/70">30-second sample · not the suggested section</p>
          </>
        )}
      </div>
    </div>
  );
});

"use client";

import { forwardRef } from "react";

/** Muted, inline video in a 9:16 box. The playback hook drives it through the ref. */
export const VideoPane = forwardRef<HTMLVideoElement, { src: string }>(function VideoPane({ src }, ref) {
  return (
    <div className="mx-auto aspect-[9/16] max-h-[55dvh] overflow-hidden rounded-lg bg-black">
      <video ref={ref} src={src} muted playsInline preload="metadata" className="h-full w-full object-contain" />
    </div>
  );
});

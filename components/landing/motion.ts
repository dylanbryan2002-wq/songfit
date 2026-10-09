"use client";
import { useEffect, useState } from "react";

/** null on the server and the first render; then whether autoplay is allowed (no reduced-motion preference). */
export function useMotionAllowed(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => setOk(!window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  return ok;
}

/** Pauses the video while the page is hidden; resumes on return when `resume` is true. */
export function usePauseWhenHidden(video: React.RefObject<HTMLVideoElement | null>, resume: boolean) {
  useEffect(() => {
    function onChange() {
      const v = video.current;
      if (!v) return;
      if (document.hidden) v.pause();
      else if (resume) v.play().catch(() => {});
    }
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [video, resume]);
}

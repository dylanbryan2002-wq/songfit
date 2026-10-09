"use client";
import { useEffect, useRef, useState } from "react";
import { formatDuration, formatFileSize } from "../videoChecks";
import { CHANGE, REMOVE_VIDEO, YOUR_VIDEO } from "./copy";
import { CHOSEN_SIZE, MediaFrame } from "./Hero";
import { useMotionAllowed, usePauseWhenHidden } from "./motion";

/** Outline video icon, muted: the empty upload box and the thumbnail fallback. */
export function VideoIcon({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`${className} text-muted`} fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="5" width="13" height="14" rx="2.5" />
      <path d="M16 10l5-3v10l-5-3" strokeLinejoin="round" />
    </svg>
  );
}

/** The chosen video: the clip itself (9:16, contained on ink, muted, looping) with an X to remove it,
 *  then a mono caption "YOUR VIDEO  0:24 · 18 MB" and a separate CHANGE button. Under reduced motion it
 *  does not autoplay and shows its first frame; it pauses while the page is hidden. */
export function FileCard({
  file,
  durationSeconds,
  onChange,
  onRemove,
  disabled,
}: {
  file: File;
  /** Known length; otherwise read from the clip's metadata. */
  durationSeconds?: number | null;
  onChange: () => void;
  /** Drops the chosen video and shows the empty state again. */
  onRemove: () => void;
  disabled?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const motion = useMotionAllowed();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [readSeconds, setReadSeconds] = useState<number | null>(null);
  usePauseWhenHidden(video, motion === true);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    setFailed(false);
    setReadSeconds(null);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const seconds = durationSeconds ?? readSeconds;

  const caption = (
    <div className="flex flex-wrap items-center gap-x-4">
      <p className="whitespace-pre-wrap uppercase">{`${YOUR_VIDEO}  ${formatDuration(seconds)} · ${formatFileSize(file.size)}`}</p>
      <button
        type="button"
        onClick={onChange}
        disabled={disabled}
        className="-my-3 min-h-11 font-mono underline underline-offset-4 disabled:opacity-50"
      >
        {CHANGE}
      </button>
    </div>
  );

  return (
    <MediaFrame size={CHOSEN_SIZE} caption={caption}>
      {url && !failed && motion !== null ? (
        // iOS only paints a frame once the video plays; "#t=0.001" makes it paint the first frame when it can't.
        <video
          ref={video}
          src={motion ? url : `${url}#t=0.001`}
          muted
          playsInline
          autoPlay={motion}
          loop
          preload={motion ? "auto" : "metadata"}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) setReadSeconds(d);
          }}
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <VideoIcon />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={REMOVE_VIDEO}
        className="absolute left-2 top-2 flex h-11 w-11 items-center justify-center bg-ink/70 text-white disabled:opacity-50"
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
        <span className="sr-only">{REMOVE_VIDEO}</span>
      </button>
    </MediaFrame>
  );
}

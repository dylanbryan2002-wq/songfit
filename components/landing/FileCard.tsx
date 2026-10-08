"use client";
import { useEffect, useState } from "react";
import { formatDuration, formatFileSize } from "../videoChecks";

/** Outline video icon, muted: the empty upload box and the thumbnail fallback. */
export function VideoIcon({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`${className} text-muted`} fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="5" width="13" height="14" rx="2.5" />
      <path d="M16 10l5-3v10l-5-3" strokeLinejoin="round" />
    </svg>
  );
}

/** The chosen video: a reel-ratio preview with an X to remove it, then name, length · size, and "Change". */
export function FileCard({
  file,
  durationSeconds,
  onChange,
  onRemove,
  disabled,
}: {
  file: File;
  /** Known length; otherwise read from the thumbnail's metadata. */
  durationSeconds?: number | null;
  onChange: () => void;
  /** Drops the chosen video and shows the empty upload box again. */
  onRemove: () => void;
  disabled?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [readSeconds, setReadSeconds] = useState<number | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    setFailed(false);
    setReadSeconds(null);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const seconds = durationSeconds ?? readSeconds;

  return (
    <div className="flex w-full flex-col gap-3">
      {/* The video itself, at reel ratio, playing muted. iOS only paints a frame when the video plays. */}
      <div className="relative mx-auto aspect-[9/16] h-64 max-w-full overflow-hidden rounded-2xl bg-gray-100">
        {url && !failed ? (
          <video
            src={url}
            muted
            playsInline
            autoPlay
            loop
            preload="auto"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d)) setReadSeconds(d);
            }}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
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
          aria-label="Remove video"
          className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-ink/80 text-white disabled:opacity-50"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="flex w-full items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{file.name}</p>
          <p className="text-xs text-muted">
            {formatDuration(seconds)} · {formatFileSize(file.size)}
          </p>
        </div>
        <button
          type="button"
          onClick={onChange}
          disabled={disabled}
          className="min-h-11 shrink-0 rounded-xl px-3 text-sm font-semibold text-steel-dark disabled:opacity-50"
        >
          Change
        </button>
      </div>
    </div>
  );
}

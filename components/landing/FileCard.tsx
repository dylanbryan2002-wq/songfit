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

/** The chosen video as one compact row: thumbnail, name, length · size, and "Change". */
export function FileCard({
  file,
  durationSeconds,
  onChange,
  disabled,
}: {
  file: File;
  /** Known length; otherwise read from the thumbnail's metadata. */
  durationSeconds?: number | null;
  onChange: () => void;
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
    <div className="flex w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white p-2">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100">
        {url && !failed ? (
          // "#t=0.1" makes mobile Safari paint the first frame instead of a blank box.
          <video
            src={`${url}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d)) setReadSeconds(d);
            }}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <VideoIcon />
        )}
      </div>
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
  );
}

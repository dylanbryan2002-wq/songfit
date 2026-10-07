"use client";

import type { ReactNode } from "react";
import type { PickerRow } from "@/src/shared/types";

type Props = {
  row: PickerRow;
  hasSample: boolean;
  active: boolean;
  playing: boolean;
  chosen: boolean;
  rejected: boolean;
  showActions: boolean;
  explanationOpen: boolean;
  note: string | null;
  onPlay: () => void;
  onPause: () => void;
  onReject: () => void;
  onChoose: () => void;
  onToggleExplanation: () => void;
  children?: ReactNode;
};

const iconButton =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors active:scale-95 disabled:opacity-40";

export function SongRow(p: Props) {
  const { row } = p;
  const toggle = () => (p.playing ? p.onPause() : p.onPlay());

  return (
    <li className={`rounded-xl px-2 py-2 ${p.active ? "bg-steel/10" : ""}`}>
      <div className={`flex items-center gap-3 ${p.rejected ? "opacity-50" : ""}`}>
        {/* Tapping the song itself plays it too, like TikTok. Out of the tab order: the Play button is the control. */}
        <button
          type="button"
          tabIndex={-1}
          disabled={!p.hasSample}
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <Artwork url={row.artwork_url} active={p.active} />
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[15px] font-semibold ${p.active ? "text-steel-dark" : "text-ink"}`}>
              {row.title}
            </span>
            <span className="mt-0.5 block truncate text-[13px] text-muted">{row.artist}</span>
            <span className="mt-1 inline-block rounded-full bg-steel/15 px-2 py-0.5 text-[11px] font-semibold text-steel-dark">
              {row.direction_label}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {p.hasSample ? (
            <button
              type="button"
              onClick={toggle}
              aria-label={`${p.playing ? "Pause" : "Play"} ${row.title}`}
              className={`${iconButton} ${p.playing ? "bg-steel-dark text-white" : "bg-steel/15 text-steel-dark"}`}
            >
              {p.playing ? <PauseIcon /> : <PlayIcon />}
            </button>
          ) : (
            <span className="w-11 text-center text-[11px] leading-tight text-muted">No sample</span>
          )}
          {p.showActions && (
            <>
              <button
                type="button"
                onClick={p.onReject}
                disabled={p.rejected}
                aria-label={`Not for me: ${row.title}`}
                aria-pressed={p.rejected}
                className={`${iconButton} border border-ink/10 text-ink/60`}
              >
                <CrossIcon />
              </button>
              <button
                type="button"
                onClick={p.onChoose}
                aria-label={`Use this: ${row.title}`}
                aria-pressed={p.chosen}
                className={`${iconButton} ${p.chosen ? "bg-steel text-white" : "bg-ink text-white"}`}
              >
                <CheckIcon />
              </button>
            </>
          )}
        </div>
      </div>

      {p.note && <p className="mt-1 pl-[68px] text-xs text-muted">{p.note}</p>}
      {p.children}

      <button
        type="button"
        onClick={p.onToggleExplanation}
        aria-expanded={p.explanationOpen}
        className="ml-[60px] mt-1 flex min-h-11 items-center gap-1 px-2 text-[13px] font-medium text-steel-dark"
      >
        Why this song
        <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${p.explanationOpen ? "rotate-180" : ""}`} aria-hidden>
          <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {p.explanationOpen && <p className="pb-1 pl-[68px] pr-2 text-sm leading-relaxed text-ink/80">{row.explanation}</p>}
    </li>
  );
}

function Artwork({ url, active }: { url: string | null; active: boolean }) {
  const ring = active ? "ring-2 ring-steel" : "";
  if (!url) return <span className={`h-14 w-14 shrink-0 rounded-lg bg-ink/10 ${ring}`} />;
  return (
    // Plain img: artwork hosts vary and a 56px square needs no optimisation.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" width={56} height={56} className={`h-14 w-14 shrink-0 rounded-lg object-cover ${ring}`} />
  );
}

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" className="ml-0.5 h-5 w-5" aria-hidden>
    <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />
  </svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
    <path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" fill="currentColor" />
  </svg>
);
const CrossIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

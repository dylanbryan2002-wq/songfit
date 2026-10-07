"use client";

import type { ReactNode } from "react";
import type { PickerRow } from "@/src/shared/types";

type Props = {
  row: PickerRow;
  hasSample: boolean;
  active: boolean;
  playing: boolean;
  /** Playing and the sound has started (not still loading). */
  sounding: boolean;
  /** 0..1 through the loop while sounding, else null. */
  progress: number | null;
  chosen: boolean;
  /** The chosen song in chosen mode: labelled "Your pick". */
  pick: boolean;
  rejected: boolean;
  showActions: boolean;
  divider: boolean;
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
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-150 active:scale-[0.96] disabled:opacity-40 motion-reduce:transition-none motion-reduce:active:scale-100";

export function SongRow(p: Props) {
  const { row } = p;
  const toggle = () => (p.playing ? p.onPause() : p.onPlay());

  return (
    <div
      className={`relative px-2 py-3 transition-colors duration-150 motion-reduce:transition-none ${
        p.divider ? "border-t border-ink/5" : ""
      } ${p.active ? "bg-steel/5" : ""} ${p.chosen ? "rounded-2xl ring-1 ring-inset ring-steel" : ""}`}
    >
      <div className="flex items-center gap-3">
        {/* Tapping the song itself plays it too, like TikTok. Out of the tab order: the Play button is the control. */}
        <button
          type="button"
          tabIndex={-1}
          disabled={!p.hasSample}
          onClick={toggle}
          className={`flex min-w-0 flex-1 items-center gap-3 text-left ${p.rejected ? "opacity-40" : ""}`}
        >
          <Artwork url={row.artwork_url} />
          <span className="min-w-0 flex-1">
            {p.pick && (
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-steel-dark">Your pick</span>
            )}
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`truncate text-[17px] font-semibold leading-snug ${p.active ? "text-steel-dark" : "text-ink"} ${
                  p.rejected ? "line-through" : ""
                }`}
              >
                {row.title}
              </span>
              {p.sounding && <Equaliser />}
            </span>
            <span className="mt-0.5 block truncate text-[15px] text-muted">{row.artist}</span>
            <span className="mt-1.5 inline-block rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink/70">
              {row.direction_label}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-2">
          {p.hasSample ? (
            <button
              type="button"
              onClick={toggle}
              aria-label={`${p.playing ? "Pause" : "Play"} ${row.title}`}
              className={`${iconButton} bg-canvas ${p.playing ? "text-steel-dark" : "text-ink"}`}
            >
              {p.playing ? <PauseIcon /> : <PlayIcon />}
            </button>
          ) : (
            <span className="rounded-full bg-canvas px-2.5 py-1 text-[11px] font-medium text-muted">No sample</span>
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
              {/* Still enabled when rejected: choosing un-rejects (reducer `choose`). Muted so it reads as secondary. */}
              <button
                type="button"
                onClick={p.onChoose}
                aria-label={`Use this: ${row.title}`}
                aria-pressed={p.chosen}
                className={`${iconButton} ${p.chosen ? "bg-steel text-white" : p.rejected ? "bg-ink/10 text-ink/60" : "bg-ink text-white"}`}
              >
                <CheckIcon />
              </button>
            </>
          )}
        </div>
      </div>

      {p.note && <p className="mt-1 pl-[68px] text-[13px] text-muted">{p.note}</p>}
      {p.children}

      <button
        type="button"
        onClick={p.onToggleExplanation}
        aria-expanded={p.explanationOpen}
        className="ml-[60px] flex min-h-11 items-center gap-1 px-2 text-[13px] font-medium text-steel-dark"
      >
        Why this song
        <svg
          viewBox="0 0 20 20"
          className={`h-4 w-4 transition-transform duration-200 ease-out motion-reduce:transition-none ${p.explanationOpen ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        inert={!p.explanationOpen}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
          p.explanationOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <p className="pb-1 pl-[68px] pr-2 text-left text-[15px] leading-relaxed text-ink/80">{row.explanation}</p>
        </div>
      </div>

      {p.progress !== null && (
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-steel/10">
          <span
            className="block h-full bg-steel transition-[width] duration-100 ease-linear motion-reduce:transition-none"
            style={{ width: `${Math.min(Math.max(p.progress, 0), 1) * 100}%` }}
          />
        </span>
      )}
    </div>
  );
}

function Artwork({ url }: { url: string | null }) {
  if (!url) return <span className="h-14 w-14 shrink-0 rounded-xl bg-canvas ring-1 ring-inset ring-ink/10" />;
  return (
    <span className="relative h-14 w-14 shrink-0">
      {/* Plain img: artwork hosts vary and a 56px square needs no optimisation. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" width={56} height={56} className="h-14 w-14 rounded-xl object-cover" />
      <span aria-hidden className="absolute inset-0 rounded-xl ring-1 ring-inset ring-ink/10" />
    </span>
  );
}

/** Three bars, 0.9 s; frozen by prefers-reduced-motion in globals.css. */
const Equaliser = () => (
  <span aria-hidden className="flex h-3.5 shrink-0 items-end gap-[2px]">
    {[0, -0.3, -0.6].map((delay) => (
      <span key={delay} className="eq-bar h-full w-[3px] rounded-full bg-steel" style={{ animationDelay: `${delay}s` }} />
    ))}
  </span>
);

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

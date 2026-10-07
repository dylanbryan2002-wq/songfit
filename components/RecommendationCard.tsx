"use client";
import { useRef, useState } from "react";
import { formatTime } from "@/src/shared/format";
import type { RecommendationView } from "@/src/shared/types";

export type Rank = 1 | 2 | 3;

type Props = {
  rec: RecommendationView;
  chosen: boolean;
  collapsed: boolean;
  onSelect: (rank: Rank) => void;
  onReject: (rank: Rank) => void;
};

// Artwork-free by decision: the card never renders rec.artwork_url.
// Handlers are no-ops until Phase 4 wires them.
export function RecommendationCard({ rec, chosen, collapsed, onSelect, onReject }: Props) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const featured = rec.rank === 1;
  if (collapsed) return null;

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play();
      setPlaying(true);
    }
  };

  return (
    <article
      className={[
        "rounded-2xl border border-ink/10 bg-white shadow-sm",
        featured ? "p-5" : "p-4",
        rec.rejected ? "opacity-40" : "",
      ].join(" ")}
    >
      <span className="inline-block rounded-full bg-steel/10 px-2.5 py-0.5 text-xs font-medium text-steel-dark">
        {rec.direction_label}
      </span>
      <h2 className={featured ? "mt-2 text-xl font-semibold text-ink" : "mt-2 text-lg font-semibold text-ink"}>
        {rec.title}
      </h2>
      <p className="text-sm text-muted">{rec.artist}</p>
      <p className={featured ? "mt-3 text-2xl font-bold text-ink" : "mt-3 text-lg font-bold text-ink"}>
        Use {formatTime(rec.start_seconds)}–{formatTime(rec.end_seconds)}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink/80">{rec.explanation}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        {rec.preview_url && (
          <>
            <audio ref={audio} src={rec.preview_url} preload="none" onEnded={() => setPlaying(false)} />
            <button type="button" onClick={toggle} className="rounded-full border border-ink/15 px-3 py-1 text-ink">
              {playing ? "Pause preview" : "Play preview"}
            </button>
          </>
        )}
        <a
          href={rec.spotify_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-steel underline-offset-2 hover:underline"
        >
          Open in Spotify
        </a>
      </div>

      {chosen ? (
        <p className="mt-4 text-sm font-medium text-steel">Chosen. Go make it.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onSelect(rec.rank)}
            className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white"
          >
            Use this
          </button>
          <button
            type="button"
            onClick={() => onReject(rec.rank)}
            className="rounded-xl border border-ink/15 px-4 py-3 text-sm font-medium text-ink"
          >
            Not for me
          </button>
        </div>
      )}
    </article>
  );
}

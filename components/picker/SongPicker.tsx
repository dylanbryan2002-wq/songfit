"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { PickerData } from "@/src/shared/types";
import { formatTime } from "@/src/shared/format";
import { allRejected, initialPickerState, pickerReducer, type PickerAction } from "@/src/picker/state";
import { useSyncedPlayback } from "./useSyncedPlayback";
import { VideoPane } from "./VideoPane";
import { SongSheet } from "./SongSheet";
import { SongRow } from "./SongRow";
import { UseItPanel, type Destination } from "./UseItPanel";
import { Attribution } from "./Attribution";

type Rank = 1 | 2 | 3;
type UiEvent = "song_previewed" | "explanation_opened" | "title_copied" | "open_app" | "song_not_found";

const SAVE_FAILED = "Couldn't save. Try again.";
const ALL_REJECTED = "None of these? We'll do better next time.";
const RETRY_NOTE = "Sample didn't load. Tap play to try again.";

export function SongPicker({
  data,
  videoUrl,
  onAllRejected,
}: {
  data: PickerData;
  videoUrl: string;
  onAllRejected?: () => void;
}) {
  const id = data.submission_id;
  const rows = data.rows;
  const videoDuration = data.video_duration_seconds;
  const pb = useSyncedPlayback({ videoDurationSeconds: videoDuration });
  const [state, dispatch] = useReducer(pickerReducer, rows, initialPickerState);
  const [message, setMessage] = useState<string | null>(null);
  const [urls, setUrls] = useState<Partial<Record<Rank, string | null>>>(() =>
    Object.fromEntries(rows.map((r) => [r.rank, r.preview_url])),
  );
  const [notes, setNotes] = useState<Partial<Record<Rank, string>>>({});
  const previewed = useRef(new Set<Rank>());
  const explained = useRef(new Set<Rank>());
  const refreshed = useRef(new Set<Rank>());

  const postEvent = useCallback(
    (name: UiEvent, rank: Rank, destination?: Destination) => {
      void fetch(`/api/submissions/${id}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, rank, ...(destination ? { destination } : {}) }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [id],
  );

  const save = async (body: { action: "select" | "reject"; rank: Rank } | { action: "all_rejected" }) => {
    const res = await fetch(`/api/submissions/${id}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`feedback ${res.status}`);
  };

  // song_previewed: the first time each song actually plays in this view.
  useEffect(() => {
    const rank = pb.currentRank;
    if (pb.state !== "playing" || !rank) return;
    setNotes((n) => (n[rank] ? { ...n, [rank]: undefined } : n));
    if (previewed.current.has(rank)) return;
    previewed.current.add(rank);
    postEvent("song_previewed", rank);
  }, [pb.state, pb.currentRank, postEvent]);

  // A sample that will not play: fetch a fresh url once, then wait for the next tap. A second failure hides Play.
  useEffect(() => {
    const rank = pb.currentRank;
    if (pb.state !== "unavailable" || !rank) return;
    if (refreshed.current.has(rank)) {
      setUrls((u) => ({ ...u, [rank]: null }));
      setNotes((n) => ({ ...n, [rank]: undefined }));
      return;
    }
    refreshed.current.add(rank);
    setNotes((n) => ({ ...n, [rank]: RETRY_NOTE }));
    fetch(`/api/submissions/${id}/preview/${rank}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ preview_url: string | null }>) : null))
      .then((body) => {
        if (!body) return;
        setUrls((u) => ({ ...u, [rank]: body.preview_url }));
        if (!body.preview_url) setNotes((n) => ({ ...n, [rank]: undefined }));
      })
      .catch(() => undefined);
  }, [pb.state, pb.currentRank, id]);

  const isPlaying = (rank: Rank) =>
    state.auditioningRank === rank && pb.currentRank === rank && (pb.state === "playing" || pb.state === "loading");

  // Synchronous inside the tap: play() first, state after (I1).
  const play = (rank: Rank) => {
    const url = urls[rank];
    if (!url) return;
    pb.play(rank, url, rank === state.auditioningRank ? state.sampleStart : 0);
    dispatch({ type: "audition", rank });
  };
  const pause = () => {
    pb.pause();
    dispatch({ type: "stop" });
  };

  const snapshot = (): PickerAction => ({ type: "serverState", selected: state.chosenRank, rejected: [...state.rejected] });

  const choose = (rank: Rank) => {
    const revert = snapshot();
    dispatch({ type: "choose", rank });
    setMessage(null);
    save({ action: "select", rank }).catch(() => {
      dispatch(revert);
      setMessage(SAVE_FAILED);
    });
  };

  const reject = (rank: Rank) => {
    const revert = snapshot();
    const next = pickerReducer(state, { type: "reject", rank });
    if (state.auditioningRank === rank) pb.pause();
    dispatch({ type: "reject", rank });
    setMessage(null);
    save({ action: "reject", rank }).then(
      () => {
        if (!allRejected(next, rows.map((r) => r.rank))) return;
        setMessage(ALL_REJECTED);
        onAllRejected?.();
        save({ action: "all_rejected" }).catch(() => undefined);
      },
      () => {
        dispatch(revert);
        setMessage(SAVE_FAILED);
      },
    );
  };

  const toggleExplanation = (rank: Rank) => {
    if (state.explanationOpen !== rank && !explained.current.has(rank)) {
      explained.current.add(rank);
      postEvent("explanation_opened", rank);
    }
    dispatch({ type: "toggleExplanation", rank });
  };

  // Sample start can move until the loop would run past the end of the 30-second sample.
  const maxStart =
    pb.previewDuration !== null && videoDuration !== null
      ? Math.floor(Math.max(0, Math.min(15, pb.previewDuration - Math.min(videoDuration, pb.previewDuration))) * 2) / 2
      : 0;
  const sampleStart = Math.min(state.sampleStart, maxStart);
  const anySample = rows.some((r) => r.preview_url);

  const playingRow = rows.find((r) => r.rank === state.auditioningRank && isPlaying(r.rank)) ?? null;
  const chosenRow = rows.find((r) => r.rank === state.chosenRank) ?? null;
  const visible = state.mode === "chosen" && chosenRow ? [chosenRow] : rows;
  const deezerHref = rows.find((r) => r.rank === pb.currentRank)?.deezer_url ?? null;

  return (
    <div className="flex w-full flex-col gap-3">
      <h1 className="sr-only">Your songs</h1>
      <div className="relative">
        <VideoPane ref={pb.videoRef} src={videoUrl} />
        {playingRow && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg bg-gradient-to-t from-black/75 to-transparent px-3 pb-3 pt-12 text-white">
            <p className="truncate text-sm font-semibold">
              ▶ {playingRow.title} · {playingRow.artist}
            </p>
            <p className="text-xs text-white/80">30-second sample · not the suggested section</p>
          </div>
        )}
      </div>
      {playingRow && videoDuration !== null && pb.loopLength !== null && videoDuration > pb.loopLength + 0.5 && (
        <p className="text-center text-xs text-muted">
          Only the first {formatTime(pb.loopLength)} of your video plays with this sample.
        </p>
      )}

      <SongSheet>
        <ul className="flex flex-col gap-1">
          {visible.map((row) => {
            const active = state.auditioningRank === row.rank && pb.currentRank === row.rank;
            return (
              <SongRow
                key={row.rank}
                row={row}
                hasSample={!!urls[row.rank]}
                active={active}
                playing={isPlaying(row.rank)}
                chosen={state.chosenRank === row.rank}
                rejected={state.rejected.has(row.rank)}
                showActions={state.mode === "list"}
                explanationOpen={state.explanationOpen === row.rank}
                note={notes[row.rank] ?? null}
                onPlay={() => play(row.rank)}
                onPause={pause}
                onReject={() => reject(row.rank)}
                onChoose={() => choose(row.rank)}
                onToggleExplanation={() => toggleExplanation(row.rank)}
              >
                {active && maxStart >= 0.5 && (
                  <label className="mt-1 flex items-center gap-3 pl-[68px] pr-2 text-xs text-muted">
                    <span className="shrink-0">Adjust sample start</span>
                    <input
                      type="range"
                      min={0}
                      max={maxStart}
                      step={0.5}
                      value={sampleStart}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        dispatch({ type: "sampleStart", seconds: v });
                        pb.setSampleStart(v);
                      }}
                      className="h-11 min-w-0 flex-1 accent-steel"
                    />
                    <span className="w-8 shrink-0 text-right tabular-nums">{formatTime(sampleStart)}</span>
                  </label>
                )}
              </SongRow>
            );
          })}
        </ul>

        {state.mode === "chosen" && chosenRow && (
          <>
            <button
              type="button"
              onClick={() => dispatch({ type: "unchoose" })}
              className="ml-[68px] flex min-h-11 items-center px-2 text-sm font-semibold text-steel-dark"
            >
              Change song
            </button>
            <UseItPanel
              key={chosenRow.rank}
              row={chosenRow}
              showTrimNote={anySample}
              onCopied={() => postEvent("title_copied", chosenRow.rank)}
              onOpen={(destination) => postEvent("open_app", chosenRow.rank, destination)}
              onNotFound={() => postEvent("song_not_found", chosenRow.rank)}
            />
          </>
        )}

        {message && (
          <p role="status" className="mt-3 px-2 text-center text-sm font-medium text-ink">
            {message}
          </p>
        )}
      </SongSheet>

      <Attribution href={deezerHref} />
      <p className="text-center text-xs text-muted">Sections are our best estimate. Check it against the track.</p>
    </div>
  );
}

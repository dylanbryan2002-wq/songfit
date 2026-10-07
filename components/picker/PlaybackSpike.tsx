"use client";

import { useState } from "react";
import type { PickerRow } from "@/src/shared/types";
import { formatTime } from "@/src/shared/format";
import { useSyncedPlayback } from "./useSyncedPlayback";
import { VideoPane } from "./VideoPane";

/** Throwaway phone-test UI for the playback hook. */
export function PlaybackSpike({
  videoUrl,
  videoDurationSeconds,
  rows,
}: {
  videoUrl: string;
  videoDurationSeconds: number | null;
  rows: PickerRow[];
}) {
  const pb = useSyncedPlayback({ videoDurationSeconds });
  const [start, setStart] = useState(0);
  const maxStart =
    pb.previewDuration !== null && videoDurationSeconds !== null
      ? Math.max(0, Math.min(15, pb.previewDuration - Math.min(videoDurationSeconds, pb.previewDuration)))
      : 15;
  const shownStart = Math.min(start, maxStart);
  const f = (n: number) => n.toFixed(1);

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-sm font-medium">30-second sample · not the suggested section</p>
      <VideoPane ref={pb.videoRef} src={videoUrl} />
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <button
            key={r.rank}
            type="button"
            disabled={!r.preview_url}
            onClick={() => r.preview_url && pb.play(r.rank, r.preview_url, start)}
            className="min-h-11 rounded-md border px-3 py-2 text-left text-sm disabled:opacity-40"
          >
            Play {r.rank} · {r.title}
            {r.preview_url ? "" : " (no sample)"}
          </button>
        ))}
        <button type="button" onClick={pb.pause} className="min-h-11 rounded-md border px-3 py-2 text-sm">
          Pause
        </button>
      </div>
      <p className="font-mono text-xs">
        {pb.state} · {pb.currentRank ?? "-"} · {f(pb.position)}/{pb.loopLength === null ? "-" : f(pb.loopLength)} ·
        drift {f(pb.drift)}
      </p>
      {videoDurationSeconds !== null && pb.loopLength !== null && videoDurationSeconds > pb.loopLength && (
        <p className="text-xs">Only the first {formatTime(pb.loopLength)} of your video plays with this sample.</p>
      )}
      <label className="flex flex-col gap-1 text-sm">
        Sample start {shownStart}s
        <input
          type="range"
          min={0}
          max={maxStart}
          step={1}
          value={shownStart}
          onChange={(e) => {
            const v = Number(e.target.value);
            setStart(v);
            pb.setSampleStart(v);
          }}
        />
      </label>
    </div>
  );
}

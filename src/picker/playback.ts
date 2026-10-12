/**
 * How the results picker plays samples. "sync" mixes the sample under the moving video; "alone" never plays a
 * sample while the video moves. Sync was admin-only from 2026-10-09 (docs/review/16: syncing samples to the
 * creator's video is not allowed by self-serve providers; Deezer's objection was commercial use). Songfit became
 * non-commercial on 2026-10-09 and Dylan turned sync back on for everyone on 2026-10-12. Alone mode is kept.
 */
export type PlaybackMode = "sync" | "alone";

export function playbackModeFor(_admin: boolean): PlaybackMode {
  return "sync";
}

export const ALONE_NOTE = "Samples play on their own. Add the song in TikTok or Instagram to hear it over your video.";

/** Alone mode: what the video and the sample are doing. Never both sounding. */
export type AloneSides = {
  video: "looping-muted" | "paused" | "playing-unmuted";
  sample: "playing" | "stopped";
};
export type AloneEvent = "playSample" | "tapVideo" | "stopSample";

export const ALONE_IDLE: AloneSides = { video: "looping-muted", sample: "stopped" };

export function aloneNext(s: AloneSides, e: AloneEvent): AloneSides {
  switch (e) {
    case "playSample":
      return { video: "paused", sample: "playing" };
    case "tapVideo":
      return { video: s.video === "playing-unmuted" ? "paused" : "playing-unmuted", sample: "stopped" };
    case "stopSample":
      return ALONE_IDLE;
  }
}

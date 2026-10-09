/**
 * How the results picker plays samples. "sync" mixes the sample under the moving video (admins only);
 * "alone" never plays a sample while the video moves (docs/review/16: the providers' terms forbid
 * playing a sample in sync with the creator's video).
 */
export type PlaybackMode = "sync" | "alone";

export function playbackModeFor(admin: boolean): PlaybackMode {
  return admin ? "sync" : "alone";
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

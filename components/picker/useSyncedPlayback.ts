"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/src/shared/logger";
import type { Rank } from "@/src/shared/types";

export type PlaybackState = "idle" | "loading" | "playing" | "paused" | "unavailable";
export type SyncedPlayback = {
  state: PlaybackState;
  currentRank: Rank | null;
  /** audio.currentTime − sampleStart, clamped to [0, loopLength] — for a progress ruler */
  position: number;
  loopLength: number | null; // min(videoDuration, loadedPreviewDuration − sampleStart)
  /** Loaded preview duration (audio.duration), null until loadedmetadata. */
  previewDuration: number | null;
  /** Video time minus expected video time, seconds. For the spike status line. */
  drift: number;
  /** MUST be called synchronously inside a user-gesture handler (tap). */
  play(rank: Rank, src: string, sampleStart?: number): void;
  pause(): void;
  setSampleStart(seconds: number): void; // re-seeks audio and video; keeps playing if playing
  videoRef: React.RefObject<HTMLVideoElement | null>;
};

export function loopLength(
  videoDuration: number | null,
  previewDuration: number | null,
  sampleStart = 0,
): number | null {
  if (videoDuration === null || previewDuration === null) return null;
  if (!(videoDuration > 0) || !(previewDuration > 0)) return null;
  const L = Math.min(videoDuration, previewDuration - sampleStart);
  return L >= 0.5 ? L : null;
}

export function videoTimeFor(audioTime: number, sampleStart: number, loop: number): number {
  const t = (audioTime - sampleStart) % loop;
  return t < 0 ? t + loop : t;
}

export function needsNudge(videoTime: number, expected: number, threshold = 0.15): boolean {
  return Math.abs(videoTime - expected) > threshold;
}

/**
 * What a rejected play() means. The song is the product: a video that will not play (e.g. an HEVC
 * .mov on Android Chrome) leaves an audio-only audition; only an audio failure is `unavailable`.
 */
export function playFailure(which: "audio" | "video", errorName: string): "ignore" | "audio_only" | "unavailable" {
  if (errorName === "AbortError") return "ignore";
  return which === "video" ? "audio_only" : "unavailable";
}

export function useSyncedPlayback(opts: { videoDurationSeconds: number | null }): SyncedPlayback {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const token = useRef(0);
  const sampleStartRef = useRef(0);
  const pendingStart = useRef<number | null>(null);
  const loopRef = useRef<number | null>(null);
  const stateRef = useRef<PlaybackState>("idle");
  // The video would not play this audition: do not retry it every frame. Logged once per view.
  const videoFailed = useRef(false);
  const videoFailLogged = useRef(false);
  const videoDurationRef = useRef(opts.videoDurationSeconds);
  videoDurationRef.current = opts.videoDurationSeconds;

  const [state, setStateRaw] = useState<PlaybackState>("idle");
  const [currentRank, setCurrentRank] = useState<Rank | null>(null);
  const [position, setPosition] = useState(0);
  const [loop, setLoop] = useState<number | null>(null);
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const audioDurRef = useRef<number | null>(null);
  const [drift, setDrift] = useState(0);

  const setState = useCallback((s: PlaybackState) => {
    stateRef.current = s;
    setStateRaw(s);
  }, []);

  // Created once; not part of the render tree.
  const getAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "auto";
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const recomputeLoop = useCallback(() => {
    const L = loopLength(
      videoDurationRef.current ?? videoRef.current?.duration ?? null,
      audioDurRef.current,
      sampleStartRef.current,
    );
    loopRef.current = L;
    setLoop(L);
  }, []);

  const tick = useCallback(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    const L = loopRef.current;
    if (!audio || !video || L === null || pendingStart.current !== null) return;
    const start = sampleStartRef.current;
    if (stateRef.current === "playing" && video.paused && !videoFailed.current) void video.play().catch(() => undefined);
    if (audio.currentTime - start >= L) {
      audio.currentTime = start;
      video.currentTime = 0;
    } else if (!audio.seeking && !video.seeking) {
      const expected = videoTimeFor(audio.currentTime, start, L);
      if (needsNudge(video.currentTime, expected)) video.currentTime = expected;
    }
    setPosition(Math.min(Math.max(audio.currentTime - start, 0), L));
    setDrift(video.currentTime - videoTimeFor(audio.currentTime, start, L));
  }, []);

  useEffect(() => {
    const audio = getAudio();
    const video = videoRef.current;
    const tokenRef = token;
    if (video) {
      video.defaultMuted = true;
      video.muted = true;
      video.loop = true;
    }
    const onMeta = () => {
      audioDurRef.current = Number.isFinite(audio.duration) ? audio.duration : null;
      setPreviewDuration(audioDurRef.current);
      recomputeLoop();
      if (pendingStart.current !== null) {
        const start = pendingStart.current;
        pendingStart.current = null;
        audio.currentTime = start;
        if (videoRef.current) videoRef.current.currentTime = 0;
      }
    };
    const onEnded = () => {
      if (stateRef.current !== "playing") return;
      audio.currentTime = sampleStartRef.current;
      if (videoRef.current) videoRef.current.currentTime = 0;
      void audio.play().catch(() => setState("unavailable"));
      if (!videoFailed.current) void videoRef.current?.play().catch(() => undefined);
    };
    const onError = () => {
      logger.warn("picker.audio_error", { code: audio.error?.code ?? null });
      setState("unavailable");
    };
    const onStalled = () => logger.warn("picker.audio_stalled", {});
    const stopNow = () => {
      token.current++;
      audio.pause();
      videoRef.current?.pause();
      if (stateRef.current === "playing" || stateRef.current === "loading") setState("paused");
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") stopNow();
    };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("timeupdate", tick);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("stalled", onStalled);
    document.addEventListener("visibilitychange", onHidden);
    // Leaving the page: silence at once rather than after the unload finishes.
    window.addEventListener("pagehide", stopNow);
    return () => {
      audio.pause();
      video?.pause();
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("timeupdate", tick);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("stalled", onStalled);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", stopNow);
      audio.src = "";
      tokenRef.current++;
    };
  }, [getAudio, setState, tick, recomputeLoop]);

  // rAF nudge while playing and visible.
  useEffect(() => {
    if (state !== "playing") return;
    let raf = 0;
    const frame = () => {
      if (document.visibilityState === "visible") tick();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state, tick]);

  const play = useCallback(
    (rank: Rank, src: string, sampleStart = 0) => {
      const audio = getAudio();
      const video = videoRef.current;
      if (!video) return;
      const mine = ++token.current;
      videoFailed.current = false;
      sampleStartRef.current = sampleStart;
      setCurrentRank(rank);
      setState("loading");
      setPosition(0);

      const changed = audio.getAttribute("src") !== src;
      if (changed) {
        loopRef.current = null;
        audioDurRef.current = null;
        setLoop(null);
        setPreviewDuration(null);
        audio.src = src;
        pendingStart.current = sampleStart;
      } else {
        if (audio.readyState >= 1) {
          pendingStart.current = null;
          audio.currentTime = sampleStart;
          video.currentTime = 0;
          recomputeLoop();
        } else {
          pendingStart.current = sampleStart;
        }
      }

      // Both play() calls back to back inside the gesture: no await between them.
      // results: audio ok, video settled (played or gave up), video ok.
      const results = [false, false, false];
      const audioP = audio.play();
      const videoP = video.play();
      const fail = (which: "audio" | "video", e: unknown) => {
        if (mine !== token.current) return;
        const name = e instanceof Error ? e.name : "unknown";
        const outcome = playFailure(which, name);
        if (outcome === "ignore") return;
        if (outcome === "audio_only") {
          videoFailed.current = true;
          if (!videoFailLogged.current) logger.warn("picker.play_failed", { rank, which, reason: name });
          videoFailLogged.current = true;
          results[1] = true;
          if (results[0]) setState("playing");
          return;
        }
        logger.warn("picker.play_failed", { rank, which, reason: name });
        audio.pause();
        video.pause();
        setState("unavailable");
      };
      void audioP.then(
        () => {
          results[0] = true;
          if (mine === token.current && results[1]) setState("playing");
        },
        (e: unknown) => fail("audio", e),
      );
      void videoP.then(
        () => {
          results[1] = true;
          results[2] = true;
          if (mine === token.current && results[0]) setState("playing");
        },
        (e: unknown) => fail("video", e),
      );
      void Promise.allSettled([audioP, videoP]).then(() => {
        logger.info("picker.play", {
          rank,
          audio: results[0],
          video: results[2],
          ...(mine !== token.current ? { superseded: true } : {}),
        });
      });
    },
    [getAudio, setState, recomputeLoop],
  );

  const pause = useCallback(() => {
    token.current++;
    audioRef.current?.pause();
    videoRef.current?.pause();
    setState("paused");
  }, [setState]);

  const setSampleStart = useCallback((seconds: number) => {
    const audio = audioRef.current;
    const video = videoRef.current;
    sampleStartRef.current = seconds;
    if (pendingStart.current !== null) {
      pendingStart.current = seconds;
      return;
    }
    // (loop is recomputed below once metadata is known)
    if (!audio || !video || audio.readyState < 1) return;
    recomputeLoop();
    audio.currentTime = seconds;
    video.currentTime = 0;
  }, [recomputeLoop]);

  return { state, currentRank, position, loopLength: loop, previewDuration, drift, play, pause, setSampleStart, videoRef };
}

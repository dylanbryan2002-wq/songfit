"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/src/shared/logger";
import type { Rank } from "@/src/shared/types";
import { DEFAULT_MUSIC, DEFAULT_VOICE, percentToGain } from "@/src/picker/mix";
import { ALONE_IDLE, aloneNext, type AloneSides, type PlaybackMode } from "@/src/picker/playback";

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
  /** False once Web Audio could not carry the video's sound: the voice slider has nothing to drive. */
  voiceControl: boolean;
  /** Alone mode: the video is playing with its own sound. */
  videoSound: boolean;
  /** Alone mode, MUST be called synchronously inside the tap: stops any sample and plays the video with
   *  its sound from the current frame, or pauses it if it already is. */
  toggleVideo(): void;
};

/**
 * The voice + music graph. iOS Safari ignores `media.volume`, so both elements go through Web Audio:
 * video → voice gain → out, sample audio → music gain → out. An element can be attached only once in
 * its lifetime, so the nodes are kept and reused across tracks. A null gain means that element plays
 * on its own (video stays muted; music falls back to `audio.volume`).
 */
export type Mix = {
  ctx: AudioContext;
  voice: GainNode | null;
  music: GainNode | null;
  videoEl: HTMLVideoElement | null;
  audioEl: HTMLAudioElement | null;
};

/** MUST be called synchronously inside the tap: creates the context on first use and resumes it. */
export function ensureMix(
  mix: Mix | null,
  video: HTMLVideoElement,
  audio: HTMLAudioElement,
  create: () => AudioContext | null,
): Mix | null {
  let m = mix;
  if (!m) {
    try {
      const ctx = create();
      if (!ctx) return null;
      m = { ctx, voice: null, music: null, videoEl: null, audioEl: null };
    } catch {
      return null;
    }
  }
  if (m.ctx.state !== "running") void m.ctx.resume().catch(() => undefined);
  const route = (el: HTMLMediaElement): GainNode | null => {
    try {
      const gain = m.ctx.createGain();
      m.ctx.createMediaElementSource(el).connect(gain);
      gain.connect(m.ctx.destination);
      return gain;
    } catch {
      return null;
    }
  };
  if (m.audioEl !== audio) {
    m.audioEl = audio;
    m.music = route(audio);
  }
  if (m.videoEl !== video) {
    m.videoEl = video;
    m.voice = route(video);
  }
  return m;
}

function createAudioContext(): AudioContext | null {
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  // iOS 16.4+: play through the silent switch like a plain media element does.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = "playback";
  return new Ctor();
}

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

export function useSyncedPlayback(opts: {
  videoDurationSeconds: number | null;
  /** "alone": the sample never plays while the video moves. Default "sync". */
  mode?: PlaybackMode;
  /** Slider levels, 0..100. */
  voice?: number;
  music?: number;
}): SyncedPlayback {
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
  const mixRef = useRef<Mix | null>(null);
  const voiceLevel = opts.voice ?? DEFAULT_VOICE;
  const musicLevel = opts.music ?? DEFAULT_MUSIC;
  const levelsRef = useRef({ voice: voiceLevel, music: musicLevel });
  levelsRef.current = { voice: voiceLevel, music: musicLevel };
  const aloneRef = useRef(opts.mode === "alone");
  aloneRef.current = opts.mode === "alone";
  const sidesRef = useRef<AloneSides>(ALONE_IDLE);
  const [videoSound, setVideoSound] = useState(false);

  const [state, setStateRaw] = useState<PlaybackState>("idle");
  const [currentRank, setCurrentRank] = useState<Rank | null>(null);
  const [position, setPosition] = useState(0);
  const [loop, setLoop] = useState<number | null>(null);
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const audioDurRef = useRef<number | null>(null);
  const [drift, setDrift] = useState(0);
  const [voiceControl, setVoiceControl] = useState(true);

  const setState = useCallback((s: PlaybackState) => {
    stateRef.current = s;
    setStateRaw(s);
  }, []);

  const setSides = useCallback((s: AloneSides) => {
    sidesRef.current = s;
    setVideoSound(s.video === "playing-unmuted");
  }, []);

  // Created once; not part of the render tree.
  const getAudio = useCallback((): HTMLAudioElement => {
    if (!audioRef.current) {
      const a = new Audio();
      // Before any src: an untagged cross-origin source plays silence through Web Audio.
      a.crossOrigin = "anonymous";
      a.preload = "auto";
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  // The page never plays the creator's voice by itself: muted unless a sample is auditioning.
  const silenceVoice = useCallback(() => {
    if (videoRef.current) videoRef.current.muted = true;
    if (mixRef.current?.voice) mixRef.current.voice.gain.value = 0;
  }, []);

  // Alone: the sample stopped, so the video goes back to its silent loop from the frozen frame.
  const resumeMutedLoop = useCallback(() => {
    silenceVoice();
    setSides(aloneNext(sidesRef.current, "stopSample"));
    void videoRef.current?.play().catch(() => undefined);
  }, [silenceVoice, setSides]);

  // Levels follow the sliders. The voice is heard only while the sample is actually playing.
  const applyLevels = useCallback(() => {
    const m = mixRef.current;
    const video = videoRef.current;
    const audio = audioRef.current;
    const s = stateRef.current;
    if (aloneRef.current) {
      // Alone: the video is heard only while it plays on its own; the sample at the music level.
      const sound = sidesRef.current.video === "playing-unmuted";
      if (video) {
        if (!sound) video.muted = true;
        video.volume = m?.voice ? 1 : percentToGain(levelsRef.current.voice);
      }
      if (m?.voice) m.voice.gain.value = sound ? percentToGain(levelsRef.current.voice) : 0;
      if (m?.music) m.music.gain.value = percentToGain(levelsRef.current.music);
      if (audio) audio.volume = m?.music ? 1 : percentToGain(levelsRef.current.music);
      return;
    }
    const voiceOn = !!m?.voice && !videoFailed.current;
    if (video && !(voiceOn && (s === "playing" || s === "loading"))) video.muted = true;
    if (m?.voice) m.voice.gain.value = voiceOn && s === "playing" ? percentToGain(levelsRef.current.voice) : 0;
    if (m?.music) m.music.gain.value = percentToGain(levelsRef.current.music);
    if (audio) audio.volume = m?.music ? 1 : percentToGain(levelsRef.current.music);
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
    if (aloneRef.current) {
      // Same loop window, the video left frozen.
      if (audio.currentTime - start >= L) audio.currentTime = start;
      setPosition(Math.min(Math.max(audio.currentTime - start, 0), L));
      return;
    }
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
        if (videoRef.current && !aloneRef.current) videoRef.current.currentTime = 0;
      }
    };
    const onEnded = () => {
      if (stateRef.current !== "playing") return;
      audio.currentTime = sampleStartRef.current;
      if (aloneRef.current) {
        void audio.play().catch(() => setState("unavailable"));
        return;
      }
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
      if (aloneRef.current) resumeMutedLoop();
      else {
        videoRef.current?.pause();
        silenceVoice();
      }
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
      // This element is tied to the closing context for good: the next mount gets a fresh one.
      if (mixRef.current) {
        void mixRef.current.ctx.close().catch(() => undefined);
        mixRef.current = null;
        audioRef.current = null;
      }
    };
  }, [getAudio, setState, tick, recomputeLoop, silenceVoice, resumeMutedLoop]);

  useEffect(applyLevels, [state, voiceLevel, musicLevel, videoSound, applyLevels]);

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
      const mix = ensureMix(mixRef.current, video, audio, createAudioContext);
      mixRef.current = mix;
      setVoiceControl(!!mix?.voice);
      const alone = aloneRef.current;
      // Alone: never both at once, so the video freezes on its frame while the sample plays.
      if (alone) {
        video.pause();
        setSides(aloneNext(sidesRef.current, "playSample"));
      }
      // iOS unmutes only inside a gesture. The voice gain stays at 0 until the sample is playing.
      else if (mix?.voice) video.muted = false;
      sampleStartRef.current = sampleStart;
      setCurrentRank(rank);
      setState("loading");
      applyLevels();
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
          if (!alone) video.currentTime = 0;
          recomputeLoop();
        } else {
          pendingStart.current = sampleStart;
        }
      }

      if (alone) {
        let ok = false;
        void audio.play().then(
          () => {
            ok = true;
            if (mine === token.current) setState("playing");
          },
          (e: unknown) => {
            if (mine !== token.current) return;
            const name = e instanceof Error ? e.name : "unknown";
            if (playFailure("audio", name) === "ignore") return;
            logger.warn("picker.play_failed", { rank, which: "audio", reason: name });
            audio.pause();
            resumeMutedLoop();
            setState("unavailable");
          },
        ).finally(() => {
          logger.info("picker.play", { rank, audio: ok, video: false, ...(mine !== token.current ? { superseded: true } : {}) });
        });
        return;
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
          silenceVoice();
          results[1] = true;
          if (results[0]) setState("playing");
          return;
        }
        logger.warn("picker.play_failed", { rank, which, reason: name });
        audio.pause();
        video.pause();
        silenceVoice();
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
    [getAudio, setState, recomputeLoop, silenceVoice, applyLevels, setSides, resumeMutedLoop],
  );

  const pause = useCallback(() => {
    token.current++;
    audioRef.current?.pause();
    if (aloneRef.current) resumeMutedLoop();
    else {
      videoRef.current?.pause();
      silenceVoice();
    }
    setState("paused");
  }, [setState, silenceVoice, resumeMutedLoop]);

  const toggleVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const next = aloneNext(sidesRef.current, "tapVideo");
    if (next.video === "paused") {
      video.pause();
      setSides(next);
      return;
    }
    token.current++;
    const audio = getAudio();
    audio.pause();
    const mix = ensureMix(mixRef.current, video, audio, createAudioContext);
    mixRef.current = mix;
    setVoiceControl(!!mix?.voice);
    // iOS unmutes only inside a gesture.
    video.muted = false;
    setSides(next);
    if (stateRef.current === "playing" || stateRef.current === "loading") setState("paused");
    applyLevels();
    void video.play().catch((e: unknown) => {
      if (e instanceof Error && e.name === "AbortError") return;
      if (sidesRef.current.video !== "playing-unmuted") return;
      silenceVoice();
      setSides({ video: "paused", sample: "stopped" });
    });
  }, [getAudio, setState, setSides, applyLevels, silenceVoice]);

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
    if (!aloneRef.current) video.currentTime = 0;
  }, [recomputeLoop]);

  return {
    state,
    currentRank,
    position,
    loopLength: loop,
    previewDuration,
    drift,
    play,
    pause,
    setSampleStart,
    videoRef,
    voiceControl,
    videoSound,
    toggleVideo,
  };
}

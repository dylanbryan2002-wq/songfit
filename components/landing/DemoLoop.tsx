"use client";
import { useEffect, useRef, useState } from "react";
import { DEMO_SONG, DEMO_USE, DEMO_VIDEO_AVAILABLE, EXAMPLE, NOW_PLAYING } from "./copy";
import { DEMO_SIZE, MediaFrame } from "./Hero";
import { useMotionAllowed, usePauseWhenHidden } from "./motion";

const VIDEO = "/brand/demo.mp4";
const POSTER = "/brand/demo-poster.jpg";

/** Demo of a result, poster first: the still paints at once; the video is fetched only once the slot is on
 *  screen and motion is allowed (or on a tap of Play), and replaces the still only when it is actually playing.
 *  Any failure keeps the still; no still either leaves the plain ink box. The caption shows in every case.
 *  `initial: "ink"` starts with both files failed (tests). `videoAvailable` false (DEMO_VIDEO_AVAILABLE) never
 *  requests the video and shows no play control. */
export function DemoLoop({
  initial = "poster",
  videoAvailable = DEMO_VIDEO_AVAILABLE,
}: {
  initial?: "poster" | "ink";
  videoAvailable?: boolean;
}) {
  const slot = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const motion = useMotionAllowed();
  const [posterFailed, setPosterFailed] = useState(initial === "ink");
  const [videoFailed, setVideoFailed] = useState(initial === "ink" || !videoAvailable);
  const [load, setLoad] = useState(false); // the <video> is mounted (and fetching)
  const [wantPlay, setWantPlay] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [revealed, setRevealed] = useState(false);
  usePauseWhenHidden(video, wantPlay);

  useEffect(() => {
    if (!motion || videoFailed) return;
    const el = slot.current;
    const start = () => {
      setWantPlay(true);
      setLoad(true);
    };
    if (!el || typeof IntersectionObserver === "undefined") return start();
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        start();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [motion, videoFailed]);

  function toggle() {
    const v = video.current;
    if (!load || !v) {
      setWantPlay(true);
      setLoad(true); // autoPlay starts it once mounted
      return;
    }
    if (v.paused) {
      setWantPlay(true);
      v.play().catch(() => {});
    } else {
      setWantPlay(false);
      v.pause();
    }
  }

  const caption = (
    <>
      <p className="whitespace-pre-wrap">{`${playing ? NOW_PLAYING : EXAMPLE}  ${DEMO_SONG}`}</p>
      <p className="mt-1">
        <span className="inline-block border-b-2 border-ink pb-0.5">{DEMO_USE}</span>
      </p>
    </>
  );

  return (
    <MediaFrame size={DEMO_SIZE} caption={caption}>
      <span ref={slot} aria-hidden className="absolute inset-0" />
      {!posterFailed && (
        // eslint-disable-next-line @next/next/no-img-element -- static brand still, no optimisation needed
        <img
          src={POSTER}
          alt="A Songfit result: a song and the part of it to use"
          fetchPriority="high"
          onError={() => setPosterFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {load && !videoFailed && (
        <video
          ref={video}
          src={VIDEO}
          muted
          playsInline
          loop
          autoPlay
          preload="auto"
          aria-hidden
          onPlaying={() => {
            setPlaying(true);
            setRevealed(true);
          }}
          onPause={() => setPlaying(false)}
          onError={() => {
            setVideoFailed(true);
            setPlaying(false);
          }}
          className={`absolute inset-0 h-full w-full object-cover ${revealed ? "" : "opacity-0"}`}
        />
      )}
      {!videoFailed && (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause demo" : "Play demo"}
          className="absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center bg-ink/70 text-white"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
            {playing ? <path d="M4 3h3v10H4zM9 3h3v10H9z" /> : <path d="M4 2.5v11l9.5-5.5z" />}
          </svg>
        </button>
      )}
    </MediaFrame>
  );
}

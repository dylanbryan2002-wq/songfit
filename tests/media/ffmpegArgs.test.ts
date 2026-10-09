import { describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as { args: string[]; opts: { env?: Record<string, string>; timeout?: number } }[]);
vi.mock("node:child_process", () => ({
  execFile: (_f: string, args: string[], opts: { env?: Record<string, string> }, cb: (e: unknown, o: string, s: string) => void) => {
    calls.push({ args, opts });
    cb(Object.assign(new Error("Command failed"), { killed: true, signal: "SIGKILL" }), "", "");
  },
}));

import { audioArgs, audioStreamsArgs, childEnv, framesArgs, probeDurationArgs } from "@/src/media/extractHelpers";
import { extractMedia } from "@/src/media/extract";
import { transcodeArgs, transcodeForPlayback } from "@/src/media/transcode";

/** The whitelist pair appears once and before the input (`-i x` for ffmpeg, the bare path for ffprobe). */
function whitelistBeforeInput(args: string[], input: string) {
  const w = args.indexOf("-protocol_whitelist");
  expect(w).toBeGreaterThanOrEqual(0);
  expect(args[w + 1]).toBe("file,pipe");
  expect(args.filter((a) => a === "-protocol_whitelist")).toHaveLength(1);
  expect(w).toBeLessThan(args.indexOf(input));
  const i = args.indexOf("-i");
  if (i >= 0) {
    expect(w).toBeLessThan(i);
    expect(args[i + 1]).toBe(input);
  }
}

describe("ffmpeg/ffprobe argv on untrusted input", () => {
  const IN = "/tmp/songfit-x/video.mov";
  it.each([
    ["ffprobe duration", probeDurationArgs(IN)],
    ["ffprobe streams", audioStreamsArgs(IN)],
    ["ffmpeg frames", framesArgs(IN, 1, 60, 512, "/tmp/frame_%03d.jpg")],
    ["ffmpeg audio", audioArgs(IN, "/tmp/audio.wav")],
    ["ffmpeg transcode", transcodeArgs(IN, "/tmp/playback.mp4")],
  ])("%s: file,pipe only, before the input", (_name, args) => {
    whitelistBeforeInput(args, IN);
  });

  it("keeps the probe and extraction arguments", () => {
    expect(probeDurationArgs(IN)).toEqual(["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration", "-of", "json", IN]);
    expect(framesArgs(IN, 0.5, 60, 512, "/o/f_%03d.jpg")).toEqual([
      "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe", "-i", IN,
      "-frames:v", "60", "-vf", "fps=0.5,scale=512:-2", "-q:v", "4", "/o/f_%03d.jpg",
    ]);
  });

  it("child env carries PATH and nothing else", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "must-not-leak");
    expect(Object.keys(childEnv())).toEqual(["PATH"]);
    vi.unstubAllEnvs();
  });

  it("every spawn passes the clean env and a timeout", async () => {
    calls.length = 0;
    await extractMedia(IN, { workDir: "/tmp/songfit-ffargs-unit" }).catch(() => undefined);
    await transcodeForPlayback(IN, "/tmp", Date.now() + 400_000);
    expect(calls.length).toBe(2); // ffprobe duration (killed), then the transcode
    for (const c of calls) {
      expect(Object.keys(c.opts.env ?? {})).toEqual(["PATH"]);
      expect(c.opts.timeout).toBeGreaterThan(0);
      whitelistBeforeInput(c.args, IN);
    }
  });
});

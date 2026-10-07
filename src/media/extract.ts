import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import { LIMITS } from "../shared/config";
import { PipelineError } from "../shared/errors";
import { logger } from "../shared/logger";
import { pickFps, frameTimestamps, timeoutFor } from "./extractHelpers";

const TIMEOUTS = { probe: 20_000, frames: 90_000, audio: 60_000 } as const;

function bin(): { ffmpeg: string; ffprobe: string } {
  if (!ffmpegPath) throw new PipelineError("analyze", "ffmpeg binary not found");
  const ffprobe = ffprobeStatic.path;
  if (!ffprobe) throw new PipelineError("analyze", "ffprobe binary not found");
  return { ffmpeg: ffmpegPath, ffprobe };
}

/**
 * Runs a binary with a hard timeout. On timeout Node sends SIGKILL to the child and
 * rejects with `killed: true`; we translate that into a PipelineError so the runner
 * records "ffmpeg timeout: <step>" instead of an opaque signal name.
 */
function run(file: string, args: string[], step: string, timeoutMs: number): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout: String(stdout) });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
        if (e.killed || e.signal === "SIGKILL") {
          return reject(new PipelineError("analyze", `ffmpeg timeout: ${step} (${timeoutMs} ms)`));
        }
        reject(new PipelineError("analyze", `${step} failed: ${e.message}`, String(stderr).slice(0, 2000)));
      },
    );
  });
}

async function probeDuration(ffprobe: string, input: string, deadlineAt?: number): Promise<number> {
  const { stdout } = await run(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", input],
    "ffprobe duration",
    timeoutFor(TIMEOUTS.probe, deadlineAt),
  );
  const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
  const d = Number(parsed.format?.duration);
  if (!Number.isFinite(d) || d <= 0) throw new PipelineError("analyze", "could not read video duration", stdout);
  return d;
}

async function hasAudioStream(ffprobe: string, input: string, deadlineAt?: number): Promise<boolean> {
  const { stdout } = await run(
    ffprobe,
    ["-v", "error", "-select_streams", "a", "-show_streams", "-of", "json", input],
    "ffprobe streams",
    timeoutFor(TIMEOUTS.probe, deadlineAt),
  );
  const parsed = JSON.parse(stdout) as { streams?: unknown[] };
  return Array.isArray(parsed.streams) && parsed.streams.length > 0;
}

export async function extractMedia(
  videoPath: string,
  opts: { workDir?: string; deadlineAt?: number } = {},
): Promise<{
  durationSeconds: number;
  frames: { time: number; path: string }[];
  audioPath: string | null;
  workDir: string;
}> {
  const { ffmpeg, ffprobe } = bin();
  const { deadlineAt } = opts;
  const dir = opts.workDir ?? (await fs.mkdtemp(path.join(os.tmpdir(), "songfit-")));
  await fs.mkdir(dir, { recursive: true });

  const durationSeconds = await probeDuration(ffprobe, videoPath, deadlineAt);
  if (durationSeconds > LIMITS.maxDurationSeconds) {
    throw new PipelineError("analyze", `video too long: ${Math.round(durationSeconds)}s > ${LIMITS.maxDurationSeconds}s`);
  }

  const fps = pickFps(durationSeconds, LIMITS.maxFrames);
  const framePattern = path.join(dir, "frame_%03d.jpg");
  await run(
    ffmpeg,
    [
      "-hide_banner", "-loglevel", "error",
      "-i", videoPath,
      "-vf", `fps=${fps},scale=${LIMITS.frameWidth}:-2`,
      "-q:v", "4",
      framePattern,
    ],
    "ffmpeg frames",
    timeoutFor(TIMEOUTS.frames, deadlineAt),
  );
  const names = (await fs.readdir(dir)).filter((n) => /^frame_\d{3}\.jpg$/.test(n)).sort();
  const times = frameTimestamps(names.length, fps);
  const frames = names.map((n, i) => ({ time: times[i] ?? 0, path: path.join(dir, n) }));
  if (frames.length === 0) throw new PipelineError("analyze", "no frames extracted");

  let audioPath: string | null = null;
  if (await hasAudioStream(ffprobe, videoPath, deadlineAt)) {
    audioPath = path.join(dir, "audio.wav");
    await run(
      ffmpeg,
      [
        "-hide_banner", "-loglevel", "error",
        "-i", videoPath,
        "-vn", "-ac", "1", "-ar", "16000", "-f", "wav",
        audioPath,
      ],
      "ffmpeg audio",
      timeoutFor(TIMEOUTS.audio, deadlineAt),
    );
  }

  logger.info("media.extracted", { durationSeconds, frames: frames.length, fps, audio: audioPath !== null });
  return { durationSeconds, frames, audioPath, workDir: dir };
}

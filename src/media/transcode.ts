import { execFile } from "node:child_process";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { logger } from "../shared/logger";

const MAX_TRANSCODE_MS = 60_000;
const MODEL_RESERVE_MS = 120_000;
const MIN_TRANSCODE_MS = 15_000;

/** Pure: exact ffmpeg argv for the H.264 playback copy (video only, <= 720 px wide). */
export function transcodeArgs(input: string, output: string): string[] {
  return [
    "-y",
    "-hide_banner", "-loglevel", "error",
    "-i", input,
    "-an",
    "-vf", "scale='min(720,iw)':-2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    output,
  ];
}

/** Pure: ms the transcode may use, or null when too little budget remains (skip it). */
export function transcodeBudgetMs(deadlineAt: number | undefined, now: number = Date.now()): number | null {
  if (deadlineAt === undefined) return MAX_TRANSCODE_MS;
  const ms = Math.min(MAX_TRANSCODE_MS, deadlineAt - now - MODEL_RESERVE_MS);
  return ms < MIN_TRANSCODE_MS ? null : ms;
}

/**
 * Writes `<outDir>/playback.mp4`. Returns its path, or null on skip/failure. NEVER throws:
 * a missing playback copy must not fail the analysis stage.
 */
export async function transcodeForPlayback(
  videoPath: string,
  outDir: string,
  deadlineAt?: number,
): Promise<string | null> {
  try {
    if (!ffmpegPath) throw new Error("ffmpeg binary not found");
    const budget = transcodeBudgetMs(deadlineAt);
    if (budget === null) {
      logger.info("media.transcode_skipped", { reason: "budget" });
      return null;
    }
    const out = path.join(outDir, "playback.mp4");
    await new Promise<void>((resolve, reject) => {
      execFile(
        ffmpegPath as string,
        transcodeArgs(videoPath, out),
        { timeout: budget, killSignal: "SIGKILL", maxBuffer: 16 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          if (!err) return resolve();
          const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string };
          if (e.killed || e.signal === "SIGKILL") return reject(new Error(`timeout after ${budget} ms`));
          reject(new Error(`${e.message.slice(0, 500)} ${String(stderr).slice(0, 500)}`));
        },
      );
    });
    return out;
  } catch (err) {
    logger.warn("media.transcode_failed", { reason: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

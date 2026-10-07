/** Frames per second to sample so that a video of `durationSeconds` yields at most `maxFrames`, never more than 1 fps. */
export function pickFps(durationSeconds: number, maxFrames: number): number {
  if (!(durationSeconds > 0)) throw new Error(`invalid duration: ${durationSeconds}`);
  return Math.min(1, maxFrames / durationSeconds);
}

/** Timestamp (seconds) of each extracted frame, given ffmpeg's `fps=` filter output order. */
export function frameTimestamps(count: number, fps: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round((i / fps) * 1000) / 1000);
  return out;
}

/**
 * Timeout to hand a subprocess or SDK call: the step's default, shortened to whatever
 * is left before the pipeline deadline, floored at 1 s so a call always gets a chance
 * to fail with a real error rather than a zero timeout.
 */
export function timeoutFor(defaultMs: number, deadlineAt: number | undefined, now: number = Date.now()): number {
  if (deadlineAt === undefined) return defaultMs;
  return Math.max(1000, Math.min(defaultMs, deadlineAt - now));
}

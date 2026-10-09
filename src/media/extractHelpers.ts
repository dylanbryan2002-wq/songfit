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

/**
 * Untrusted input: local file (or pipe) only, so a playlist disguised as a video cannot make
 * ffmpeg/ffprobe fetch URLs. Goes BEFORE `-i` / the input path.
 */
export const INPUT_PROTOCOLS = ["-protocol_whitelist", "file,pipe"] as const;

/** Child processes get PATH and nothing else: no service keys in an ffmpeg/ffprobe environment. */
export function childEnv(): NodeJS.ProcessEnv {
  // Cast: Next's typings mark NODE_ENV as required on ProcessEnv; the child must not get it either.
  return { PATH: process.env.PATH ?? "" } as unknown as NodeJS.ProcessEnv;
}

export function probeDurationArgs(input: string): string[] {
  return ["-v", "error", ...INPUT_PROTOCOLS, "-show_entries", "format=duration", "-of", "json", input];
}

export function audioStreamsArgs(input: string): string[] {
  return ["-v", "error", ...INPUT_PROTOCOLS, "-select_streams", "a", "-show_streams", "-of", "json", input];
}

export function framesArgs(input: string, fps: number, maxFrames: number, frameWidth: number, framePattern: string): string[] {
  return [
    "-hide_banner", "-loglevel", "error",
    ...INPUT_PROTOCOLS,
    "-i", input,
    "-frames:v", String(maxFrames),
    "-vf", `fps=${fps},scale=${frameWidth}:-2`,
    "-q:v", "4",
    framePattern,
  ];
}

export function audioArgs(input: string, output: string): string[] {
  return [
    "-hide_banner", "-loglevel", "error",
    ...INPUT_PROTOCOLS,
    "-i", input,
    "-vn", "-ac", "1", "-ar", "16000", "-f", "wav",
    output,
  ];
}

/** Creator-facing reason for a failed run, derived from the stored pipeline message. Anything else is "ours". */
export type FailureReason = "too_long" | "bad_file";

export function failureReason(message: string | null | undefined): FailureReason | null {
  if (!message) return null;
  if (message.startsWith("video too long")) return "too_long";
  if (message.startsWith("could not read video duration") || message.startsWith("ffprobe duration failed")) return "bad_file";
  return null;
}

export const FAILURE_COPY: Record<FailureReason, string> = {
  too_long: "That video is over 3 minutes. Trim it and try again.",
  bad_file: "That file doesn't play as a video. Try an MP4 or MOV.",
};

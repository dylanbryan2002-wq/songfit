import { fileExt } from "./fileExt";
import { LIMITS } from "@/src/shared/config";

/** Shared by UploadForm and the landing page so both reject the same files with the same words. */
export const TOO_LONG = "Keep it under 3 minutes for now.";

/** The synchronous checks (type, empty, size). null when the file may proceed. */
export function checkVideoFile(file: { name: string; type: string; size: number }): string | null {
  if (!fileExt(file)) return "That file type isn't supported. Use MP4, MOV or WebM.";
  if (file.size === 0) return "That file is empty. Pick another video.";
  if (file.size > LIMITS.maxUploadBytes) return "That video is over 50 MB. Keep it under a minute, or export a smaller file.";
  return null;
}

export function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "length unknown";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

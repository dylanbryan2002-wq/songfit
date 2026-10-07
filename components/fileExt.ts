export type VideoExt = "mp4" | "mov" | "webm" | "m4v";

const BY_EXT: Record<string, VideoExt> = { mp4: "mp4", mov: "mov", webm: "webm", m4v: "m4v" };
const BY_MIME: Record<string, VideoExt> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
};

export function fileExt(file: { name: string; type: string }): VideoExt | null {
  const dot = file.name.lastIndexOf(".");
  if (dot > -1) {
    const ext = file.name.slice(dot + 1).toLowerCase();
    if (BY_EXT[ext]) return BY_EXT[ext];
  }
  return BY_MIME[file.type.toLowerCase()] ?? null;
}

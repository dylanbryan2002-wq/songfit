/* Ground-truth intake: clips.csv → ClipSpec[]; ffmpeg mute; ffprobe duration. See docs/review/18. */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const run = promisify(execFile);

export type ClipSpec = {
  id: string;
  file: string;
  link: string;
  niche: string;
  song: string;
  artist: string;
  start_seconds: number;
  views: number | null;
  typical_views: number | null;
  notes: string;
  split?: "tune" | "test"; // held-out "test" rows are the headline numbers; written by split.ts, blank until then
};

// song, artist and start_seconds may be empty: the clip then runs for the brief comparison only (no hit verdict).
const REQUIRED = ["file"] as const;

/** Slug of the file name without its extension: "IMG_0042 Final (1).MOV" → "img-0042-final-1". */
export function clipId(file: string): string {
  return path.parse(file).name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Splits CSV text into rows of fields. Quoted fields may hold commas, newlines and doubled quotes. */
export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

function optionalNumber(s: string, label: string, rowNo: number): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`clips.csv row ${rowNo}: ${label} must be a number, got "${s}"`);
  return n;
}

export function parseClipsCsv(text: string): ClipSpec[] {
  const [header, ...lines] = splitCsv(text.replace(/^﻿/, ""));
  if (!header) throw new Error("clips.csv is empty; the header row is required");
  const col = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  for (const name of REQUIRED) if (!col.has(name)) throw new Error(`clips.csv header is missing the "${name}" column`);

  const seen = new Set<string>();
  return lines.map((fields, i) => {
    const rowNo = i + 2;
    const get = (name: string) => (col.has(name) ? (fields[col.get(name)!] ?? "").trim() : "");
    for (const name of REQUIRED) if (get(name) === "") throw new Error(`clips.csv row ${rowNo}: ${name} is empty`);
    const start = get("start_seconds") === "" ? 0 : Number(get("start_seconds"));
    if (!Number.isFinite(start) || start < 0) {
      throw new Error(`clips.csv row ${rowNo}: start_seconds must be a number >= 0, got "${get("start_seconds")}"`);
    }
    const file = get("file");
    if (seen.has(file)) throw new Error(`clips.csv row ${rowNo}: duplicate file "${file}"`);
    seen.add(file);
    const split = get("split");
    if (split !== "" && split !== "tune" && split !== "test") throw new Error(`clips.csv row ${rowNo}: split must be tune or test, got "${split}"`);
    return {
      id: clipId(file), file, link: get("link"), niche: get("niche"),
      song: get("song"), artist: get("artist"), start_seconds: start,
      views: optionalNumber(get("views"), "views", rowNo),
      typical_views: optionalNumber(get("typical_views"), "typical_views", rowNo),
      notes: get("notes"),
      ...(split === "" ? {} : { split }),
    };
  });
}

function ffmpeg(): string {
  if (!ffmpegPath) throw new Error("ffmpeg binary not found (ffmpeg-static)");
  return ffmpegPath;
}

/** Writes a copy of the video with the audio track removed (video stream copied, not re-encoded). */
export async function muteVideo(input: string, output: string): Promise<void> {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await run(ffmpeg(), ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-an", "-c:v", "copy", output]);
}

export async function probeDuration(input: string): Promise<number> {
  const { stdout } = await run(ffprobeStatic.path, ["-v", "error", "-show_entries", "format=duration", "-of", "json", input]);
  const d = Number((JSON.parse(stdout) as { format?: { duration?: string } }).format?.duration);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`could not read duration of ${input}: ${stdout}`);
  return d;
}

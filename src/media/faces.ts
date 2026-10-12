// Faces (new engine v1, Dylan 2026-10-11): YuNet (MIT) finds the main face in each sampled frame and HSEmotion
// (enet_b0_8_va_mtl, Apache-2.0) reads its valence and arousal. Averaged over the frames that show a face, these become
// the faces source's mood and energy (weights in weights.ts). Runs on the server via onnxruntime-web (WASM, no
// microservice). Too few frames with a face (< 25%) = no reading, so a face-free video is not judged by faces.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import * as ort from "onnxruntime-web";
import { PipelineError } from "../shared/errors";

const run = promisify(execFile);
export const SIZE = 640; // YuNet input (letterboxed)
const CROP = 224; // HSEmotion input
const MIN_SCORE = 0.6;
const MIN_FACE_SHARE = 0.25;
const MAX_FRAMES = 20; // ~0.5 s per frame on a Mac: 20 frames spread across the video keeps faces near 10 s
const MODELS = path.join(process.cwd(), "src", "media", "models");

export type Box = { x: number; y: number; w: number; h: number; score: number };
export type FaceReading = { mood: number; energy: number; faceFrames: number; frames: number };
type Out = Record<string, { data: Float32Array | ArrayLike<number> }>;

/** YuNet 2023 output grids (strides 8/16/32) -> face boxes in 640x640 space, strongest first. */
export function decodeYunet(o: Out, threshold = MIN_SCORE): Box[] {
  const boxes: Box[] = [];
  for (const s of [8, 16, 32]) {
    const cols = SIZE / s, cls = o[`cls_${s}`]!.data, obj = o[`obj_${s}`]!.data, bb = o[`bbox_${s}`]!.data;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i]!)) * Math.min(1, Math.max(0, obj[i]!)));
      if (score < threshold) continue;
      const row = Math.floor(i / cols), col = i % cols;
      const cx = (col + bb[i * 4]!) * s, cy = (row + bb[i * 4 + 1]!) * s, w = Math.exp(bb[i * 4 + 2]!) * s, h = Math.exp(bb[i * 4 + 3]!) * s;
      boxes.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
    }
  }
  return boxes.sort((a, b) => b.score - a.score);
}

/** Crop a box from a 640x640 BGR frame, resize to 224x224 (nearest), RGB, ImageNet-normalised, NCHW. */
export function cropToTensor(bgr: Buffer, b: Box): Float32Array {
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const out = new Float32Array(3 * CROP * CROP);
  for (let y = 0; y < CROP; y++) for (let x = 0; x < CROP; x++) {
    const sx = Math.min(SIZE - 1, Math.max(0, Math.round(b.x + (x / CROP) * b.w)));
    const sy = Math.min(SIZE - 1, Math.max(0, Math.round(b.y + (y / CROP) * b.h)));
    const p = (sy * SIZE + sx) * 3;
    const rgb = [bgr[p + 2]!, bgr[p + 1]!, bgr[p]!];
    for (let c = 0; c < 3; c++) out[c * CROP * CROP + y * CROP + x] = (rgb[c]! / 255 - mean[c]!) / std[c]!;
  }
  return out;
}

export function summarizeFaces(frames: ({ valence: number; arousal: number } | null)[]): FaceReading | null {
  const seen = frames.filter((f): f is { valence: number; arousal: number } => f !== null);
  if (!frames.length || seen.length / frames.length < MIN_FACE_SHARE) return null;
  const avg = (k: "valence" | "arousal") => seen.reduce((t, f) => t + f[k], 0) / seen.length;
  const unit = (v: number) => Math.round(Math.min(1, Math.max(0, (v + 1) / 2)) * 100) / 100;
  return { mood: unit(avg("valence")), energy: unit(avg("arousal")), faceFrames: seen.length, frames: frames.length };
}

let sessions: Promise<[ort.InferenceSession, ort.InferenceSession]> | null = null;
function loadSessions() {
  sessions ??= Promise.all([
    fs.readFile(path.join(MODELS, "face_detection_yunet_2023mar.onnx")).then((b) => ort.InferenceSession.create(b)),
    fs.readFile(path.join(MODELS, "enet_b0_8_va_mtl.onnx")).then((b) => ort.InferenceSession.create(b)),
  ]);
  return sessions;
}

/** Frames per second to sample: 1 per second, or fewer so at most MAX_FRAMES cover the whole video. */
export function sampleFps(durationSeconds: number) {
  return durationSeconds > MAX_FRAMES ? MAX_FRAMES / durationSeconds : 1;
}

/** One ffmpeg pass: up to 20 frames spread across the video, letterboxed to 640x640 BGR; then faces per frame. */
export async function readFaces(file: string, durationSeconds: number): Promise<FaceReading | null> {
  if (!ffmpegPath) throw new PipelineError("analyze", "ffmpeg binary not found");
  const vf = `fps=${sampleFps(durationSeconds).toFixed(4)},scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease,pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2`;
  const { stdout } = await run(ffmpegPath as unknown as string, ["-v", "error", "-i", file, "-vf", vf, "-frames:v", String(MAX_FRAMES), "-pix_fmt", "bgr24", "-f", "rawvideo", "-"], { encoding: "buffer", maxBuffer: SIZE * SIZE * 3 * (MAX_FRAMES + 1) });
  const [det, emo] = await loadSessions();
  const frameBytes = SIZE * SIZE * 3, readings: ({ valence: number; arousal: number } | null)[] = [];
  for (let off = 0; off + frameBytes <= stdout.length; off += frameBytes) {
    const bgr = stdout.subarray(off, off + frameBytes);
    const input = new Float32Array(3 * SIZE * SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) input[c * SIZE * SIZE + i] = bgr[i * 3 + c]!;
    const box = decodeYunet(await det.run({ input: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) }) as unknown as Out)[0];
    if (!box) { readings.push(null); continue; }
    const out = (await emo.run({ input: new ort.Tensor("float32", cropToTensor(bgr, box), [1, 3, CROP, CROP]) })).output!.data as Float32Array;
    readings.push({ valence: out[8]!, arousal: out[9]! });
  }
  return summarizeFaces(readings);
}

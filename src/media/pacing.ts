// Measured pacing of the upload (new engine, Dylan approved 2026-10-11; research in docs/RESEARCH.md):
// cuts per minute, median shot length and peak motion from ffmpeg's frame-change score, combined into energy 0..1.
// Threshold 0.2 found 85% of hand-marked cuts on 10 creator videos; known blind spot: punch-in jump cuts (accepted).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { PipelineError } from "../shared/errors";

const run = promisify(execFile);
export const CUT_THRESHOLD = 0.2;

export type Pacing = { cutsPerMinute: number; medianShot: number; motionPeak: number; energy: number };

export function parseSceneScores(out: string) {
  const res: { t: number; score: number }[] = [];
  let t: number | null = null;
  for (const line of out.split("\n")) {
    const m = line.match(/pts_time:([\d.]+)/);
    if (m) t = Number(m[1]);
    const s = line.match(/lavfi\.scene_score=([\d.]+)/);
    if (s && t !== null) res.push({ t, score: Number(s[1]) });
  }
  return res;
}

/** Frames whose change score passes the threshold, keeping at most one cut per 0.3 s. */
export function cutsFromScores(scores: { t: number; score: number }[], threshold: number) {
  const cuts: number[] = [];
  for (const s of scores) if (s.score >= threshold && (!cuts.length || s.t - cuts[cuts.length - 1]! >= 0.3)) cuts.push(s.t);
  return cuts;
}

export function shotStats(cuts: number[], start: number, end: number) {
  const inside = cuts.filter((c) => c > start && c < end).sort((a, b) => a - b);
  const edges = [start, ...inside, end];
  const shots = edges.slice(1).map((e, i) => e - edges[i]!).sort((a, b) => a - b);
  const mid = Math.floor(shots.length / 2);
  const medianShot = shots.length % 2 ? shots[mid]! : (shots[mid - 1]! + shots[mid]!) / 2;
  return { cutsPerMinute: Math.round((inside.length / ((end - start) / 60)) * 10) / 10, medianShot: Math.round(medianShot * 10) / 10 };
}

/** Energy 0..1 from cut speed and motion. Scales from the 10 checked videos (cuts 9–75/min, motion peak 0.01–0.19). */
export function videoEnergy(m: { cutsPerMinute: number; motionPeak: number }) {
  const cuts = Math.min(1, m.cutsPerMinute / 60), motion = Math.min(1, m.motionPeak / 0.15);
  return Math.round(((cuts + motion) / 2) * 100) / 100;
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0; };

/** Runs ffmpeg once over the upload (30 fps, 320 px wide: same sampling as the calibration). */
export async function measurePacing(file: string): Promise<Pacing> {
  if (!ffmpegPath) throw new PipelineError("analyze", "ffmpeg binary not found");
  const vf = "fps=30,scale=320:-2,select='gte(scene,0)',metadata=print:file=-";
  const { stdout } = await run(ffmpegPath as unknown as string, ["-v", "error", "-i", file, "-vf", vf, "-an", "-f", "null", "-"], { maxBuffer: 1 << 28 });
  const scores = parseSceneScores(stdout);
  if (!scores.length) throw new PipelineError("analyze", "pacing: no frames measured");
  const st = shotStats(cutsFromScores(scores, CUT_THRESHOLD), 0, scores[scores.length - 1]!.t);
  const motionPeak = Math.round(pct(scores.map((x) => x.score), 0.95) * 1000) / 1000;
  return { ...st, motionPeak, energy: videoEnergy({ cutsPerMinute: st.cutsPerMinute, motionPeak }) };
}

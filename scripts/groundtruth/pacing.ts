/* Measured video pacing (Dylan took the recommended measures, 2026-10-11; design/song-labels.md):
   cuts per minute + median shot length, motion level (median and peak frame change), loudness of the video's own sound,
   and a per-second energy curve. All feed the video's ENERGY in the shared dictionary.
     node --import tsx scripts/groundtruth/pacing.ts [--home ~/Songfit-groundtruth]
   Checks the cut detector against hand-marked cuts (design/pacing-check/hand/*.json) at a few thresholds. */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);

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

export function matchCuts(hand: number[], detected: number[], tol: number) {
  const used = new Set<number>();
  let hit = 0;
  for (const h of hand) {
    const i = detected.findIndex((d, j) => !used.has(j) && Math.abs(d - h) <= tol);
    if (i >= 0) { used.add(i); hit++; }
  }
  return { hit, missed: hand.length - hit, falseCuts: detected.length - used.size };
}

export function shotStats(cuts: number[], start: number, end: number) {
  const inside = cuts.filter((c) => c > start && c < end).sort((a, b) => a - b);
  const edges = [start, ...inside, end];
  const shots = edges.slice(1).map((e, i) => e - edges[i]!).sort((a, b) => a - b);
  const mid = Math.floor(shots.length / 2);
  const medianShot = shots.length % 2 ? shots[mid]! : (shots[mid - 1]! + shots[mid]!) / 2;
  return { cutsPerMinute: Math.round((inside.length / ((end - start) / 60)) * 10) / 10, medianShot: Math.round(medianShot * 10) / 10 };
}

/** Overall video energy 0..1 from measured pacing. Scales from the 10 checked videos (cuts 9–75 per minute, motion peak
    0.01–0.19). Loudness is left out of the overall number: Instagram levels every Reel to about -14 LUFS. */
export function videoEnergy(m: { cutsPerMinute: number; motionPeak: number }) {
  const cuts = Math.min(1, m.cutsPerMinute / 60), motion = Math.min(1, m.motionPeak / 0.15);
  return Math.round(((cuts + motion) / 2) * 100) / 100;
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : 0; };

/** Scene-change score per frame, measured on the Reel area only (the screen recording's app UI is cropped away). */
async function sceneScores(file: string) {
  const vf = "fps=30,crop=iw*0.9:ih*0.62:iw*0.05:ih*0.12,scale=320:-1,select='gte(scene,0)',metadata=print:file=-";
  const { stdout } = await run(ffmpegPath as unknown as string, ["-v", "error", "-i", file, "-vf", vf, "-an", "-f", "null", "-"], { maxBuffer: 1 << 28 });
  return parseSceneScores(stdout);
}

/** Momentary loudness (LUFS) every 0.1 s from ffmpeg's EBU R128 meter; empty when there is no audio. */
async function loudness(file: string) {
  const r = await run(ffmpegPath as unknown as string, ["-nostats", "-i", file, "-vn", "-af", "ebur128=framelog=verbose", "-f", "null", "-"], { maxBuffer: 1 << 28 }).catch((e) => e);
  const text = String(r.stderr ?? "");
  const pts: { t: number; m: number }[] = [];
  for (const m of text.matchAll(/t:\s*([\d.]+)\s+.*?M:\s*(-?[\d.]+)/g)) pts.push({ t: Number(m[1]), m: Number(m[2]) });
  const integrated = text.match(/I:\s*(-?[\d.]+) LUFS/g)?.pop()?.match(/-?[\d.]+/)?.[0];
  return { pts, integrated: integrated ? Number(integrated) : null };
}

/** --all: measure every test video that has a known song (both batches) -> design/pacing-all.json. */
async function measureAll(home: string) {
  const { parseCsv } = await import("./csv");
  const out: Record<string, { cutsPerMinute: number; medianShot: number; motionPeak: number; energy: number }> = {};
  for (const batch of ["2026-10-08-founders-mixed", "2026-10-09-founders-mixed"]) {
    const [head, ...rows] = parseCsv(await fs.readFile(path.join(home, "batches", batch, "clips.csv"), "utf8"));
    for (const r of rows) {
      const file = r[head!.indexOf("file")]!;
      if (!r[head!.indexOf("song")]) continue;
      const scores = await sceneScores(path.join(home, "batches", batch, "videos", file)).catch(() => []);
      if (!scores.length) continue;
      const end = scores[scores.length - 1]!.t;
      const st = shotStats(cutsFromScores(scores, 0.2), 0, end);
      const motionPeak = pct(scores.map((x) => x.score), 0.95);
      out[`${batch}/${file}`] = { ...st, motionPeak: Math.round(motionPeak * 1000) / 1000, energy: videoEnergy({ cutsPerMinute: st.cutsPerMinute, motionPeak }) };
      console.log(file, out[`${batch}/${file}`]!.energy);
    }
  }
  await fs.writeFile(path.join(home, "design", "pacing-all.json"), JSON.stringify(out, null, 1));
}

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" }, all: { type: "boolean" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  if (args.all) return measureAll(home);
  const hdir = path.join(home, "design", "pacing-check", "hand");
  const vdir = path.join(home, "batches", "2026-10-08-founders-mixed", "videos");
  const thresholds = [0.2, 0.3, 0.4, 0.5];
  const totals = Object.fromEntries(thresholds.map((t) => [t, { hit: 0, missed: 0, falseCuts: 0 }]));
  const rows: string[] = [], measures: Record<string, unknown> = {};
  for (const f of (await fs.readdir(hdir)).filter((f) => f.endsWith(".json"))) {
    const hand = JSON.parse(await fs.readFile(path.join(hdir, f), "utf8")) as { reel_start: number; reel_end: number; cuts: number[] };
    const video = path.join(vdir, f.replace(/\.json$/, ""));
    const all = await sceneScores(video);
    const scores = all.filter((s) => s.t >= hand.reel_start && s.t <= hand.reel_end);
    const per: string[] = [];
    for (const t of thresholds) {
      const m = matchCuts(hand.cuts, cutsFromScores(scores, t), 0.15);
      for (const k of ["hit", "missed", "falseCuts"] as const) totals[t]![k] += m[k];
      per.push(`${t}: ${m.hit}/${hand.cuts.length} hit, ${m.falseCuts} false`);
    }
    const loud = await loudness(video);
    const motion = scores.map((s) => s.score);
    measures[f] = {
      hand: shotStats(hand.cuts, hand.reel_start, hand.reel_end),
      motion_median: Math.round(pct(motion, 0.5) * 1000) / 1000, motion_peak: Math.round(pct(motion, 0.95) * 1000) / 1000,
      loudness_lufs: loud.integrated,
      energy: videoEnergy({ cutsPerMinute: shotStats(cutsFromScores(scores, 0.2), hand.reel_start, hand.reel_end).cutsPerMinute, motionPeak: pct(motion, 0.95) }),
    };
    rows.push(`${f.replace(/\.mp4\.json$/, "")} | hand cuts ${hand.cuts.length} | ${per.join(" | ")}`);
  }
  rows.push("\nTotals by threshold:");
  for (const t of thresholds) rows.push(`  ${t}: hit ${totals[t]!.hit}, missed ${totals[t]!.missed}, false ${totals[t]!.falseCuts}`);
  await fs.writeFile(path.join(home, "design", "pacing-check", "results-v1.txt"), rows.join("\n") + "\n");
  await fs.writeFile(path.join(home, "design", "pacing-check", "measures-v1.json"), JSON.stringify(measures, null, 1));
  console.log(rows.join("\n"));
  console.log(JSON.stringify(measures, null, 1));
}

if (process.argv[1]?.endsWith("pacing.ts")) main().catch((e) => { console.error(e); process.exit(1); });

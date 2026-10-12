/* Offline check of the app's closeness matching (src/engine/match/closest.ts) on the test video profiles (Dylan, 2026-10-11).
     node --conditions=react-server --import tsx scripts/groundtruth/match-eval.ts [--home ~/Songfit-groundtruth]
   --exposure simulates the repeat limit, counting earlier videos' top 3s as recent shows. Reports: distinct songs across all top 3s, most repeats of one song, average raw feelings closeness of the top 3s,
   and for videos with a known real song: its position and whether the top 3 share its feeling. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseCsv } from "./csv";
import { DICTIONARY } from "../../src/engine/catalog/dictionary";
import { rankSongs, feelingsCloseness, applyExposure } from "../../src/engine/match/closest";
import { combineEnergyMood } from "../../src/analysis/videoProfile";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" }, exposure: { type: "boolean" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const pacing = JSON.parse(await fs.readFile(path.join(home, "design", "pacing-all.json"), "utf8")) as Record<string, { energy: number }>;
  const real = new Map<string, { title: string; artist: string }>();
  for (const batch of ["2026-10-08-founders-mixed", "2026-10-09-founders-mixed"]) {
    const [head, ...rows] = parseCsv(await fs.readFile(path.join(home, "batches", batch, "clips.csv"), "utf8"));
    for (const r of rows) if (r[head!.indexOf("song")]) real.set(`${batch}/${r[head!.indexOf("file")]}`, { title: r[head!.indexOf("song")]!, artist: r[head!.indexOf("artist")]! });
  }
  const pdir = path.join(home, "design", "video-profiles");
  const count = new Map<string, number>(); let closeSum = 0, slots = 0, hit3 = 0, withFeel = 0;
  const pos: number[] = [];
  for (const f of (await fs.readdir(pdir)).filter((f) => f.endsWith(".json"))) {
    const reading = JSON.parse(await fs.readFile(path.join(pdir, f), "utf8"));
    const key = f.replace(/\.json$/, "").replace("__", "/");
    const pace = pacing[key] ? { cutsPerMinute: 0, medianShot: 0, motionPeak: 0, energy: pacing[key]!.energy } : null;
    const profile = { reading, pacing: pace, ...combineEnergyMood(reading, pace?.energy ?? null) };
    const shown = new Map([...count.entries()].map(([t, n]) => [DICTIONARY.find((d) => d.title === t)?.id ?? t, n]));
    const ranked = args.exposure ? applyExposure(rankSongs(profile as never, DICTIONARY), shown) : rankSongs(profile as never, DICTIONARY);
    for (const x of ranked.slice(0, 3)) { count.set(x.song.title, (count.get(x.song.title) ?? 0) + 1); closeSum += feelingsCloseness(reading.feelings, x.song.feelings); slots++; }
    const rs = real.get(key);
    const song = rs && DICTIONARY.find((s) => norm(s.title) === norm(rs.title) && norm(s.artist).includes(norm(rs.artist).split(" ")[0]!));
    if (song) {
      pos.push(ranked.findIndex((x) => x.song === song) + 1);
      const feel = Object.entries(song.feelings).filter(([, c]) => c !== "flagged").map(([k]) => k);
      if (feel.length) { withFeel++; if (ranked.slice(0, 3).some((x) => Object.entries(x.song.feelings).some(([k, c]) => c !== "flagged" && feel.includes(k)))) hit3++; }
    }
  }
  pos.sort((a, b) => a - b);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`videos ${slots / 3}; distinct songs in top 3s: ${count.size} of ${slots}; most repeats: ${top[0]![1]} (${top[0]![0]})`);
  console.log(`average raw feelings closeness of top 3s: ${(closeSum / slots).toFixed(2)}`);
  console.log(`real songs in dictionary: ${pos.length}; median position ${pos[Math.floor(pos.length / 2)]}; top 50: ${pos.filter((p) => p <= 50).length}`);
  console.log(`top 3 share a feeling with the real song: ${hit3} of ${withFeel}`);
  console.log(`top repeats: ${top.slice(0, 6).map(([t, n]) => `${t} ${n}`).join(", ")}`);
}

if (process.argv[1]?.endsWith("match-eval.ts")) main().catch((e) => { console.error(e); process.exit(1); });

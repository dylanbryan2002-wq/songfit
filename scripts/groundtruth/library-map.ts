/* The category map of the song library: every tagged song placed by job x energy x era x familiarity.
     pnpm local scripts/groundtruth/library-map.ts [--home ~/Songfit-groundtruth]
   Writes catalog/library-map.json ({ "<job>|<energy>|<era>|<familiarity>": [deezer ids] }) and library-map.csv, and prints
   the counts as plain tables. A song that can do several jobs sits in several places. Untagged or unknown songs are left out. */
import "./assert-tree";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { LibrarySong } from "./library";

export const energyBand = (e: number) => (e <= 2 ? "low" : e === 3 ? "mid" : "high");
export function eraBand(date: string | null): string {
  const y = Number((date ?? "").slice(0, 4));
  if (!y) return "unknown";
  return y < 1990 ? "pre-90s" : y < 2000 ? "90s" : y < 2010 ? "2000s" : y < 2020 ? "2010s" : "2020s";
}
export const cellKey = (job: string, energy: number, era: string, fam: string) => `${job}|${energyBand(energy)}|${era}|${fam}`;

export function buildMap(lib: LibrarySong[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const s of lib) {
    const t = s.tags;
    if (!t || t.confidence === "low" || t.familiarity === "unknown") continue;
    const era = eraBand(s.first_release ?? s.release_date);
    for (const job of t.jobs) (map[cellKey(job, t.energy, era, t.familiarity)] ??= []).push(s.deezer_id);
  }
  return map;
}

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const lib = JSON.parse(await fs.readFile(path.join(home, "catalog", "library.json"), "utf8")) as LibrarySong[];
  const map = buildMap(lib);
  await fs.writeFile(path.join(home, "catalog", "library-map.json"), JSON.stringify(map, null, 1));
  await fs.writeFile(path.join(home, "catalog", "library-map.csv"), ["job,energy,era,familiarity,songs",
    ...Object.entries(map).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `${k.split("|").join(",")},${v.length}`)].join("\n"));
  const placed = new Set(Object.values(map).flat()).size;
  console.log(`${lib.length} songs, ${placed} placed on the map (low-confidence or unknown songs left out)\n`);
  const jobs = ["quiet_bed", "drive_energy", "emotional_lift", "comic_cue", "familiar_anthem"];
  const sum = (pred: (k: string[]) => boolean) => new Set(Object.entries(map).filter(([k]) => pred(k.split("|"))).flatMap(([, v]) => v)).size;
  console.log("job               low   mid  high");
  for (const j of jobs) console.log(`${j.padEnd(16)} ${["low", "mid", "high"].map((e) => String(sum((k) => k[0] === j && k[1] === e)).padStart(5)).join(" ")}`);
  console.log("\njob               pre-90s   90s 2000s 2010s 2020s");
  for (const j of jobs) console.log(`${j.padEnd(16)} ${["pre-90s", "90s", "2000s", "2010s", "2020s"].map((e) => String(sum((k) => k[0] === j && k[2] === e)).padStart(5)).join(" ")}`);
  console.log("\njob               household known niche");
  for (const j of jobs) console.log(`${j.padEnd(16)} ${["household", "known", "niche"].map((f) => String(sum((k) => k[0] === j && k[3] === f)).padStart(5)).join(" ")}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

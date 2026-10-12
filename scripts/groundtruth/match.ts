/* Closeness matching (Dylan, 2026-10-11): songs are pre-mapped into the shared dictionary, the video is read into the same
   dictionary (design/video-profile-prompt-v1.md), and the closest songs are the picks. Closeness uses the approved weights:
   content-type fit 25, mood + delivery fit 25, creator evidence 15, lyrics 10, talking/vocals 10, familiarity 10, section 5.
     node --import tsx scripts/groundtruth/match.ts [--home ~/Songfit-groundtruth]
   Reports, per test video, where the creator's real song lands and whether the top picks share its feeling. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseCsv } from "./csv";
import { scoreSong, WEIGHTS, type RankSong } from "./rank-test";
import { combineEnergyMood } from "./video-profile";
import { FAMILIES } from "./merge-labels";

/** How much a song label counts in the feelings match (Dylan: low-confidence and flagged labels count less). */
const LABEL_WEIGHT: Record<string, number> = { high: 1, medium: 0.8, low: 0.6, flagged: 0.4 };

export function feelingsCloseness(want: Record<string, number>, songFamilies: Record<string, string>) {
  let dot = 0, a = 0, b = 0;
  for (const f of FAMILIES) {
    const x = want[f] ?? 0, y = songFamilies[f] ? LABEL_WEIGHT[songFamilies[f]!] ?? 0.6 : 0;
    dot += x * y; a += x * x; b += y * y;
  }
  return a && b ? dot / Math.sqrt(a * b) : 0;
}

export type Profile = {
  talking: string; words: { energy: number; mood: number } | null; colour: { energy: number; mood: number } | null;
  feelings: Record<string, number>; vocals: string; themes_fit: string[]; themes_avoid: string[];
  content_type: string; story_feeling: string | null;
};
type Song = RankSong & { energy?: number | null; valence?: number | null };
type Ctx = Parameters<typeof scoreSong>[2];

export function matchScore(p: Profile, editEnergy: number | null, s: Song, ctx: Ctx) {
  const talking = p.talking !== "none";
  const base = scoreSong({ type: p.content_type, story_feeling: p.story_feeling, format: talking ? "talking to camera" : "montage" }, s, ctx).signals;
  const { energy, mood } = combineEnergyMood({ talking, words: p.words, colour: p.colour, editEnergy });
  const parts = [Object.keys(s.families).length ? feelingsCloseness(p.feelings, s.families) : 0.5];
  if (energy !== null && s.energy !== null && s.energy !== undefined) parts.push(1 - Math.abs(energy - s.energy));
  if (mood !== null && s.valence !== null && s.valence !== undefined) parts.push(1 - Math.abs(mood - s.valence));
  const moodFit = parts.reduce((x, y) => x + y, 0) / parts.length;
  const theme = ctx.lyrics.get(s.deezer_id)?.theme?.main ?? null;
  const lyrics = theme && p.themes_fit.includes(theme) ? 1 : theme && p.themes_avoid.includes(theme) ? 0
    : theme === "none" && p.vocals === "instrumental preferred" ? 1 : 0.5;
  const vocals = p.vocals !== "instrumental preferred" ? 1 : s.vocals === "vocals" ? 0 : s.vocals === "instrumental" ? 1 : 0.5;
  const signals = { type: base.type, mood: moodFit, creator: base.creator, lyrics, talking: vocals, familiarity: base.familiarity, section: base.section };
  const total = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((t, k) => t + WEIGHTS[k] * signals[k], 0);
  return { signals, total };
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const solid = (s: Song) => Object.entries(s.families).filter(([, c]) => c !== "flagged").map(([f]) => f);

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const read = async (...p: string[]) => JSON.parse(await fs.readFile(path.join(home, ...p), "utf8"));
  const songs = (await read("catalog", "song-labels.json")) as Song[];
  const lib = (await read("catalog", "library.json")) as { deezer_id: string; rank: number | null }[];
  const ranked = lib.filter((x) => x.rank).sort((a, b) => a.rank! - b.rank!);
  const rankPct = new Map(ranked.map((x, i) => [x.deezer_id, i / ranked.length]));
  const lyrics = new Map<string, any>();
  for (const f of (await fs.readdir(path.join(home, "catalog", "lyrics-meaning"))).filter((f) => /^out-\d+\.json$/.test(f)))
    for (const r of await read("catalog", "lyrics-meaning", f)) lyrics.set(r.deezer_id, r);
  const ctx = { lyrics, sections: await read("catalog", "sections.json"), rankPct };
  const pacing = (await read("design", "pacing-all.json")) as Record<string, { energy: number }>;

  const out: string[] = [];
  const pos: number[] = []; let hit3 = 0, hit10 = 0, chance3 = 0, withFeel = 0;
  for (const batch of ["2026-10-08-founders-mixed", "2026-10-09-founders-mixed"]) {
    const [head, ...rows] = parseCsv(await fs.readFile(path.join(home, "batches", batch, "clips.csv"), "utf8"));
    for (const r of rows) {
      const file = r[head!.indexOf("file")]!, title = r[head!.indexOf("song")]!, artist = r[head!.indexOf("artist")]!;
      if (!title) continue;
      let p: Profile;
      try { p = await read("design", "video-profiles", `${batch}__${file}.json`); } catch { continue; }
      const real = songs.find((s) => norm(s.title) === norm(title) && norm(s.artist).includes(norm(artist).split(" ")[0]!));
      if (!real) continue;
      const scored = songs.map((s) => ({ s, ...matchScore(p, pacing[`${batch}/${file}`]?.energy ?? null, s, ctx) })).sort((a, b) => b.total - a.total);
      const i = scored.findIndex((x) => x.s === real);
      pos.push(i + 1);
      const realFeel = solid(real);
      let line = `${file} | ${p.content_type}${p.story_feeling ? ` (${p.story_feeling})` : ""} | ${real.title} — ${real.artist} | position ${i + 1}`;
      if (realFeel.length) {
        withFeel++;
        const shares = (x: { s: Song }) => solid(x.s).some((f) => realFeel.includes(f));
        if (scored.slice(0, 3).some(shares)) hit3++;
        if (scored.slice(0, 10).some(shares)) hit10++;
        const pShare = songs.filter((s) => solid(s).some((f) => realFeel.includes(f))).length / songs.length;
        chance3 += 1 - (1 - pShare) ** 3;
        line += ` | real feels ${realFeel.join("/")} | top 3: ${scored.slice(0, 3).map((x) => `${x.s.title} (${solid(x.s).join("/") || "?"})`).join("; ")}`;
      }
      out.push(line);
    }
  }
  pos.sort((a, b) => a - b);
  out.push(`\nvideos: ${pos.length}; real song top 10: ${pos.filter((x) => x <= 10).length}, top 50: ${pos.filter((x) => x <= 50).length}, top 500: ${pos.filter((x) => x <= 500).length}; median position ${pos[Math.floor(pos.length / 2)]} of ${songs.length}`);
  out.push(`same-feeling hit (top 3 shares a feeling with the real song): ${hit3} of ${withFeel} (chance would be about ${Math.round(chance3)}); top 10: ${hit10} of ${withFeel}`);
  await fs.writeFile(path.join(home, "design", "match-test-v1.txt"), out.join("\n") + "\n");
  console.log(out.join("\n"));
}

if (process.argv[1]?.endsWith("match.ts")) main().catch((e) => { console.error(e); process.exit(1); });

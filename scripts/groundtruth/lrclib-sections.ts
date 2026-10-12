/* Song sections from LRCLIB timed lyrics (Dylan, 2026-10-11). Only timings are kept; lyric text is used in memory
   to find repeats and never stored or shown. LRCLIB terms: free incl. commercial; lyrics may be third-party copyright.
     node --import tsx scripts/groundtruth/lrclib-sections.ts [--home ~/Songfit-groundtruth]
   Chorus = the most repeated run of 4 lines (fallback 3, then 2); its occurrences give chorus start times.
   Gaps of 8 s or more between lines = instrumental stretches (intro, build, drop, outro).
   Writes catalog/sections.json; resumable; ~3 requests per second. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const UA = "Songfit/0.1 (https://thissongfits.com)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export type Line = { t: number; text: string };
export function parseLrc(lrc: string): Line[] {
  const out: Line[] = [];
  for (const row of lrc.split("\n")) {
    const m = row.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (m) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: m[3]!.trim() });
  }
  return out;
}

/** Timings only: chorus starts, chorus length, instrumental gaps, first vocal. */
export function sections(lines: Line[], duration: number) {
  const sung = lines.filter((l) => norm(l.text));
  const keys = sung.map((l) => norm(l.text));
  let chorus: { starts: number[]; len: number } | null = null;
  for (const k of [4, 3, 2]) {
    const seen = new Map<string, number[]>();
    for (let i = 0; i + k <= keys.length; i++) {
      const g = keys.slice(i, i + k).join("|");
      const idx = seen.get(g) ?? [];
      if (!idx.length || i >= idx[idx.length - 1]! + k) idx.push(i); // no overlapping repeats
      seen.set(g, idx);
    }
    const best = [...seen.values()].filter((v) => v.length >= 2).sort((a, b) => b.length - a.length || a[0]! - b[0]!)[0];
    if (best) {
      // Move each start back while the line before every occurrence is the same, to reach the start of the chorus block.
      let starts = best;
      while (starts.every((i) => i > 0 && keys[i - 1] === keys[starts[0]! - 1])) starts = starts.map((i) => i - 1);
      const span = (sung[starts[0]! + k + (best[0]! - starts[0]!)]?.t ?? duration) - sung[starts[0]!]!.t;
      chorus = { starts: starts.map((i) => Math.round(sung[i]!.t * 10) / 10), len: Math.round(span * 10) / 10 };
      break;
    }
  }
  const gaps: [number, number][] = [];
  const times = [0, ...lines.map((l) => l.t), duration];
  for (let i = 1; i < times.length; i++) if (times[i]! - times[i - 1]! >= 8) gaps.push([Math.round(times[i - 1]! * 10) / 10, Math.round(times[i]! * 10) / 10]);
  return { first_vocal: sung[0] ? Math.round(sung[0].t * 10) / 10 : null, chorus_starts: chorus?.starts ?? [], chorus_len: chorus?.len ?? null, gaps, lines: sung.length };
}

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const lib = JSON.parse(await fs.readFile(path.join(home, "catalog", "library.json"), "utf8")) as { deezer_id: string; title: string; artist: string }[];
  const out = path.join(home, "catalog", "sections.json");
  let done: Record<string, unknown> = {};
  try { done = JSON.parse(await fs.readFile(out, "utf8")); } catch { /* first run */ }
  const todo = lib.filter((s) => !(s.deezer_id in done));
  console.log(`LRCLIB: ${todo.length} songs (~${Math.ceil(todo.length / 3 / 60)} min)`);
  for (const [i, s] of todo.entries()) {
    await sleep(330);
    const q = `track_name=${encodeURIComponent(s.title.replace(/\s*[([].*?[)\]]/g, ""))}&artist_name=${encodeURIComponent(s.artist)}`;
    const res = await fetch(`https://lrclib.net/api/search?${q}`, { headers: { "User-Agent": UA } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const pick = (Array.isArray(res) ? res : []).find((r: any) => r.instrumental || (r.syncedLyrics && r.duration > 60));
    if (!pick) done[s.deezer_id] = { found: false };
    else if (pick.instrumental) done[s.deezer_id] = { found: true, instrumental: true, duration: pick.duration };
    else done[s.deezer_id] = { found: true, instrumental: false, duration: pick.duration, ...sections(parseLrc(pick.syncedLyrics), pick.duration) };
    if ((i + 1) % 200 === 0) { await fs.writeFile(out, JSON.stringify(done)); console.log(`  ${i + 1}/${todo.length}`); }
  }
  await fs.writeFile(out, JSON.stringify(done));
  const v = Object.values(done) as { found: boolean; instrumental?: boolean; chorus_starts?: number[] }[];
  console.log(`found ${v.filter((x) => x.found).length} of ${v.length}; instrumental ${v.filter((x) => x.instrumental).length}; with chorus ${v.filter((x) => x.chorus_starts?.length).length}`);
}

if (process.argv[1]?.endsWith("lrclib-sections.ts")) main().catch((e) => { console.error(e); process.exit(1); });

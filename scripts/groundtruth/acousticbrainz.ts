/* Measured song data from AcousticBrainz (Dylan, 2026-10-10): every library song gets mood, danceability, voice and
   genre scores computed from the audio, or goes on the "unknown" list.
     node --import tsx scripts/groundtruth/acousticbrainz.ts [--home ~/Songfit-groundtruth]
   1. MusicBrainz: every recording id for the song's ISRC (1 request per second, resumable).
   2. AcousticBrainz high-level data, 25 recording ids per request; the first recording with data wins.
   Writes catalog/acousticbrainz.json (all songs) and catalog/acousticbrainz-unknown.csv (songs it does not know).
   AcousticBrainz data is CC0; it stopped taking new submissions in 2022, so newer songs are expected to be missing. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const UA = "Songfit/0.1 (https://thissongfits.com)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Lib = { deezer_id: string; title: string; artist: string; isrc: string | null; mbid: string | null; release_date: string | null; first_release: string | null };
export type AbSong = {
  deezer_id: string; title: string; artist: string; year: number | null; isrc: string | null;
  recordings: string[] | null; // null = not looked up yet
  ab_recording: string | null;
  ab: Record<string, { value: string; probability: number; all: Record<string, number> }> | null;
};

/** Keeps the classifier results (value, probability, every class score); drops version metadata. */
export function slimHighLevel(hl: Record<string, { value: string; probability: number; all: Record<string, number> }>) {
  return Object.fromEntries(Object.entries(hl).map(([k, v]) => [k, { value: v.value, probability: v.probability, all: v.all }]));
}

async function get(url: string, tries = 4): Promise<any | null> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { "User-Agent": UA } }).catch(() => null);
    if (r?.ok) return r.json().catch(() => null);
    if (r && r.status === 404) return null;
    await sleep(r?.status === 503 || r?.status === 429 ? 5000 * (i + 1) : 2000);
  }
  return null;
}

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const out = path.join(home, "catalog", "acousticbrainz.json");
  const lib = JSON.parse(await fs.readFile(path.join(home, "catalog", "library.json"), "utf8")) as Lib[];
  const prev = new Map<string, AbSong>();
  try { for (const s of JSON.parse(await fs.readFile(out, "utf8")) as AbSong[]) prev.set(s.deezer_id, s); } catch { /* first run */ }
  const songs: AbSong[] = lib.map((s) => prev.get(s.deezer_id) ?? {
    deezer_id: s.deezer_id, title: s.title, artist: s.artist, isrc: s.isrc,
    year: Number((s.first_release ?? s.release_date ?? "").slice(0, 4)) || null,
    recordings: s.isrc ? null : [], ab_recording: null, ab: null,
  });
  const save = () => fs.writeFile(out, JSON.stringify(songs));

  // 1. MusicBrainz recordings per ISRC.
  const todo = songs.filter((s) => s.recordings === null);
  console.log(`MusicBrainz: ${todo.length} ISRCs to look up (~${Math.ceil(todo.length * 1.1 / 60)} min)`);
  let n = 0;
  for (const s of todo) {
    await sleep(1100);
    const body = await get(`https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(s.isrc!)}?fmt=json`);
    s.recordings = (body?.recordings ?? []).map((r: { id: string }) => r.id);
    if (++n % 100 === 0) { await save(); console.log(`  ${n}/${todo.length}`); }
  }
  await save();

  // 2. AcousticBrainz high-level, 25 recording ids per request.
  const ids = [...new Set(songs.filter((s) => !s.ab).flatMap((s) => s.recordings ?? []))];
  console.log(`AcousticBrainz: ${ids.length} recording ids`);
  const found = new Map<string, AbSong["ab"]>();
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const body = await get(`https://acousticbrainz.org/api/v1/high-level?recording_ids=${batch.join(";")}&map_classes=true`);
    for (const id of batch) { const hl = body?.[id]?.["0"]?.highlevel; if (hl) found.set(id, slimHighLevel(hl)); }
    await sleep(1000);
  }
  for (const s of songs) {
    if (s.ab) continue;
    const id = (s.recordings ?? []).find((r) => found.has(r));
    if (id) { s.ab_recording = id; s.ab = found.get(id)!; }
  }
  await save();

  const unknown = songs.filter((s) => !s.ab);
  const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  await fs.writeFile(path.join(home, "catalog", "acousticbrainz-unknown.csv"), ["title,artist,year,reason",
    ...unknown.map((s) => [s.title, s.artist, s.year, !s.recordings?.length ? "not on MusicBrainz" : "on MusicBrainz, no AcousticBrainz data"].map(csv).join(","))].join("\n"));
  console.log(`known: ${songs.length - unknown.length} of ${songs.length}; unknown: ${unknown.length} ` +
    `(${unknown.filter((s) => !s.recordings?.length).length} not on MusicBrainz, ${unknown.filter((s) => s.recordings?.length).length} no AcousticBrainz data)`);
}

if (require.main === module) if (process.argv[1]?.endsWith("acousticbrainz.ts")) main().catch((e) => { console.error(e); process.exit(1); });

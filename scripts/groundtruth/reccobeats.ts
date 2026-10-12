/* Spotify-style audio features from ReccoBeats for the songs AcousticBrainz does not know (Dylan, 2026-10-10).
     node --import tsx scripts/groundtruth/reccobeats.ts [--home ~/Songfit-groundtruth] [--all]
   Reads catalog/acousticbrainz.json, looks up every song without AcousticBrainz data (--all: every song) by ISRC (40 per request,
   1 request per second), writes catalog/reccobeats.json (found songs) and catalog/reccobeats-unknown.csv (--all: reccobeats-all.*).
   Terms (reccobeats.com/docs/documentation/terms-of-service): "entirely free to use for both personal and commercial
   projects"; data "aggregated from Spotify data". Newer songs' values are likely ReccoBeats' own estimates. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { AbSong } from "./acousticbrainz";

const FIELDS = ["valence", "energy", "danceability", "tempo", "acousticness", "instrumentalness", "speechiness", "liveness", "loudness", "mode", "key"] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

async function get(url: string, tries = 4): Promise<any | null> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(url, { headers: { Accept: "application/json" } }).catch(() => null);
    if (r?.ok) return r.json().catch(() => null);
    await sleep(r?.status === 429 ? 10000 * (i + 1) : 2000);
  }
  return null;
}

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" }, all: { type: "boolean" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  // --all: every library song (includes songs added after the AcousticBrainz run).
  const songs = args.all
    ? (JSON.parse(await fs.readFile(path.join(home, "catalog", "library.json"), "utf8")) as (AbSong & { first_release: string | null; release_date: string | null })[])
        .map((s) => ({ ...s, year: Number((s.first_release ?? s.release_date ?? "").slice(0, 4)) || null }))
    : (JSON.parse(await fs.readFile(path.join(home, "catalog", "acousticbrainz.json"), "utf8")) as AbSong[]).filter((s) => !s.ab);
  const name = args.all ? "reccobeats-all" : "reccobeats";
  const isrcs = [...new Set(songs.flatMap((s) => (s.isrc ? [s.isrc.toUpperCase()] : [])))];
  console.log(`ReccoBeats: ${songs.length} songs, ${isrcs.length} ISRCs`);
  const found = new Map<string, Record<string, unknown>>();
  let failed = 0;
  for (let i = 0; i < isrcs.length; i += 40) {
    const body = await get(`https://api.reccobeats.com/v1/audio-features?ids=${isrcs.slice(i, i + 40).join(",")}`);
    if (!body) failed++;
    for (const row of body?.content ?? []) {
      const k = String(row.isrc ?? "").toUpperCase();
      if (k && !found.has(k)) found.set(k, { spotify: row.href, ...Object.fromEntries(FIELDS.map((f) => [f, row[f]])) });
    }
    if ((i / 40) % 10 === 0) console.log(`  ${Math.min(i + 40, isrcs.length)}/${isrcs.length}, found ${found.size}`);
    await sleep(1000);
  }
  const hit = songs.filter((s) => s.isrc && found.has(s.isrc.toUpperCase()));
  const miss = songs.filter((s) => !(s.isrc && found.has(s.isrc.toUpperCase())));
  await fs.writeFile(path.join(home, "catalog", `${name}.json`),
    JSON.stringify(hit.map((s) => ({ deezer_id: s.deezer_id, title: s.title, artist: s.artist, year: s.year, isrc: s.isrc, ...found.get(s.isrc!.toUpperCase()) }))));
  await fs.writeFile(path.join(home, "catalog", `${name}-unknown.csv`),
    ["title,artist,year,isrc", ...miss.map((s) => [s.title, s.artist, s.year, s.isrc].map(csv).join(","))].join("\n") + "\n");
  console.log(`found: ${hit.length} of ${songs.length}; still unknown: ${miss.length}; failed requests: ${failed}`);
}

if (process.argv[1]?.endsWith("reccobeats.ts")) main().catch((e) => { console.error(e); process.exit(1); });

/* Listener mood tags from Last.fm for the songs neither AcousticBrainz nor ReccoBeats know (Dylan, 2026-10-10).
     pnpm -s local scripts/groundtruth/lastfm.ts [--home ~/Songfit-groundtruth]   (needs LASTFM_API_KEY)
   Reads catalog/reccobeats-unknown.csv, calls track.getTopTags by artist + title (4 requests per second),
   writes catalog/lastfm.json (top 15 tags per song, with Last.fm's 0–100 weight) and catalog/lastfm-unknown.csv.
   Terms (last.fm/api/tos): non-commercial use only, credit and link Last.fm, store at most 100 MB. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseCsv } from "./csv";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

async function main() {
  const key = process.env.LASTFM_API_KEY;
  if (!key) throw new Error("LASTFM_API_KEY is not set");
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const [, ...rows] = parseCsv(await fs.readFile(path.join(home, "catalog", "reccobeats-unknown.csv"), "utf8"));
  console.log(`Last.fm: ${rows.length} songs (~${Math.ceil(rows.length / 4 / 60)} min)`);
  const hit: unknown[] = [], miss: string[][] = [];
  let failed = 0;
  for (const [i, [title = "", artist = "", year = "", isrc = ""]] of rows.entries()) {
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.gettoptags&autocorrect=1&format=json&api_key=${key}`
      + `&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}`;
    const body = await fetch(url, { headers: { "User-Agent": "Songfit/0.1 (https://thissongfits.com)" } })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!body) failed++;
    const tags = ((body?.toptags?.tag ?? []) as { name: string; count: number }[])
      .slice(0, 15).map((t) => ({ tag: t.name.toLowerCase(), weight: t.count }));
    if (tags.length) hit.push({ title, artist, year, isrc, tags });
    else miss.push([title, artist, year, isrc]);
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${rows.length}, tagged ${hit.length}`);
    await sleep(250);
  }
  await fs.writeFile(path.join(home, "catalog", "lastfm.json"), JSON.stringify(hit));
  await fs.writeFile(path.join(home, "catalog", "lastfm-unknown.csv"),
    ["title,artist,year,isrc", ...miss.map((r) => r.map(csv).join(","))].join("\n") + "\n");
  console.log(`tagged: ${hit.length} of ${rows.length}; no tags: ${miss.length}; failed requests: ${failed}`);
}

if (process.argv[1]?.endsWith("lastfm.ts")) main().catch((e) => { console.error(e); process.exit(1); });

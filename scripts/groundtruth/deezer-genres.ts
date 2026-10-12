/* Deezer genre for every library song (Dylan, 2026-10-10): track -> album id, album -> genres.
     node --import tsx scripts/groundtruth/deezer-genres.ts [--home ~/Songfit-groundtruth]
   Reads catalog/library.json, writes catalog/deezer-genres.json ({ deezer_id: string[] }); resumable.
   Throttled to ~8 requests per second (Deezer allows ~50 per 5 s per IP). */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string, tries = 4): Promise<any | null> {
  for (let i = 0; i < tries; i++) {
    await sleep(125);
    const body = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (body && !body.error) return body;
    if (body?.error?.code === 800) return null; // no data
    await sleep(2000 * (i + 1)); // quota (code 4) or network
  }
  return null;
}

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const lib = JSON.parse(await fs.readFile(path.join(home, "catalog", "library.json"), "utf8")) as { deezer_id: string }[];
  const out = path.join(home, "catalog", "deezer-genres.json");
  let genres: Record<string, string[]> = {};
  try { genres = JSON.parse(await fs.readFile(out, "utf8")); } catch { /* first run */ }
  const albums = new Map<number, string[]>();
  const todo = lib.filter((s) => !(s.deezer_id in genres));
  console.log(`Deezer genres: ${todo.length} songs`);
  for (const [i, s] of todo.entries()) {
    const track = await get(`https://api.deezer.com/track/${s.deezer_id}`);
    const albumId: number | undefined = track?.album?.id;
    if (albumId && !albums.has(albumId)) {
      const album = await get(`https://api.deezer.com/album/${albumId}`);
      albums.set(albumId, (album?.genres?.data ?? []).map((g: { name: string }) => g.name));
    }
    genres[s.deezer_id] = albumId ? albums.get(albumId)! : [];
    if ((i + 1) % 250 === 0) { await fs.writeFile(out, JSON.stringify(genres)); console.log(`  ${i + 1}/${todo.length}`); }
  }
  await fs.writeFile(out, JSON.stringify(genres));
  const none = Object.values(genres).filter((g) => !g.length).length;
  console.log(`genres: ${lib.length - none} of ${lib.length}; none: ${none}`);
}

if (process.argv[1]?.endsWith("deezer-genres.ts")) main().catch((e) => { console.error(e); process.exit(1); });

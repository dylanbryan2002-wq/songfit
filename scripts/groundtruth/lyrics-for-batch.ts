/* Prints LRCLIB lyrics for one batch of songs to stdout so a labelling agent can read them (Dylan, 2026-10-11).
   Lyrics are never written to disk here: the agent stores only meaning labels.
     node --import tsx scripts/groundtruth/lyrics-for-batch.ts <batch-in.json>
   ~2 requests per second; User-Agent identifies Songfit as LRCLIB's terms ask. */
import fs from "node:fs/promises";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const songs = JSON.parse(await fs.readFile(process.argv[2]!, "utf8")) as { deezer_id: string; title: string; artist: string }[];
  for (const s of songs) {
    await sleep(500);
    const q = `track_name=${encodeURIComponent(s.title.replace(/\s*[([].*?[)\]]/g, ""))}&artist_name=${encodeURIComponent(s.artist)}`;
    const res = await fetch(`https://lrclib.net/api/search?${q}`, { headers: { "User-Agent": "Songfit/0.1 (https://thissongfits.com)" } })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const pick = (Array.isArray(res) ? res : []).find((r: any) => r.instrumental || r.plainLyrics);
    console.log(`\n=== ${s.deezer_id} | ${s.title} | ${s.artist}`);
    console.log(!pick ? "NO LYRICS FOUND" : pick.instrumental ? "INSTRUMENTAL (per LRCLIB)" : pick.plainLyrics);
  }
}

if (process.argv[1]?.endsWith("lyrics-for-batch.ts")) main().catch((e) => { console.error(e); process.exit(1); });

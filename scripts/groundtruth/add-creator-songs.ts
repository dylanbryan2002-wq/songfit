/* Add creator-recommended songs that are missing from the library (Dylan, 2026-10-11: "all of those songs need to be in
   our library"). Every song is verified on Deezer first (CLAUDE.md); only songs with a Deezer preview are added.
     node --import tsx scripts/groundtruth/add-creator-songs.ts [--home ~/Songfit-groundtruth]
   Reads catalog/creator-unmatched.csv, appends to catalog/library.json (sources: ["creator_list"], tags: null),
   writes catalog/creator-not-found.csv for songs Deezer can't confirm. ~8 requests per second. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseCsv } from "./csv";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Title variants to try: as written, and the long form inside brackets ("CYHTM (Can You Hear The Music)"). */
export function titleVariants(t: string) {
  const inner = t.match(/\(([^)]{6,})\)/)?.[1];
  return [...new Set([t.replace(/\s*\(.*?\)\s*/g, " ").trim(), inner].filter((x): x is string => !!x))];
}
/** Drops notes like "(artist from my knowledge)" and anything not a name. */
export function cleanArtist(a: string) {
  const s = a.replace(/\(.*?\)/g, "").trim();
  return /not confirmed|unreadable|inferred/i.test(s) ? "" : s;
}

async function get(url: string): Promise<any | null> {
  for (let i = 0; i < 4; i++) {
    await sleep(130);
    const body = await fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (body && !body.error) return body;
    await sleep(2000 * (i + 1));
  }
  return null;
}

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const libPath = path.join(home, "catalog", "library.json");
  const lib = JSON.parse(await fs.readFile(libPath, "utf8")) as { deezer_id: string }[];
  const have = new Set(lib.map((s) => s.deezer_id));
  const [, ...rows] = parseCsv(await fs.readFile(path.join(home, "catalog", "creator-unmatched.csv"), "utf8"));
  const seen = new Set<string>(), notFound: string[][] = [];
  let added = 0, already = 0;
  for (const [title = "", artistRaw = "", label = "", source = ""] of rows) {
    const artist = cleanArtist(artistRaw);
    const key = `${norm(title)}|${norm(artist)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let hit: any = null;
    const first = norm(artist).split(" ")[0] ?? "";
    for (const t of titleVariants(title)) {
      for (const q of artist ? [`track:"${t}" artist:"${artist}"`, `${t} ${artist}`] : [t]) {
        const res = await get(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=15`);
        hit = (res?.data ?? []).find((d: any) => d.preview && (artist
          ? norm(d.title).startsWith(norm(t)) && norm(d.artist.name).includes(first)
          : norm(d.title) === norm(t))); // no artist given: exact title only, flagged for review below
        if (hit) break;
      }
      if (hit) break;
    }
    if (!hit) { notFound.push([title, artistRaw, label, source]); continue; }
    if (have.has(String(hit.id))) { already++; continue; }
    const t = await get(`https://api.deezer.com/track/${hit.id}`);
    have.add(String(hit.id));
    lib.push({
      deezer_id: String(hit.id), title: hit.title, artist: hit.artist.name, sources: ["creator_list"],
      source_note: [`${title} — ${artistRaw} (${label}, ${source})`, ...(artist ? [] : ["artist unconfirmed: matched on title only"])], rank: hit.rank ?? null,
      release_date: t?.release_date ?? null, bpm: t?.bpm || null, explicit: !!hit.explicit_lyrics, has_sample: true,
      isrc: t?.isrc ?? null, mbid: null, first_release: null, tags: null,
    } as any);
    added++;
    console.log(`  + ${hit.title} — ${hit.artist.name}${artist ? "" : "   (artist unconfirmed)"}`);
  }
  await fs.writeFile(libPath, JSON.stringify(lib));
  const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  await fs.writeFile(path.join(home, "catalog", "creator-not-found.csv"),
    ["title,artist,creator_label,source", ...notFound.map((r) => r.map(csv).join(","))].join("\n") + "\n");
  console.log(`unique picks: ${seen.size}; added: ${added}; already in library under another title: ${already}; not found on Deezer: ${notFound.length}; library now ${lib.length}`);
}

if (process.argv[1]?.endsWith("add-creator-songs.ts")) main().catch((e) => { console.error(e); process.exit(1); });

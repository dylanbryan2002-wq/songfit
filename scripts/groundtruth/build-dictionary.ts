/* Builds src/engine/catalog/dictionary.data.json from the ground-truth catalog (new engine phase 1, Dylan 2026-10-11).
     node --import tsx scripts/groundtruth/build-dictionary.ts [--home ~/Songfit-groundtruth]
   Reads catalog/song-labels.json, library.json, lyrics-meaning/out-*.json, sections.json. Writes labels only, never lyrics. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { typeKey } from "./filter-test";

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const read = async (...p: string[]) => JSON.parse(await fs.readFile(path.join(home, ...p), "utf8"));
  const labels = (await read("catalog", "song-labels.json")) as any[];
  const lib = new Map(((await read("catalog", "library.json")) as any[]).map((x) => [x.deezer_id, x]));
  const ranked = [...lib.values()].filter((x) => x.rank).sort((a, b) => a.rank - b.rank);
  const rankPct = new Map(ranked.map((x, i) => [x.deezer_id, Math.round((i / ranked.length) * 1000) / 1000]));
  const lyrics = new Map<string, any>();
  for (const f of (await fs.readdir(path.join(home, "catalog", "lyrics-meaning"))).filter((f) => /^out-\d+\.json$/.test(f)))
    for (const r of await read("catalog", "lyrics-meaning", f)) lyrics.set(r.deezer_id, r);
  const sections = (await read("catalog", "sections.json")) as Record<string, any>;
  const clamp = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.max(0, Math.min(1, x)));
  const out = labels.map((s) => {
    const l = lyrics.get(s.deezer_id), sec = sections[s.deezer_id];
    return {
      id: s.deezer_id, title: s.title, artist: s.artist, year: s.year ?? null,
      feelings: s.families, energy: clamp(s.energy), valence: clamp(s.valence), tempo: s.tempo ?? null,
      vocals: s.vocals, explicit: !!s.explicit,
      theme: l?.theme?.main ?? null, flags: l?.flags ?? [],
      sections: sec?.found ? { instrumental: !!sec.instrumental, first_vocal: sec.first_vocal ?? null, chorus: sec.chorus_starts ?? [], gaps: (sec.gaps ?? []).slice(0, 8) } : null,
      creator_types: [...new Set(((s.creator_uses ?? []) as { type: string | null }[]).filter((u) => u.type).map((u) => typeKey({ type: u.type!, format: "" })))],
      rank_pct: rankPct.get(s.deezer_id) ?? null,
    };
  });
  const dest = path.join(process.cwd(), "src", "engine", "catalog", "dictionary.data.json");
  await fs.writeFile(dest, JSON.stringify(out));
  console.log(`wrote ${out.length} songs to ${dest} (${Math.round((await fs.stat(dest)).size / 1024)} KB)`);
}

if (process.argv[1]?.endsWith("build-dictionary.ts")) main().catch((e) => { console.error(e); process.exit(1); });

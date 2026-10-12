/* Builds src/engine/catalog/dictionary.data.json from the ground-truth catalog (new engine phase 1, Dylan 2026-10-11).
     node --import tsx scripts/groundtruth/build-dictionary.ts [--home ~/Songfit-groundtruth]
   Reads catalog/song-labels.json, library.json, lyrics-meaning/out-*.json, sections.json, deezer-genres.json. Writes labels only, never lyrics. */
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
  const genres = (await read("catalog", "deezer-genres.json")) as Record<string, string[] | null>;
  // Film, TV and game scores (Dylan, 2026-10-12: kept away from talking videos): Deezer's genre, or a title that says so.
  const filmScore = (id: string, title: string) =>
    (genres[id] ?? []).some((g) => g === "Films/Games" || g === "Film Scores") || /soundtrack|\bscore\b|main (theme|title)|\btheme\b|\(from\b|from "/i.test(title);
  const clamp = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.max(0, Math.min(1, x)));
  const out = labels.map((s) => {
    const l = lyrics.get(s.deezer_id), sec = sections[s.deezer_id];
    // Instrumental vs lyric theme contradictions (Dylan, 2026-10-11): real words found on LRCLIB mean the song has vocals;
    // otherwise an instrumental song gets no lyric theme.
    const wordsFound = l?.source === "lyrics" && l?.instrumental === false;
    // Strict instrumental (Dylan, 2026-10-12: no lyrics under talking): every source must agree. Claude's tag says lead
    // vocals, the lyrics check found words, or the title names a featured artist -> the song has singing.
    const claudeSaysVocals = lib.get(s.deezer_id)?.tags?.lead_vocals === "yes";
    const featured = /\b(feat|ft)\.?\s/i.test(s.title);
    const vocals = s.vocals === "instrumental" && (wordsFound || l?.instrumental === false || claudeSaysVocals || featured) ? "vocals" : s.vocals;
    const instrumentalNoWords = vocals === "instrumental";
    return {
      id: s.deezer_id, title: s.title, artist: s.artist, year: s.year ?? null,
      feelings: s.families, energy: clamp(s.energy), valence: clamp(s.valence), tempo: s.tempo ?? null,
      vocals, explicit: !!s.explicit,
      theme: instrumentalNoWords ? (l ? "none" : null) : l?.theme?.main ?? null, flags: instrumentalNoWords ? [] : l?.flags ?? [],
      sections: sec?.found ? { instrumental: !!sec.instrumental, first_vocal: sec.first_vocal ?? null, chorus: sec.chorus_starts ?? [], gaps: (sec.gaps ?? []).slice(0, 8) } : null,
      creator_types: [...new Set(((s.creator_uses ?? []) as { type: string | null }[]).filter((u) => u.type).map((u) => typeKey({ type: u.type!, format: "" })))],
      rank_pct: rankPct.get(s.deezer_id) ?? null,
      film_score: filmScore(s.deezer_id, s.title),
    };
  });
  const dest = path.join(process.cwd(), "src", "engine", "catalog", "dictionary.data.json");
  await fs.writeFile(dest, JSON.stringify(out));
  console.log(`wrote ${out.length} songs to ${dest} (${Math.round((await fs.stat(dest)).size / 1024)} KB)`);
}

if (process.argv[1]?.endsWith("build-dictionary.ts")) main().catch((e) => { console.error(e); process.exit(1); });

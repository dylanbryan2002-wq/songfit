import { searchDeezer, pickDeezerMatch } from "../src/engine/catalog/deezer";
import { normalizeTitle, normalizeArtist, titlesMatch, artistsMatch } from "../src/engine/catalog/normalize";
const cases: [string, string][] = [
  ["Mr. Brightside", "The Killers"], ["Someone Like You", "Adele"], ["Dreams", "Fleetwood Mac"],
  ["Sunflower", "Post Malone & Swae Lee"], ["Die With A Smile", "Lady Gaga & Bruno Mars"], ["Too Sweet", "Hozier"],
  ["Birthday", "The Beatles"], ["Running Up That Hill", "Kate Bush"], ["Moon River", "Audrey Hepburn"], ["Let It Go", "Idina Menzel"],
];
async function main() {
  for (const [title, artist] of cases) {
    const res = await searchDeezer(title, artist);
    const pick = pickDeezerMatch({ title, artist }, res);
    console.log(`\n## ${title} — ${artist}  → ${pick ? "MATCH " + pick.title + " / " + pick.artist.name : "NO MATCH"} (${res.length} results) norm=[${normalizeTitle(title)}|${normalizeArtist(artist)}]`);
    for (const r of res.slice(0, 4)) console.log(`   ${titlesMatch(title, r.title) ? "T" : "-"}${artistsMatch(artist, r.artist.name) ? "A" : "-"} ${r.title} / ${r.artist.name} [${normalizeTitle(r.title)}|${normalizeArtist(r.artist.name)}] ${r.duration}s`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

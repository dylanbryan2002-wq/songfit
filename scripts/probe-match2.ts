// Proposed relaxed matcher, measured against today's unverified candidates. Also checks iTunes for the rest.
import { listCandidates } from "../src/db/queries/candidates";
import { normalizeTitle, normalizeArtist } from "../src/engine/catalog/normalize";
const BAD = /\b(live|remix|mix|edit|acoustic|instrumental|karaoke|cover|tribute|sped|slowed|nightcore|demo|outtake|outtakes|sessions?|rehearsal|originally|ringtone|8-bit|lullaby|piano version|version)\b/i;
function core(title: string) { return normalizeTitle(title.replace(/\s*[\(\[].*$/, "").replace(/\s+[-–—]\s+.*$/, "")); }
function extra(title: string) { const m = title.match(/[\(\[].*$|\s+[-–—]\s+.*$/); return m ? m[0] : ""; }
function artists(a: string) { return a.split(/\s*(?:&|,|\band\b|\bx\b|\bfeat\.?|\bft\.?|\bwith\b)\s*/i).map(normalizeArtist).filter(Boolean); }
async function dz(q: string) { const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=15`); const j = (await r.json()) as { data?: { title: string; artist: { name: string }; rank: number; duration: number }[] }; return j.data ?? []; }
async function itunes(q: string) { const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&country=US&limit=10`); const j = (await r.json()) as { results?: { trackName: string; artistName: string }[] }; return j.results ?? []; }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const seen = new Set<string>(); const cands: { title: string; artist: string }[] = [];
  for (const id of process.argv.slice(2)) for (const r of await listCandidates(id)) if (!r.verified && !seen.has(r.title + r.artist)) { seen.add(r.title + r.artist); cands.push({ title: r.title, artist: r.artist }); }
  let strictHit = 0, relaxedHit = 0; const left: typeof cands = [];
  for (const c of cands) {
    const res = await dz(`${c.title} ${c.artist}`); await sleep(150);
    const want = normalizeTitle(c.title); const wantArtists = artists(c.artist);
    const ok = res.filter((t) => { const ta = normalizeArtist(t.artist.name); const artistOk = wantArtists.includes(ta) || artists(t.artist.name).some((x) => wantArtists.includes(x)); const titleOk = normalizeTitle(t.title) === want || (core(t.title) === want && !BAD.test(extra(t.title))); return artistOk && titleOk; }).sort((a, b) => b.rank - a.rank);
    const strict = res.find((t) => normalizeTitle(t.title) === want && normalizeArtist(t.artist.name) === normalizeArtist(c.artist));
    if (strict) strictHit++;
    if (ok[0]) { relaxedHit++; console.log(`OK   ${c.title} — ${c.artist}  →  ${ok[0].title} / ${ok[0].artist.name} (rank ${ok[0].rank})`); } else left.push(c);
  }
  console.log(`\n${cands.length} unverified: strict ${strictHit}, relaxed ${relaxedHit}, still missing ${left.length}`);
  for (const c of left) { const it = await itunes(`${c.title} ${c.artist}`); await sleep(3100); const hit = it.find((t) => normalizeTitle(t.trackName) === normalizeTitle(c.title) || core(t.trackName) === normalizeTitle(c.title)); console.log(`MISS ${c.title} — ${c.artist}  → iTunes: ${hit ? hit.trackName + " / " + hit.artistName : "none"}`); }
}
main().catch((e) => { console.error(e); process.exit(1); });

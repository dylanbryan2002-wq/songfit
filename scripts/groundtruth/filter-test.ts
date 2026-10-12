/* Step 1 of the engine (filter), offline (Dylan, 2026-10-11). Cuts the library down to songs that could fit a video,
   then checks on the content-type test videos whether the song the creator really used survives each rule.
     node --import tsx scripts/groundtruth/filter-test.ts [--home ~/Songfit-groundtruth]
   Feel button = hard filter; content type, talking and lyric clashes order the pool (Dylan's decisions, design/song-labels.md).
   Allowed feelings for Educational, Vlog, Storytelling, Sad, Funny, Motivational, Product, Aesthetic, Challenge and Deep
   come from design/song-labels.md; the others (Advice, Commentary, Reaction, Podcast, Inspirational) are provisional. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseCsv } from "./csv";

export const ALLOWED: Record<string, string[]> = {
  "Educational": ["Calm/Focused", "Upbeat", "Reflective"],
  "Vlog": ["Upbeat", "Calm/Focused", "Nostalgic"],
  "Storytelling": ["Heartfelt", "Reflective", "Dramatic"], // no feeling given
  // Storytelling is one type with a feeling (Dylan, 2026-10-11).
  "Storytelling: emotional": ["Heartfelt", "Reflective", "Dramatic", "Sad"],
  "Storytelling: sad": ["Sad", "Heartfelt", "Reflective", "Nostalgic"],
  "Storytelling: inspirational": ["Inspirational", "Heartfelt", "Dramatic", "Reflective"],
  "Storytelling: motivational": ["Motivational", "Inspirational", "Dramatic", "Hype"],
  "Storytelling: funny": ["Funny", "Upbeat"],
  "Storytelling: interesting": ["Upbeat", "Calm/Focused", "Dramatic"],
  "Storytelling: deep": ["Reflective", "Heartfelt", "Sad"],
  "Building in public": ["Inspirational", "Motivational", "Upbeat", "Calm/Focused", "Dramatic"],
  "Funny/Upbeat": ["Funny", "Upbeat", "Hype"],
  "Motivational": ["Motivational", "Hype", "Dramatic", "Inspirational"],
  "Product/Review": ["Upbeat", "Calm/Focused"],
  "Aesthetic/Montage": [], // any feeling
  "Challenge": ["Hype", "Dramatic", "Motivational"],
  "Deep": ["Reflective", "Sad", "Heartfelt"],
  "Advice": ["Calm/Focused", "Reflective", "Upbeat", "Inspirational"],
  "Commentary/Opinion": ["Calm/Focused", "Upbeat", "Dramatic", "Funny"],
  "Reaction": ["Funny", "Upbeat", "Dramatic"],
  "Podcast/Interview": ["Reflective", "Calm/Focused", "Dramatic", "Inspirational"],
};
/** v1 story types -> v2 Storytelling + feeling. */
const LEGACY: Record<string, string> = { "Sad storytelling": "Storytelling: sad", "Inspirational storytelling": "Storytelling: inspirational" };
export function typeKey(v: Video) {
  if (LEGACY[v.type]) return LEGACY[v.type]!;
  return v.type === "Storytelling" && v.story_feeling ? `Storytelling: ${v.story_feeling}` : v.type;
}
const TALKING = new Set(["talking to camera", "voice-over", "conversation", "reacting to a clip"]);
const HAPPY_TYPES = new Set(["Funny/Upbeat", "Vlog", "Product/Review", "Motivational", "Challenge", "Storytelling: funny", "Building in public"]);
const SAD_TYPES = new Set(["Storytelling: sad", "Storytelling: deep", "Storytelling: emotional", "Storytelling: inspirational", "Deep"]);

type Song = { deezer_id: string; title: string; artist: string; families: Record<string, string>; vocals: string };
type Lyr = { deezer_id: string; theme?: { main: string | null } | null };
export type Video = { type: string; format: string; story_feeling?: string | null };

/** Dylan's decisions (2026-10-11): the feel button is the only hard filter. Content type, talking and lyric clashes
    only order the pool: allowed feeling 2 (flagged 1.5), unlabelled 1, other feelings 0; minus 1 for a vocal song
    under talking and minus 1 for a lyric clash. Stable sort keeps library order on ties. */
export function rankPool(v: Video, songs: Song[], lyrics: Map<string, Lyr>, feelButtons: string[] = []) {
  const key = typeKey(v);
  const allowed = ALLOWED[key];
  const pool = feelButtons.length ? songs.filter((s) => feelButtons.some((f) => s.families[f])) : songs;
  return pool.map((s) => {
    const labels = Object.entries(s.families);
    let score = !labels.length ? 1 : !allowed || !allowed.length ? 2
      : allowed.some((f) => s.families[f] && s.families[f] !== "flagged") ? 2 : allowed.some((f) => s.families[f]) ? 1.5 : 0;
    if (TALKING.has(v.format) && s.vocals === "vocals") score -= 1;
    const theme = lyrics.get(s.deezer_id)?.theme?.main;
    if (HAPPY_TYPES.has(key) && (theme === "breakup/heartbreak" || theme === "grief/loss")) score -= 1;
    if (SAD_TYPES.has(key) && (theme === "partying" || theme === "flexing/money")) score -= 1;
    return { song: s, score };
  }).sort((a, b) => b.score - a.score);
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const songs = JSON.parse(await fs.readFile(path.join(home, "catalog", "song-labels.json"), "utf8")) as Song[];
  const lyrics = new Map<string, Lyr>();
  const ldir = path.join(home, "catalog", "lyrics-meaning");
  for (const f of (await fs.readdir(ldir)).filter((f) => /^out-\d+\.json$/.test(f)))
    for (const r of JSON.parse(await fs.readFile(path.join(ldir, f), "utf8")) as Lyr[]) lyrics.set(r.deezer_id, r);
  const batch = path.join(home, "batches", "2026-10-08-founders-mixed");
  const [head, ...rows] = parseCsv(await fs.readFile(path.join(batch, "clips.csv"), "utf8"));
  const col = (n: string) => head!.indexOf(n);
  const tdir = path.join(home, "design", "content-type-test");
  const out: string[] = [];
  const ranks: number[] = [];
  for (const r of rows) {
    const file = r[col("file")]!, title = r[col("song")]!, artist = r[col("artist")]!;
    if (!title) continue;
    const real = songs.find((s) => norm(s.title) === norm(title) && norm(s.artist).includes(norm(artist).split(" ")[0]!));
    let v: Video;
    try { v = JSON.parse(await fs.readFile(path.join(tdir, `${file}.json`), "utf8")); } catch { continue; }
    if (!real) { out.push(`${file} | ${v.type} | ${title} — not in library`); continue; }
    const ranked = rankPool(v, songs, lyrics);
    const i = ranked.findIndex((x) => x.song === real);
    const top = ranked.filter((x) => x.score === ranked[0]!.score).length;
    const pct = Math.round((i / ranked.length) * 100);
    ranks.push(pct);
    out.push(`${file} | ${v.type} / ${v.format} | ${real.title} — ${real.artist} | score ${ranked[i]!.score} | top tier ${top} songs | real song at top ${pct}% | feelings: ${Object.keys(real.families).join(", ") || "none"}, vocals ${real.vocals}`);
  }
  ranks.sort((a, b) => a - b);
  out.push(`\nreal songs scored: ${ranks.length}; in top tier-ish (top 25%): ${ranks.filter((p) => p <= 25).length}; median position: top ${ranks[Math.floor(ranks.length / 2)]}%`);
  await fs.writeFile(path.join(home, "design", "filter-test-v2.txt"), out.join("\n") + "\n");
  console.log(out.join("\n"));
}

if (process.argv[1]?.endsWith("filter-test.ts")) main().catch((e) => { console.error(e); process.exit(1); });

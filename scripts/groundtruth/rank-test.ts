/* Step 3 of the engine (rank), offline (Dylan, 2026-10-11; signals and weights in design/song-labels.md).
     node --import tsx scripts/groundtruth/rank-test.ts [--home ~/Songfit-groundtruth]
   Scores every library song for each test video with 7 signals, reports where the creator's real song lands
   (top 3 / top 10 / median), and writes each video's top 50 to design/rank-shortlists.json for the Claude final pick. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { parseCsv } from "./csv";
import { ALLOWED, typeKey, type Video } from "./filter-test";
import { claudeFamilies } from "./merge-labels";

export const WEIGHTS = { type: 25, mood: 25, creator: 15, lyrics: 10, talking: 10, familiarity: 10, section: 5 };

const TALKING = new Set(["talking to camera", "voice-over", "conversation", "reacting to a clip"]);
/** Lyric themes that suit each content type (Dylan approved the signal; this list is the stated assumption). */
const SUITS: Record<string, string[]> = {
  "Motivational": ["self-belief/empowerment", "ambition/success", "rebellion/anger", "flexing/money"],
  "Storytelling: motivational": ["self-belief/empowerment", "ambition/success", "rebellion/anger"],
  "Storytelling: inspirational": ["self-belief/empowerment", "ambition/success", "freedom/escape", "faith", "joy/optimism", "gratitude"],
  "Storytelling: sad": ["grief/loss", "longing", "breakup/heartbreak", "nostalgia", "family"],
  "Storytelling: emotional": ["grief/loss", "longing", "love", "nostalgia", "family", "gratitude"],
  "Storytelling: deep": ["longing", "nostalgia", "grief/loss", "freedom/escape"],
  "Storytelling: funny": ["joy/optimism", "partying", "friendship"],
  "Storytelling: interesting": ["joy/optimism", "freedom/escape"],
  "Funny/Upbeat": ["joy/optimism", "partying", "friendship"],
  "Vlog": ["joy/optimism", "freedom/escape", "friendship", "love"],
  "Building in public": ["ambition/success", "self-belief/empowerment"],
  "Challenge": ["self-belief/empowerment", "ambition/success", "rebellion/anger"],
  "Deep": ["longing", "nostalgia", "grief/loss", "freedom/escape"],
};
const CLASH: Record<string, string[]> = {
  happy: ["breakup/heartbreak", "grief/loss"],
  sad: ["partying", "flexing/money"],
};
const HAPPY = new Set(["Funny/Upbeat", "Vlog", "Product/Review", "Motivational", "Challenge", "Storytelling: funny", "Building in public"]);
const SAD = new Set(["Storytelling: sad", "Storytelling: deep", "Storytelling: emotional", "Storytelling: inspirational", "Deep"]);

export type RankSong = { deezer_id: string; title: string; artist: string; families: Record<string, string>; vocals: string; creator_uses?: { type: string | null }[] };
export type RankVideo = Video & { mood_by_section?: { mood: string[] }[] };
type Ctx = { lyrics: Map<string, { theme?: { main: string | null } | null }>; sections: Record<string, any>; rankPct: Map<string, number> };

/** Each signal is 0..1; total is the weighted sum (0..100). */
export function scoreSong(v: RankVideo, s: RankSong, ctx: Ctx) {
  const key = typeKey(v);
  const allowed = ALLOWED[key];
  const fam = Object.keys(s.families);
  const type = !fam.length ? 0.5 : !allowed || !allowed.length ? 1
    : allowed.some((f) => s.families[f] && s.families[f] !== "flagged") ? 1 : allowed.some((f) => s.families[f]) ? 0.75 : 0;
  const want = claudeFamilies({ mood: (v.mood_by_section ?? []).flatMap((m) => m.mood.map((w) => w.toLowerCase())) });
  const mood = !want.size || !fam.length ? 0.5 : [...want].filter((f) => s.families[f]).length / want.size;
  const uses = (s.creator_uses ?? []).map((u) => (u.type ? typeKey({ type: u.type, format: "" }) : null));
  const creator = uses.includes(key) ? 1 : uses.length ? 0.5 : 0;
  const theme = ctx.lyrics.get(s.deezer_id)?.theme?.main ?? null;
  const clash = theme && ((HAPPY.has(key) && CLASH.happy!.includes(theme)) || (SAD.has(key) && CLASH.sad!.includes(theme)));
  const lyrics = clash ? 0 : theme && SUITS[key]?.includes(theme) ? 1 : theme === "none" && TALKING.has(v.format) ? 1 : 0.5;
  const talking = !TALKING.has(v.format) ? 1 : s.vocals === "vocals" ? 0 : s.vocals === "instrumental" ? 1 : 0.5;
  const p = ctx.rankPct.get(s.deezer_id);
  const familiarity = p === undefined ? 0.4 : p >= 0.9 ? 0.6 : p >= 0.5 ? 1 : 0.4;
  const sec = ctx.sections[s.deezer_id];
  const section = sec?.chorus_starts?.length || (sec?.instrumental) ? 1 : sec?.found ? 0.5 : 0;
  const signals = { type, mood, creator, lyrics, talking, familiarity, section };
  const total = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).reduce((t, k) => t + WEIGHTS[k] * signals[k], 0);
  return { signals, total };
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const read = async (...p: string[]) => JSON.parse(await fs.readFile(path.join(home, ...p), "utf8"));
  const songs = (await read("catalog", "song-labels.json")) as RankSong[];
  const lib = (await read("catalog", "library.json")) as { deezer_id: string; rank: number | null }[];
  const ranked = lib.filter((x) => x.rank).sort((a, b) => a.rank! - b.rank!);
  const rankPct = new Map(ranked.map((x, i) => [x.deezer_id, i / ranked.length]));
  const lyrics = new Map<string, any>();
  const ldir = path.join(home, "catalog", "lyrics-meaning");
  for (const f of (await fs.readdir(ldir)).filter((f) => /^out-\d+\.json$/.test(f))) for (const r of await read("catalog", "lyrics-meaning", f)) lyrics.set(r.deezer_id, r);
  const ctx = { lyrics, sections: await read("catalog", "sections.json"), rankPct };

  const tests: [string, string][] = [["2026-10-08-founders-mixed", "content-type-test"], ["2026-10-09-founders-mixed", "content-type-test-b2"]];
  const out: string[] = [], shortlists: Record<string, { real: string; top: { deezer_id: string; title: string; artist: string; total: number }[] }> = {};
  const pos: number[] = [];
  for (const [batch, tdir] of tests) {
    const [head, ...rows] = parseCsv(await fs.readFile(path.join(home, "batches", batch, "clips.csv"), "utf8"));
    const col = (n: string) => head!.indexOf(n);
    for (const r of rows) {
      const file = r[col("file")]!, title = r[col("song")]!, artist = r[col("artist")]!;
      if (!title) continue;
      let v: RankVideo;
      try { v = await read("design", tdir, `${file}.json`); } catch { continue; }
      const real = songs.find((s) => norm(s.title) === norm(title) && norm(s.artist).includes(norm(artist).split(" ")[0]!));
      if (!real) continue;
      const scored = songs.map((s) => ({ s, ...scoreSong(v, s, ctx) })).sort((a, b) => b.total - a.total);
      const i = scored.findIndex((x) => x.s === real);
      pos.push(i + 1);
      out.push(`${file} | ${typeKey(v)} | ${real.title} — ${real.artist} | position ${i + 1} of ${scored.length} | ${JSON.stringify(scored[i]!.signals)}`);
      shortlists[`${batch}/${file}`] = { real: `${real.title} — ${real.artist}`, top: scored.slice(0, 50).map((x) => ({ deezer_id: x.s.deezer_id, title: x.s.title, artist: x.s.artist, total: Math.round(x.total) })) };
    }
  }
  pos.sort((a, b) => a - b);
  out.push(`\nvideos: ${pos.length}; real song in top 3: ${pos.filter((p) => p <= 3).length}; top 10: ${pos.filter((p) => p <= 10).length}; top 50: ${pos.filter((p) => p <= 50).length}; median position: ${pos[Math.floor(pos.length / 2)]}`);
  await fs.writeFile(path.join(home, "design", "rank-test-v1.txt"), out.join("\n") + "\n");
  await fs.writeFile(path.join(home, "design", "rank-shortlists.json"), JSON.stringify(shortlists));
  console.log(out.join("\n"));
}

if (process.argv[1]?.endsWith("rank-test.ts")) main().catch((e) => { console.error(e); process.exit(1); });

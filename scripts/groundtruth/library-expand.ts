/* Grow the song library beyond the first 500 (Dylan 2026-10-09: "make the library much bigger right now"; this lifts the
   500-row cap from CLAUDE.md for the library). Adds Deezer songs from ~60 theme playlists and from artists related to the
   ones already in the library. Only songs with a sample and a popularity rank at or above MIN_RANK get in.
     pnpm local scripts/groundtruth/library-expand.ts [--target 5000] [--home ~/Songfit-groundtruth]
   --beats (Dylan 2026-10-12, "fix both"): instead, add energetic creator-style instrumentals (phonk, gym beats, trap,
   drill, EDM, future bass, synthwave, funk...) for talking videos: the 30 most popular per style from beat playlists.
   Loads and rewrites catalog/library.json, keeping existing rows and tags. Tag the new rows with
   library.ts --tags-only, then build the category map with library-map.ts. Non-commercial use only. */
import "./assert-tree";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { deezerGet, paced } from "../../src/engine/catalog/deezer";
import type { LibrarySong } from "./library";

const MIN_RANK = 150_000; // Deezer popularity; keeps the library to songs people recognise
const THEMES = [
  "tiktok viral", "tiktok hits", "reels trending", "viral hits", "trending sounds", "motivation", "gym motivation", "hustle",
  "grind", "entrepreneur", "success", "confidence", "glow up", "main character", "boss", "study", "focus", "productivity",
  "deep work", "coding", "morning routine", "day in my life", "vlog", "travel", "road trip", "moving", "new beginnings",
  "summer", "summer hits", "throwback", "throwback hits", "y2k", "2000s hits", "2010s hits", "90s hits", "80s hits",
  "feel good", "happy", "good vibes", "upbeat", "party", "dance hits", "indie", "indie pop", "alternative", "rock classics",
  "sad", "sad songs", "heartbreak", "nostalgia", "emotional", "inspiring", "epic", "cinematic", "piano", "chill", "lofi",
  "funny", "meme songs", "comedy", "hype", "workout", "running", "graduation", "friendship", "family",
];

const BEAT_STYLES = [
  "motivational beat", "gym beats", "trap instrumental", "phonk", "drill instrumental", "workout instrumental", "upbeat instrumental",
  "energetic instrumental", "boom bap instrumental", "hype instrumental", "rap instrumentals", "edm instrumental", "future bass",
  "funk instrumental", "synthwave", "gym phonk", "hip hop instrumental", "electronic instrumental", "drum and bass", "instrumental rap beats",
];
const BEAT_KEEP = /instrument|beat|phonk|future bass|synthwave|edm|drum|funk|no lyrics/i;
const BEAT_SKIP = /lofi|lo-fi|chill|study|focus|pilates|lounge|downtempo|sleep|relax|jazzy|road trip|mixtape|80s/i;
/** A playlist of energetic beats, not a calm study/lofi list or a "type beat" list of old pop songs. */
export const beatPlaylist = (title: string) => BEAT_KEEP.test(title) && !BEAT_SKIP.test(title);

/** The most popular tracks of one style: no featured singers, no slowed/sped-up copies, nothing already in, a cap per artist. */
export function selectBeats(tracks: Track[], o: { have: Set<string>; perStyle: number; minRank: number; artistCap: number; seen?: Set<string>; artists?: Map<string, number> }) {
  const seen = o.seen ?? new Set<string>(), artists = o.artists ?? new Map<string, number>(), out: Track[] = [];
  for (const t of [...tracks].sort((a, b) => b.rank - a.rank)) {
    if (out.length >= o.perStyle) break;
    const base = `${t.title.replace(/\s*[([].*?(slowed|sped|remix|edit|version|reverb).*?[)\]]/gi, "").toLowerCase().trim()}|${t.artist.name.toLowerCase()}`;
    if (o.have.has(String(t.id)) || !t.preview || t.rank < o.minRank || /\b(feat|ft)\.?\s/i.test(t.title) || seen.has(base) || (artists.get(t.artist.name) ?? 0) >= o.artistCap) continue;
    seen.add(base); artists.set(t.artist.name, (artists.get(t.artist.name) ?? 0) + 1); out.push(t);
  }
  return out;
}

type Track = { id: number; title: string; rank: number; preview: string; artist: { id: number; name: string } };
const dz = (url: string) => paced(() => deezerGet(url)) as Promise<Record<string, unknown>>;
const data = <T>(r: Record<string, unknown> | null) => ((r?.data as T[] | undefined) ?? []);

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" }, target: { type: "string", default: "5000" }, beats: { type: "boolean", default: false } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const file = path.join(home, "catalog", "library.json");
  const target = Number(args.target);
  const lib = JSON.parse(await fs.readFile(file, "utf8")) as LibrarySong[];
  const byId = new Map(lib.map((s) => [s.deezer_id, s]));
  const artistIds = new Set<number>();
  const add = (t: Track, note: string, minRank = MIN_RANK) => {
    if (byId.size >= target || byId.has(String(t.id)) || !t.preview || t.rank < minRank) return;
    const s: LibrarySong = { deezer_id: String(t.id), title: t.title, artist: t.artist.name, sources: ["deezer_playlist"], source_note: [note],
      rank: t.rank, release_date: null, bpm: null, explicit: null, has_sample: true, isrc: null, mbid: null, first_release: null, tags: null };
    byId.set(s.deezer_id, s); lib.push(s); artistIds.add(t.artist.id);
  };
  const start = byId.size;

  if (args.beats) {
    const seen = new Set<string>(), artists = new Map<string, number>();
    for (const q of BEAT_STYLES) {
      const lists = data<{ id: number; title: string; nb_tracks: number }>(await dz(`https://api.deezer.com/search/playlist?q=${encodeURIComponent(q)}&limit=25`).catch(() => null))
        .filter((p) => beatPlaylist(p.title)).sort((a, b) => b.nb_tracks - a.nb_tracks).slice(0, 4);
      const tracks: Track[] = [];
      for (const pl of lists) tracks.push(...data<Track>(await dz(`https://api.deezer.com/playlist/${pl.id}/tracks?limit=100`).catch(() => null)));
      const picked = selectBeats(tracks, { have: new Set(byId.keys()), perStyle: 30, minRank: 40_000, artistCap: 4, seen, artists });
      for (const t of picked) add(t, `beats: ${q}`, 40_000);
      console.log(`${q}: +${picked.length}`);
    }
  }

  // 1. Theme playlists: the three biggest per theme, popular tracks first.
  for (const q of args.beats ? [] : THEMES) {
    if (byId.size >= target) break;
    const lists = data<{ id: number; title: string; nb_tracks: number }>(await dz(`https://api.deezer.com/search/playlist?q=${encodeURIComponent(q)}&limit=10`).catch(() => null))
      .sort((a, b) => b.nb_tracks - a.nb_tracks).slice(0, 3);
    for (const pl of lists) {
      const tracks = data<Track>(await dz(`https://api.deezer.com/playlist/${pl.id}/tracks?limit=100`).catch(() => null));
      for (const t of tracks.sort((a, b) => b.rank - a.rank).slice(0, 40)) add(t, `${q}: ${pl.title}`);
    }
  }
  console.log(`after playlists: ${byId.size} (+${byId.size - start})`);

  // 2. Related artists of the creator-used and creator-list songs first, then of everything else: top 5 tracks each.
  const seedArtists = new Map<string, number>();
  for (const s of args.beats ? [] : lib) {
    if (seedArtists.size > 600) break;
    if (seedArtists.has(s.artist.toLowerCase())) continue;
    const hits = data<Track>(await dz(`https://api.deezer.com/search/track?q=${encodeURIComponent(`${s.title} ${s.artist}`)}&limit=1`).catch(() => null));
    if (hits[0]) seedArtists.set(s.artist.toLowerCase(), hits[0].artist.id);
  }
  const seen = new Set<number>();
  for (const id of seedArtists.values()) {
    if (byId.size >= target) break;
    for (const rel of data<{ id: number; name: string }>(await dz(`https://api.deezer.com/artist/${id}/related?limit=5`).catch(() => null))) {
      if (seen.has(rel.id) || byId.size >= target) continue;
      seen.add(rel.id);
      for (const t of data<Track>(await dz(`https://api.deezer.com/artist/${rel.id}/top?limit=5`).catch(() => null))) add(t, `related to ${rel.name}`);
    }
  }
  console.log(`after related artists: ${byId.size} (+${byId.size - start})`);

  // Release dates for the new songs (album date from the track endpoint).
  for (const s of lib) {
    if (s.release_date || s.first_release) continue;
    const t = await dz(`https://api.deezer.com/track/${s.deezer_id}`).catch(() => null);
    if (!t || t.error) continue;
    s.release_date = typeof t.release_date === "string" ? t.release_date : null;
    s.bpm = typeof t.bpm === "number" && t.bpm > 0 ? t.bpm : null;
    s.explicit = typeof t.explicit_lyrics === "boolean" ? t.explicit_lyrics : null;
    s.isrc = typeof t.isrc === "string" ? t.isrc : null;
  }
  await fs.writeFile(file, JSON.stringify(lib, null, 1));
  console.log(`wrote ${file}: ${lib.length} songs (${lib.length - start} new, untagged)`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

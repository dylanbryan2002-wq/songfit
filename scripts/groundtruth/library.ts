/* Build the song library (docs/review/27 follow-up, Dylan 2026-10-09): up to 500 songs with matchable factors.
     pnpm local scripts/groundtruth/library.ts [--home ~/Songfit-groundtruth] [--max-dollars 4] [--skip-tags]
   Sources, in priority order (deduped by Deezer id, capped at 500):
     1. songs creators used in our practice Reels (tune split only: held-out songs stay out so tests stay honest),
     2. the resolved creator-list songs (src/engine/catalog/creatorLists.ts),
     3. Deezer playlists found by theme searches (current, recognisable songs),
     4. the engine's best-scoring verified finds across saved runs (max 2 per artist).
   Facts: Deezer track (rank = popularity, release date, bpm when present, explicit, sample available) and MusicBrainz
   by ISRC (recording id, first release date; CC0 core data; non-commercial web service, 1 request/second).
   Tags: one model pass in batches (mood, energy 1-5, jobs, lead vocals, familiarity, era, hook/theme, confidence).
   Writes catalog/library.json and catalog/library.csv. Non-commercial use only (Dylan, 2026-10-09). */
import "./assert-tree";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { deezerGet, paced } from "../../src/engine/catalog/deezer";
import { CREATOR_LISTS } from "../../src/engine/catalog/creatorLists";
import { callClaude } from "../../src/shared/anthropic";
import { MODELS } from "../../src/shared/config";
import { extractJson } from "../../src/shared/json";
import { MusicJob } from "../../src/shared/types";
import { parseClipsCsv } from "./intake";
import type { OursResult } from "./ours";
import { spentDollars } from "./treatment";

const LIBRARY_MAX = 500; // CLAUDE.md: no song catalogs over 500 rows this week
const PLAYLIST_QUERIES = [
  "tiktok viral", "tiktok hits", "reels trending", "viral hits", "motivation", "gym motivation", "study focus",
  "throwback hits", "2000s hits", "90s hits", "feel good", "summer hits", "indie hits", "sad songs", "main character", "road trip",
];
const PER_PLAYLIST = 12;
const MB_UA = "Songfit/0.1 (https://thissongfits.com)";

type Source = "creator_used" | "creator_list" | "deezer_playlist" | "engine_find";
export type LibrarySong = {
  deezer_id: string; title: string; artist: string; sources: Source[]; source_note: string[];
  rank: number | null; release_date: string | null; bpm: number | null; explicit: boolean | null; has_sample: boolean;
  isrc: string | null; mbid: string | null; first_release: string | null;
  tags: z.infer<typeof Tag> | null;
};

export const Tag = z.object({
  i: z.number().int(),
  mood: z.preprocess((v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : v), z.array(z.string()).max(6)),
  energy: z.number().int().min(1).max(5),
  jobs: z.array(MusicJob),
  lead_vocals: z.enum(["yes", "no", "unknown"]),
  familiarity: z.enum(["household", "known", "niche", "unknown"]),
  era: z.string(),
  hook: z.string(), // what the title or hook says or evokes, for joke/title matches; "" if nothing
  confidence: z.enum(["high", "medium", "low"]),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dz = (url: string) => paced(() => deezerGet(url)) as Promise<Record<string, unknown>>;

async function main() {
  const { values: args } = parseArgs({ options: {
    home: { type: "string" }, "max-dollars": { type: "string", default: "4" }, "skip-tags": { type: "boolean", default: false },
    "tags-only": { type: "boolean", default: false }, // tag the untagged songs in an existing library.json
    batches: { type: "string" }, // stop after this many tagging batches (for a first check)
    recover: { type: "string" }, // re-read saved replies library-tags-raw-0..N-1 instead of calling the model for those batches
  } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const cap = Number(args["max-dollars"]);
  const songs = new Map<string, LibrarySong>();
  const add = (id: string, title: string, artist: string, source: Source, note: string) => {
    const s = songs.get(id);
    if (s) { if (!s.sources.includes(source)) s.sources.push(source); s.source_note.push(note); return; }
    if (songs.size >= LIBRARY_MAX) return;
    songs.set(id, { deezer_id: id, title, artist, sources: [source], source_note: [note], rank: null, release_date: null, bpm: null, explicit: null, has_sample: false, isrc: null, mbid: null, first_release: null, tags: null });
  };

  if (args["tags-only"]) {
    for (const s of JSON.parse(await fs.readFile(path.join(home, "catalog", "library.json"), "utf8")) as LibrarySong[]) songs.set(s.deezer_id, s);
    console.log(`loaded ${songs.size} songs from library.json`);
  } else {
  // 1. Songs creators used (tune split), identified via Deezer search on the fingerprinted name.
  const used: { song: string; artist: string }[] = [];
  for (const batch of (await fs.readdir(path.join(home, "batches"))).sort()) {
    const csv = await fs.readFile(path.join(home, "batches", batch, "clips.csv"), "utf8").catch(() => null);
    if (csv) for (const c of parseClipsCsv(csv)) if (c.split === "tune" && c.song && c.artist) used.push({ song: c.song, artist: c.artist });
  }
  const { findDeezerMatch } = await import("../../src/engine/catalog/deezer");
  for (const u of used) {
    const hit = await findDeezerMatch({ title: u.song, artist: u.artist }).catch(() => null);
    if (hit) add(String(hit.id), hit.title, hit.artist.name, "creator_used", `${u.song} — ${u.artist}`);
  }
  console.log(`creator_used: ${songs.size}`);
  // 2. Creator lists.
  for (const e of CREATOR_LISTS) if (e.deezer_id && e.title && e.artist && !e.banned_for_generation) add(e.deezer_id, e.title, e.artist, "creator_list", e.title_raw);
  console.log(`+ creator_list: ${songs.size}`);
  // 3. Deezer theme playlists: the biggest playlist per query, its most popular tracks.
  for (const q of PLAYLIST_QUERIES) {
    const found = await dz(`https://api.deezer.com/search/playlist?q=${encodeURIComponent(q)}&limit=5`).catch(() => null);
    const lists = ((found?.data as { id: number; title: string; nb_tracks: number }[] | undefined) ?? []).sort((a, b) => b.nb_tracks - a.nb_tracks);
    const pl = lists[0];
    if (!pl) continue;
    const tracks = await dz(`https://api.deezer.com/playlist/${pl.id}/tracks?limit=100`).catch(() => null);
    const items = ((tracks?.data as { id: number; title: string; rank: number; preview: string; artist: { name: string } }[] | undefined) ?? [])
      .filter((t) => t.preview).sort((a, b) => b.rank - a.rank).slice(0, PER_PLAYLIST);
    for (const t of items) add(String(t.id), t.title, t.artist.name, "deezer_playlist", `${q}: ${pl.title}`);
  }
  console.log(`+ deezer_playlist: ${songs.size}`);
  // 4. Engine finds: verified, well-scored, max 2 per artist, most frequent first.
  const finds = new Map<string, { title: string; artist: string; n: number; best: number }>();
  for (const batch of await fs.readdir(path.join(home, "batches"))) {
    const work = path.join(home, "batches", batch, "work");
    for (const id of await fs.readdir(work).catch(() => [] as string[])) {
      for (const f of await fs.readdir(path.join(work, id)).catch(() => [] as string[])) {
        if (!/^ours\..+\.json$/.test(f)) continue;
        const run = await fs.readFile(path.join(work, id, f), "utf8").then((t) => JSON.parse(t) as OursResult).catch(() => null);
        for (const c of run?.candidates ?? []) {
          if (!c.verified || !c.deezer_id || (c.total_score ?? 0) < 0.72) continue;
          const e = finds.get(c.deezer_id) ?? { title: c.canonical_title ?? c.title, artist: c.canonical_artist ?? c.artist, n: 0, best: 0 };
          e.n++; e.best = Math.max(e.best, c.total_score ?? 0); finds.set(c.deezer_id, e);
        }
      }
    }
  }
  const perArtist = new Map<string, number>();
  for (const [id, e] of [...finds].sort((a, b) => b[1].best - a[1].best)) {
    if (songs.size >= LIBRARY_MAX) break;
    const k = e.artist.toLowerCase();
    if ((perArtist.get(k) ?? 0) >= 2) continue;
    perArtist.set(k, (perArtist.get(k) ?? 0) + 1);
    add(id, e.title, e.artist, "engine_find", `best ${e.best.toFixed(2)}`);
  }
  console.log(`+ engine_find: ${songs.size}`);

  // Facts: Deezer track details, then MusicBrainz by ISRC (1 request per second).
  for (const s of songs.values()) {
    const t = await dz(`https://api.deezer.com/track/${s.deezer_id}`).catch(() => null);
    if (!t || t.error) continue;
    s.title = String(t.title ?? s.title);
    s.rank = typeof t.rank === "number" ? t.rank : null;
    s.release_date = typeof t.release_date === "string" ? t.release_date : null;
    s.bpm = typeof t.bpm === "number" && t.bpm > 0 ? t.bpm : null;
    s.explicit = typeof t.explicit_lyrics === "boolean" ? t.explicit_lyrics : null;
    s.has_sample = !!t.preview;
    s.isrc = typeof t.isrc === "string" ? t.isrc : null;
  }
  let mbHits = 0;
  for (const s of songs.values()) {
    if (!s.isrc) continue;
    await sleep(1100);
    const r = await fetch(`https://musicbrainz.org/ws/2/isrc/${encodeURIComponent(s.isrc)}?fmt=json`, { headers: { "User-Agent": MB_UA } }).catch(() => null);
    if (!r?.ok) continue;
    const body = (await r.json().catch(() => null)) as { recordings?: { id: string; "first-release-date"?: string }[] } | null;
    const recs = body?.recordings ?? [];
    if (!recs.length) continue;
    const dates = recs.map((x) => x["first-release-date"]).filter((d): d is string => !!d).sort();
    s.mbid = recs[0]!.id; s.first_release = dates[0] ?? null; mbHits++;
  }
  console.log(`facts: ${[...songs.values()].filter((s) => s.rank != null).length} from Deezer, ${mbHits} matched on MusicBrainz`);
  }

  // Tags: batches of 40 songs, stopping before the spending cap.
  if (!args["skip-tags"]) {
    const all = [...songs.values()];
    const list = all.filter((s) => !s.tags);
    const maxBatches = args.batches ? Number(args.batches) : Infinity;
    for (let i = 0; i < list.length && i / 40 < maxBatches; i += 40) {
      const b = i / 40;
      const recovering = args.recover != null && b < Number(args.recover);
      if (!recovering && spentDollars() + 0.4 > cap) { console.log(`STOP tagging: spent $${spentDollars().toFixed(2)} of $${cap}`); break; }
      const chunk = list.slice(i, i + 40);
      const user = `Tag each song for matching it to short-form videos. Use what you know about the actual recording; if you do not know it, say unknown and confidence low, never guess. lead_vocals means a singer is heard (a sung hook counts as yes).\n` +
        chunk.map((s, j) => `${j}. ${s.title} — ${s.artist} (released ${s.first_release ?? s.release_date ?? "?"}${s.bpm ? `, ${Math.round(s.bpm)} bpm` : ""})`).join("\n") +
        `\nReturn ONE JSON array, one object per song: {"i": index, "mood": up to 4 words, "energy": 1-5, "jobs": subset of ${MusicJob.options.join("|")} this song can do for a video, "lead_vocals": "yes"|"no"|"unknown", "familiarity": "household"|"known"|"niche"|"unknown" (to US Gen Z), "era": e.g. "2009 club" or "2020s TikTok", "hook": what the title or hook says or evokes, in your own words (never quote lyrics), "" if nothing, "confidence": "high"|"medium"|"low"}`;
      let text: string;
      try {
        text = recovering
          ? await fs.readFile(path.join(home, "catalog", `library-tags-raw-${args["tags-only"] ? "more-" : ""}${b}.md`), "utf8")
          : await callClaude({ model: MODELS.study, system: "You are a music supervisor tagging songs accurately. Reply with JSON only. Never quote song lyrics.", user, maxTokens: 16_000, effort: "medium" });
      } catch (err) {
        console.log(`batch ${b}: call failed, skipped (${(err instanceof Error ? err.message : String(err)).slice(0, 120)})`);
        continue;
      }
      if (!recovering) await fs.writeFile(path.join(home, "catalog", `library-tags-raw-${args["tags-only"] ? "more-" : ""}${b}.md`), text);
      // Parse each song on its own: one bad field must not discard the whole batch.
      let items: unknown[] = [];
      try { const j = extractJson(text); items = Array.isArray(j) ? j : []; } catch { items = []; }
      let ok = 0; const errors: string[] = [];
      for (const raw of items) {
        const t = Tag.safeParse(raw);
        if (t.success) { const s = chunk[t.data.i]; if (s) { s.tags = t.data; ok++; } }
        else errors.push(t.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; "));
      }
      console.log(`batch ${b}: ${ok}/${chunk.length} tagged${recovering ? " (recovered)" : ""}${errors.length ? `; first problem: ${errors[0]}` : ""}`);
      await fs.writeFile(path.join(home, "catalog", "library.json"), JSON.stringify(all, null, 1)); // save after every batch
    }
    console.log(`tagged ${all.filter((s) => s.tags).length} of ${all.length}; spent $${spentDollars().toFixed(2)}`);
  }

  const out = path.join(home, "catalog");
  const rows = [...songs.values()];
  await fs.writeFile(path.join(out, "library.json"), JSON.stringify(rows, null, 1));
  const esc = (v: unknown) => { const s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["title", "artist", "sources", "first_release", "rank", "bpm", "lead_vocals", "energy", "mood", "jobs", "familiarity", "era", "hook", "confidence", "deezer_id"];
  await fs.writeFile(path.join(out, "library.csv"), [head.join(","), ...rows.map((s) => [s.title, s.artist, s.sources, s.first_release ?? s.release_date, s.rank, s.bpm, s.tags?.lead_vocals, s.tags?.energy, s.tags?.mood, s.tags?.jobs, s.tags?.familiarity, s.tags?.era, s.tags?.hook, s.tags?.confidence, s.deezer_id].map(esc).join(","))].join("\n"));
  console.log(`wrote catalog/library.json and library.csv: ${rows.length} songs`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

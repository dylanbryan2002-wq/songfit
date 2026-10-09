/* Build the sounds catalog from every ground-truth batch (docs/review/18; ~/Songfit-groundtruth/README.md):
     pnpm local scripts/groundtruth/catalog.ts [--home <dir>]
   Reads batches/<batch>/clips.csv (song, artist, start, niche), fingerprint.json (score, deezer id) and gemini/<id>.md
   (the job the music did) and writes catalog/sounds.csv: one row per song, with how many clips used it. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { clipId, parseClipsCsv } from "./intake";
import type { ClipFingerprint } from "./fingerprint";

type Row = {
  song: string; artist: string; deezer_id: string | null; clips: number; batches: Set<string>; niches: Set<string>;
  roles: Set<string>; starts: number[]; scores: number[]; files: string[];
};

const key = (song: string, artist: string) => `${song.toLowerCase().trim()}|${artist.toLowerCase().trim()}`;
const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] : null);

async function geminiRole(batch: string, id: string): Promise<string | null> {
  const text = await fs.readFile(path.join(batch, "gemini", `${id}.md`), "utf8").catch(() => null);
  const json = text && /```json\s*([\s\S]*?)```/.exec(text)?.[1];
  if (!json) return null;
  try { return String((JSON.parse(json) as { music?: { role?: string } }).music?.role ?? "") || null; } catch { return null; }
}

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = (args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir());
  const batchesDir = path.join(home, "batches");
  const batches = (await fs.readdir(batchesDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const rows = new Map<string, Row>();
  let clipsSeen = 0;
  for (const name of batches) {
    const batch = path.join(batchesDir, name);
    const csv = await fs.readFile(path.join(batch, "clips.csv"), "utf8").catch(() => null);
    if (!csv) continue;
    const fps = await fs.readFile(path.join(batch, "fingerprint.json"), "utf8")
      .then((t) => new Map((JSON.parse(t) as ClipFingerprint[]).map((f) => [f.id, f])))
      .catch(() => new Map<string, ClipFingerprint>());
    for (const clip of parseClipsCsv(csv)) {
      clipsSeen += 1;
      if (!clip.song || !clip.artist) continue;
      const fp = fps.get(clipId(clip.file))?.best ?? null;
      const k = key(clip.song, clip.artist);
      const row = rows.get(k) ?? { song: clip.song, artist: clip.artist, deezer_id: null, clips: 0, batches: new Set(), niches: new Set(), roles: new Set(), starts: [], scores: [], files: [] };
      row.clips += 1;
      row.batches.add(name);
      if (clip.niche) row.niches.add(clip.niche);
      row.starts.push(clip.start_seconds);
      row.files.push(clip.file);
      if (fp && fp.deezer_id) row.deezer_id = fp.deezer_id;
      if (fp) row.scores.push(fp.score);
      const role = await geminiRole(batch, clipId(clip.file));
      if (role) row.roles.add(role);
      rows.set(k, row);
    }
  }
  const header = "song,artist,deezer_id,clips,niches,music_role,median_start_seconds,min_fingerprint_score,batches,files";
  const lines = [...rows.values()]
    .sort((a, b) => b.clips - a.clips || a.song.localeCompare(b.song))
    .map((r) => [
      r.song, r.artist, r.deezer_id ?? "", String(r.clips), [...r.niches].join("; "), [...r.roles].join("; "),
      String(median(r.starts) ?? ""), r.scores.length ? String(Math.min(...r.scores)) : "", [...r.batches].join("; "), r.files.join("; "),
    ].map(esc).join(","));
  await fs.mkdir(path.join(home, "catalog"), { recursive: true });
  const out = path.join(home, "catalog", "sounds.csv");
  await fs.writeFile(out, `${header}\n${lines.join("\n")}\n`);
  console.log(`${rows.size} sounds from ${clipsSeen} clips in ${batches.length} batch(es) → ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

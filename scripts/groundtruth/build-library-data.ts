/* Library → engine data file (docs/review/27 follow-up).
     pnpm local scripts/groundtruth/build-library-data.ts [--home ~/Songfit-groundtruth]
   Reads catalog/library.json and writes src/engine/catalog/library.data.json with the songs the tagger was confident about
   (not low confidence, familiarity known), in a compact shape the matcher reads. Song identity and samples come from
   Deezer; release years from MusicBrainz where matched (CC0). Non-commercial use only (Dylan, 2026-10-09). */
import "./assert-tree";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { LibrarySong } from "./library";
import { eraBand } from "./library-map";

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const lib = JSON.parse(await fs.readFile(path.join(home, "catalog", "library.json"), "utf8")) as LibrarySong[];
  const rows = lib
    .filter((s) => s.has_sample && s.tags && s.tags.confidence !== "low" && s.tags.familiarity !== "unknown" && s.tags.jobs.length)
    .map((s) => ({
      id: s.deezer_id, title: s.title, artist: s.artist,
      jobs: s.tags!.jobs, energy: s.tags!.energy, era: eraBand(s.first_release ?? s.release_date),
      year: Number((s.first_release ?? s.release_date ?? "").slice(0, 4)) || null,
      fam: s.tags!.familiarity, vocals: s.tags!.lead_vocals, rank: s.rank ?? 0, mood: s.tags!.mood, hook: s.tags!.hook,
      proven: s.sources.includes("creator_used") || s.sources.includes("creator_list"),
    }));
  const out = path.resolve(__dirname, "../../src/engine/catalog/library.data.json");
  await fs.writeFile(out, JSON.stringify(rows));
  console.log(`wrote ${out}: ${rows.length} songs of ${lib.length}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

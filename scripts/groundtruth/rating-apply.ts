/* Reads Dylan's answers back from reports/rating-sheet-<tag>.csv (rating-sheet.ts) into work/<id>/rating.<tag>.json.
     pnpm local scripts/groundtruth/rating-apply.ts --root <batch> --tag <tag> [--csv <file>]
   Rows with a blank rating are skipped; a clip gets a file once at least one of its picks is rated. The report then shows
   "Dylan rated X of N good" per clip. Rerunning overwrites the files from the CSV, which stays the source of truth. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { splitCsv } from "./intake";

export type RatedPick = { rank: number; title: string; artist: string; start: number; end: number; rating: "good" | "no" };
export type Rating = { tag: string; picks: RatedPick[] };

const GOOD = new Set(["good", "g", "yes", "y"]);
const NO = new Set(["no", "n"]);

/** Rated picks per clip id. Accepts good/g/yes/y and no/n in any case; blanks are left out. */
export function parseRatingCsv(text: string): Map<string, RatedPick[]> {
  const [header, ...rows] = splitCsv(text.replace(/^﻿/, ""));
  const col = new Map((header ?? []).map((h, i) => [h.trim().toLowerCase(), i]));
  for (const name of ["clip_id", "rank", "title", "artist", "start", "end", "rating"]) {
    if (!col.has(name)) throw new Error(`rating csv header is missing the "${name}" column`);
  }
  const out = new Map<string, RatedPick[]>();
  rows.forEach((fields, i) => {
    const get = (name: string) => (fields[col.get(name)!] ?? "").trim();
    const raw = get("rating").toLowerCase();
    if (raw === "") return;
    const rating = GOOD.has(raw) ? "good" : NO.has(raw) ? "no" : null;
    if (!rating) throw new Error(`rating csv row ${i + 2}: rating must be good or no, got "${get("rating")}"`);
    const id = get("clip_id");
    out.set(id, [...(out.get(id) ?? []), { rank: Number(get("rank")), title: get("title"), artist: get("artist"), start: Number(get("start")), end: Number(get("end")), rating }]);
  });
  return out;
}

async function main() {
  const { values: args } = parseArgs({ options: { root: { type: "string" }, tag: { type: "string" }, csv: { type: "string" } } });
  if (!args.root || !args.tag) { console.error("usage: pnpm local scripts/groundtruth/rating-apply.ts --root <batch> --tag <tag> [--csv <file>]"); process.exit(1); }
  const root = path.resolve(args.root.replace(/^~(?=$|\/)/, os.homedir()));
  const file = args.csv ? path.resolve(args.csv) : path.join(root, "reports", `rating-sheet-${args.tag}.csv`);
  const byClip = parseRatingCsv(await fs.readFile(file, "utf8"));
  let good = 0, total = 0;
  for (const [id, picks] of byClip) {
    const rating: Rating = { tag: args.tag, picks };
    await fs.mkdir(path.join(root, "work", id), { recursive: true });
    await fs.writeFile(path.join(root, "work", id, `rating.${args.tag}.json`), JSON.stringify(rating, null, 2));
    good += picks.filter((p) => p.rating === "good").length;
    total += picks.length;
    console.log(`${id}: ${picks.filter((p) => p.rating === "good").length} of ${picks.length} good`);
  }
  console.log(`\n${byClip.size} clips rated: ${good} of ${total} picks good`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

/* Blind rating sheet for Dylan: pnpm local scripts/groundtruth/rating-sheet.ts --root <batch> --tag <tag> [--n 10] [--out <file>]
   For N clips (song-carries-the-edit clips first: Gemini role amplify or punchline, then narration, then the rest) writes
   a markdown sheet with the clip's summary, its key moment and our top 5 picks, each with a "Rating: [ ] good [ ] no" line,
   plus reports/rating-sheet-<tag>.csv to type the answers into (rating-apply.ts reads it back). The real song is never shown. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Truth } from "./compare";
import { readGeminiReply, type GeminiAnalysis } from "./gemini";
import { parseClipsCsv } from "./intake";
import type { OursResult } from "./ours";

export type SheetClip = {
  id: string;
  truth: Truth | null; // carried so the test can prove it is never printed
  ours: OursResult;
  gemini: GeminiAnalysis | null;
};

const PICKS = 5;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

const priority = (c: SheetClip) => (c.gemini?.music.role === "amplify" || c.gemini?.music.role === "punchline" ? 0 : c.gemini?.music.role === "narration" ? 1 : 2);

/** The first N clips by role priority; clips.csv order inside each group. */
export function orderForSheet(clips: SheetClip[], n: number): SheetClip[] {
  return clips.map((c, i) => ({ c, i })).sort((a, b) => priority(a.c) - priority(b.c) || a.i - b.i).slice(0, n).map((x) => x.c);
}

export function renderSheet(clips: SheetClip[], tag: string): { markdown: string; csv: string } {
  const md: string[] = [`# Rating sheet — ${tag}`, "", "For each pick: would this song work on this video? Tick good or no. The real song is not shown.", ""];
  const csv: string[] = ["clip_id,rank,title,artist,start,end,rating"];
  clips.forEach((c, i) => {
    const moment = c.gemini?.key_moments[0] ?? c.ours.analysis.important_moments[0];
    md.push(`## ${i + 1}. ${c.id}`, "", c.gemini?.summary ?? c.ours.analysis.summary);
    if (moment) md.push(`Key moment: ${moment.time}s ${moment.type}${moment.note ? ` — ${moment.note}` : ""}`);
    md.push("");
    for (const f of [...c.ours.finals].sort((a, b) => a.rank - b.rank).slice(0, PICKS)) {
      md.push(`${f.rank}. ${f.canonical_title} — ${f.canonical_artist} · ${mmss(f.start_seconds)}–${mmss(f.end_seconds)}`, `   ${f.explanation}`, "   Rating: [ ] good  [ ] no  — ", "");
      csv.push([c.id, f.rank, f.canonical_title, f.canonical_artist, f.start_seconds, f.end_seconds, ""].map((v) => esc(String(v))).join(","));
    }
  });
  return { markdown: `${md.join("\n")}\n`, csv: `${csv.join("\n")}\n` };
}

async function main() {
  const { values: args } = parseArgs({
    options: { root: { type: "string" }, tag: { type: "string" }, n: { type: "string", default: "10" }, out: { type: "string" } },
  });
  if (!args.root || !args.tag) { console.error("usage: pnpm local scripts/groundtruth/rating-sheet.ts --root <batch> --tag <tag> [--n 10] [--out <file>]"); process.exit(1); }
  const root = path.resolve(args.root.replace(/^~(?=$|\/)/, os.homedir()));
  const clips: SheetClip[] = [];
  for (const clip of parseClipsCsv(await fs.readFile(path.join(root, "clips.csv"), "utf8"))) {
    const ours = await fs.readFile(path.join(root, "work", clip.id, `ours.${args.tag}.json`), "utf8").then((t) => JSON.parse(t) as OursResult).catch(() => null);
    if (!ours || ours.finals.length === 0) continue;
    const truth = clip.song && clip.artist ? { song: clip.song, artist: clip.artist, start_seconds: clip.start_seconds } : null;
    clips.push({ id: clip.id, truth, ours, gemini: (await readGeminiReply(root, clip.id))?.parsed ?? null });
  }
  const picked = orderForSheet(clips, Number(args.n));
  const { markdown, csv } = renderSheet(picked, args.tag);
  await fs.mkdir(path.join(root, "reports"), { recursive: true });
  const mdFile = args.out ? path.resolve(args.out) : path.join(root, "reports", `rating-sheet-${args.tag}.md`);
  const csvFile = path.join(root, "reports", `rating-sheet-${args.tag}.csv`);
  await fs.writeFile(mdFile, markdown);
  await fs.writeFile(csvFile, csv);
  console.log(`${picked.length} clips (of ${clips.length} with a run): wrote ${mdFile} and ${csvFile}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

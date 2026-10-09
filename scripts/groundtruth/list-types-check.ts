/* Precision check for listTypesFor against blind hand labels (docs/review/24, v3 §5).
     pnpm local scripts/groundtruth/list-types-check.ts [--labels ~/Songfit-groundtruth/catalog/list-type-labels.json] [--tag round2]
   Labels: { clips: [{ batch, id, types: ListType[] }] }, written from summaries before any rule existed.
   Prints per type: predicted positives, true positives, precision, labelled positives, recall; and every disagreement.
   In-sample: the rules were written after seeing these clips' fields, so precision here is optimistic. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { listTypesFor } from "../../src/engine/catalog/listTypes";
import type { ListType } from "../../src/engine/catalog/creatorLists";
import type { OursResult } from "./ours";

const ALL: ListType[] = ["educational", "storytelling", "emotional", "motivational", "sad", "upbeat", "funny", "day_in_life"];

export type TypeStats = { type: ListType; predicted: number; truePositive: number; labelled: number; precision: number | null; recall: number | null };

export function typeStats(rows: { predicted: ListType[]; labelled: ListType[] }[]): TypeStats[] {
  return ALL.map((type) => {
    const predicted = rows.filter((r) => r.predicted.includes(type)).length;
    const labelled = rows.filter((r) => r.labelled.includes(type)).length;
    const truePositive = rows.filter((r) => r.predicted.includes(type) && r.labelled.includes(type)).length;
    return { type, predicted, truePositive, labelled, precision: predicted ? truePositive / predicted : null, recall: labelled ? truePositive / labelled : null };
  });
}

async function main() {
  const { values: args } = parseArgs({ options: { labels: { type: "string" }, tag: { type: "string", default: "round2" } } });
  const home = os.homedir();
  const labelsPath = (args.labels ?? "~/Songfit-groundtruth/catalog/list-type-labels.json").replace(/^~(?=$|\/)/, home);
  const { clips } = JSON.parse(await fs.readFile(labelsPath, "utf8")) as { clips: { batch: string; id: string; types: ListType[] }[] };
  const rows: { id: string; predicted: ListType[]; labelled: ListType[] }[] = [];
  for (const c of clips) {
    const work = path.join(home, "Songfit-groundtruth", "batches", c.batch, "work", c.id);
    const file = await fs.access(path.join(work, `ours.${args.tag}.json`)).then(() => `ours.${args.tag}.json`, () => "ours.round1.json");
    const run = JSON.parse(await fs.readFile(path.join(work, file), "utf8")) as OursResult;
    rows.push({ id: c.id, predicted: listTypesFor(run.analysis, run.brief), labelled: c.types });
  }
  const pct = (x: number | null) => (x == null ? "-" : `${Math.round(x * 100)}%`);
  console.log("type | predicted | true pos | precision | labelled | recall");
  for (const s of typeStats(rows)) console.log(`${s.type} | ${s.predicted} | ${s.truePositive} | ${pct(s.precision)} | ${s.labelled} | ${pct(s.recall)}`);
  console.log("\ndisagreements:");
  for (const r of rows) {
    const extra = r.predicted.filter((t) => !r.labelled.includes(t));
    const missed = r.labelled.filter((t) => !r.predicted.includes(t));
    if (extra.length || missed.length) console.log(`${r.id}: rule added [${extra.join(", ")}], rule missed [${missed.join(", ")}]`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

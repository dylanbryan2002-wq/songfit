/* Tune / test split of a batch: pnpm local scripts/groundtruth/split.ts --root <batch>
   Adds a "split" column at the end of clips.csv (about one third "test", chosen by sha1 of the clip id so the
   assignment never changes), keeping every other byte of the file as it is. Rows that already have a split keep it.
   The previous clips.csv is copied to <root>/history/ first. The report shows the test rows as the headline. */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { clipId, splitCsv } from "./intake";

export type Split = "tune" | "test";

/** sha1 of the id, first 8 hex digits as a number, one third of the range → "test". Stable across runs and machines. */
export function splitFor(id: string): Split {
  const n = parseInt(createHash("sha1").update(id).digest("hex").slice(0, 8), 16);
  return n % 3 === 0 ? "test" : "tune";
}

/** The raw text of each CSV record and its line ending, quotes respected, nothing re-encoded. */
function rawRecords(text: string): { body: string; eol: string }[] {
  const out: { body: string; eol: string }[] = [];
  let body = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    if (!quoted && (ch === "\n" || ch === "\r")) {
      const eol = ch === "\r" && text[i + 1] === "\n" ? "\r\n" : ch;
      out.push({ body, eol }); body = ""; i += eol.length - 1;
    } else body += ch;
  }
  if (body !== "") out.push({ body, eol: "" });
  return out;
}

/** clips.csv text with every row assigned; existing assignments and all other columns are untouched. */
export function assignSplits(csv: string): string {
  const records = rawRecords(csv);
  const header = records[0];
  if (!header) throw new Error("clips.csv is empty; the header row is required");
  const names = splitCsv(header.body)[0]!.map((h) => h.trim().toLowerCase());
  const at = names.indexOf("split");
  if (at >= 0 && at !== names.length - 1) throw new Error('the "split" column must be the last column of clips.csv');
  const width = at >= 0 ? names.length : names.length + 1;
  if (at < 0) header.body += ",split";
  const fileAt = names.indexOf("file");
  if (fileAt < 0) throw new Error('clips.csv header is missing the "file" column');

  for (const rec of records.slice(1)) {
    if (rec.body.trim() === "") continue;
    const fields = splitCsv(rec.body)[0] ?? [];
    if (fields.length >= width && (fields[width - 1] ?? "").trim() !== "") continue; // already assigned
    // A blank split cell already ends the row with its comma; a short row (trailing empty cells left out) is padded.
    rec.body += ",".repeat(Math.max(0, width - fields.length)) + splitFor(clipId((fields[fileAt] ?? "").trim()));
  }
  return records.map((r) => r.body + r.eol).join("");
}

async function main() {
  const { values: args } = parseArgs({ options: { root: { type: "string" } } });
  if (!args.root) { console.error("usage: pnpm local scripts/groundtruth/split.ts --root <batch>"); process.exit(1); }
  const root = path.resolve(args.root.replace(/^~(?=$|\/)/, os.homedir()));
  const file = path.join(root, "clips.csv");
  const before = await fs.readFile(file, "utf8");
  const after = assignSplits(before);
  if (after === before) { console.log("every row already has a split; nothing to write"); return; }
  await fs.mkdir(path.join(root, "history"), { recursive: true });
  await fs.copyFile(file, path.join(root, "history", `clips.before-split-${Date.now()}.csv`));
  await fs.writeFile(file, after);
  const rows = splitCsv(after).slice(1).map((r) => r[r.length - 1]);
  console.log(`clips.csv updated (backup in history/): ${rows.filter((s) => s === "test").length} test, ${rows.filter((s) => s === "tune").length} tune`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

/** Minimal CSV reader for the quoted files the ground-truth scripts write. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n").filter(Boolean)) {
    const cells: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q && ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = !q;
      else if (ch === "," && !q) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

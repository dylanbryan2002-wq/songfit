/* Creator evidence (Dylan, 2026-10-11): which content types creators actually recommend each song for.
     node --import tsx scripts/groundtruth/creator-evidence.ts [--home ~/Songfit-groundtruth]
   Reads creator-lists/*.md (headings = the creator's category, "**Title – Artist.**" = a pick), maps each category to
   one of the 15 content types, matches picks to library songs by title (+ artist when given), and adds
   creator_uses: [{ type, creator_label, source }] to catalog/song-labels.json. Unmatched picks go to creator-unmatched.csv. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

/** Creator's own category wording -> Songfit content type (null = no type, kept as label only). */
export function contentType(label: string): string | null {
  const l = label.toLowerCase();
  if (/sad/.test(l)) return "Sad storytelling";
  if (/upbeat|positive|quirky|funny/.test(l)) return "Funny/Upbeat";
  if (/educat|tactical|informational/.test(l)) return "Educational";
  if (/day in the life|vlog/.test(l)) return "Vlog";
  if (/challenge/.test(l)) return "Challenge";
  if (/deep/.test(l)) return "Deep";
  if (/inspir/.test(l)) return "Inspirational storytelling";
  if (/motivat|energetic/.test(l)) return "Motivational";
  if (/text reel|cinematic/.test(l)) return "Aesthetic/Montage";
  if (/emotional|sentimental|story/.test(l)) return "Storytelling";
  return null;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function parsePicks(md: string) {
  const picks: { label: string; title: string; artist: string | null }[] = [];
  let label = "";
  for (const line of md.split("\n")) {
    const h = line.match(/^##\s+(?:\d+\.\s*)?(.+?)\s*(?:\(".*"\))?\s*$/);
    if (h) { label = h[1]!; continue; }
    const m = line.match(/^(?:-\s+)?\*\*(.+?)\*\*/) ?? line.match(/^([^#*\s-][^*]*?\s[–-]\s.+)$/); // bold pick, or a plain "Title - Artist" line
    if (!m || !label) continue;
    const [title, artist] = m[1]!.replace(/[.]$/, "").split(/\s+[–-]\s+/);
    picks.push({ label, title: title!.trim(), artist: artist && !/not confirmed/i.test(artist) ? artist.trim() : null });
  }
  return picks;
}

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const labelsPath = path.join(home, "catalog", "song-labels.json");
  const rows = JSON.parse(await fs.readFile(labelsPath, "utf8")) as { title: string; artist: string; creator_uses?: unknown[] }[];
  const byTitle = new Map<string, typeof rows>();
  for (const r of rows) { r.creator_uses = []; const k = norm(r.title); byTitle.set(k, [...(byTitle.get(k) ?? []), r]); }
  const dir = path.join(home, "creator-lists");
  const unmatched: string[][] = [];
  let matched = 0, total = 0;
  for (const file of (await fs.readdir(dir)).filter((f) => f.endsWith(".md"))) {
    for (const p of parsePicks(await fs.readFile(path.join(dir, file), "utf8"))) {
      total++;
      const cands = byTitle.get(norm(p.title)) ?? [];
      const a = p.artist ? norm(p.artist).split(" ")[0]! : "";
      const hit = cands.find((r) => a && norm(r.artist).includes(a)) ?? (cands.length === 1 ? cands[0] : undefined);
      if (!hit) { unmatched.push([p.title, p.artist ?? "", p.label, file]); continue; }
      matched++;
      hit.creator_uses!.push({ type: contentType(p.label), creator_label: p.label, source: file });
    }
  }
  await fs.writeFile(labelsPath, JSON.stringify(rows));
  const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  await fs.writeFile(path.join(home, "catalog", "creator-unmatched.csv"),
    ["title,artist,creator_label,source", ...unmatched.map((u) => u.map(csv).join(","))].join("\n") + "\n");
  const songs = rows.filter((r) => r.creator_uses!.length).length;
  console.log(`picks: ${total}; matched to library: ${matched} (${songs} songs); unmatched: ${unmatched.length}`);
}

if (process.argv[1]?.endsWith("creator-evidence.ts")) main().catch((e) => { console.error(e); process.exit(1); });

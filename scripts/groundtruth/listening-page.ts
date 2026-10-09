/* Blind listening page (docs/review/27 v2): for each clip, the original video plays muted with each candidate's Deezer sample,
   two top-3 lists labelled A and B in shuffled order. Dylan picks A / B / both / neither. LOCAL ONLY: the videos are other
   creators' content and the page references them by file path, so it is never published.
     pnpm local scripts/groundtruth/listening-page.ts --root <batch>[,<batch>] --a <tag> --b <tag> --only <id,id,...> [--out <dir>]
   Writes <out>/listening.html (default ~/Songfit-groundtruth/listening/) and <out>/key.json (which arm is A, per clip).
   Deezer sample links expire after about an hour: build the page right before listening.
   The sample is Deezer's 30 s preview, which may not be the recommended section: this is a sample-level audition. */
import "./assert-tree";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { getDeezerTrack } from "../../src/engine/catalog/deezer";
import { parseClipsCsv } from "./intake";
import type { OursResult } from "./ours";

type Pick = { title: string; artist: string; start: number; end: number; preview: string | null };
type Item = { n: number; video: string; summary: string; A: Pick[]; B: Pick[] };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const mmss = (s: number) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

async function top3(run: OursResult | null): Promise<Pick[] | null> {
  if (!run || run.recommend_error || !run.finals.length) return null;
  const out: Pick[] = [];
  for (const f of [...run.finals].sort((a, b) => a.rank - b.rank).slice(0, 3)) {
    const t = f.deezer_id ? await getDeezerTrack(f.deezer_id).catch(() => ({ kind: "none" as const })) : { kind: "none" as const };
    out.push({ title: f.canonical_title, artist: f.canonical_artist, start: f.start_seconds, end: f.end_seconds, preview: t.kind === "ok" ? t.previewUrl : null });
  }
  return out;
}

export function renderPage(items: Item[]): string {
  const list = (label: string, picks: Pick[], n: number) => `<div class="list"><h3>List ${label}</h3>${picks.map((p, i) => `
    <div class="pick"><span>${esc(p.title)} — ${esc(p.artist)} <small>(we'd use ${mmss(p.start)}–${mmss(p.end)})</small></span>
    ${p.preview ? `<button type="button" data-n="${n}" data-src="${esc(p.preview)}" id="p${n}${label}${i}">▶ play with video</button>` : "<em>no sample</em>"}</div>`).join("")}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Songfit Listening Test</title><style>
body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:16px;background:#f6f4ef;color:#1c1a16}
.clip{background:#fffdf8;border:1px solid #e3dfd5;border-radius:10px;padding:14px;margin:16px 0}
video{width:220px;max-width:100%;border-radius:8px;float:right;margin-left:12px}
.list{margin:10px 0}.pick{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:4px 0;border-top:1px solid #eee}
button{font:inherit;padding:6px 10px;border-radius:8px;border:1px solid #ccc;background:#fff;cursor:pointer}
.choice button.on{background:#1f6f5f;color:#fff;border-color:#1f6f5f}.note{color:#6b645a;font-size:.9rem}
</style></head><body>
<h1>Songfit listening test</h1>
<p class="note">For each video, play the songs over it and pick the list that feels closer to what this video needs. A and B are shuffled
for every video. The sample is Deezer's 30-second preview, which may not be the exact section we'd use. When done, press Copy answers
and paste them to Claude.</p>
${items.map((it) => `<section class="clip"><h2>Video ${it.n}</h2><video id="v${it.n}" src="${esc(pathToFileURL(it.video).href)}" muted playsinline controls></video>
<p class="note">${esc(it.summary)}</p>${list("A", it.A, it.n)}${list("B", it.B, it.n)}
<div class="choice" data-n="${it.n}">Closer: ${["A", "B", "both", "neither"].map((c) => `<button type="button" data-c="${c}" id="c${it.n}${c}">${c}</button>`).join(" ")}</div>
<div style="clear:both"></div></section>`).join("")}
<button type="button" id="copy">Copy answers</button><textarea id="out" rows="6" style="width:100%" readonly></textarea>
<audio id="a"></audio>
<script>
const ans={};try{Object.assign(ans,JSON.parse(localStorage.getItem("songfit-listen")||"{}"))}catch{}
const audio=document.getElementById("a");
function paint(){document.querySelectorAll(".choice").forEach(d=>d.querySelectorAll("button").forEach(b=>b.classList.toggle("on",ans[d.dataset.n]===b.dataset.c)))}
document.addEventListener("click",e=>{const p=e.target.closest("button[data-src]");if(p){const v=document.getElementById("v"+p.dataset.n);
 document.querySelectorAll("video").forEach(x=>x.pause());v.currentTime=0;audio.src=p.dataset.src;audio.currentTime=0;v.play();audio.play();return}
 const c=e.target.closest(".choice button");if(c){ans[c.parentElement.dataset.n]=c.dataset.c;try{localStorage.setItem("songfit-listen",JSON.stringify(ans))}catch{};paint()}});
document.getElementById("copy").addEventListener("click",()=>{const t=Object.keys(ans).sort((a,b)=>a-b).map(k=>"video "+k+": "+ans[k]).join("\\n");
 const o=document.getElementById("out");o.value=t;o.select();try{navigator.clipboard.writeText(t)}catch{}});
paint();
</script></body></html>`;
}

async function main() {
  const { values: args } = parseArgs({ options: { root: { type: "string" }, a: { type: "string" }, b: { type: "string" }, only: { type: "string" }, out: { type: "string" } } });
  if (!args.root || !args.a || !args.b || !args.only) { console.error("usage: listening-page.ts --root <batch>[,<batch>] --a <tag> --b <tag> --only <id,...>"); process.exit(1); }
  const ids = new Set(args.only.split(","));
  const out = path.resolve((args.out ?? "~/Songfit-groundtruth/listening").replace(/^~(?=$|\/)/, os.homedir()));
  const items: Item[] = [];
  const key: Record<string, { clip: string; A: string; B: string }> = {};
  for (const r of args.root.split(",")) {
    const root = path.resolve(r.replace(/^~(?=$|\/)/, os.homedir()));
    for (const clip of parseClipsCsv(await fs.readFile(path.join(root, "clips.csv"), "utf8")).filter((c) => ids.has(c.id))) {
      const read = (tag: string) => fs.readFile(path.join(root, "work", clip.id, `ours.${tag}.json`), "utf8").then((t) => JSON.parse(t) as OursResult).catch(() => null);
      const runA = await read(args.a), runB = await read(args.b);
      const [pa, pb] = [await top3(runA), await top3(runB)];
      if (!pa || !pb) { console.log(`${clip.id}: missing a run in one arm, left out of the page (counted separately)`); continue; }
      const swap = Math.random() < 0.5;
      const n = items.length + 1;
      items.push({ n, video: path.join(root, "videos", clip.file), summary: (runA ?? runB)!.analysis.summary, A: swap ? pb : pa, B: swap ? pa : pb });
      key[String(n)] = { clip: clip.id, A: swap ? args.b : args.a, B: swap ? args.a : args.b };
    }
  }
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, "listening.html"), renderPage(items));
  await fs.writeFile(path.join(out, "key.json"), JSON.stringify(key, null, 2));
  console.log(`wrote ${path.join(out, "listening.html")} with ${items.length} videos; key in key.json (do not open before listening)`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

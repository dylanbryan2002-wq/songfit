/* Ground-truth eval (docs/review/18): viral clips with a known song vs our engine, Gemini (pasted from the app) as a second watcher.
   pnpm local scripts/groundtruth/run.ts --tag <t> [--only <id>] [--root <dir>] [--force] [--skip-gemini] [--skip-ours] [--dry-run]
   Reads <root>/clips.csv, <root>/videos/<file> and <root>/gemini/<id>.md (Dylan's pasted Gemini replies);
   writes <root>/work/<id>/ (muted copy, cached engine JSON per tag) and <root>/reports/<date>-<tag>.{md,json}.
   --dry-run: offline, test fixtures, temp root. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { LIMITS } from "../../src/shared/config";
import { muteVideo, parseClipsCsv, probeDuration, type ClipSpec } from "./intake";
import { runOurs, type OursResult } from "./ours";
import { PROMPT_VERSION as GEMINI_PROMPT_VERSION, readGeminiReply } from "./gemini";
import { briefDiff, compareClip } from "./compare";
import { buildReport, summaryTable, type ClipReport } from "./report";

const { values: args } = parseArgs({
  options: {
    tag: { type: "string" },
    only: { type: "string" },
    root: { type: "string", default: "~/Songfit-groundtruth" },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    "skip-gemini": { type: "boolean", default: false },
    "skip-ours": { type: "boolean", default: false },
  },
});

type RunOurs = (mutedPath: string, durationSeconds: number, deadlineMs: number) => Promise<OursResult>;

const FIXTURES = path.resolve("tests/groundtruth/fixtures");

const readJson = async <T>(file: string): Promise<T> => JSON.parse(await fs.readFile(file, "utf8")) as T;
const exists = (file: string) => fs.access(file).then(() => true, () => false);

/** Temp root with the fixture clip under two names (real song in the fixture finals / not generated) and one pasted Gemini reply. */
async function makeDryRunRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "groundtruth-dry-run-"));
  await fs.mkdir(path.join(root, "videos"), { recursive: true });
  await fs.mkdir(path.join(root, "gemini"), { recursive: true });
  for (const name of ["hit.mp4", "miss.mp4"]) await fs.copyFile(path.join(FIXTURES, "clip.mp4"), path.join(root, "videos", name));
  await fs.copyFile(path.join(FIXTURES, "gemini-reply.md"), path.join(root, "gemini", "hit.md"));
  await fs.writeFile(path.join(root, "clips.csv"), [
    "file,link,niche,song,artist,start_seconds,views,typical_views,notes",
    "hit.mp4,https://example.com/hit,fashion,Blinding Lights,The Weeknd,40,1000000,20000,fixture",
    'miss.mp4,,comedy,"Hey, Soul Sister",Train,12,500000,,"fixture, not generated"',
  ].join("\n"));
  return root;
}

const dryRunOurs: RunOurs = () => readJson(path.join(FIXTURES, "ours.json"));

async function runClip(clip: ClipSpec, root: string, tag: string, ours: RunOurs): Promise<ClipReport> {
  const report: ClipReport = {
    id: clip.id, file: clip.file, link: clip.link, niche: clip.niche, notes: clip.notes,
    truth: { song: clip.song, artist: clip.artist, start_seconds: clip.start_seconds },
    duration_seconds: null, verdict: null, ours: null, gemini: null, brief_diff: null, errors: [],
  };
  const fail = (stage: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ${stage}: FAILED ${message}`);
    report.errors.push(`${stage}: ${message}`);
    return null;
  };

  const video = path.join(root, "videos", clip.file);
  const work = path.join(root, "work", clip.id);
  await fs.mkdir(work, { recursive: true });
  const muted = path.join(work, "muted.mp4");
  if (args.force || !(await exists(muted))) await muteVideo(video, muted);
  const duration = await probeDuration(video);
  report.duration_seconds = duration;

  if (!args["skip-ours"]) {
    const file = path.join(work, `ours.${tag}.json`);
    try {
      if (!args.force && (await exists(file))) { console.log("  ours: cached"); report.ours = await readJson<OursResult>(file); }
      else {
        const t0 = Date.now();
        report.ours = await ours(muted, duration, LIMITS.pipelineBudgetMs);
        await fs.writeFile(file, JSON.stringify(report.ours, null, 2));
        console.log(`  ours: done in ${Math.round((Date.now() - t0) / 1000)} s`);
      }
    } catch (err) { fail("ours", err); }
  }
  if (!args["skip-gemini"]) {
    try {
      report.gemini = await readGeminiReply(root, clip.id);
      console.log(`  gemini: ${report.gemini ? "pasted reply parsed" : "no reply yet"}`);
    } catch (err) { fail("gemini", err); }
  }
  if (report.ours) {
    report.verdict = compareClip(report.truth, report.ours);
    if (report.gemini) report.brief_diff = briefDiff(report.ours, report.gemini.parsed);
  }
  return report;
}

async function main() {
  const dryRun = args["dry-run"];
  const tag = args.tag ?? (dryRun ? "dry-run" : null);
  if (!tag) { console.error("usage: pnpm local scripts/groundtruth/run.ts --tag <tag> [--only <id>] [--dry-run]"); process.exit(1); }
  const root = dryRun ? await makeDryRunRoot() : path.resolve(args.root.replace(/^~(?=$|\/)/, os.homedir()));

  const csv = await fs.readFile(path.join(root, "clips.csv"), "utf8").catch(() => { throw new Error(`no clips.csv in ${root}`); });
  let clips = parseClipsCsv(csv);
  if (args.only) clips = clips.filter((c) => c.id === args.only);
  if (clips.length === 0) throw new Error(args.only ? `no clip with id "${args.only}"` : "clips.csv has no rows");

  console.log(`${dryRun ? "DRY RUN " : ""}tag=${tag} root=${root} clips=${clips.length}`);
  const reports: ClipReport[] = [];
  for (const clip of clips) {
    console.log(`${clip.id}: ${clip.song} — ${clip.artist} @ ${clip.start_seconds}s`);
    reports.push(await runClip(clip, root, tag, dryRun ? dryRunOurs : runOurs));
  }

  const date = new Date().toISOString().slice(0, 10);
  const { json, markdown } = buildReport({ tag, date, gemini_prompt_version: GEMINI_PROMPT_VERSION }, reports);
  await fs.mkdir(path.join(root, "reports"), { recursive: true });
  const base = path.join(root, "reports", `${date}-${tag}`);
  await fs.writeFile(`${base}.md`, markdown);
  await fs.writeFile(`${base}.json`, JSON.stringify(json, null, 2));
  console.log(`\n${summaryTable(json.summary)}\n\nwrote ${base}.md and .json`);
}

main().catch((e) => { console.error(e); process.exit(1); });

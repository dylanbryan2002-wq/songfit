/* Study pass (docs/review/27 v3, Dylan 2026-10-09: "send it all of the Gemini analysis along with the songs").
   One model call reads every TUNE-split Reel with a known song: Gemini's write-up (made with sound), the fingerprinted
   song and start second, and our engine's top 3 for the same video. It writes:
     - a corrected lesson per Reel (flagging where Gemini's description contradicts what is known about the recording),
     - a short playbook of decision rules, each citing lesson numbers.
   Test-split Reels are never read. Output: ~/Songfit-groundtruth/catalog/study.json (+ study-raw.md).
     pnpm local scripts/groundtruth/study.ts [--home ~/Songfit-groundtruth] [--dry-run]
   --dry-run prints the prompt size and writes the prompt only. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { callClaude } from "../../src/shared/anthropic";
import { MODELS } from "../../src/shared/config";
import { extractJson } from "../../src/shared/json";
import { MusicJob } from "../../src/shared/types";
import { parseClipsCsv } from "./intake";
import type { OursResult } from "./ours";

export const STUDY_PROMPT_VERSION = "study-v1";

const SYSTEM = `You are a senior music supervisor teaching a recommendation engine how creators in one niche choose the song for
their short-form videos (Instagram Reels / TikTok; founders, students, people building something or moving somewhere new).
You get real Reels with the song the creator actually used (identified by audio fingerprint, so trust the song identity),
a description of the video and its music written by another model that watched it WITH sound (useful but sometimes wrong
about the music: genre, vocals, energy), and the top 3 songs our engine picked for the same video.

Your job is to extract what transfers to NEW videos: how the music's job is decided (quiet bed under speech, driving energy,
emotional lift, comic cue, familiar anthem), when a famous or obvious song is right, when contrast beats matching, how era,
title or lyric make a joke, and where our engine's picks change the emotion the creator created.
Use what you know about each recording to check the description. If the description contradicts the recording (for example
says "no vocals" for a song with lead vocals, or "electronic" for an orchestral piece), say so and teach from the recording,
not the description. Never invent facts about a recording you do not know; mark confidence low instead.
Reply with ONE JSON object only.`;

const Lesson = z.object({
  n: z.number().int(),
  job: MusicJob,
  video: z.string(), // one sentence, no names or handles
  song: z.string(), // "Title — Artist" as given
  what_music_does: z.string(), // moment by moment where known
  why_it_works: z.string(),
  lazy_wrong_pick: z.string(), // what a generic engine would pick and why it would flatten the video (use our engine's picks when they do)
  rule: z.string(), // the decision rule, reusable on a different video
  description_errors: z.array(z.string()), // contradictions between the description and the recording; [] if none
  confidence: z.enum(["high", "medium", "low"]),
});
const StudyOutput = z.object({
  lessons: z.array(Lesson),
  playbook: z.array(z.object({ rule: z.string(), examples: z.array(z.number().int()) })).min(5).max(20),
});
export type StudyOutput = z.infer<typeof StudyOutput>;

type Dossier = { n: number; clip: string; batch: string; song: string; start: number; gemini: unknown; ours_top3: string[] };

async function main() {
  const { values: args } = parseArgs({ options: { home: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  const home = path.resolve((args.home ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir()));
  const dossiers: Dossier[] = [];
  for (const batch of (await fs.readdir(path.join(home, "batches"))).sort()) {
    const root = path.join(home, "batches", batch);
    const csv = await fs.readFile(path.join(root, "clips.csv"), "utf8").catch(() => null);
    if (!csv) continue;
    for (const c of parseClipsCsv(csv)) {
      if (c.split !== "tune" || !c.song || !c.artist) continue; // never read test clips
      const md = await fs.readFile(path.join(root, "gemini", `${c.id}.md`), "utf8").catch(() => null);
      const json = md && /```json\s*([\s\S]*?)```/.exec(md)?.[1];
      if (!json) continue;
      let g: Record<string, unknown>;
      try { g = JSON.parse(json) as Record<string, unknown>; } catch { continue; }
      delete g.song; // Gemini's own song guess: the fingerprint is the identity
      let ours: OursResult | null = null;
      for (const tag of ["v7s5", "v7", "round2"]) {
        ours = await fs.readFile(path.join(root, "work", c.id, `ours.${tag}.json`), "utf8").then((t) => JSON.parse(t) as OursResult).catch(() => null);
        if (ours && !ours.recommend_error && ours.finals.length) break;
      }
      const top3 = ours ? [...ours.finals].sort((a, b) => a.rank - b.rank).slice(0, 3).map((f) => `${f.canonical_title} — ${f.canonical_artist}`) : [];
      dossiers.push({ n: dossiers.length + 1, clip: c.id, batch, song: `${c.song} — ${c.artist}`, start: c.start_seconds, gemini: g, ours_top3: top3 });
    }
  }
  const user = `REELS (${dossiers.length})\n` + dossiers.map((d) =>
    `#${d.n}\nCREATOR'S SONG: ${d.song} (starts ${d.start}s into the recording)\nDESCRIPTION WITH SOUND: ${JSON.stringify(d.gemini)}\nOUR ENGINE'S TOP 3: ${d.ours_top3.join(" | ") || "none"}`,
  ).join("\n\n") + `\n\nReturn {"lessons":[{"n","job","video","song","what_music_does","why_it_works","lazy_wrong_pick","rule","description_errors","confidence"} one per Reel, same n],` +
    ` "playbook":[{"rule","examples":[n,...]}] 8-15 rules ordered by how often they decide the pick}. job is one of ${MusicJob.options.join(", ")}.`;
  const out = path.join(home, "catalog");
  await fs.mkdir(out, { recursive: true });
  console.log(`${dossiers.length} tune Reels, prompt ≈ ${Math.round((SYSTEM.length + user.length) / 4)} tokens`);
  if (args["dry-run"]) { await fs.writeFile(path.join(out, "study-prompt.md"), `${SYSTEM}\n\n${user}`); return; }
  const text = await callClaude({ model: MODELS.study, system: SYSTEM, user, maxTokens: 32_000, effort: "high", timeoutMs: 600_000 });
  await fs.writeFile(path.join(out, "study-raw.md"), text);
  const parsed = StudyOutput.safeParse(extractJson(text));
  if (!parsed.success) throw new Error(`study output did not parse: ${parsed.error.message.slice(0, 500)} (raw in study-raw.md)`);
  if (parsed.data.lessons.length !== dossiers.length) throw new Error(`expected ${dossiers.length} lessons, got ${parsed.data.lessons.length}`);
  const withClips = { prompt_version: STUDY_PROMPT_VERSION, model: MODELS.study, lessons: parsed.data.lessons.map((l) => ({ ...l, clip: dossiers[l.n - 1]?.clip ?? null })), playbook: parsed.data.playbook };
  await fs.writeFile(path.join(out, "study.json"), JSON.stringify(withClips, null, 2));
  const flagged = parsed.data.lessons.filter((l) => l.description_errors.length || l.confidence === "low");
  console.log(`wrote study.json: ${parsed.data.lessons.length} lessons, ${parsed.data.playbook.length} rules, ${flagged.length} flagged for a human check`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

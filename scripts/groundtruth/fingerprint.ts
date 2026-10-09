/* Identify the song behind each ground-truth clip with ACRCloud (docs/review/18, terms read 2026-10-08):
     pnpm local scripts/groundtruth/fingerprint.ts [--root <dir>] [--only <id>] [--force] [--apply]
   Cuts two 12 s samples per clip (near the start, and mid-clip), sends each to ACRCloud, keeps the best match,
   writes <root>/fingerprint.json and, with --apply, fills song / artist / start_seconds in clips.csv for rows
   whose song is empty (rows that already have a song get the match appended to their notes as a cross-check).
   start_seconds = play_offset_ms / 1000 − the sample's offset into the clip. Needs ACRCLOUD_HOST, ACRCLOUD_ACCESS_KEY,
   ACRCLOUD_ACCESS_SECRET in the environment (entered by Dylan). */
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { clipId, parseClipsCsv, probeDuration, type ClipSpec } from "./intake";

const SAMPLE_SECONDS = 12;
const MIN_SCORE = 70; // ACRCloud's own floor; below it the API returns no match

export type Match = {
  title: string;
  artist: string;
  score: number;
  play_offset_ms: number;
  duration_ms: number | null;
  deezer_id: string | null;
  isrc: string | null;
  sample_offset_seconds: number;
  /** Where in the song the clip starts: play_offset − sample offset, floored at 0. */
  start_seconds: number;
};

export type ClipFingerprint = { id: string; file: string; best: Match | null; samples: { offset: number; match: Match | null; error?: string }[] };

/** ACRCloud "signature_version 1": HMAC-SHA1 over the fixed string, base64. */
export function sign(accessKey: string, secret: string, timestamp: number): string {
  const text = ["POST", "/v1/identify", accessKey, "audio", "1", String(timestamp)].join("\n");
  return createHmac("sha1", secret).update(text).digest("base64");
}

export function startSeconds(playOffsetMs: number, sampleOffsetSeconds: number): number {
  return Math.max(0, Math.round((playOffsetMs / 1000 - sampleOffsetSeconds) * 10) / 10);
}

/** The best music match in an ACRCloud identify response, or null (status.code 1001 = no result). */
export function parseIdentify(body: unknown, sampleOffsetSeconds: number): Match | null {
  const r = body as { status?: { code?: number; msg?: string }; metadata?: { music?: Record<string, unknown>[] } };
  if (r.status?.code === 1001) return null;
  if (r.status?.code !== 0) throw new Error(`ACRCloud error ${r.status?.code}: ${r.status?.msg}`);
  const list = r.metadata?.music ?? [];
  const best = list
    .map((m) => ({
      title: String(m.title ?? ""),
      artist: ((m.artists as { name?: string }[] | undefined) ?? []).map((a) => a.name ?? "").filter(Boolean).join(", "),
      score: Number(m.score ?? 0),
      play_offset_ms: Number(m.play_offset_ms ?? 0),
      duration_ms: m.duration_ms == null ? null : Number(m.duration_ms),
      deezer_id: ((m.external_metadata as { deezer?: { track?: { id?: unknown } } } | undefined)?.deezer?.track?.id ?? null) as string | null,
      isrc: ((m.external_ids as { isrc?: string } | undefined)?.isrc ?? null),
      sample_offset_seconds: sampleOffsetSeconds,
      start_seconds: startSeconds(Number(m.play_offset_ms ?? 0), sampleOffsetSeconds),
    }))
    .filter((m) => m.title && m.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)[0];
  return best ? { ...best, deezer_id: best.deezer_id == null ? null : String(best.deezer_id) } : null;
}

const run = promisify(execFile);

async function cutSample(video: string, offset: number, out: string): Promise<void> {
  if (!ffmpegPath) throw new Error("ffmpeg binary not found (ffmpeg-static)");
  // Mono 8 kHz wav keeps a 12 s sample under 200 KB; ACRCloud fingerprints fine at this rate.
  await run(ffmpegPath, ["-v", "error", "-y", "-ss", String(offset), "-t", String(SAMPLE_SECONDS), "-i", video, "-vn", "-ac", "1", "-ar", "8000", "-f", "wav", out]);
}

async function identify(sample: string, offset: number): Promise<Match | null> {
  const host = process.env.ACRCLOUD_HOST;
  const key = process.env.ACRCLOUD_ACCESS_KEY;
  const secret = process.env.ACRCLOUD_ACCESS_SECRET;
  if (!host || !key || !secret) throw new Error("ACRCLOUD_HOST, ACRCLOUD_ACCESS_KEY and ACRCLOUD_ACCESS_SECRET must be set (Dylan enters them)");
  const bytes = await fs.readFile(sample);
  const timestamp = Math.floor(Date.now() / 1000);
  const form = new FormData();
  form.append("sample", new Blob([bytes], { type: "audio/wav" }), "sample.wav");
  form.append("sample_bytes", String(bytes.length));
  form.append("access_key", key);
  form.append("data_type", "audio");
  form.append("signature_version", "1");
  form.append("signature", sign(key, secret, timestamp));
  form.append("timestamp", String(timestamp));
  const res = await fetch(`https://${host}/v1/identify`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`ACRCloud HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return parseIdentify(await res.json(), offset);
}

async function fingerprintClip(clip: ClipSpec, root: string, force: boolean): Promise<ClipFingerprint> {
  const video = path.join(root, "videos", clip.file);
  const work = path.join(root, "work", clip.id);
  await fs.mkdir(work, { recursive: true });
  const cached = path.join(work, "fingerprint.json");
  if (!force) {
    const prior = await fs.readFile(cached, "utf8").then((t) => JSON.parse(t) as ClipFingerprint).catch(() => null);
    if (prior) { console.log(`${clip.id}: cached ${prior.best ? `${prior.best.title} — ${prior.best.artist} (${prior.best.score})` : "no match"}`); return prior; }
  }
  const duration = await probeDuration(video);
  const offsets = duration <= SAMPLE_SECONDS + 2 ? [0] : [1, Math.max(1, duration / 2 - SAMPLE_SECONDS / 2)];
  const samples: ClipFingerprint["samples"] = [];
  for (const offset of offsets) {
    const out = path.join(work, `sample-${Math.round(offset)}.wav`);
    try {
      await cutSample(video, offset, out);
      samples.push({ offset, match: await identify(out, offset) });
    } catch (err) {
      samples.push({ offset, match: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const best = samples.flatMap((s) => (s.match ? [s.match] : [])).sort((a, b) => b.score - a.score)[0] ?? null;
  const result: ClipFingerprint = { id: clip.id, file: clip.file, best, samples };
  await fs.writeFile(cached, JSON.stringify(result, null, 2));
  console.log(`${clip.id}: ${best ? `${best.title} — ${best.artist} (score ${best.score}, starts ${best.start_seconds} s)` : "no match"}${samples.some((s) => s.error) ? ` [errors: ${samples.filter((s) => s.error).map((s) => s.error).join("; ")}]` : ""}`);
  return result;
}

const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Fills empty song rows from the matches; known songs get the match in notes as a cross-check. */
export function applyToCsv(csv: string, results: Map<string, ClipFingerprint>): string {
  const rows = parseClipsCsv(csv);
  const header = "file,link,niche,song,artist,start_seconds,views,typical_views,notes";
  const lines = rows.map((r) => {
    const fp = results.get(clipId(r.file));
    const m = fp?.best ?? null;
    let { song, artist, start_seconds, notes } = r;
    if (m && !song) {
      song = m.title; artist = m.artist; start_seconds = m.start_seconds;
      notes = `${notes ? `${notes}; ` : ""}acrcloud score ${m.score}`;
    } else if (m) {
      notes = `${notes ? `${notes}; ` : ""}acrcloud heard ${m.title} — ${m.artist} starting ${m.start_seconds} s (score ${m.score})`;
    } else if (fp) {
      notes = `${notes ? `${notes}; ` : ""}acrcloud: no match`;
    }
    return [r.file, r.link, r.niche, song, artist, String(start_seconds), r.views ?? "", r.typical_views ?? "", notes].map((v) => esc(String(v))).join(",");
  });
  return `${header}\n${lines.join("\n")}\n`;
}

async function main() {
  const { values: args } = parseArgs({
    options: { root: { type: "string" }, only: { type: "string" }, force: { type: "boolean", default: false }, apply: { type: "boolean", default: false } },
  });
  const root = (args.root ?? "~/Songfit-groundtruth").replace(/^~(?=$|\/)/, os.homedir());
  const csv = await fs.readFile(path.join(root, "clips.csv"), "utf8");
  let clips = parseClipsCsv(csv);
  if (args.only) clips = clips.filter((c) => c.id === args.only);
  const results = new Map<string, ClipFingerprint>();
  for (const clip of clips) results.set(clip.id, await fingerprintClip(clip, root, args.force));
  await fs.writeFile(path.join(root, "fingerprint.json"), JSON.stringify([...results.values()], null, 2));
  const matched = [...results.values()].filter((r) => r.best).length;
  console.log(`\n${matched}/${results.size} clips matched`);
  if (args.apply) {
    await fs.copyFile(path.join(root, "clips.csv"), path.join(root, `clips.before-fingerprint-${Date.now()}.csv`));
    await fs.writeFile(path.join(root, "clips.csv"), applyToCsv(csv, results));
    console.log("clips.csv updated (backup kept)");
  }
}

// Run only when invoked directly (the tests import the pure functions above).
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

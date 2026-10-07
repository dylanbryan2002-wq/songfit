/* Run: pnpm smoke  (node --env-file=.env.local --import tsx scripts/smoke.ts) */
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { callClaude } from "../src/shared/anthropic";
import { MODELS, env } from "../src/shared/config";

const run = promisify(execFile);

type Check = { name: string; fn: () => Promise<string> };

async function timed(check: Check): Promise<boolean> {
  const t0 = Date.now();
  try {
    const detail = await check.fn();
    console.log(`OK    ${check.name.padEnd(10)} ${Date.now() - t0} ms  ${detail}`);
    return true;
  } catch (e) {
    console.log(`FAIL  ${check.name.padEnd(10)} ${Date.now() - t0} ms  ${(e as Error).message}`);
    return false;
  }
}

const checks: Check[] = [
  {
    name: "claude",
    fn: async () => {
      const text = await callClaude({
        model: MODELS.candidates,
        system: "Reply with exactly one word.",
        user: "Say: ready",
        maxTokens: 10,
      });
      return `reply="${text.trim()}" (${MODELS.candidates})`;
    },
  },
  {
    name: "fable",
    fn: async () => {
      // Proves access to the analysis model too; Phase 2 is the first real use of it.
      const text = await callClaude({
        model: MODELS.analysis,
        system: "Reply with exactly one word.",
        user: "Say: ready",
        maxTokens: 10,
      });
      return `reply="${text.trim()}" (${MODELS.analysis})`;
    },
  },
  {
    name: "whisper",
    fn: async () => {
      if (!ffmpegPath) throw new Error("ffmpeg-static binary missing");
      const dir = await mkdtemp(path.join(os.tmpdir(), "songfit-smoke-"));
      const wav = path.join(dir, "silence.wav");
      try {
        await run(ffmpegPath, ["-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", wav]);
        const openai = new OpenAI({ apiKey: env("OPENAI_API_KEY") });
        const res = await openai.audio.transcriptions.create({
          file: createReadStream(wav),
          model: MODELS.whisper,
          response_format: "text",
        });
        return `transcript="${String(res).trim().slice(0, 30)}" (silence, empty is fine)`;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "deezer",
    fn: async () => {
      const q = encodeURIComponent("The Weeknd Blinding Lights");
      const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { title: string; duration: number }[] };
      const hit = json.data?.[0];
      if (!hit) throw new Error("no result");
      return `"${hit.title}" duration=${hit.duration}s`;
    },
  },
  {
    name: "database",
    fn: async () => {
      const db = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false },
      });
      const { count, error } = await db.from("submissions").select("id", { count: "exact", head: true });
      if (error) throw new Error(error.message);
      return `submissions=${count ?? 0}`;
    },
  },
];

void Promise.all(checks.map(timed)).then((results) => process.exit(results.every(Boolean) ? 0 : 1));

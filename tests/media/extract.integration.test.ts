import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const run = promisify(execFile);
const ffmpeg: string | null = (ffmpegPath as string | null) ?? null;

if (!ffmpeg) {
  console.warn(
    "\n!!! ffmpeg-static resolved NO binary for this platform. extract.integration is SKIPPED, which is NOT a pass. Fix the install before trusting Phase 2.\n",
  );
}

describe.skipIf(!ffmpeg)("extractMedia (integration)", () => {
  let sample: string;
  const tmpDirs: string[] = [];

  beforeAll(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "songfit-sample-"));
    tmpDirs.push(dir);
    sample = path.join(dir, "sample.mp4");
    // 5 s synthetic video with a 440 Hz tone so an audio stream exists.
    await run(ffmpeg!, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=5:size=320x240:rate=30",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
      "-shortest", "-pix_fmt", "yuv420p", sample,
    ]);
  }, 30_000);

  afterAll(async () => {
    await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  it("extracts duration, ~1 frame per second and a wav", async () => {
    const { extractMedia } = await import("../../src/media/extract");
    const out = await extractMedia(sample);
    tmpDirs.push(out.workDir);
    expect(out.durationSeconds).toBeGreaterThan(4.5);
    expect(out.durationSeconds).toBeLessThan(5.5);
    expect(out.frames.length).toBeGreaterThanOrEqual(4);
    expect(out.frames.length).toBeLessThanOrEqual(6);
    expect(out.frames[0]?.time).toBe(0);
    expect(out.audioPath).toMatch(/audio\.wav$/);
    const stat = await fs.stat(out.audioPath!);
    expect(stat.size).toBeGreaterThan(1000);
  }, 30_000);
});

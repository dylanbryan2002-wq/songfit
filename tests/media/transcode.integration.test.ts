import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const run = promisify(execFile);
const ffmpeg: string | null = (ffmpegPath as string | null) ?? null;

describe.skipIf(!ffmpeg)("transcodeForPlayback (integration)", () => {
  let dir: string;
  let sample: string;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "songfit-transcode-"));
    sample = path.join(dir, "sample.mp4");
    // 2 s, 1280x720 with a tone: wider than 540 and has audio, so scale and -an are both exercised.
    await run(ffmpeg!, [
      "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc=duration=2:size=1280x720:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-shortest", "-pix_fmt", "yuv420p", sample,
    ]);
  }, 30_000);

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes an h264 yuv420p mp4, no audio, width <= 540", async () => {
    const { transcodeForPlayback } = await import("../../src/media/transcode");
    const out = await transcodeForPlayback(sample, dir);
    expect(out).toBe(path.join(dir, "playback.mp4"));
    expect((await fs.stat(out!)).size).toBeGreaterThan(1000);
    const { stdout } = await run(ffprobeStatic.path, [
      "-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt,width", "-of", "json", out!,
    ]);
    const streams = (JSON.parse(stdout) as { streams: Record<string, unknown>[] }).streams;
    expect(streams.filter((s) => s.codec_type === "audio")).toHaveLength(0);
    const v = streams.find((s) => s.codec_type === "video")!;
    expect(v.codec_name).toBe("h264");
    expect(v.pix_fmt).toBe("yuv420p");
    expect(Number(v.width)).toBeLessThanOrEqual(540);
  }, 30_000);

  it("returns null for a file that is not a video", async () => {
    const { transcodeForPlayback } = await import("../../src/media/transcode");
    const bad = path.join(dir, "bad.mov");
    await fs.writeFile(bad, "not a video");
    expect(await transcodeForPlayback(bad, dir)).toBeNull();
  }, 30_000);
});

import { describe, it, expect, vi } from "vitest";

// Simulate Node killing the child on timeout.
vi.mock("node:child_process", () => ({
  execFile: (_f: string, _a: string[], _opts: unknown, cb: (e: unknown, o: string, s: string) => void) => {
    cb(Object.assign(new Error("Command failed"), { killed: true, signal: "SIGKILL" }), "", "");
  },
}));

import { transcodeArgs, transcodeBudgetMs, transcodeForPlayback } from "../../src/media/transcode";

describe("transcodeArgs", () => {
  it("is the exact H.264 playback argv", () => {
    expect(transcodeArgs("/in/video.mov", "/out/playback.mp4")).toEqual([
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", "/in/video.mov",
      "-an",
      "-vf", "scale='min(720,iw)':-2",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "/out/playback.mp4",
    ]);
  });
});

describe("transcodeBudgetMs", () => {
  it("caps at 60 s, leaves 120 s for the model calls, skips under 15 s", () => {
    expect(transcodeBudgetMs(undefined)).toBe(60_000);
    expect(transcodeBudgetMs(1_000_000 + 400_000, 1_000_000)).toBe(60_000);
    expect(transcodeBudgetMs(1_000_000 + 150_000, 1_000_000)).toBe(30_000);
    expect(transcodeBudgetMs(1_000_000 + 134_000, 1_000_000)).toBeNull();
  });
});

describe("transcodeForPlayback", () => {
  it("returns null without throwing when the budget is too small", async () => {
    expect(await transcodeForPlayback("/in.mov", "/tmp", Date.now() + 10_000)).toBeNull();
  });

  it("returns null without throwing when ffmpeg is killed on timeout", async () => {
    expect(await transcodeForPlayback("/in.mov", "/tmp", Date.now() + 400_000)).toBeNull();
  });
});

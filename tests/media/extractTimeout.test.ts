import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Simulate Node killing a child on timeout: execFile calls back with killed=true / SIGKILL.
vi.mock("node:child_process", () => ({
  execFile: (_f: string, _a: string[], _opts: unknown, cb: (e: unknown, o: string, s: string) => void) => {
    cb(Object.assign(new Error("Command failed"), { killed: true, signal: "SIGKILL" }), "", "");
  },
}));

const explicitDir = "/tmp/songfit-timeout-unit";

afterEach(async () => {
  await fs.rm(explicitDir, { recursive: true, force: true });
});

describe("extractMedia failures", () => {
  it("surfaces a killed subprocess as PipelineError('analyze', 'ffmpeg timeout: <step>')", async () => {
    const { extractMedia } = await import("../../src/media/extract");
    await expect(extractMedia("/nonexistent.mp4", { workDir: explicitDir })).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      message: expect.stringMatching(/^ffmpeg timeout: ffprobe duration/),
    });
  });

  it("removes a self-created work dir on failure", async () => {
    const mkdtemp = vi.spyOn(fs, "mkdtemp");
    const { extractMedia } = await import("../../src/media/extract");
    await expect(extractMedia("/nonexistent.mp4")).rejects.toThrow(/timeout/);
    const created = await mkdtemp.mock.results[0]!.value as string;
    expect(created.startsWith(path.join(os.tmpdir(), "songfit-"))).toBe(true);
    await expect(fs.stat(created)).rejects.toThrow(/ENOENT/);
    mkdtemp.mockRestore();
  });

  it("keeps a caller-supplied work dir on failure", async () => {
    const { extractMedia } = await import("../../src/media/extract");
    await expect(extractMedia("/nonexistent.mp4", { workDir: explicitDir })).rejects.toThrow();
    await expect(fs.stat(explicitDir)).resolves.toBeTruthy();
  });
});

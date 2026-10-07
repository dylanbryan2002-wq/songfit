import { describe, it, expect, vi } from "vitest";

// Simulate Node killing a child on timeout: execFile calls back with killed=true / SIGKILL.
vi.mock("node:child_process", () => ({
  execFile: (_f: string, _a: string[], opts: { timeout: number }, cb: (e: unknown, o: string, s: string) => void) => {
    const err = Object.assign(new Error("Command failed"), { killed: true, signal: "SIGKILL", timeoutSeen: opts.timeout });
    cb(err, "", "");
  },
}));

describe("extractMedia timeouts", () => {
  it("surfaces a killed subprocess as PipelineError('analyze', 'ffmpeg timeout: <step>')", async () => {
    const { extractMedia } = await import("../../src/media/extract");
    await expect(extractMedia("/nonexistent.mp4", { workDir: "/tmp/songfit-timeout-unit" })).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      message: expect.stringMatching(/^ffmpeg timeout: ffprobe duration/),
    });
  });
});

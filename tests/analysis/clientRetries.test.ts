import { describe, it, expect, vi, beforeEach } from "vitest";

// Every SDK client is built with maxRetries: 0. The per-call timeout applies per attempt, so SDK
// retries would multiply a hung call past the 300 s function limit.
const m = vi.hoisted(() => ({ anthropicOpts: [] as unknown[], openaiOpts: [] as unknown[] }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(opts: unknown) { m.anthropicOpts.push(opts); }
    messages = { create: async () => { throw new Error("stub"); } };
  },
}));
vi.mock("openai", () => ({
  default: class {
    constructor(opts: unknown) { m.openaiOpts.push(opts); }
    audio = { transcriptions: { create: async () => ({ text: "" }) } };
  },
}));

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("OPENAI_API_KEY", "test-key");
});

describe("SDK clients", () => {
  it("callClaude's client has maxRetries 0", async () => {
    const { callClaude } = await import("../../src/shared/anthropic");
    await callClaude({ model: "m", system: "s", user: "u" }).catch(() => undefined);
    expect(m.anthropicOpts).toContainEqual(expect.objectContaining({ maxRetries: 0 }));
    expect(m.anthropicOpts.every((o) => (o as { maxRetries?: number }).maxRetries === 0)).toBe(true);
  });

  it("analyzeVideo's client has maxRetries 0", async () => {
    m.anthropicOpts.length = 0;
    const { analyzeVideo } = await import("../../src/analysis/analyzeVideo");
    await analyzeVideo({ frames: [], transcript: "", transcriptSegments: [], creatorVibe: null, durationSeconds: 5 })
      .catch(() => undefined);
    expect(m.anthropicOpts).toEqual([expect.objectContaining({ maxRetries: 0 })]);
  });

  it("transcribe's OpenAI client has maxRetries 0", async () => {
    const { transcribe } = await import("../../src/analysis/transcribe");
    await transcribe(__filename);
    expect(m.openaiOpts).toEqual([expect.objectContaining({ maxRetries: 0 })]);
  });
});

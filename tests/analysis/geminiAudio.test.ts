import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listenWithGemini, PROMPT_VERSION } from "../../src/analysis/geminiAudio";

const good = {
  transcript: "I quit my job today.", segments: [{ start: 0.5, end: 2.1, text: "I quit my job today." }],
  voice: { energy: 0.7, mood: 0.8 }, words_per_second: 2.9, laughter: false, sarcasm: false,
  confidence: "medium",
};
const reply = (obj: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }));

async function wav() {
  const p = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "gem-")), "a.wav");
  await fs.writeFile(p, Buffer.from("RIFF0000WAVE"));
  return p;
}

describe("Gemini listens to the audio (new engine, Dylan's decision 2026-10-11)", () => {
  it("exports a prompt version", () => expect(PROMPT_VERSION).toMatch(/^voice-v\d+$/));

  it("returns the words with times plus the voice reading", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(good));
    const r = await listenWithGemini(await wav(), { fetchImpl, apiKey: "k" });
    expect(r.transcript.text).toBe("I quit my job today.");
    expect(r.transcript.segments).toHaveLength(1);
    expect(r.voice).toEqual({ energy: 0.7, mood: 0.8 });
    expect(r.wordsPerSecond).toBe(2.9);
  });

  it("no audio track: empty transcript, no voice reading, no call", async () => {
    const fetchImpl = vi.fn();
    const r = await listenWithGemini(null, { fetchImpl, apiKey: "k" });
    expect(r).toEqual({ transcript: { text: "", segments: [] }, voice: null, wordsPerSecond: null, laughter: false, sarcasm: false, raw: "" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries once on a bad reply, then throws with the raw text", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => reply({ nope: 1 }));
    await expect(listenWithGemini(await wav(), { fetchImpl, apiKey: "k" })).rejects.toThrow(/nope/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries when Google is busy (503/429/5xx), then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => (++n < 3 ? new Response("busy", { status: 503 }) : reply(good)));
    const r = await listenWithGemini(await wav(), { fetchImpl, apiKey: "k", sleep: async () => {} });
    expect(r.transcript.text).toBe("I quit my job today.");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("gives up after the retries with a clear error", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response("busy", { status: 503 }));
    await expect(listenWithGemini(await wav(), { fetchImpl, apiKey: "k", sleep: async () => {} })).rejects.toThrow(/gemini 503/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("asks Gemini for the same answer every time (temperature 0)", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => reply(good));
    await listenWithGemini(await wav(), { fetchImpl, apiKey: "k" });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).generationConfig.temperature).toBe(0);
  });
});

import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { buildVideoProfile, PROMPT_VERSION } from "../../src/analysis/videoProfile";
import { SOURCE_WEIGHTS } from "../../src/engine/scoring/weights";

const zero = { Motivational: 0, Inspirational: 0, Reflective: 0, Heartfelt: 0, Sad: 0, Nostalgic: 0, Funny: 0, Upbeat: 0, Hype: 0, "Calm/Focused": 0, Dramatic: 0 };
const reading = {
  talking: "on camera",
  words: { energy: 0.6, mood: 0.8 },
  colour: { energy: 0.3, mood: 0.6 },
  feelings: { ...zero, Inspirational: 0.8, Heartfelt: 0.5 },
  vocals: "instrumental preferred",
  themes_fit: ["self-belief/empowerment"], themes_avoid: ["partying"],
  content_type: "Storytelling", story_feeling: "inspirational",
  key_moments: [{ time: 12, what: "the turn" }],
  confidence: { feelings: "high", energy: "medium", mood: "medium", themes: "low" },
};
const input = { frames: [{ time: 0, base64: "AAAA" }], transcript: "hi", transcriptSegments: [], creatorVibe: null, durationSeconds: 20 };

function fakeClient(responses: string[]) {
  const create = vi.fn();
  for (const r of responses) create.mockResolvedValueOnce({ content: [{ type: "text", text: r }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

describe("video profile (new engine phase 2, Dylan 2026-10-11)", () => {
  it("exports a prompt version", () => {
    expect(PROMPT_VERSION).toMatch(/^profile-v\d+$/);
  });

  it("parses the reading and combines energy and mood with the approved source weights", async () => {
    const { client } = fakeClient([JSON.stringify(reading)]);
    const p = await buildVideoProfile(input, { cutsPerMinute: 20, medianShot: 3, motionPeak: 0.05, energy: 0.4 }, { client });
    const w = SOURCE_WEIGHTS.talking.energy;
    expect(p.energy).toBeCloseTo((w.words * 0.6 + w.edit * 0.4 + w.colour * 0.3) / (w.words + w.edit + w.colour), 5);
    expect(p.reading.content_type).toBe("Storytelling");
  });

  it("retries once with the error, then throws with the raw text attached", async () => {
    const { client, create } = fakeClient(["not json", "still not json"]);
    await expect(buildVideoProfile(input, null, { client })).rejects.toThrow(/still not json/);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("rejects feelings outside the 11 families", async () => {
    const bad = { ...reading, feelings: { ...reading.feelings, Romantic: 1 } };
    const { client } = fakeClient([JSON.stringify(bad), JSON.stringify(bad)]);
    await expect(buildVideoProfile(input, null, { client })).rejects.toThrow();
  });
});

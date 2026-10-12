import { describe, it, expect, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { buildVideoProfile, PROMPT_VERSION, voiceEnergy } from "../../src/analysis/videoProfile";
import { SOURCE_WEIGHTS } from "../../src/engine/scoring/weights";

const zero = { Motivational: 0, Inspirational: 0, Reflective: 0, Heartfelt: 0, Sad: 0, Nostalgic: 0, Funny: 0, Upbeat: 0, Hype: 0, "Calm/Focused": 0, Dramatic: 0 };
const reading = {
  talking: "on camera",
  words: { energy: 0.6, mood: 0.8 },
  colour: { energy: 0.3, mood: 0.6 },
  words_feelings: { ...zero, Inspirational: 0.8, Heartfelt: 0.5 },
  visual_feelings: { ...zero, Inspirational: 0.4, "Calm/Focused": 0.6 },
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
    const bad = { ...reading, words_feelings: { ...reading.words_feelings, Romantic: 1 } };
    const { client } = fakeClient([JSON.stringify(bad), JSON.stringify(bad)]);
    await expect(buildVideoProfile(input, null, { client })).rejects.toThrow();
  });

  it("the voice reading counts with its approved weight when Gemini heard someone talking", async () => {
    const { client } = fakeClient([JSON.stringify(reading)]);
    const p = await buildVideoProfile(input, null, { client, voice: { energy: 1, mood: 1 } });
    const w = SOURCE_WEIGHTS.talking.energy;
    expect(p.energy).toBeCloseTo((w.words * 0.6 + w.voice * 1 + w.colour * 0.3) / (w.words + w.voice + w.colour), 5);
  });

  it("the faces reading counts with its approved weight", async () => {
    const { client } = fakeClient([JSON.stringify(reading)]);
    const p = await buildVideoProfile(input, null, { client, faces: { energy: 1, mood: 1 } });
    const w = SOURCE_WEIGHTS.talking.mood;
    expect(p.mood).toBeCloseTo((w.words * 0.8 + w.faces * 1 + w.colour * 0.6) / (w.words + w.faces + w.colour), 5);
  });

  it("does not send temperature: the analysis model rejects it with a 400 (live failure, 2026-10-12)", async () => {
    const { client, create } = fakeClient([JSON.stringify(reading)]);
    await buildVideoProfile(input, null, { client });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("temperature");
  });

  it("talking: the feelings are voice 50 / words 30 / visuals 20 (Dylan, 2026-10-12: tone of voice matters most)", async () => {
    const { client } = fakeClient([JSON.stringify(reading)]);
    const voiceFeelings = { ...zero, Motivational: 1, Hype: 0.8 };
    const p = await buildVideoProfile(input, null, { client, voice: { energy: 0.6, mood: 0.5 }, voiceFeelings });
    expect(p.reading.feelings.Motivational).toBeCloseTo(0.5 * 1, 5);
    expect(p.reading.feelings.Hype).toBeCloseTo(0.5 * 0.8, 5);
    expect(p.reading.feelings.Inspirational).toBeCloseTo(0.3 * 0.8 + 0.2 * 0.4, 5);
    expect(p.reading.feelings["Calm/Focused"]).toBeCloseTo(0.2 * 0.6, 5);
  });

  it("no voice reading: words and visuals share the feelings (words 60 / visuals 40 when talking, 40 / 60 when not)", async () => {
    const { client } = fakeClient([JSON.stringify(reading)]);
    const p = await buildVideoProfile(input, null, { client });
    expect(p.reading.feelings.Inspirational).toBeCloseTo(0.6 * 0.8 + 0.4 * 0.4, 5);
    const quiet = fakeClient([JSON.stringify({ ...reading, talking: "none", words: null })]);
    const q = await buildVideoProfile(input, null, { client: quiet.client });
    expect(q.reading.feelings.Inspirational).toBeCloseTo(0.4 * 0.8 + 0.6 * 0.4, 5);
  });

  it("fast speech raises the voice's energy (4 words per second reads as high energy)", () => {
    expect(voiceEnergy(0.6, 4.15)).toBeGreaterThan(0.75);
    expect(voiceEnergy(0.6, null)).toBe(0.6);
    expect(voiceEnergy(0.6, 2)).toBeLessThan(0.6);
  });
});

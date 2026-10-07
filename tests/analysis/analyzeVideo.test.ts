import { describe, it, expect, vi } from "vitest";
import { analyzeVideo, PROMPT_VERSION } from "../../src/analysis/analyzeVideo";
import type Anthropic from "@anthropic-ai/sdk";

const validPayload = {
  analysis: {
    summary: "Creator walks through NYC at night and reveals an outfit.",
    content_type: "fashion lifestyle reel",
    content_category: "fashion",
    setting: "New York at night",
    story: "walk, then outfit reveal",
    aesthetic: ["luxury", "urban"],
    mood: ["confident", "mysterious"],
    energy: "medium-high",
    pacing: "medium",
    dialogue_present: false,
    important_moments: [{ time: 7.8, type: "main_visual_reveal", note: "outfit reveal" }],
  },
  brief: {
    text: "Modern NYC fashion montage. Confident and slightly mysterious. Needs a lift around 8s.",
    fields: {
      moods: ["confident", "cool"],
      energy: 0.72,
      tempo_preference: "medium-high",
      vocal_preference: "either",
      genre_preferences: [],
      genre_avoid: [],
      dialogue_present: false,
      desired_cultural_relevance: "high",
      desired_familiarity: "recognizable_not_overused",
    },
  },
};

function fakeClient(responses: string[]): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn();
  for (const r of responses) {
    create.mockResolvedValueOnce({ content: [{ type: "text", text: r }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 20 } });
  }
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const input = {
  frames: [{ time: 0, base64: "AAAA" }, { time: 1, base64: "BBBB" }],
  transcript: "",
  transcriptSegments: [],
  creatorIntent: null,
  durationSeconds: 12,
};

describe("analyzeVideo", () => {
  it("parses a valid response into AnalysisResult", async () => {
    const { client, create } = fakeClient([JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.content_category).toBe("fashion");
    expect(out.brief.fields.energy).toBe(0.72);
    expect(out.transcript).toBe("");
    expect(out.prompt_version).toBe(PROMPT_VERSION);
    expect(create).toHaveBeenCalledTimes(1);
    const [params, reqOpts] = create.mock.calls[0]!;
    expect(params.model).toBeDefined();
    expect(reqOpts).toEqual(expect.objectContaining({ timeout: expect.any(Number) }));
    // two image blocks, each preceded by a timestamp label
    const content = params.messages[0].content as { type: string; text?: string }[];
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect(content.some((b) => b.type === "text" && b.text?.includes("t=1.0s"))).toBe(true);
  });

  it("accepts fenced JSON", async () => {
    const { client } = fakeClient(["```json\n" + JSON.stringify(validPayload) + "\n```"]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.summary).toContain("NYC");
  });

  it("renders transcript segments with timestamps into the prompt", async () => {
    const { client, create } = fakeClient([JSON.stringify(validPayload)]);
    await analyzeVideo(
      {
        ...input,
        transcript: "okay so here is the fit",
        transcriptSegments: [{ start: 2.1, end: 4.0, text: "okay so here is the fit" }],
      },
      { client },
    );
    const content = create.mock.calls[0]![0].messages[0].content as { type: string; text?: string }[];
    const joined = content.map((b) => b.text ?? "").join("\n");
    expect(joined).toContain("[2.1–4.0] okay so here is the fit");
  });

  it("retries once when the first response fails validation, then succeeds", async () => {
    const bad = JSON.stringify({ analysis: { summary: "x" }, brief: {} });
    const { client, create } = fakeClient([bad, JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.content_category).toBe("fashion");
    expect(create).toHaveBeenCalledTimes(2);
    const retryMessages = create.mock.calls[1]![0].messages;
    expect(retryMessages).toHaveLength(3);
    expect(retryMessages[1]).toEqual({ role: "assistant", content: bad });
    expect(JSON.stringify(retryMessages[2])).toContain("did not match the schema");
  });

  it("rejects an important_moments type outside MOMENT_TYPES (then retries)", async () => {
    const wrongType = JSON.parse(JSON.stringify(validPayload));
    wrongType.analysis.important_moments[0]!.type = "vibe_shift";
    const { client, create } = fakeClient([JSON.stringify(wrongType), JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.important_moments[0]!.type).toBe("main_visual_reveal");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("throws PipelineError with raw text after two invalid responses", async () => {
    const bad = "{\"nope\": true}";
    const { client } = fakeClient([bad, bad]);
    await expect(analyzeVideo(input, { client })).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      raw: bad,
    });
  });

  it("throws PipelineError when the output was truncated at max_tokens", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      content: [{ type: "text", text: "{\"analysis\": {" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 4000 },
    });
    const client = { messages: { create } } as unknown as Anthropic;
    await expect(analyzeVideo(input, { client })).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("throws PipelineError when the response is not JSON at all, twice", async () => {
    const { client } = fakeClient(["Sorry, I cannot see the video.", "Still nothing."]);
    await expect(analyzeVideo(input, { client })).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      raw: "Still nothing.",
    });
  });

  it("throws PipelineError when the model refuses", async () => {
    const create = vi.fn().mockResolvedValueOnce({ content: [], stop_reason: "refusal", usage: { input_tokens: 10, output_tokens: 0 } });
    const client = { messages: { create } } as unknown as Anthropic;
    await expect(analyzeVideo(input, { client })).rejects.toMatchObject({
      name: "PipelineError",
      stage: "analyze",
      message: "model refused",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects a content_category outside CONTENT_CATEGORIES (then retries with the allowed list)", async () => {
    const bad = JSON.parse(JSON.stringify(validPayload));
    bad.analysis.content_category = "vibes";
    const { client, create } = fakeClient([JSON.stringify(bad), JSON.stringify(validPayload)]);
    const out = await analyzeVideo(input, { client });
    expect(out.analysis.content_category).toBe("fashion");
    expect(JSON.stringify(create.mock.calls[1]![0].messages[2])).toContain("must be one of");
  });

  it("skips the retry when the budget is exhausted", async () => {
    const bad = "{\"nope\": true}";
    const { client, create } = fakeClient([bad, JSON.stringify(validPayload)]);
    await expect(analyzeVideo(input, { client, deadlineAt: Date.now() + 1000 })).rejects.toMatchObject({
      stage: "analyze",
      raw: bad,
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("precedes every image with a t=...s label, sorted by time", async () => {
    const { client, create } = fakeClient([JSON.stringify(validPayload)]);
    await analyzeVideo(
      { ...input, frames: [{ time: 2, base64: "CC" }, { time: 0.5, base64: "AA" }] },
      { client },
    );
    const content = create.mock.calls[0]![0].messages[0].content as { type: string; text?: string }[];
    const labels: string[] = [];
    content.forEach((b, i) => {
      if (b.type === "image") {
        const prev = content[i - 1]!;
        expect(prev.type).toBe("text");
        expect(prev.text).toMatch(/^t=\d+\.\ds$/);
        labels.push(prev.text!);
      }
    });
    expect(labels).toEqual(["t=0.5s", "t=2.0s"]);
  });
});

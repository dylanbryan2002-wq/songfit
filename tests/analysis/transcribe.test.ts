import { describe, it, expect, vi } from "vitest";
import { transcribe } from "../../src/analysis/transcribe";

describe("transcribe", () => {
  it("returns an empty transcript when there is no audio", async () => {
    expect(await transcribe(null)).toEqual({ text: "", segments: [] });
  });

  it("calls Whisper with verbose_json and maps text + segments", async () => {
    const create = vi.fn().mockResolvedValue({
      text: "  this is my new fit  ",
      segments: [
        { start: 0.0, end: 1.4, text: " this is " },
        { start: 1.4, end: 2.9, text: " my new fit " },
      ],
    });
    const client = { audio: { transcriptions: { create } } } as unknown as import("openai").default;
    const t = await transcribe(__filename, { client });
    expect(t.text).toBe("this is my new fit");
    expect(t.segments).toEqual([
      { start: 0, end: 1.4, text: "this is" },
      { start: 1.4, end: 2.9, text: "my new fit" },
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "whisper-1", response_format: "verbose_json" }),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("tolerates a response with no segments array", async () => {
    const create = vi.fn().mockResolvedValue({ text: "hello" });
    const client = { audio: { transcriptions: { create } } } as unknown as import("openai").default;
    const t = await transcribe(__filename, { client });
    expect(t).toEqual({ text: "hello", segments: [] });
  });
});

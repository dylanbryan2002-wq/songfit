import { describe, it, expect, vi } from "vitest";
import { PipelineError } from "../../src/shared/errors";
import { remainingBudget } from "../../src/pipeline/budget";
import { transcribe } from "../../src/analysis/transcribe";

describe("transcribe", () => {
  it("returns an empty transcript when there is no audio, without calling the API", async () => {
    const create = vi.fn();
    const client = { audio: { transcriptions: { create } } } as unknown as import("openai").default;
    expect(await transcribe(null, { client })).toEqual({ text: "", segments: [] });
    expect(create).not.toHaveBeenCalled();
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

  it("passes the deadline-aware timeout to Whisper", async () => {
    const create = vi.fn().mockResolvedValue({ text: "hi" });
    const client = { audio: { transcriptions: { create } } } as unknown as import("openai").default;
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const deadlineAt = now + 20_000;
    await transcribe(__filename, { client, deadlineAt });
    const timeout = (create.mock.calls[0]?.[1] as { timeout: number }).timeout;
    vi.restoreAllMocks();
    expect(timeout).toBe(remainingBudget({ deadlineAt }, 60_000, now));
    expect(timeout).toBe(15_000);
  });

  it("maps API failures to a PipelineError without leaking secrets", async () => {
    const err = Object.assign(new Error("Rate limited"), {
      name: "RateLimitError",
      status: 429,
      headers: { authorization: "Bearer sk-FAKE123" },
    });
    const create = vi.fn().mockRejectedValue(err);
    const client = { audio: { transcriptions: { create } } } as unknown as import("openai").default;
    const e = await transcribe(__filename, { client }).catch((x) => x);
    expect(e).toBeInstanceOf(PipelineError);
    expect(e.stage).toBe("analyze");
    expect(e.message).toBe("whisper: RateLimitError 429: Rate limited");
    expect(e.message).not.toContain("sk-FAKE123");
  });
});

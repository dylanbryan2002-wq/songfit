import { describe, expect, it, vi } from "vitest";
import { makeClaudeCall } from "@/src/shared/anthropic";
import { LIMITS } from "@/src/shared/config";

describe("makeClaudeCall", () => {
  it("sends system + user with the default timeout and returns concatenated text blocks", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "hello " }, { type: "text", text: "world" }],
    });
    const call = makeClaudeCall({ messages: { create } } as never);
    const out = await call({ model: "m", system: "S", user: "U", maxTokens: 10 });
    expect(out).toBe("hello world");
    expect(create).toHaveBeenCalledWith(
      { model: "m", max_tokens: 10, system: "S", messages: [{ role: "user", content: "U" }] },
      { timeout: LIMITS.modelTimeoutMs },
    );
  });

  it("throws when the output was truncated at max_tokens", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "partial" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const call = makeClaudeCall({ messages: { create } } as never);
    await expect(call({ model: "m", system: "S", user: "U" })).rejects.toThrow(/truncated/);
  });

  it("throws when the response has no text", async () => {
    const create = vi.fn().mockResolvedValue({ content: [] });
    const call = makeClaudeCall({ messages: { create } } as never);
    await expect(call({ model: "m", system: "S", user: "U" })).rejects.toThrow(/no text/);
  });
});

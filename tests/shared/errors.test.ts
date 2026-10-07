import { describe, it, expect } from "vitest";
import { PipelineError, isPipelineError } from "@/src/shared/errors";

describe("PipelineError", () => {
  it("keeps the plain message and exposes stage and raw as properties", () => {
    const e = new PipelineError("analyze", "model output invalid", "{oops");
    expect(e.message).toBe("model output invalid");
    expect(e.stage).toBe("analyze");
    expect(e.raw).toBe("{oops");
    expect(String(e)).toBe("PipelineError[analyze]: model output invalid");
  });

  it("is recognised by isPipelineError", () => {
    expect(isPipelineError(new PipelineError("recommend", "x"))).toBe(true);
    expect(isPipelineError(new Error("x"))).toBe(false);
  });
});

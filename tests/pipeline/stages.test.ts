import { describe, it, expect } from "vitest";
import { nextStage } from "../../src/pipeline/stages";

describe("nextStage", () => {
  it("no analysis → analyze", () => expect(nextStage(false, false)).toBe("analyze"));
  it("analysis but no recommendations → recommend", () => expect(nextStage(true, false)).toBe("recommend"));
  it("both present → done", () => expect(nextStage(true, true)).toBe("done"));
  it("recommendations without analysis is impossible but still re-analyzes", () =>
    expect(nextStage(false, true)).toBe("analyze"));
});

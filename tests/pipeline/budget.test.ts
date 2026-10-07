import { describe, it, expect } from "vitest";
import { remainingBudget } from "../../src/pipeline/budget";
import { LIMITS } from "../../src/shared/config";

describe("remainingBudget", () => {
  it("returns the default when there is no ctx or no deadline", () => {
    expect(remainingBudget(undefined, 120_000, 0)).toBe(120_000);
    expect(remainingBudget({}, 120_000, 0)).toBe(120_000);
  });
  it("defaults to LIMITS.modelTimeoutMs", () => {
    expect(remainingBudget(undefined)).toBe(LIMITS.modelTimeoutMs);
  });
  it("caps at the time left minus the 5 s reserve", () => {
    expect(remainingBudget({ deadlineAt: 50_000 }, 120_000, 20_000)).toBe(25_000);
  });
  it("never goes below 5 s", () => {
    expect(remainingBudget({ deadlineAt: 1_000 }, 120_000, 900)).toBe(5_000);
  });
});

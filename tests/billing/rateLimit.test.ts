import { describe, expect, it } from "vitest";
import { takeToken } from "../../src/billing/rateLimit";

describe("takeToken", () => {
  it("allows up to the limit inside the window, then refuses", () => {
    const store = new Map<string, number[]>();
    let now = 1_000_000;
    for (let i = 0; i < 5; i++) expect(takeToken(store, "c1", 5, 60_000, now)).toBe(true);
    expect(takeToken(store, "c1", 5, 60_000, now)).toBe(false);
    now += 60_001;
    expect(takeToken(store, "c1", 5, 60_000, now)).toBe(true);
  });
  it("keys are independent", () => {
    const store = new Map<string, number[]>();
    for (let i = 0; i < 5; i++) takeToken(store, "a", 5, 60_000, 0);
    expect(takeToken(store, "b", 5, 60_000, 0)).toBe(true);
  });
});

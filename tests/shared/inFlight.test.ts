import { describe, expect, it } from "vitest";
import { isStaleInFlight } from "@/src/shared/inFlight";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("isStaleInFlight", () => {
  it("is true for an in-flight status untouched for more than 6 minutes", () => {
    for (const s of ["uploaded", "analyzing", "recommending"]) expect(isStaleInFlight(s, ago(7), NOW)).toBe(true);
  });
  it("is false inside the window", () => {
    expect(isStaleInFlight("analyzing", ago(5), NOW)).toBe(false);
  });
  it("is false for ready and failed however old", () => {
    expect(isStaleInFlight("ready", ago(60), NOW)).toBe(false);
    expect(isStaleInFlight("failed", ago(60), NOW)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { formatElapsed, shortId } from "../../src/db/queries/admin";

describe("formatElapsed", () => {
  it("formats minutes and seconds", () => {
    expect(formatElapsed("2026-10-06T10:00:00Z", "2026-10-06T10:01:12Z")).toBe("1m 12s");
  });
  it("formats seconds only under a minute", () => {
    expect(formatElapsed("2026-10-06T10:00:00Z", "2026-10-06T10:00:42Z")).toBe("42s");
  });
  it("returns a dash when either side is missing", () => {
    expect(formatElapsed(null, "2026-10-06T10:00:42Z")).toBe("—");
    expect(formatElapsed("2026-10-06T10:00:00Z", null)).toBe("—");
  });
});

describe("shortId", () => {
  it("returns the first 8 characters", () => {
    expect(shortId("0f4a1c9e-1234-5678-9abc-def012345678")).toBe("0f4a1c9e");
  });
});

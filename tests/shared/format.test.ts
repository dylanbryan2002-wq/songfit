import { describe, it, expect } from "vitest";
import { formatTime } from "@/src/shared/format";

describe("formatTime", () => {
  it("formats m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(43)).toBe("0:43");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
    expect(formatTime(43.6)).toBe("0:43");
  });
  it("clamps negatives to zero", () => {
    expect(formatTime(-5)).toBe("0:00");
  });
});

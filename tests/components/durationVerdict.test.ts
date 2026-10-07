import { describe, expect, it } from "vitest";
import { durationVerdict } from "../../components/durationVerdict";

describe("durationVerdict", () => {
  it("lets unknown durations through", () => expect(durationVerdict(null)).toBe("ok"));
  it("accepts 100s and exactly 180s", () => {
    expect(durationVerdict(100)).toBe("ok");
    expect(durationVerdict(180)).toBe("ok");
  });
  it("rejects over 180s", () => expect(durationVerdict(181)).toBe("too_long"));
});

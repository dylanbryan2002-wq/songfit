import { describe, expect, it } from "vitest";
import { safeNext } from "../../src/auth/redirect";

const O = "https://thissongfits.com";

describe("safeNext", () => {
  it("keeps same-origin paths", () => {
    expect(safeNext("/results/abc", O)).toBe("/results/abc");
    expect(safeNext("/a?b=1#c", O)).toBe("/a?b=1#c");
    expect(safeNext("/%2F%2Fevil.com", O)).toBe("/%2F%2Fevil.com");
  });
  it("defaults to /", () => {
    expect(safeNext(null, O)).toBe("/");
  });
  it("rejects off-origin and bypass attempts", () => {
    expect(safeNext("https://evil.com", O)).toBe("/");
    expect(safeNext("//evil.com", O)).toBe("/");
    expect(safeNext("/\\evil.com", O)).toBe("/");
    expect(safeNext("/\t/evil.com", O)).toBe("/");
    expect(safeNext("/\n/evil.com", O)).toBe("/");
  });
});

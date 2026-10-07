import { describe, expect, it } from "vitest";
import { isAdminEmail } from "../../src/auth/admin";

describe("isAdminEmail", () => {
  it("matches case-insensitively against a comma-separated list", () => {
    expect(isAdminEmail("Dylan@Gmail.com", "dylanbryan2002@gmail.com, dylan@gmail.com")).toBe(true);
  });
  it("ignores whitespace around entries", () => {
    expect(isAdminEmail("a@b.com", "  a@b.com  ,c@d.com")).toBe(true);
  });
  it("rejects emails not in the list", () => {
    expect(isAdminEmail("x@y.com", "a@b.com,c@d.com")).toBe(false);
  });
  it("rejects null/undefined/empty", () => {
    expect(isAdminEmail(null, "a@b.com")).toBe(false);
    expect(isAdminEmail(undefined, "a@b.com")).toBe(false);
    expect(isAdminEmail("", "a@b.com")).toBe(false);
    expect(isAdminEmail("a@b.com", "")).toBe(false);
  });
});

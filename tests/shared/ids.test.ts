import { describe, it, expect } from "vitest";
import { isUuid } from "../../src/shared/ids";

describe("isUuid", () => {
  it("accepts a valid v4 uuid", () => {
    expect(isUuid("0f4a1c9e-1234-4678-9abc-def012345678")).toBe(true);
  });
  it("rejects an empty string", () => {
    expect(isUuid("")).toBe(false);
  });
  it("rejects arbitrary text", () => {
    expect(isUuid("abc")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { isExactStoragePath, storagePathFor } from "../../src/media/storage";

const c = "11111111-1111-1111-1111-111111111111";
const s = "22222222-2222-2222-2222-222222222222";

describe("storagePathFor / isExactStoragePath", () => {
  it("builds creator/submission.ext", () => {
    expect(storagePathFor(c, s, "mov")).toBe(`${c}/${s}.mov`);
  });
  it("accepts only the exact path", () => {
    expect(isExactStoragePath(`${c}/${s}.mov`, c, s, "mov")).toBe(true);
    expect(isExactStoragePath(`${c}/${s}.mp4`, c, s, "mov")).toBe(false);
    expect(isExactStoragePath(`${c}/other.mov`, c, s, "mov")).toBe(false);
    expect(isExactStoragePath(`${c}/../${c}/${s}.mov`, c, s, "mov")).toBe(false);
    expect(isExactStoragePath(`${c}/${s}.mov/`, c, s, "mov")).toBe(false);
  });
});

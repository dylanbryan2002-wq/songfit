import { describe, expect, it } from "vitest";
import { isExactStoragePath, playbackPathFor, storagePathFor } from "../../src/media/storage";

describe("playbackPathFor", () => {
  it("swaps the extension for .playback.mp4 in the same folder", () => {
    expect(playbackPathFor("cre/sub.mov")).toBe("cre/sub.playback.mp4");
    expect(playbackPathFor("cre/sub.mp4")).toBe("cre/sub.playback.mp4");
  });
});

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

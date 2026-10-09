import { describe, expect, it } from "vitest";
import { FAILURE_COPY, failureReason } from "../../src/shared/failureReason";

describe("failureReason", () => {
  it("maps the too-long probe message", () => {
    expect(failureReason("video too long: 200s > 180s")).toBe("too_long");
  });
  it("maps unreadable files", () => {
    expect(failureReason("could not read video duration")).toBe("bad_file");
    expect(failureReason("ffprobe duration failed: Invalid data found when processing input")).toBe("bad_file");
  });
  it("treats everything else as our fault", () => {
    expect(failureReason("ffmpeg timeout: frames (90000 ms)")).toBeNull();
    expect(failureReason("model response did not parse")).toBeNull();
    expect(failureReason(null)).toBeNull();
    expect(failureReason("")).toBeNull();
  });
  it("has copy for every reason, with no retry wording", () => {
    for (const text of Object.values(FAILURE_COPY)) expect(text).not.toMatch(/our side/i);
  });
});

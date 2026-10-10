import { describe, expect, it } from "vitest";
import { uploadLine } from "../../components/WaitingState";

describe("uploadLine", () => {
  it("never shows 100% while the file is still in flight", () => {
    expect(uploadLine({ progress: 100 })).toBe("Uploading 99%");
    expect(uploadLine({ progress: 43.6 })).toBe("Uploading 44%");
  });
  it("hands over once the run is being created", () => {
    expect(uploadLine({ progress: 100, starting: true })).toBe("Starting your songs");
  });
});

import { describe, it, expect } from "vitest";
import { checkVideoFile, formatFileSize, formatDuration, TOO_LONG } from "@/components/videoChecks";
import { LIMITS } from "@/src/shared/config";

const f = (name: string, type: string, size: number) => ({ name, type, size });

describe("checkVideoFile", () => {
  it("accepts a supported, non-empty file within the size cap", () => {
    expect(checkVideoFile(f("clip.MOV", "", 10))).toBeNull();
    expect(checkVideoFile(f("clip", "video/mp4", LIMITS.maxUploadBytes))).toBeNull();
  });
  it("rejects an unsupported type", () => {
    expect(checkVideoFile(f("clip.avi", "video/x-msvideo", 10))).toBe("That file type isn't supported. Use MP4, MOV or WebM.");
  });
  it("rejects an empty file", () => {
    expect(checkVideoFile(f("clip.mp4", "video/mp4", 0))).toBe("That file is empty. Pick another video.");
  });
  it("rejects a file over the cap", () => {
    expect(checkVideoFile(f("clip.mp4", "video/mp4", LIMITS.maxUploadBytes + 1))).toBe(
      "That video is over 50 MB. Keep it under a minute, or export a smaller file.",
    );
  });
  it("keeps the too-long copy", () => {
    expect(TOO_LONG).toBe("Keep it under 3 minutes for now.");
  });
});

describe("formatting", () => {
  it("formats size in MB and duration as m:ss, null as length unknown", () => {
    expect(formatFileSize(18 * 1024 * 1024)).toBe("18 MB");
    expect(formatFileSize(300 * 1024)).toBe("0.3 MB");
    expect(formatDuration(14.4)).toBe("0:14");
    expect(formatDuration(75)).toBe("1:15");
    expect(formatDuration(null)).toBe("length unknown");
  });
});

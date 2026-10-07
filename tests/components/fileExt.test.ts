import { describe, expect, it } from "vitest";
import { fileExt } from "../../components/fileExt";

describe("fileExt", () => {
  it("uses the filename extension when recognised", () => {
    expect(fileExt({ name: "clip.MOV", type: "video/quicktime" })).toBe("mov");
    expect(fileExt({ name: "clip.mp4", type: "video/mp4" })).toBe("mp4");
    expect(fileExt({ name: "clip.webm", type: "video/webm" })).toBe("webm");
    expect(fileExt({ name: "clip.m4v", type: "video/x-m4v" })).toBe("m4v");
  });
  it("falls back to the mime type when the name has no usable extension", () => {
    expect(fileExt({ name: "image", type: "video/quicktime" })).toBe("mov");
    expect(fileExt({ name: "blob", type: "video/mp4" })).toBe("mp4");
  });
  it("returns null for unsupported files", () => {
    expect(fileExt({ name: "a.avi", type: "video/x-msvideo" })).toBeNull();
    expect(fileExt({ name: "a.jpg", type: "image/jpeg" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { claudeFamilies } from "@/scripts/groundtruth/merge-labels";
import { parseLrc, sections } from "@/scripts/groundtruth/lrclib-sections";
import { contentType } from "@/scripts/groundtruth/creator-evidence";
import { parseCsv } from "@/scripts/groundtruth/csv";

describe("song labels", () => {
  it("splits Inspirational from Motivational (Dylan, 2026-10-11)", () => {
    expect([...claudeFamilies({ mood: ["uplifting", "hopeful"] })]).toContain("Inspirational");
    expect([...claudeFamilies({ mood: ["uplifting"] })]).not.toContain("Motivational");
    expect([...claudeFamilies({ mood: ["defiant"] })]).toEqual(["Motivational"]);
  });
});

describe("sections from timed lyrics", () => {
  it("finds the repeated block as the chorus and long gaps as instrumental", () => {
    const lrc = ["[00:10.00]verse one", "[00:14.00]verse two", "[00:20.00]hook a", "[00:22.00]hook b", "[00:24.00]hook c",
      "[00:40.00]verse three", "[00:44.00]hook a", "[00:46.00]hook b", "[00:48.00]hook c"].join("\n");
    const s = sections(parseLrc(lrc), 60);
    expect(s.chorus_starts).toEqual([20, 44]);
    expect(s.gaps).toContainEqual([24, 40]);
    expect(s.first_vocal).toBe(10);
  });
});

describe("creator categories", () => {
  it("maps creators' own words to content types", () => {
    expect(contentType("Sadder Storytelling Videos")).toBe("Sad storytelling");
    expect(contentType("Tactical slash educational")).toBe("Educational");
    expect(contentType("If your video has deep meaning")).toBe("Deep");
    expect(contentType("Engaging")).toBeNull();
  });
});

describe("csv", () => {
  it("reads quoted cells with commas and escaped quotes", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'say "hi"']]);
  });
});

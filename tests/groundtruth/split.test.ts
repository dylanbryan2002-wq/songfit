import { describe, it, expect } from "vitest";
import { assignSplits, splitFor } from "../../scripts/groundtruth/split";
import { parseClipsCsv } from "../../scripts/groundtruth/intake";

const HEADER = "file,link,niche,song,artist,start_seconds,views,typical_views,notes";

describe("splitFor", () => {
  it("is deterministic and puts about a third of ids in test", () => {
    expect(splitFor("clip-1")).toBe(splitFor("clip-1"));
    const ids = Array.from({ length: 600 }, (_, i) => `clip-${i}`);
    const test = ids.filter((id) => splitFor(id) === "test").length / ids.length;
    expect(test).toBeGreaterThan(0.25);
    expect(test).toBeLessThan(0.42);
  });
});

describe("assignSplits", () => {
  const csv = `${HEADER}\na.mp4,,comedy,"Hey, Soul Sister",Train,12,,,"she said ""no"""\nb.mp4,,fashion,Stay,Kid Laroi,0,500,,\n`;

  it("adds the split column at the end, keeping every other byte", () => {
    const out = assignSplits(csv);
    const lines = out.split("\n");
    expect(lines[0]).toBe(`${HEADER},split`);
    expect(lines[1]).toBe(`a.mp4,,comedy,"Hey, Soul Sister",Train,12,,,"she said ""no""",${splitFor("a")}`);
    expect(lines[2]).toBe(`b.mp4,,fashion,Stay,Kid Laroi,0,500,,,${splitFor("b")}`);
    expect(lines[3]).toBe("");
    expect(parseClipsCsv(out).map((c) => c.split)).toEqual([splitFor("a"), splitFor("b")]);
  });

  it("is idempotent and keeps an assignment already in the file", () => {
    const once = assignSplits(csv);
    expect(assignSplits(once)).toBe(once);
    const other = splitFor("a") === "test" ? "tune" : "test";
    const edited = once.replace(`"she said ""no""",${splitFor("a")}`, `"she said ""no""",${other}`);
    expect(assignSplits(edited)).toBe(edited);
  });

  it("fills a blank split cell and pads a short row", () => {
    const out = assignSplits(`${HEADER},split\na.mp4,,comedy,Hey,Train,12,,,,\nb.mp4,,fashion,Stay,Kid Laroi,0\n`);
    expect(out.split("\n")[1]).toBe(`a.mp4,,comedy,Hey,Train,12,,,,${splitFor("a")}`);
    expect(out.split("\n")[2]).toBe(`b.mp4,,fashion,Stay,Kid Laroi,0,,,,${splitFor("b")}`);
  });

  it("refuses a split column that is not last", () => {
    expect(() => assignSplits("file,split,song\na.mp4,,x\n")).toThrow(/last column/);
  });
});

describe("parseClipsCsv split column", () => {
  it("reads tune / test, leaves it undefined when blank, rejects other values", () => {
    expect(parseClipsCsv(`${HEADER},split\na.mp4,,,,,0,,,,test\nb.mp4,,,,,0,,,,\n`).map((c) => c.split)).toEqual(["test", undefined]);
    expect(() => parseClipsCsv(`${HEADER},split\na.mp4,,,,,0,,,,maybe\n`)).toThrow(/row 2.*split/);
  });
});

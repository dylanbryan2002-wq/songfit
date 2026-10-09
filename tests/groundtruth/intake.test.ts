import { describe, it, expect } from "vitest";
import { parseClipsCsv, clipId } from "../../scripts/groundtruth/intake";

const HEADER = "file,link,niche,song,artist,start_seconds,views,typical_views,notes";

describe("parseClipsCsv", () => {
  it("reads one row per line with every column", () => {
    const rows = parseClipsCsv(`${HEADER}\nmy clip.mp4,https://x/1,fashion,Blinding Lights,The Weeknd,43,1200000,20000,outfit reveal\n`);
    expect(rows).toEqual([{
      id: "my-clip", file: "my clip.mp4", link: "https://x/1", niche: "fashion",
      song: "Blinding Lights", artist: "The Weeknd", start_seconds: 43,
      views: 1200000, typical_views: 20000, notes: "outfit reveal",
    }]);
  });

  it("accepts quoted fields with commas and doubled quotes", () => {
    const rows = parseClipsCsv(`${HEADER}\na.mov,,comedy,"Hey, Soul Sister","Train",12.5,50000,,"she said ""no"", then left"`);
    expect(rows[0]?.song).toBe("Hey, Soul Sister");
    expect(rows[0]?.notes).toBe('she said "no", then left');
    expect(rows[0]?.start_seconds).toBe(12.5);
  });

  it("leaves optional columns empty when missing from the header", () => {
    const rows = parseClipsCsv("file,song,artist,start_seconds\nb.mp4,Stay,Kid Laroi,0");
    expect(rows[0]).toMatchObject({ id: "b", link: "", niche: "", views: null, typical_views: null, notes: "" });
  });

  it("rejects a bad start_seconds with the row number", () => {
    expect(() => parseClipsCsv("file,song,artist,start_seconds\nb.mp4,Stay,Kid Laroi,abc")).toThrow(/row 2.*start_seconds/);
    expect(() => parseClipsCsv("file,song,artist,start_seconds\nb.mp4,Stay,Kid Laroi,-3")).toThrow(/row 2.*start_seconds/);
  });

  it("rejects a missing required column or an empty song", () => {
    expect(parseClipsCsv("file,song,artist\nb.mp4,Stay,Kid Laroi")[0]?.start_seconds).toBe(0);
    expect(parseClipsCsv("file,song,artist,start_seconds\nb.mp4,,Kid Laroi,1")[0]?.song).toBe("");
  });

  it("rejects two rows for the same file", () => {
    expect(() => parseClipsCsv("file,song,artist,start_seconds\nb.mp4,Stay,Kid Laroi,1\nb.mp4,Stay,Kid Laroi,1")).toThrow(/duplicate/);
  });
});

describe("clipId", () => {
  it("slugs the file name without its extension", () => {
    expect(clipId("IMG_0042 Final (1).MOV")).toBe("img-0042-final-1");
  });
});

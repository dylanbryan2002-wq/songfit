import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { applyToCsv, parseIdentify, sameSong, sign, startSeconds, type ClipFingerprint, type Match } from "../../scripts/groundtruth/fingerprint";

const HEADER = "file,link,niche,song,artist,start_seconds,views,typical_views,notes";

describe("sign", () => {
  it("is HMAC-SHA1 over ACRCloud's fixed field order, base64", () => {
    const expected = createHmac("sha1", "secret").update("POST\n/v1/identify\nkey\naudio\n1\n1700000000").digest("base64");
    expect(sign("key", "secret", 1700000000)).toBe(expected);
  });
});

describe("startSeconds", () => {
  it("subtracts the sample end from the song position and floors at zero", () => {
    expect(startSeconds(44_000, 13)).toBe(31);
    expect(startSeconds(9_040, 20)).toBe(0);
    expect(startSeconds(30_550, 13)).toBe(17.6);
  });
});

describe("parseIdentify", () => {
  const ok = {
    status: { code: 0, msg: "Success" },
    metadata: { music: [
      { title: "Hello", artists: [{ name: "Adele" }], score: 100, play_offset_ms: 9040, duration_ms: 295000, external_ids: { isrc: "GBBKS1500214" }, external_metadata: { deezer: { track: { id: 110265034 } } } },
      { title: "Hello (Live)", artists: [{ name: "Adele" }], score: 80, play_offset_ms: 100 },
    ] },
  };
  it("returns the highest-scoring match with the clip start derived from play_offset_ms", () => {
    const m = parseIdentify(ok, 1, 7) as Match;
    expect(m.title).toBe("Hello");
    expect(m.artist).toBe("Adele");
    expect(m.deezer_id).toBe("110265034");
    expect(m.isrc).toBe("GBBKS1500214");
    expect(m.start_seconds).toBe(2);
    expect(m.sample_end_seconds).toBe(7);
  });
  it("returns null on no result (1001) and throws on other errors", () => {
    expect(parseIdentify({ status: { code: 1001, msg: "No result" } }, 1, 13)).toBeNull();
    expect(() => parseIdentify({ status: { code: 3003, msg: "Limit exceeded" } }, 1, 13)).toThrow(/3003/);
  });
});

describe("sameSong", () => {
  it("matches loosely on simplified titles", () => {
    expect(sameSong("Theme of Law & Order", "Law & Order")).toBe(true);
    expect(sameSong("On the Nature of Daylight", "On The Nature Of Daylight")).toBe(true);
    expect(sameSong("Sirens", "Florida")).toBe(false);
  });
});

describe("applyToCsv", () => {
  const match: Match = { title: "Sirens", artist: "Ludwig Göransson", score: 95, play_offset_ms: 61_000, duration_ms: null, deezer_id: null, isrc: null, sample_offset_seconds: 1, sample_end_seconds: 13, start_seconds: 48 };
  const fp = (file: string, best: Match | null): ClipFingerprint => ({ id: file.replace(/\.mp4$/, ""), file, best, samples: [] });
  it("fills empty song rows, cross-checks known ones in notes, and marks no-match rows", () => {
    const csv = `${HEADER}\nempty.mp4,,business,,,0,,,speech\nknown.mp4,,comedy,Hello,Adele,8,,,\nplaceholder.mp4,,comedy,Sirens,Ludwig Goransson,0,,,guess\nnone.mp4,,other,,,0,,,\n`;
    const out = applyToCsv(csv, new Map([["empty", fp("empty.mp4", match)], ["known", fp("known.mp4", match)], ["placeholder", fp("placeholder.mp4", match)], ["none", fp("none.mp4", null)]]));
    const lines = out.trim().split("\n");
    expect(lines[1]).toBe("empty.mp4,,business,Sirens,Ludwig Göransson,48,,,speech; acrcloud score 95");
    expect(lines[2]).toContain("known.mp4,,comedy,Hello,Adele,8,,,acrcloud heard Sirens — Ludwig Göransson starting 48 s (score 95)");
    expect(lines[3]).toBe("placeholder.mp4,,comedy,Sirens,Ludwig Goransson,48,,,guess; start from acrcloud (score 95)");
    expect(lines[4]).toBe("none.mp4,,other,,,0,,,acrcloud: no match");
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { orderForSheet, renderSheet, type SheetClip } from "../../scripts/groundtruth/rating-sheet";
import { parseRatingCsv } from "../../scripts/groundtruth/rating-apply";
import { parseGeminiReply } from "../../scripts/groundtruth/gemini";
import type { OursResult } from "../../scripts/groundtruth/ours";

const ours = JSON.parse(readFileSync("tests/groundtruth/fixtures/ours.json", "utf8")) as OursResult;
const gemini = parseGeminiReply(readFileSync("tests/groundtruth/fixtures/gemini-reply.md", "utf8"));
const withRole = (role: typeof gemini.music.role) => ({ ...gemini, music: { ...gemini.music, role } });

const clip = (id: string, g: SheetClip["gemini"]): SheetClip => ({ id, truth: { song: "Secret Song", artist: "Hidden Artist", start_seconds: 3 }, ours, gemini: g });

describe("orderForSheet", () => {
  it("puts amplify and punchline clips first, then narration, then the rest, keeping csv order inside each group", () => {
    const clips = [clip("n1", withRole("narration")), clip("none", null), clip("p1", withRole("punchline")), clip("c1", withRole("contrast")), clip("a1", withRole("amplify"))];
    expect(orderForSheet(clips, 10).map((c) => c.id)).toEqual(["p1", "a1", "n1", "none", "c1"]);
    expect(orderForSheet(clips, 2).map((c) => c.id)).toEqual(["p1", "a1"]);
  });
});

describe("renderSheet", () => {
  const { markdown, csv } = renderSheet([clip("a1", withRole("amplify")), clip("none", null)], "round1");

  it("shows the summary, key moment and top 5 picks with a rating line each, and never the real song", () => {
    expect(markdown).toContain("## 1. a1");
    expect(markdown).toContain("A colour-bar test pattern with a running counter; no people."); // Gemini summary when present
    expect(markdown).toContain("Key moment: 1s transition — counter advances");
    expect(markdown).toContain("## 2. none");
    expect(markdown).toContain("Colour bars and a counter: a synthetic test clip."); // ours when no Gemini
    expect(markdown).toContain("1. Blinding Lights — The Weeknd · 0:43–0:58\n   Use 0:43–0:58: the chorus hits on the flip.\n   Rating: [ ] good  [ ] no  — ");
    expect(markdown).toContain("2. Levitating — Dua Lipa · 0:30–0:45");
    expect(markdown).not.toContain("Secret Song");
    expect(markdown).not.toContain("Hidden Artist");
  });

  it("writes one csv row per pick with a blank rating", () => {
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("clip_id,rank,title,artist,start,end,rating");
    expect(lines[1]).toBe("a1,1,Blinding Lights,The Weeknd,43,58,");
    expect(lines).toHaveLength(5);
    expect(csv).not.toContain("Secret Song");
  });

  it("round-trips through rating-apply: typed answers become per-clip ratings, blanks are skipped", () => {
    const filled = csv.replace("a1,1,Blinding Lights,The Weeknd,43,58,", "a1,1,Blinding Lights,The Weeknd,43,58,good").replace("a1,2,Levitating,Dua Lipa,30,45,", "a1,2,Levitating,Dua Lipa,30,45,N");
    const byClip = parseRatingCsv(filled);
    expect([...byClip.keys()]).toEqual(["a1"]);
    expect(byClip.get("a1")).toEqual([
      { rank: 1, title: "Blinding Lights", artist: "The Weeknd", start: 43, end: 58, rating: "good" },
      { rank: 2, title: "Levitating", artist: "Dua Lipa", start: 30, end: 45, rating: "no" },
    ]);
    expect(() => parseRatingCsv(csv.replace("43,58,", "43,58,maybe"))).toThrow(/row 2.*maybe/);
  });
});

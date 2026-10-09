import { describe, it, expect, vi } from "vitest";
import { librarySections, directionFor } from "@/src/engine/candidates/librarySections";
import type { LibrarySong } from "@/src/engine/catalog/libraryMatch";
import { analysis, brief } from "../fixtures";

const s = (title: string, over: Partial<LibrarySong> = {}): LibrarySong => ({ id: title, title, artist: "X", jobs: ["drive_energy"], energy: 4, era: "2010s", year: 2015, fam: "known", vocals: "yes", rank: 1, mood: [], hook: "", proven: false, ...over });
const sec = (i: number) => ({ i, proposed_start: 30, proposed_end: 45, anchor_seconds: 32, section_is_vocal: true, section_reason: "chorus", fit_reason: "fits" });

describe("librarySections", () => {
  it("turns placed songs into library candidates and leaves out ones the model skipped or garbled", async () => {
    const call = vi.fn().mockResolvedValue(JSON.stringify([sec(0), { i: 1, bad: true }]));
    const out = await librarySections(analysis, brief, [s("One"), s("Two"), s("Three")], "drive_energy", { call });
    expect(out.map((c) => c.title)).toEqual(["One"]);
    expect(out[0]).toMatchObject({ origin: "library", proposed_start: 30, directions: ["safe"] });
  });
  it("labels recent songs current and niche ones unexpected", () => {
    expect(directionFor(s("a", { year: 2026 }), 2026)).toBe("current");
    expect(directionFor(s("b", { fam: "niche" }), 2026)).toBe("unexpected");
    expect(directionFor(s("c"), 2026)).toBe("safe");
  });
  it("throws with the raw text when the reply is not JSON", async () => {
    await expect(librarySections(analysis, brief, [s("One")], "drive_energy", { call: vi.fn().mockResolvedValue("nope") })).rejects.toThrow(/model text/);
  });
});

import { describe, it, expect } from "vitest";
import { CREATOR_LISTS, groupOf, matchedGroups, shortlistFor, SHORTLIST_MAX, type CreatorListEntry } from "@/src/engine/catalog/creatorLists";

const entry = (title: string) => CREATOR_LISTS.find((e) => e.title_raw === title)!;

describe("creator lists data", () => {
  it("resolved entries carry title, artist and Deezer id together, and no Deezer id appears twice", () => {
    for (const e of CREATOR_LISTS) expect(!!e.title && !!e.artist && !!e.deezer_id || (!e.title && !e.artist && !e.deezer_id)).toBe(true);
    const ids = CREATOR_LISTS.flatMap((e) => (e.deezer_id ? [e.deezer_id] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("counts an L4 mention as L3 when L3 also names the song (dependence policy)", () => {
    const money = entry("Money So Big");
    expect(money.mentions.map((m) => groupOf(money, m))).toEqual(["L2", "L3", "L3"]);
    expect(matchedGroups(money, ["educational"])).toEqual(["L2", "L3"]);
  });
  it("counts groups per type, not a union of types", () => {
    const runaway = entry("Runaway");
    expect(matchedGroups(runaway, ["storytelling"])).toEqual(["L2", "L5"]);
    expect(matchedGroups(runaway, ["emotional"])).toEqual(["L3"]);
    expect(matchedGroups(runaway, ["storytelling", "emotional", "motivational"])).toEqual(["L2", "L3", "L5"]); // 3 groups (Codex review 2)
  });
  it("keeps evidence per recording: the slowed New Home is not emotional evidence for the original", () => {
    expect(matchedGroups(entry("New Home"), ["emotional"])).toEqual(["L5"]);
    expect(matchedGroups(entry("New Home (Slowed)"), ["emotional"])).toEqual([]);
  });
});

describe("shortlistFor", () => {
  it("offers only resolved, non-banned songs with evidence for the type, most groups first", () => {
    const s = shortlistFor(["emotional"]);
    expect(s.length).toBeLessThanOrEqual(SHORTLIST_MAX);
    expect(s[0]).toMatchObject({ title: "Mrs Magic", groups: 3 });
    expect(s[1]).toMatchObject({ title: "Karen 3", groups: 2 });
    expect(s.every((p) => p.deezer_id && p.types.includes("emotional"))).toBe(true);
    expect(s.map((p) => p.title)).not.toContain("Gibran Alcocer"); // unresolved
  });
  it("never offers production-library songs", () => {
    expect(shortlistFor(["funny"])).toEqual([]);
  });
  it("offers nothing for no types", () => {
    expect(shortlistFor([])).toEqual([]);
  });
  it("dedupes by Deezer id and caps the list", () => {
    const dup: CreatorListEntry[] = [
      { title_raw: "a", title: "A", artist: "X", deezer_id: "1", mentions: [{ source: "L2", type: "sad" }] },
      { title_raw: "a2", title: "A", artist: "X", deezer_id: "1", mentions: [{ source: "L5", type: "sad" }, { source: "L6", type: "sad" }] },
      ...Array.from({ length: 10 }, (_, i): CreatorListEntry => ({ title_raw: `s${i}`, title: `S${i}`, artist: "Y", deezer_id: `x${i}`, mentions: [{ source: "L3", type: "sad" }] })),
    ];
    const s = shortlistFor(["sad"], dup, 4);
    expect(s).toHaveLength(4);
    expect(s[0]).toMatchObject({ deezer_id: "1", groups: 2 });
    expect(s.filter((p) => p.deezer_id === "1")).toHaveLength(1);
  });
});

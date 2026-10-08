import { describe, it, expect } from "vitest";
import { diversify } from "@/src/engine/diversify/diversify";
import type { DirectionTag } from "@/src/shared/types";
import { scored } from "../fixtures";

let n = 0;
const sc = (title: string, directions: DirectionTag[], total: number, artist = `Artist ${++n}`) =>
  scored({ title, canonical_title: title, artist, canonical_artist: artist, directions, deezer_id: String(++n), total_score: total });

describe("diversify", () => {
  it("rank 1 is top overall labeled Best fit; 2 and 3 come from other directions", () => {
    const out = diversify([
      sc("S1", ["safe"], 0.9), sc("S2", ["safe"], 0.85), sc("C1", ["current"], 0.8), sc("U1", ["unexpected"], 0.6), sc("C2", ["current"], 0.7),
    ]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "U1"]);
    expect(out.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(out.map((p) => p.direction_label)).toEqual(["Best fit", "More current", "Unexpected"]);
    expect(out[0]).toMatchObject({ start_seconds: 43, end_seconds: 58, aligned_to_moment: null });
  });
  it("a top candidate from the unexpected direction is still labeled Best fit", () => {
    const out = diversify([sc("U1", ["unexpected"], 0.95), sc("S1", ["safe"], 0.9), sc("C1", ["current"], 0.8)]);
    expect(out.map((p) => p.direction_label)).toEqual(["Best fit", "Safe bet", "More current"]);
  });
  it("a song proposed in two directions does not count as a different direction from rank 1", () => {
    const out = diversify([sc("S1", ["safe"], 0.9), sc("X", ["safe", "current"], 0.88), sc("C1", ["current"], 0.8), sc("U1", ["unexpected"], 0.5)]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "U1"]);
  });
  it("falls back to next best overall when a direction is empty", () => {
    const out = diversify([sc("S1", ["safe"], 0.9), sc("S2", ["safe"], 0.85), sc("C1", ["current"], 0.8)]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "S2"]);
    expect(out[2]!.direction_label).toBe("Safe bet");
  });
  it("prefers a different artist when a close alternative exists", () => {
    const out = diversify([
      sc("S1", ["safe"], 0.9, "Drake"), sc("C1", ["current"], 0.8, "Drake"), sc("C2", ["current"], 0.75, "SZA"), sc("U1", ["unexpected"], 0.5, "Khruangbin"),
    ]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C2", "U1"]);
  });
  it("keeps the repeated artist when the alternative is far worse", () => {
    const out = diversify([
      sc("S1", ["safe"], 0.9, "Drake"), sc("C1", ["current"], 0.8, "Drake"), sc("C2", ["current"], 0.5, "SZA"), sc("U1", ["unexpected"], 0.5, "Khruangbin"),
    ]);
    expect(out[1]!.title).toBe("C1");
  });
  it("never returns the same catalog_key twice", () => {
    const a = sc("S1", ["safe"], 0.9);
    const out = diversify([a, { ...a, directions: ["current"] }, sc("C1", ["current"], 0.8), sc("U1", ["unexpected"], 0.7)]);
    expect(new Set(out.map((p) => p.catalog_key)).size).toBe(3);
  });
  it("treats Deezer and iTunes recordings as distinct by catalog_key, and dedupes iTunes duplicates", () => {
    const i1 = scored({ title: "I1", canonical_artist: "Adele", directions: ["current"], verified_via: "itunes", deezer_id: null, itunes_id: "1", total_score: 0.85 });
    const i2 = scored({ title: "I2", canonical_artist: "Hozier", directions: ["unexpected"], verified_via: "itunes", deezer_id: null, itunes_id: "2", total_score: 0.7 });
    const out = diversify([sc("S1", ["safe"], 0.9), i1, { ...i1, directions: ["unexpected"] }, i2]);
    expect(out.map((p) => p.title)).toEqual(["S1", "I1", "I2"]);
  });
  it("throws with fewer than 3 candidates", () => {
    expect(() => diversify([sc("S1", ["safe"], 0.9), sc("S2", ["safe"], 0.8)])).toThrow(/fewer than 3/);
  });
  it("throws when duplicates leave fewer than 3 distinct songs", () => {
    const a = sc("S1", ["safe"], 0.9);
    expect(() => diversify([a, { ...a }, sc("C1", ["current"], 0.8)])).toThrow(/fewer than 3/);
  });
});

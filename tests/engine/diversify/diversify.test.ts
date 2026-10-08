import { describe, it, expect } from "vitest";
import { diversify, primaryDirection } from "@/src/engine/diversify/diversify";
import { normalizeArtist } from "@/src/engine/catalog/normalize";
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
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "U1", "S2", "C2"]);
    expect(out.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(out.map((p) => p.direction_label)).toEqual(["Best fit", "Recent", "Unexpected", "Safe bet", "Recent"]);
    expect(out[0]).toMatchObject({ start_seconds: 43, end_seconds: 58, aligned_to_moment: null });
  });
  it("a top candidate from the unexpected direction is still labeled Best fit", () => {
    const out = diversify([sc("U1", ["unexpected"], 0.95), sc("S1", ["safe"], 0.9), sc("C1", ["current"], 0.8)]);
    expect(out.map((p) => p.direction_label)).toEqual(["Best fit", "Safe bet", "Recent"]);
  });
  it("a song proposed in two directions does not count as a different direction from rank 1", () => {
    const out = diversify([sc("S1", ["safe"], 0.9), sc("X", ["safe", "current"], 0.88), sc("C1", ["current"], 0.8), sc("U1", ["unexpected"], 0.5)]);
    expect(out.map((p) => p.title)).toEqual(["S1", "C1", "U1", "X"]);
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
    expect(out.map((p) => p.title).slice(0, 3)).toEqual(["S1", "C2", "U1"]);
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
  it("15 from 60 across three directions: ranks 1..15, every batch of 5 holds each direction, no repeats", () => {
    // Safe songs score highest, so a plain top-15 would be all "safe".
    const dirs: DirectionTag[] = ["safe", "current", "unexpected"];
    const pool = dirs.flatMap((d, di) => Array.from({ length: 20 }, (_, i) => sc(`${d}${i}`, [d], 0.95 - di * 0.2 - i * 0.005)));
    const out = diversify(pool);
    expect(out.map((p) => p.rank)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(out[0]!.direction_label).toBe("Best fit");
    expect(new Set(out.map((p) => p.catalog_key)).size).toBe(15);
    for (let b = 0; b < 3; b++) {
      const batch = out.slice(b * 5, b * 5 + 5);
      expect(new Set(batch.map(primaryDirection))).toEqual(new Set(dirs));
    }
    expect(out.slice(1).every((p) => p.direction_label === { safe: "Safe bet", current: "Recent", unexpected: "Unexpected" }[primaryDirection(p)])).toBe(true);
  });
  it("a current+unexpected song counts as Recent, so the batch still gets an Unexpected label", () => {
    const out = diversify([
      sc("S1", ["safe"], 0.9), sc("CU", ["current", "unexpected"], 0.85), sc("S2", ["safe"], 0.6), sc("U1", ["unexpected"], 0.5),
    ]);
    expect(out.slice(0, 3).map((p) => p.title)).toEqual(["S1", "CU", "U1"]);
    expect(out.slice(0, 3).map((p) => p.direction_label)).toEqual(["Best fit", "Recent", "Unexpected"]);
  });
  it("returns every distinct candidate when fewer than 15 (7 verified -> 7 picks)", () => {
    const out = diversify([
      sc("S1", ["safe"], 0.9), sc("S2", ["safe"], 0.8), sc("S3", ["safe"], 0.7), sc("C1", ["current"], 0.6),
      sc("C2", ["current"], 0.5), sc("U1", ["unexpected"], 0.4), sc("U2", ["unexpected"], 0.3),
    ]);
    expect(out.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(out.slice(0, 5).map((p) => p.title)).toEqual(["S1", "C1", "U1", "S2", "C2"]);
  });
  it("does not repeat an artist inside a batch when a close alternative exists", () => {
    const pool = [
      sc("S1", ["safe"], 0.9, "Drake"), sc("C1", ["current"], 0.8, "SZA"), sc("U1", ["unexpected"], 0.7, "Khruangbin"),
      sc("S2", ["safe"], 0.69, "Drake"), sc("S3", ["safe"], 0.65, "Adele"), sc("C2", ["current"], 0.6, "Lorde"),
    ];
    const out = diversify(pool);
    expect(out.slice(0, 5).map((p) => p.title)).toEqual(["S1", "C1", "U1", "S3", "C2"]);
    const artists = out.slice(0, 5).map((p) => normalizeArtist(p.canonical_artist));
    expect(new Set(artists).size).toBe(5);
  });
  it("throws with fewer than 3 candidates", () => {
    expect(() => diversify([sc("S1", ["safe"], 0.9), sc("S2", ["safe"], 0.8)])).toThrow(/fewer than 3/);
  });
  it("throws when duplicates leave fewer than 3 distinct songs", () => {
    const a = sc("S1", ["safe"], 0.9);
    expect(() => diversify([a, { ...a }, sc("C1", ["current"], 0.8)])).toThrow(/fewer than 3/);
  });
});

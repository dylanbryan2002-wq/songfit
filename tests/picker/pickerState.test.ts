import { describe, it, expect } from "vitest";
import { allRejected, initialPickerState, pickerReducer, type PickerState } from "@/src/picker/state";
import type { PickerRow } from "@/src/shared/types";

const row = (rank: 1 | 2 | 3, flags: Partial<Pick<PickerRow, "selected" | "rejected">> = {}): PickerRow => ({
  rank,
  direction_label: "Best fit",
  title: `Song ${rank}`,
  artist: "Artist",
  start_seconds: 43,
  end_seconds: 58,
  explanation: "Because.",
  artwork_url: null,
  spotify_url: "https://open.spotify.com/search/x",
  deezer_url: null,
  deezer_id: "1",
  preview_url: "https://p.mp3",
  selected: flags.selected ?? false,
  rejected: flags.rejected ?? false,
});

const base = (): PickerState => initialPickerState([row(1), row(2), row(3)]);

describe("initialPickerState", () => {
  it("starts in the list with nothing chosen", () => {
    expect(base()).toEqual({
      mode: "list",
      auditioningRank: null,
      lastAuditionedRank: null,
      sampleStart: 0,
      chosenRank: null,
      rejected: new Set(),
      explanationOpen: null,
    });
  });
  it("seeds chosen and rejected from the server rows", () => {
    const s = initialPickerState([row(1, { rejected: true }), row(2, { selected: true }), row(3)]);
    expect(s.mode).toBe("chosen");
    expect(s.chosenRank).toBe(2);
    expect([...s.rejected]).toEqual([1]);
  });
});

describe("pickerReducer", () => {
  it("audition sets the playing rank; a different song resets the sample start", () => {
    let s = pickerReducer(base(), { type: "audition", rank: 1 });
    s = pickerReducer(s, { type: "sampleStart", seconds: 6 });
    expect(pickerReducer(s, { type: "audition", rank: 1 })).toMatchObject({ auditioningRank: 1, sampleStart: 6 });
    expect(pickerReducer(s, { type: "audition", rank: 2 })).toMatchObject({ auditioningRank: 2, sampleStart: 0 });
  });

  it("pause then play of the same song keeps its sample start", () => {
    let s = pickerReducer(base(), { type: "audition", rank: 2 });
    s = pickerReducer(s, { type: "sampleStart", seconds: 4.5 });
    s = pickerReducer(s, { type: "stop" });
    expect(s).toMatchObject({ auditioningRank: null, lastAuditionedRank: 2, sampleStart: 4.5 });
    expect(pickerReducer(s, { type: "audition", rank: 2 }).sampleStart).toBe(4.5);
    expect(pickerReducer(s, { type: "audition", rank: 1 }).sampleStart).toBe(0);
  });

  it("choosing a song stops a different one that is playing, and keeps the chosen one playing", () => {
    const playing2 = pickerReducer(base(), { type: "audition", rank: 2 });
    expect(pickerReducer(playing2, { type: "choose", rank: 1 })).toMatchObject({ chosenRank: 1, auditioningRank: null });
    expect(pickerReducer(playing2, { type: "choose", rank: 2 })).toMatchObject({ chosenRank: 2, auditioningRank: 2 });
  });

  it("stop clears the playing rank", () => {
    const s = pickerReducer(base(), { type: "audition", rank: 3 });
    expect(pickerReducer(s, { type: "stop" }).auditioningRank).toBeNull();
  });

  it("choose switches to the chosen view and clears that rank's rejection", () => {
    const rejected = pickerReducer(base(), { type: "reject", rank: 2 });
    const s = pickerReducer(rejected, { type: "choose", rank: 2 });
    expect(s).toMatchObject({ mode: "chosen", chosenRank: 2 });
    expect(s.rejected.has(2)).toBe(false);
  });

  it("unchoose goes back to the list and keeps the saved choice", () => {
    const s = pickerReducer(pickerReducer(base(), { type: "choose", rank: 1 }), { type: "unchoose" });
    expect(s).toMatchObject({ mode: "list", chosenRank: 1 });
  });

  it("reject adds the rank, un-chooses it and stops it if it was playing", () => {
    let s = pickerReducer(base(), { type: "choose", rank: 3 });
    s = pickerReducer(s, { type: "audition", rank: 3 });
    s = pickerReducer(s, { type: "reject", rank: 3 });
    expect(s).toMatchObject({ mode: "list", chosenRank: null, auditioningRank: null });
    expect(s.rejected.has(3)).toBe(true);
  });

  it("reject of another rank leaves the choice and playback alone", () => {
    let s = pickerReducer(base(), { type: "choose", rank: 1 });
    s = pickerReducer(s, { type: "audition", rank: 1 });
    s = pickerReducer(s, { type: "reject", rank: 2 });
    expect(s).toMatchObject({ mode: "chosen", chosenRank: 1, auditioningRank: 1 });
  });

  it("does not mutate the previous rejected set", () => {
    const s0 = base();
    pickerReducer(s0, { type: "reject", rank: 1 });
    expect(s0.rejected.size).toBe(0);
  });

  it("toggleExplanation opens one rank at a time and closes on a second tap", () => {
    let s = pickerReducer(base(), { type: "toggleExplanation", rank: 1 });
    expect(s.explanationOpen).toBe(1);
    s = pickerReducer(s, { type: "toggleExplanation", rank: 2 });
    expect(s.explanationOpen).toBe(2);
    expect(pickerReducer(s, { type: "toggleExplanation", rank: 2 }).explanationOpen).toBeNull();
  });

  it("serverState overwrites chosen and rejected (used to revert a failed save)", () => {
    let s = pickerReducer(base(), { type: "choose", rank: 2 });
    s = pickerReducer(s, { type: "serverState", selected: null, rejected: [1] });
    expect(s).toMatchObject({ mode: "list", chosenRank: null });
    expect([...s.rejected]).toEqual([1]);
    s = pickerReducer(s, { type: "serverState", selected: 3, rejected: [] });
    expect(s).toMatchObject({ mode: "chosen", chosenRank: 3 });
  });
});

describe("allRejected", () => {
  it("is true only when every shown rank is rejected", () => {
    let s = base();
    s = pickerReducer(s, { type: "reject", rank: 1 });
    s = pickerReducer(s, { type: "reject", rank: 2 });
    expect(allRejected(s, [1, 2, 3])).toBe(false);
    s = pickerReducer(s, { type: "reject", rank: 3 });
    expect(allRejected(s, [1, 2, 3])).toBe(true);
    expect(allRejected(base(), [])).toBe(false);
  });
});

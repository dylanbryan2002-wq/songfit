import type { PickerRow, Rank } from "@/src/shared/types";
import { PICKS_PER_BATCH } from "@/src/shared/config";

export type PickerMode = "list" | "chosen";

/**
 * Client-only screen state. `auditioningRank` + `sampleStart` describe the 30-second sample being
 * heard; `chosenRank` + `rejected` mirror what is saved. Neither ever changes the engine's
 * full-track section (C2).
 */
export type PickerState = {
  mode: PickerMode;
  auditioningRank: Rank | null;
  /** The last song auditioned, so Pause then Play keeps its adjusted sample start. */
  lastAuditionedRank: Rank | null;
  sampleStart: number;
  chosenRank: Rank | null;
  rejected: Set<Rank>;
  explanationOpen: Rank | null;
  /** Rows on screen: ranks 1..visibleCount. Grows by PICKS_PER_BATCH with "Show 5 more". */
  visibleCount: number;
  /** The "None of these?" answer was sent. */
  wantedSent: boolean;
};

export type PickerAction =
  | { type: "audition"; rank: Rank }
  | { type: "stop" }
  | { type: "sampleStart"; seconds: number }
  | { type: "choose"; rank: Rank }
  | { type: "unchoose" }
  | { type: "reject"; rank: Rank }
  | { type: "toggleExplanation"; rank: Rank }
  | { type: "serverState"; selected: Rank | null; rejected: Rank[] }
  | { type: "reveal"; total: number }
  | { type: "wantedSent" };

export function initialPickerState(rows: PickerRow[]): PickerState {
  const chosen = rows.find((r) => r.selected)?.rank ?? null;
  // A saved choice beyond the first batch stays on screen: reveal through the end of its batch.
  const through = Math.max(PICKS_PER_BATCH, chosen ? Math.ceil(chosen / PICKS_PER_BATCH) * PICKS_PER_BATCH : 0);
  return {
    mode: chosen ? "chosen" : "list",
    auditioningRank: null,
    lastAuditionedRank: null,
    sampleStart: 0,
    chosenRank: chosen,
    rejected: new Set(rows.filter((r) => r.rejected).map((r) => r.rank)),
    explanationOpen: null,
    visibleCount: Math.min(through, rows.length),
    wantedSent: false,
  };
}

export function pickerReducer(s: PickerState, a: PickerAction): PickerState {
  switch (a.type) {
    case "audition":
      return {
        ...s,
        auditioningRank: a.rank,
        lastAuditionedRank: a.rank,
        sampleStart: a.rank === s.lastAuditionedRank ? s.sampleStart : 0,
      };
    case "stop":
      return { ...s, auditioningRank: null };
    case "sampleStart":
      return { ...s, sampleStart: a.seconds };
    case "choose": {
      const rejected = new Set(s.rejected);
      rejected.delete(a.rank);
      // A different song playing would be hidden under the chosen view, so it stops.
      const stop = s.auditioningRank !== null && s.auditioningRank !== a.rank;
      return { ...s, mode: "chosen", chosenRank: a.rank, rejected, auditioningRank: stop ? null : s.auditioningRank };
    }
    case "unchoose":
      return { ...s, mode: "list" };
    case "reject": {
      const rejected = new Set(s.rejected).add(a.rank);
      const wasChosen = s.chosenRank === a.rank;
      return {
        ...s,
        rejected,
        chosenRank: wasChosen ? null : s.chosenRank,
        mode: wasChosen ? "list" : s.mode,
        auditioningRank: s.auditioningRank === a.rank ? null : s.auditioningRank,
      };
    }
    case "toggleExplanation":
      return { ...s, explanationOpen: s.explanationOpen === a.rank ? null : a.rank };
    case "serverState":
      return { ...s, mode: a.selected ? "chosen" : "list", chosenRank: a.selected, rejected: new Set(a.rejected) };
    case "reveal":
      return { ...s, visibleCount: Math.min(s.visibleCount + PICKS_PER_BATCH, a.total) };
    case "wantedSent":
      return { ...s, wantedSent: true };
  }
}

/** The batch number a "Show 5 more" press reveals (2 for the first press, 3 for the second). */
export function nextBatch(s: PickerState): number {
  return Math.floor(s.visibleCount / PICKS_PER_BATCH) + 1;
}

/** Under the list: "Show 5 more" while rows remain (rejections never hide them), then the "None of these?" box. */
export function moreControl(s: PickerState, rows: PickerRow[]): "more" | "wanted" {
  return s.visibleCount < rows.length ? "more" : "wanted";
}

/** True when every rank on screen has been turned down. */
export function allRejected(s: PickerState, ranks: Rank[]): boolean {
  return ranks.length > 0 && ranks.every((r) => s.rejected.has(r));
}

import type { PickerRow } from "@/src/shared/types";

type Rank = 1 | 2 | 3;

export type PickerMode = "list" | "chosen";

/**
 * Client-only screen state. `auditioningRank` + `sampleStart` describe the 30-second sample being
 * heard; `chosenRank` + `rejected` mirror what is saved. Neither ever changes the engine's
 * full-track section (C2).
 */
export type PickerState = {
  mode: PickerMode;
  auditioningRank: Rank | null;
  sampleStart: number;
  chosenRank: Rank | null;
  rejected: Set<Rank>;
  explanationOpen: Rank | null;
};

export type PickerAction =
  | { type: "audition"; rank: Rank }
  | { type: "stop" }
  | { type: "sampleStart"; seconds: number }
  | { type: "choose"; rank: Rank }
  | { type: "unchoose" }
  | { type: "reject"; rank: Rank }
  | { type: "toggleExplanation"; rank: Rank }
  | { type: "serverState"; selected: Rank | null; rejected: Rank[] };

export function initialPickerState(rows: PickerRow[]): PickerState {
  const chosen = rows.find((r) => r.selected)?.rank ?? null;
  return {
    mode: chosen ? "chosen" : "list",
    auditioningRank: null,
    sampleStart: 0,
    chosenRank: chosen,
    rejected: new Set(rows.filter((r) => r.rejected).map((r) => r.rank)),
    explanationOpen: null,
  };
}

export function pickerReducer(s: PickerState, a: PickerAction): PickerState {
  switch (a.type) {
    case "audition":
      return { ...s, auditioningRank: a.rank, sampleStart: a.rank === s.auditioningRank ? s.sampleStart : 0 };
    case "stop":
      return { ...s, auditioningRank: null };
    case "sampleStart":
      return { ...s, sampleStart: a.seconds };
    case "choose": {
      const rejected = new Set(s.rejected);
      rejected.delete(a.rank);
      return { ...s, mode: "chosen", chosenRank: a.rank, rejected };
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
  }
}

/** True when every rank on screen has been turned down. */
export function allRejected(s: PickerState, ranks: Rank[]): boolean {
  return ranks.length > 0 && ranks.every((r) => s.rejected.has(r));
}

import { describe, it, expect } from "vitest";
import { etaLabel, nextEta, tickEta, uploadFill, waitingFill, UPLOAD_SHARE } from "@/components/etaDisplay";

describe("etaLabel", () => {
  it("rounds to whole minutes from 90 s, hedged only with About", () => {
    expect(etaLabel(90)).toBe("About 2 min left");
    expect(etaLabel(200)).toBe("About 3 min left");
    expect(etaLabel(89)).toBe("About 1 min left");
    expect(etaLabel(60)).toBe("About 1 min left");
    expect(etaLabel(45)).toBe("About 1 min left");
  });
  it("says under a minute, then almost done, never 0 or negative", () => {
    expect(etaLabel(44)).toBe("Under a minute");
    expect(etaLabel(30)).toBe("Under a minute");
    expect(etaLabel(1)).toBe("Under a minute");
    expect(etaLabel(0)).toBe("Almost done");
    expect(etaLabel(-5)).toBe("Almost done");
  });
});

describe("nextEta", () => {
  it("takes the first estimate as the starting point", () => {
    expect(nextEta(null, 120)).toEqual({ eta: 120, initial: 120 });
    expect(nextEta(null, null)).toBeNull();
  });
  it("only goes down: a higher new estimate is ignored", () => {
    expect(nextEta({ eta: 60, initial: 120 }, 90)).toEqual({ eta: 60, initial: 120 });
    expect(nextEta({ eta: 60, initial: 120 }, 40)).toEqual({ eta: 40, initial: 120 });
    expect(nextEta({ eta: 60, initial: 120 }, null)).toEqual({ eta: 60, initial: 120 });
  });
  it("ticks down by a second, stopping at 0", () => {
    expect(tickEta({ eta: 10, initial: 120 })).toEqual({ eta: 9, initial: 120 });
    expect(tickEta({ eta: 0, initial: 120 })).toEqual({ eta: 0, initial: 120 });
    expect(tickEta(null)).toBeNull();
  });
});

describe("bar fill", () => {
  it("upload fills the first 15%", () => {
    expect(UPLOAD_SHARE).toBe(0.15);
    expect(uploadFill(0)).toBe(0);
    expect(uploadFill(50)).toBeCloseTo(0.075);
    expect(uploadFill(100)).toBeCloseTo(0.15);
    expect(uploadFill(140)).toBeCloseTo(0.15);
  });
  it("the wait fills the rest as the estimate runs down, capped at 95% until ready", () => {
    expect(waitingFill(null)).toBeCloseTo(0.15);
    expect(waitingFill({ eta: 120, initial: 120 })).toBeCloseTo(0.15);
    expect(waitingFill({ eta: 60, initial: 120 })).toBeCloseTo(0.575);
    expect(waitingFill({ eta: 0, initial: 120 })).toBe(0.95);
    expect(waitingFill({ eta: 0, initial: 0 })).toBe(0.95);
  });
});

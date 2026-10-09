import { describe, expect, it } from "vitest";
import { runDate, runLine, uploadsLeftCopy } from "@/components/accountCopy";

describe("runDate", () => {
  const now = new Date("2026-10-09T15:00:00Z");
  it("says Today, Yesterday, then day and month", () => {
    expect(runDate("2026-10-09T00:01:00+00:00", now)).toBe("Today");
    expect(runDate("2026-10-08T23:59:00Z", now)).toBe("Yesterday");
    expect(runDate("2026-10-03T10:00:00Z", now)).toBe("3 Oct");
    expect(runDate("2025-12-24T10:00:00Z", now)).toBe("24 Dec 2025");
  });
});

describe("runLine", () => {
  const chosen = { title: "Waiting Room", artist: "Fugazi" };
  it("shows the chosen song, or that none is chosen, or the run's state", () => {
    expect(runLine({ status: "ready", chosen })).toBe("Chose: Waiting Room · Fugazi");
    expect(runLine({ status: "ready", chosen: null })).toBe("No song chosen yet");
    for (const s of ["uploaded", "analyzing", "recommending"]) expect(runLine({ status: s, chosen: null })).toBe("Finding songs…");
    expect(runLine({ status: "failed", chosen })).toBe("Didn't work");
  });
});

describe("uploadsLeftCopy", () => {
  it("signed in: count plus the rolling-24h hint", () => {
    expect(uploadsLeftCopy(7, false)).toEqual({ line: "7 uploads left", hint: "Resets 24 hours after each upload" });
    expect(uploadsLeftCopy(1, false).line).toBe("1 upload left");
  });
  it("anonymous: free tries", () => {
    expect(uploadsLeftCopy(2, true)).toEqual({ line: "2 free tries left", hint: null });
    expect(uploadsLeftCopy(1, true).line).toBe("1 free try left");
  });
});

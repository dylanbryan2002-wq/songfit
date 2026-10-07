import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ mark: vi.fn(), logEvent: vi.fn(), calls: [] as string[] }));
vi.mock("@/src/db/queries/recommendations", () => ({ markRecommendationFeedback: m.mark }));
vi.mock("@/src/feedback/events", () => ({ logEvent: m.logEvent }));

import { applyFeedback } from "@/src/feedback/actions";

beforeEach(() => {
  m.calls.length = 0;
  m.mark.mockReset().mockImplementation(async () => {
    m.calls.push("write");
    return 1;
  });
  m.logEvent.mockReset().mockImplementation(async () => {
    m.calls.push("event");
  });
});

describe("applyFeedback", () => {
  it("select writes selected and clears rejected, then logs recommendation_selected", async () => {
    expect(await applyFeedback("c1", "s1", { action: "select", rank: 2 })).toBe("ok");
    expect(m.mark).toHaveBeenCalledWith("s1", 2, { selected: true, rejected: false });
    expect(m.logEvent).toHaveBeenCalledWith({
      name: "recommendation_selected",
      creatorId: "c1",
      submissionId: "s1",
      metadata: { rank: 2 },
    });
    expect(m.calls).toEqual(["write", "event"]);
  });

  it("reject writes rejected and clears selected, then logs recommendation_rejected", async () => {
    expect(await applyFeedback("c1", "s1", { action: "reject", rank: 3 })).toBe("ok");
    expect(m.mark).toHaveBeenCalledWith("s1", 3, { rejected: true, selected: false });
    expect(m.logEvent).toHaveBeenCalledWith({
      name: "recommendation_rejected",
      creatorId: "c1",
      submissionId: "s1",
      metadata: { rank: 3 },
    });
    expect(m.calls).toEqual(["write", "event"]);
  });

  it("all_rejected logs the event and writes nothing", async () => {
    expect(await applyFeedback("c1", "s1", { action: "all_rejected" })).toBe("ok");
    expect(m.mark).not.toHaveBeenCalled();
    expect(m.logEvent).toHaveBeenCalledWith({ name: "all_rejected", creatorId: "c1", submissionId: "s1" });
  });

  it("returns not_found and logs nothing when no row has that rank", async () => {
    m.mark.mockResolvedValue(0);
    expect(await applyFeedback("c1", "s1", { action: "select", rank: 1 })).toBe("not_found");
    expect(m.logEvent).not.toHaveBeenCalled();
  });

  it("a failed write throws and logs nothing", async () => {
    m.mark.mockRejectedValue(new Error("db down"));
    await expect(applyFeedback("c1", "s1", { action: "reject", rank: 1 })).rejects.toThrow("db down");
    expect(m.logEvent).not.toHaveBeenCalled();
  });
});

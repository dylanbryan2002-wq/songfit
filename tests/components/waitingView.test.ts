import { describe, it, expect } from "vitest";
import { waitingView, GIVE_UP_AFTER_MS, SLOW_AFTER_MS } from "@/components/waitingView";

describe("waitingView", () => {
  it("waits, then says it is slow, then gives up after about 7 minutes in flight", () => {
    expect(GIVE_UP_AFTER_MS).toBe(7 * 60_000);
    expect(waitingView("analyzing", 0)).toBe("waiting");
    expect(waitingView("analyzing", SLOW_AFTER_MS + 1)).toBe("slow");
    expect(waitingView("recommending", GIVE_UP_AFTER_MS - 1)).toBe("slow");
    expect(waitingView("recommending", GIVE_UP_AFTER_MS + 1)).toBe("failed");
  });
  it("shows failed at once for a failed run", () => {
    expect(waitingView("failed", 0)).toBe("failed");
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/src/db/client", () => ({ createServiceClient: () => ({}) }));

import { summarizeVibe, VIBE_LAUNCHED_AT } from "@/src/db/queries/metrics";

describe("summarizeVibe", () => {
  it("splits tagged vs untagged and counts picks per bucket", () => {
    const m = summarizeVibe(
      [
        { id: "a", vibe_tags: ["Funny"] },
        { id: "b", vibe_tags: ["Deep", "Travel"] },
        { id: "c", vibe_tags: [] },
        { id: "d" },
        { id: "e", vibe_tags: null },
      ],
      new Set(["a", "c", "zzz"]),
    );
    expect(m).toEqual({ total: 5, tagged: { n: 2, picked: 1 }, untagged: { n: 3, picked: 1 } });
  });

  it("launch constant is the deploy time", () => {
    expect(VIBE_LAUNCHED_AT).toBe("2026-10-08T20:00:00Z");
  });
});

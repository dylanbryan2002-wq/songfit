import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ createdAt: "" }));
vi.mock("@/src/db/client", () => ({
  createServiceClient: () => {
    const q = {
      upsert: () => q,
      select: () => q,
      single: async () => ({ data: { id: "g1", email: "a@b.co", created_at: m.createdAt }, error: null }),
    };
    return { from: () => q };
  },
}));

import { NEW_CREATOR_WINDOW_MS, ensureCreator } from "@/src/db/queries/creators";

describe("ensureCreator isNew", () => {
  const now = Date.parse("2026-10-09T12:00:00Z");

  it("is true for a row created by the auth trigger moments ago (first sign-in)", async () => {
    m.createdAt = new Date(now - 2_000).toISOString();
    expect((await ensureCreator("g1", "a@b.co", null, now)).isNew).toBe(true);
  });

  it("is false for a returning creator", async () => {
    m.createdAt = new Date(now - NEW_CREATOR_WINDOW_MS).toISOString();
    expect((await ensureCreator("g1", "a@b.co", null, now)).isNew).toBe(false);
  });
});

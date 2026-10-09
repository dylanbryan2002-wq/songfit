import { describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const q = {
  select: () => (calls.push("select"), q),
  eq: (c: string, v: unknown) => (calls.push(`eq ${c} ${String(v)}`), q),
  gte: (c: string, v: unknown) => (calls.push(`gte ${c} ${String(v)}`), Promise.resolve({ count: 4, error: null })),
};
vi.mock("@/src/db/client", () => ({
  createServiceClient: () => ({ from: (t: string) => (calls.push(`from ${t}`), q) }),
}));

import { countSubmissionsSince } from "@/src/db/queries/submissions";

describe("countSubmissionsSince", () => {
  it("counts the usage ledger (deleted videos still count), not submissions", async () => {
    expect(await countSubmissionsSince("c1", "2026-10-08T12:00:00.000Z")).toBe(4);
    expect(calls).toEqual(["from usage", "select", "eq creator_id c1", "gte created_at 2026-10-08T12:00:00.000Z"]);
  });
});

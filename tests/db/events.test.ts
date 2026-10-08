import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ops: [string, ...unknown[]][] = [];
const result = { count: 3 as number | null, error: null };
function chain() {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) q[m] = (...a: unknown[]) => { ops.push([m, ...a]); return q; };
  q.then = (res: (v: unknown) => unknown) => res(result);
  return q;
}
vi.mock("@/src/db/client", () => ({ createServiceClient: () => ({ from: chain }) }));

import { countEventsForSubmission } from "@/src/db/queries/events";

describe("countEventsForSubmission", () => {
  it("does a head count filtered by submission and name", async () => {
    expect(await countEventsForSubmission("s1", "pipeline_failed")).toBe(3);
    expect(ops).toContainEqual(["select", "*", { count: "exact", head: true }]);
    expect(ops).toContainEqual(["eq", "submission_id", "s1"]);
    expect(ops).toContainEqual(["eq", "name", "pipeline_failed"]);
  });
  it("treats a null count as 0", async () => {
    result.count = null;
    expect(await countEventsForSubmission("s1", "pipeline_failed")).toBe(0);
  });
});

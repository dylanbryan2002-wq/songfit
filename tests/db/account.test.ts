import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let rows: unknown[] = [];
let ops: [string, ...unknown[]][] = [];

function chain() {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "or", "order", "limit"]) {
    q[m] = (...a: unknown[]) => {
      ops.push([m, ...a]);
      return q;
    };
  }
  q.then = (res: (v: unknown) => unknown) => res({ data: rows, error: null });
  return q;
}
vi.mock("@/src/db/client", () => ({ createServiceClient: () => ({ from: chain }) }));

const { listAccountRuns, parseRunCursor, runCursor, RUNS_PER_PAGE } = await import("@/src/db/queries/account");

const ID = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";
const TS = "2026-10-09T12:34:56.123456+00:00";

beforeEach(() => {
  rows = [];
  ops = [];
});

describe("run cursor", () => {
  it("round-trips <created_at>_<id>", () => {
    expect(parseRunCursor(runCursor({ created_at: TS, id: ID }))).toEqual({ createdAt: TS, id: ID });
    expect(parseRunCursor(`2026-10-09T12:34:56Z_${ID}`)).toEqual({ createdAt: "2026-10-09T12:34:56Z", id: ID });
  });

  it("rejects anything else, so nothing odd reaches the filter", () => {
    for (const bad of [undefined, "", ID, `${TS}_nope`, `yesterday_${ID}`, `${TS}),id.gt.0_${ID}`, ["x"]]) {
      expect(parseRunCursor(bad)).toBeNull();
    }
  });
});

describe("listAccountRuns", () => {
  const row = (i: number, chosen: unknown[] = []) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    created_at: TS,
    status: "ready",
    recommendations: chosen,
  });

  it("filters to the creator and the selected pick, orders (created_at desc, id desc), asks one extra row", async () => {
    rows = [row(1, [{ title: "Waiting Room", artist: "Fugazi", artwork_url: null }]), row(2)];
    const { runs, next } = await listAccountRuns("creator-1", null);
    expect(ops).toEqual([
      ["select", "id, created_at, status, recommendations(title, artist, artwork_url)"],
      ["eq", "creator_id", "creator-1"],
      ["eq", "recommendations.selected", true],
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["limit", RUNS_PER_PAGE + 1],
    ]);
    expect(runs.map((r) => r.chosen)).toEqual([{ title: "Waiting Room", artist: "Fugazi", artwork_url: null }, null]);
    expect(next).toBeNull();
  });

  it("returns 20 and the cursor of the 20th when a 21st exists; applies the cursor as a tie-safe filter", async () => {
    rows = Array.from({ length: RUNS_PER_PAGE + 1 }, (_, i) => row(i));
    const { runs, next } = await listAccountRuns("creator-1", { createdAt: TS, id: ID });
    expect(runs).toHaveLength(RUNS_PER_PAGE);
    expect(next).toBe(runCursor(runs[RUNS_PER_PAGE - 1]!));
    expect(ops).toContainEqual(["or", `created_at.lt."${TS}",and(created_at.eq."${TS}",id.lt.${ID})`]);
  });
});

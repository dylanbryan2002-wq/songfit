import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

type Tables = Record<string, unknown[]>;
let tables: Tables = {};
const calls: { table: string; ops: [string, ...unknown[]][] }[] = [];

function chain(table: string) {
  const entry = { table, ops: [] as [string, ...unknown[]][] };
  calls.push(entry);
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "not", "order", "limit", "in"]) {
    q[m] = (...a: unknown[]) => { entry.ops.push([m, ...a]); return q; };
  }
  q.then = (res: (v: unknown) => unknown) => res({ data: tables[table] ?? [], error: null });
  return q;
}
vi.mock("@/src/db/client", () => ({ createServiceClient: () => ({ from: chain }) }));

import { listNotFoundSongs, countReports } from "@/src/db/queries/notFound";

beforeEach(() => { calls.length = 0; tables = {}; });

describe("listNotFoundSongs", () => {
  it("joins events to recommendations by submission and rank, then to the candidate's deezer id", async () => {
    tables.events = [
      { submission_id: "s1", metadata: { rank: 2 } },
      { submission_id: "s2", metadata: { rank: 1 } },
      { submission_id: "s3", metadata: { rank: "2" } }, // bad rank: ignored
      { submission_id: "s4", metadata: null },
    ];
    tables.recommendations = [
      { submission_id: "s1", rank: 1, title: "Wrong", artist: "X", candidate_id: "c0" },
      { submission_id: "s1", rank: 2, title: "Stay", artist: "Kid LAROI", candidate_id: "c1" },
      { submission_id: "s2", rank: 1, title: "Orphan", artist: "Y", candidate_id: null },
    ];
    tables.candidates = [{ id: "c1", deezer_id: "42" }, { id: "c0", deezer_id: "7" }];
    const rows = await listNotFoundSongs();
    expect(rows).toEqual([
      { title: "Stay", artist: "Kid LAROI", catalog_key: "deezer:42" },
      { title: "Orphan", artist: "Y", catalog_key: null },
    ]);
    const ev = calls.find((c) => c.table === "events")!;
    expect(ev.ops).toContainEqual(["eq", "name", "song_not_found"]);
    expect(ev.ops).toContainEqual(["limit", 500]);
    expect(calls.find((c) => c.table === "recommendations")!.ops).toContainEqual(["in", "submission_id", ["s1", "s2"]]);
    expect(calls.find((c) => c.table === "candidates")!.ops).toContainEqual(["in", "id", ["c1"]]);
  });

  it("returns [] without further queries when there are no usable reports", async () => {
    tables.events = [{ submission_id: "s1", metadata: {} }];
    expect(await listNotFoundSongs()).toEqual([]);
    expect(calls.map((c) => c.table)).toEqual(["events"]);
  });
});

describe("countReports", () => {
  it("counts per song, most reported first", () => {
    const out = countReports([
      { title: "A", artist: "Z", catalog_key: "deezer:1" },
      { title: "B", artist: "Z", catalog_key: null },
      { title: "A (feat. Q)", artist: "Z", catalog_key: "deezer:1" },
      { title: "b", artist: "z", catalog_key: null },
      { title: "B", artist: "Z", catalog_key: null },
    ]);
    expect(out).toEqual([
      { title: "B", artist: "Z", reports: 3 },
      { title: "A", artist: "Z", reports: 2 },
    ]);
  });
});

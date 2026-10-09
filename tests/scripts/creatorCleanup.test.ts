import { describe, expect, it } from "vitest";
import { deletablePaths, deleteEvents, folderOf, parseArgs, planCleanup, submissionPaths } from "@/scripts/lib/creatorCleanup";

const G = "g0000000-0000-4000-8000-000000000000";
const A = "a0000000-0000-4000-8000-000000000000";

describe("creator cleanup helpers", () => {
  it("parseArgs: dry run unless --yes", () => {
    expect(parseArgs(["a@b.co"])).toEqual({ positional: ["a@b.co"], yes: false });
    expect(parseArgs(["--yes", "a@b.co"])).toEqual({ positional: ["a@b.co"], yes: true });
  });

  it("submissionPaths keeps the original and the playback copy, drops nulls", () => {
    expect(submissionPaths([
      { video_path: `${A}/s1.mov`, playback_path: `${A}/s1.playback.mp4` },
      { video_path: `${G}/s2.mp4`, playback_path: null },
    ])).toEqual([`${A}/s1.mov`, `${A}/s1.playback.mp4`, `${G}/s2.mp4`]);
    expect(folderOf(`${A}/s1.mov`)).toBe(A);
  });

  it("deletablePaths: own files plus folder orphans, never another creator's claimed files", () => {
    const own = [`${G}/s2.mp4`];
    const listed = [`${G}/s2.mp4`, `${G}/orphan.mp4`, `${A}/s1.mov`];
    expect(deletablePaths(own, listed, new Set([`${A}/s1.mov`]))).toEqual([`${G}/orphan.mp4`, `${G}/s2.mp4`]);
  });
});

/** A tiny fake of the service client: submissions rows, storage folders, recorded deletes. */
function fakeClient(subs: { id: string; creator_id: string; video_path: string; playback_path: string | null }[], folders: Record<string, string[]>) {
  const deletes: { column: string; values: string[] }[] = [];
  const from = (table: string) => ({
    select: () => ({
      in: async (column: "creator_id" | "video_path" | "playback_path", values: string[]) => {
        expect(table).toBe("submissions");
        return { data: subs.filter((s) => values.includes(s[column] as string)), error: null };
      },
    }),
    delete: () => ({
      in: async (column: string, values: string[]) => {
        deletes.push({ column, values });
        return { count: values.length, error: null };
      },
    }),
  });
  const storage = {
    from: () => ({
      list: async (folder: string) => ({ data: (folders[folder] ?? []).map((name) => ({ id: name, name })), error: null }),
    }),
  };
  return { client: { from, storage } as never, deletes };
}

describe("planCleanup", () => {
  it("finds files under the anonymous folder of a claimed run, and keeps files another creator uses", async () => {
    const { client } = fakeClient(
      [
        { id: "s1", creator_id: G, video_path: `${A}/s1.mov`, playback_path: `${A}/s1.playback.mp4` },
        { id: "s3", creator_id: "other", video_path: `${A}/s3.mov`, playback_path: null },
      ],
      { [G]: ["orphan.mp4"], [A]: ["s1.mov", "s1.playback.mp4", "s3.mov"] },
    );
    const plan = await planCleanup(client, [G]);
    expect(plan.submissionIds).toEqual(["s1"]);
    expect(plan.folders).toEqual([A, G].sort());
    expect(plan.paths).toEqual([`${A}/s1.mov`, `${A}/s1.playback.mp4`, `${G}/orphan.mp4`].sort());
    expect(plan.keptForOthers).toEqual([`${A}/s3.mov`]);
  });

  it("deleteEvents removes rows by creator and by submission (events are SET NULL, not cascaded)", async () => {
    const { client, deletes } = fakeClient([], {});
    expect(await deleteEvents(client, [G], ["s1", "s2"])).toBe(3);
    expect(deletes).toEqual([{ column: "creator_id", values: [G] }, { column: "submission_id", values: ["s1", "s2"] }]);
  });
});

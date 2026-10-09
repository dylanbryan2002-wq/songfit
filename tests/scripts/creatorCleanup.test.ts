import { describe, expect, it } from "vitest";
import {
  anonymousUserDeletable,
  deletablePaths,
  deleteCreators,
  deleteEvents,
  folderOf,
  listFolder,
  parseArgs,
  planCleanup,
  submissionPaths,
} from "@/scripts/lib/creatorCleanup";

const G = "g0000000-0000-4000-8000-000000000000";
const A = "a0000000-0000-4000-8000-000000000000";

type Sub = { id: string; creator_id: string; video_path: string; playback_path: string | null };
type Row = Record<string, unknown>;

/**
 * A small fake of the service client: tables of rows with eq/is/in filters, select/delete,
 * storage objects (folders derived from "/" in the names) and auth users. Every write is
 * recorded in `ops`, in order.
 */
function fakeClient(init: { submissions?: Sub[]; creators?: Row[]; events?: Row[]; objects?: string[] }) {
  const tables: Record<string, Row[]> = {
    submissions: [...(init.submissions ?? [])],
    creators: [...(init.creators ?? [])],
    events: [...(init.events ?? [])],
  };
  let objects = [...(init.objects ?? [])];
  let removeError: string | null = null;
  const ops: string[] = [];

  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "delete" = "select";
    const run = () => {
      const hit = tables[table]!.filter((r) => filters.every((f) => f(r)));
      if (mode === "delete") {
        tables[table] = tables[table]!.filter((r) => !hit.includes(r));
        ops.push(`delete ${table} ${hit.length}`);
        return { data: null, count: hit.length, error: null };
      }
      return { data: hit, count: hit.length, error: null };
    };
    const q = {
      select: () => q,
      delete: () => {
        mode = "delete";
        return q;
      },
      eq: (c: string, v: unknown) => {
        filters.push((r) => r[c] === v);
        return q;
      },
      is: (c: string, v: unknown) => {
        filters.push((r) => (r[c] ?? null) === v);
        return q;
      },
      in: (c: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(r[c]));
        return q;
      },
      maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };

  const storage = {
    from: () => ({
      list: async (folder: string, opts: { limit: number; offset: number }) => {
        const names = new Map<string, boolean>(); // name → is a folder
        for (const o of objects) {
          if (!o.startsWith(`${folder}/`)) continue;
          const rest = o.slice(folder.length + 1).split("/");
          names.set(rest[0]!, rest.length > 1);
        }
        // Supabase lists a sub-folder as an entry with id null.
        const all = [...names].map(([name, isFolder]) => ({ id: isFolder ? null : name, name }));
        return { data: all.slice(opts.offset, opts.offset + opts.limit), error: null };
      },
      remove: async (paths: string[]) => {
        if (removeError) return { data: null, error: { message: removeError } };
        objects = objects.filter((o) => !paths.includes(o));
        ops.push(`remove ${paths.length}`);
        return { data: [], error: null };
      },
    }),
  };

  const auth = {
    admin: {
      deleteUser: async (id: string) => {
        ops.push(`deleteUser ${id}`);
        return { data: {}, error: null };
      },
    },
  };

  return {
    client: { from, storage, auth } as never,
    ops,
    tables,
    objects: () => objects,
    failRemove: (msg: string) => {
      removeError = msg;
    },
  };
}

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

  it("deletablePaths: own files plus folder orphans, never a file a kept submission references", () => {
    const own = [`${G}/s2.mp4`];
    const listed = [`${G}/s2.mp4`, `${G}/orphan.mp4`, `${A}/s1.mov`];
    expect(deletablePaths(own, listed, new Set([`${A}/s1.mov`]))).toEqual([`${G}/orphan.mp4`, `${G}/s2.mp4`]);
  });

  it("deletablePaths: an own path another submission still references is kept (bug: own paths were always deleted)", () => {
    expect(deletablePaths([`${G}/shared.mp4`, `${G}/s1.mp4`], [], new Set([`${G}/shared.mp4`]))).toEqual([`${G}/s1.mp4`]);
  });
});

describe("listFolder", () => {
  it("recurses into nested folders (bug: <uid>/<submissionId>/playback.mp4 was skipped)", async () => {
    const { client } = fakeClient({ objects: [`${G}/s1.mp4`, `${G}/s1/playback.mp4`, `${G}/s1/deep/x.mp4`, `${A}/other.mp4`] });
    expect((await listFolder(client, G)).sort()).toEqual([`${G}/s1.mp4`, `${G}/s1/deep/x.mp4`, `${G}/s1/playback.mp4`]);
  });
});

describe("planCleanup", () => {
  it("finds files under the anonymous folder of a claimed run, and keeps files another creator uses", async () => {
    const { client } = fakeClient({
      submissions: [
        { id: "s1", creator_id: G, video_path: `${A}/s1.mov`, playback_path: `${A}/s1.playback.mp4` },
        { id: "s3", creator_id: "other", video_path: `${A}/s3.mov`, playback_path: null },
      ],
      objects: [`${G}/orphan.mp4`, `${A}/s1.mov`, `${A}/s1.playback.mp4`, `${A}/s3.mov`],
    });
    const plan = await planCleanup(client, [G]);
    expect(plan.submissionIds).toEqual(["s1"]);
    expect(plan.folders).toEqual([A, G].sort());
    expect(plan.paths).toEqual([`${A}/s1.mov`, `${A}/s1.playback.mp4`, `${G}/orphan.mp4`].sort());
    expect(plan.keptForOthers).toEqual([`${A}/s3.mov`]);
  });

  it("checks the stored paths, not only listed objects (bug: an unlisted shared path was deleted)", async () => {
    // The shared object sits in no listed folder, but another creator's row stores it.
    const { client } = fakeClient({
      submissions: [
        { id: "s1", creator_id: G, video_path: "x/shared.mp4", playback_path: null },
        { id: "s2", creator_id: "other", video_path: "x/shared.mp4", playback_path: null },
      ],
    });
    const plan = await planCleanup(client, [G]);
    expect(plan.paths).toEqual([]);
    expect(plan.keptForOthers).toEqual(["x/shared.mp4"]);
  });

  it("deleting one video keeps a path another submission of the SAME creator references", async () => {
    const { client } = fakeClient({
      submissions: [
        { id: "s1", creator_id: G, video_path: `${G}/s1.mp4`, playback_path: `${G}/shared.playback.mp4` },
        { id: "s2", creator_id: G, video_path: `${G}/s2.mp4`, playback_path: `${G}/shared.playback.mp4` },
      ],
      objects: [`${G}/s1.mp4`, `${G}/s2.mp4`, `${G}/shared.playback.mp4`],
    });
    const plan = await planCleanup(client, [G], [], ["s1"]);
    expect(plan.submissionIds).toEqual(["s1"]);
    expect(plan.folders).toEqual([`${G}/s1`]); // only that run's own sub-folder is swept
    expect(plan.paths).toEqual([`${G}/s1.mp4`]);
  });

  it("includes nested playback objects in the folder sweep", async () => {
    const { client } = fakeClient({
      submissions: [{ id: "s1", creator_id: G, video_path: `${G}/s1.mp4`, playback_path: null }],
      objects: [`${G}/s1.mp4`, `${G}/s1/playback.mp4`],
    });
    expect((await planCleanup(client, [G])).paths).toEqual([`${G}/s1.mp4`, `${G}/s1/playback.mp4`]);
  });
});

describe("anonymousUserDeletable", () => {
  const anon = { id: A, email: null };

  it("needs an anonymous creators row, no remaining submissions and an empty folder", async () => {
    const { client } = fakeClient({ creators: [anon] });
    expect(await anonymousUserDeletable(client, A, [])).toBe(true);
  });

  it("refuses an id that is only a folder name, or a Google creator (bug: inferred from the folder)", async () => {
    expect(await anonymousUserDeletable(fakeClient({}).client, A, [])).toBe(false);
    expect(await anonymousUserDeletable(fakeClient({ creators: [{ id: A, email: "a@b.co" }] }).client, A, [])).toBe(false);
  });

  it("refuses while it still has a submission outside this cleanup", async () => {
    const { client } = fakeClient({
      creators: [anon],
      submissions: [{ id: "s9", creator_id: A, video_path: `${A}/s9.mp4`, playback_path: null }],
    });
    expect(await anonymousUserDeletable(client, A, [])).toBe(false);
    expect(await anonymousUserDeletable(client, A, ["s9"])).toBe(true);
  });

  it("refuses while objects remain in its folder (a claimed run another creator still uses)", async () => {
    const { client } = fakeClient({ creators: [anon], objects: [`${A}/s3/playback.mp4`] });
    expect(await anonymousUserDeletable(client, A, [])).toBe(false);
  });
});

describe("deleteEvents", () => {
  it("removes rows by creator and by submission (events are SET NULL, not cascaded)", async () => {
    const { client, tables } = fakeClient({
      events: [
        { id: "e1", creator_id: G, submission_id: null },
        { id: "e2", creator_id: null, submission_id: "s1" },
        { id: "e3", creator_id: "other", submission_id: "s9" },
      ],
    });
    expect(await deleteEvents(client, [G], ["s1", "s2"])).toBe(2);
    expect(tables.events!.map((e) => e.id)).toEqual(["e3"]);
  });
});

describe("deleteCreators", () => {
  const B = "b0000000-0000-4000-8000-000000000000";

  it("storage, then events, then the safe anonymous users, then the creator; keeps an anonymous user with objects left", async () => {
    const { client, ops, objects } = fakeClient({
      creators: [{ id: G, email: "g@b.co" }, { id: A, email: null }, { id: B, email: null }],
      submissions: [
        { id: "s1", creator_id: G, video_path: `${A}/s1.mov`, playback_path: null },
        { id: "s3", creator_id: "other", video_path: `${B}/s3.mov`, playback_path: null },
        { id: "s4", creator_id: G, video_path: `${B}/s4.mov`, playback_path: null },
      ],
      events: [{ id: "e1", creator_id: G, submission_id: "s1" }],
      objects: [`${A}/s1.mov`, `${B}/s3.mov`, `${B}/s4.mov`],
    });
    const plan = await planCleanup(client, [G]);
    const done = await deleteCreators(client, plan, { creatorIds: [G], anonymousIds: [A, B] });
    expect(objects()).toEqual([`${B}/s3.mov`]);
    expect(done).toEqual({ objects: 2, events: 1, anonymousDeleted: [A], anonymousKept: [B] });
    expect(ops).toEqual(["remove 2", "delete events 1", "delete events 0", `deleteUser ${A}`, `deleteUser ${G}`]);
  });

  it("touches no events or users when storage removal fails", async () => {
    const { client, ops, failRemove } = fakeClient({ creators: [{ id: G, email: "g@b.co" }] });
    failRemove("boom");
    await expect(
      deleteCreators(client, { submissionIds: [], folders: [], paths: [`${G}/x.mp4`], keptForOthers: [] }, { creatorIds: [G], anonymousIds: [] }),
    ).rejects.toThrow("storage remove: boom");
    expect(ops).toEqual([]);
  });
});

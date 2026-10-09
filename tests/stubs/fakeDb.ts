/**
 * A small fake of the Supabase service client for deletion tests: tables of rows with eq/is/in
 * filters, select/delete, storage objects (folders derived from "/" in the names) and auth users.
 * Every write is recorded in `ops`, in order; tests may push their own entries (e.g. logged events).
 */
type Row = Record<string, unknown>;

export function fakeDb(init: { tables?: Record<string, Row[]>; objects?: string[] }) {
  const tables: Record<string, Row[]> = {};
  for (const [k, rows] of Object.entries(init.tables ?? {})) tables[k] = rows.map((r) => ({ ...r }));
  let objects = [...(init.objects ?? [])];
  const fail = { remove: null as string | null, deleteUser: null as string | null };
  const ops: string[] = [];

  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: "select" | "delete" = "select";
    const run = () => {
      const rows = tables[table] ?? [];
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (mode === "delete") {
        tables[table] = rows.filter((r) => !hit.includes(r));
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
        if (fail.remove) return { data: null, error: { message: fail.remove } };
        objects = objects.filter((o) => !paths.includes(o));
        ops.push(`remove ${[...paths].sort().join(",")}`);
        return { data: [], error: null };
      },
    }),
  };

  const auth = {
    admin: {
      deleteUser: async (id: string) => {
        if (fail.deleteUser) return { data: null, error: { message: fail.deleteUser } };
        ops.push(`deleteUser ${id}`);
        return { data: {}, error: null };
      },
    },
  };

  return { client: { from, storage, auth } as never, ops, tables, objects: () => objects, fail };
}

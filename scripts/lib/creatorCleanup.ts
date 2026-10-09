/* Shared by scripts/delete-creator.ts and scripts/purge-anonymous.ts. Service role only.
   Storage has no foreign key to the tables, so files are found from submissions.video_path /
   playback_path AND by listing each creator's folder (uploads that never became a submission).
   A run claimed from an anonymous session keeps its files under the ANONYMOUS id's folder. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/db/types";

type Client = SupabaseClient<Database>;
const BUCKET = "videos";

export function parseArgs(argv: string[]): { positional: string[]; yes: boolean } {
  return { positional: argv.filter((a) => !a.startsWith("--")), yes: argv.includes("--yes") };
}

/** First path segment: the uid folder an object was uploaded under. */
export function folderOf(path: string): string {
  return path.split("/")[0] ?? "";
}

/** Paths stored on submission rows (original + playback copy), nulls dropped. */
export function submissionPaths(rows: { video_path: string; playback_path: string | null }[]): string[] {
  return rows.flatMap((r) => [r.video_path, r.playback_path]).filter((p): p is string => !!p);
}

/**
 * What to delete: every path on the creator's own submissions, plus every object found in the
 * listed folders unless a submission of SOMEONE ELSE points at it (a Google creator who claimed
 * runs from that anonymous folder keeps their files).
 */
export function deletablePaths(ownPaths: string[], folderObjects: string[], referencedByOthers: Set<string>): string[] {
  const out = new Set(ownPaths);
  for (const p of folderObjects) if (!referencedByOthers.has(p)) out.add(p);
  return [...out].sort();
}

export async function listFolder(supabase: Client, folder: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000, offset });
    if (error) throw new Error(`list ${folder}: ${error.message}`);
    out.push(...(data ?? []).filter((o) => o.id !== null).map((o) => `${folder}/${o.name}`));
    if ((data ?? []).length < 1000) return out;
  }
}

/** Paths among `paths` that a submission of a creator NOT in `ownIds` references. */
export async function referencedByOthers(supabase: Client, paths: string[], ownIds: string[]): Promise<Set<string>> {
  const hit = new Set<string>();
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    for (const column of ["video_path", "playback_path"] as const) {
      const { data, error } = await supabase.from("submissions").select("creator_id, video_path, playback_path").in(column, chunk);
      if (error) throw new Error(`submissions lookup: ${error.message}`);
      for (const r of data ?? []) {
        if (ownIds.includes(r.creator_id)) continue;
        const p = r[column];
        if (p) hit.add(p);
      }
    }
  }
  return hit;
}

export async function removeObjects(supabase: Client, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw new Error(`storage remove: ${error.message}`);
  }
}

/**
 * Everything to delete for these creator ids: their submissions' files, their folders' files (minus
 * files other creators' submissions reference), and the event rows that survive the cascade
 * (events.creator_id / submission_id are ON DELETE SET NULL).
 */
export async function planCleanup(supabase: Client, creatorIds: string[], extraFolders: string[] = []) {
  const { data: subs, error } = await supabase
    .from("submissions")
    .select("id, creator_id, video_path, playback_path")
    .in("creator_id", creatorIds);
  if (error) throw new Error(`submissions: ${error.message}`);
  const own = submissionPaths(subs ?? []);
  const folders = [...new Set([...creatorIds, ...extraFolders, ...own.map(folderOf)])].sort();
  const listed = (await Promise.all(folders.map((f) => listFolder(supabase, f)))).flat();
  const others = await referencedByOthers(supabase, listed, creatorIds);
  const paths = deletablePaths(own, listed, others);
  const submissionIds = (subs ?? []).map((s) => s.id);
  return { submissionIds, folders, paths, keptForOthers: [...others].sort() };
}

/** Event rows tied to these creators or their submissions. Deleted before the auth users. */
export async function deleteEvents(supabase: Client, creatorIds: string[], submissionIds: string[]): Promise<number> {
  let n = 0;
  const byCreator = await supabase.from("events").delete({ count: "exact" }).in("creator_id", creatorIds);
  if (byCreator.error) throw new Error(`events delete: ${byCreator.error.message}`);
  n += byCreator.count ?? 0;
  for (let i = 0; i < submissionIds.length; i += 100) {
    const r = await supabase.from("events").delete({ count: "exact" }).in("submission_id", submissionIds.slice(i, i + 100));
    if (r.error) throw new Error(`events delete: ${r.error.message}`);
    n += r.count ?? 0;
  }
  return n;
}

/** Deletes the auth user; the FK cascade removes creators → submissions → analyses, candidates, recommendations, subscriptions. */
export async function deleteAuthUser(supabase: Client, id: string): Promise<void> {
  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) throw new Error(`deleteUser ${id}: ${error.message}`);
}

/* Shared by scripts/delete-creator.ts and scripts/purge-anonymous.ts. Service role only.
   Storage has no foreign key to the tables, so files are found from submissions.video_path /
   playback_path AND by listing each creator's folder, sub-folders included (uploads that never
   became a submission, `<uid>/<submissionId>/playback.mp4`). A run claimed from an anonymous
   session keeps its files under the ANONYMOUS id's folder. */
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
 * What to delete: every path stored on the submissions being deleted, plus every object found in
 * the listed folders, minus every path a submission NOT being deleted references (another
 * creator's claimed run, or another run of the same creator when only one video goes).
 */
export function deletablePaths(ownPaths: string[], folderObjects: string[], referencedElsewhere: Set<string>): string[] {
  const out = new Set<string>();
  for (const p of [...ownPaths, ...folderObjects]) if (!referencedElsewhere.has(p)) out.add(p);
  return [...out].sort();
}

/** Every object under `folder`, recursing into sub-folders (Supabase lists those with id null). */
export async function listFolder(supabase: Client, folder: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(BUCKET).list(folder, { limit: 1000, offset });
    if (error) throw new Error(`list ${folder}: ${error.message}`);
    for (const o of data ?? []) {
      const path = `${folder}/${o.name}`;
      if (o.id === null) out.push(...(await listFolder(supabase, path)));
      else out.push(path);
    }
    if ((data ?? []).length < 1000) return out;
  }
}

/** Paths among `paths` stored as video_path or playback_path on a submission NOT in `deletingIds`. */
export async function referencedElsewhere(supabase: Client, paths: string[], deletingIds: string[]): Promise<Set<string>> {
  const hit = new Set<string>();
  const deleting = new Set(deletingIds);
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    for (const column of ["video_path", "playback_path"] as const) {
      const { data, error } = await supabase.from("submissions").select("id, video_path, playback_path").in(column, chunk);
      if (error) throw new Error(`submissions lookup: ${error.message}`);
      for (const r of data ?? []) {
        if (deleting.has(r.id)) continue;
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

export type CleanupPlan = { submissionIds: string[]; folders: string[]; paths: string[]; keptForOthers: string[] };

/**
 * The storage objects to delete for these creators' submissions. `onlySubmissionIds` narrows it to
 * those runs (one video): then only each run's own sub-folder is swept, not the creator's folder.
 * Both the stored paths and the listed objects are checked against every submission that stays.
 */
export async function planCleanup(
  supabase: Client,
  creatorIds: string[],
  extraFolders: string[] = [],
  onlySubmissionIds?: string[],
): Promise<CleanupPlan> {
  const { data, error } = await supabase
    .from("submissions")
    .select("id, creator_id, video_path, playback_path")
    .in("creator_id", creatorIds);
  if (error) throw new Error(`submissions: ${error.message}`);
  const subs = onlySubmissionIds ? (data ?? []).filter((s) => onlySubmissionIds.includes(s.id)) : (data ?? []);
  const own = submissionPaths(subs);
  const folders = onlySubmissionIds
    ? subs.map((s) => `${folderOf(s.video_path)}/${s.id}`).sort()
    : [...new Set([...creatorIds, ...extraFolders, ...own.map(folderOf)])].sort();
  const listed = (await Promise.all(folders.map((f) => listFolder(supabase, f)))).flat();
  const submissionIds = subs.map((s) => s.id);
  const others = await referencedElsewhere(supabase, [...new Set([...own, ...listed])], submissionIds);
  return { submissionIds, folders, paths: deletablePaths(own, listed, others), keptForOthers: [...others].sort() };
}

/** Event rows tied to these creators or their submissions. Deleted before the auth users. */
export async function deleteEvents(supabase: Client, creatorIds: string[], submissionIds: string[]): Promise<number> {
  let n = 0;
  if (creatorIds.length) {
    const byCreator = await supabase.from("events").delete({ count: "exact" }).in("creator_id", creatorIds);
    if (byCreator.error) throw new Error(`events delete: ${byCreator.error.message}`);
    n += byCreator.count ?? 0;
  }
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

/**
 * An anonymous auth user may be deleted only when it is one (a creators row with email null), it
 * has no submission outside `deletingSubmissionIds`, and its folder holds no object any more.
 * A folder name alone never proves any of that. Call it AFTER the planned objects are removed.
 */
export async function anonymousUserDeletable(supabase: Client, id: string, deletingSubmissionIds: string[]): Promise<boolean> {
  const { data: row, error } = await supabase.from("creators").select("id").eq("id", id).is("email", null).maybeSingle();
  if (error) throw new Error(`creator ${id}: ${error.message}`);
  if (!row) return false;
  const { data: subs, error: subErr } = await supabase.from("submissions").select("id").eq("creator_id", id);
  if (subErr) throw new Error(`submissions of ${id}: ${subErr.message}`);
  if ((subs ?? []).some((s) => !deletingSubmissionIds.includes(s.id))) return false;
  return (await listFolder(supabase, id)).length === 0;
}

export type CleanupResult = { objects: number; events: number; anonymousDeleted: string[]; anonymousKept: string[] };

/**
 * Runs a plan, in order: storage objects; then the events of `creatorIds`, of the anonymous users
 * that pass `anonymousUserDeletable`, and of the planned submissions; then those anonymous auth
 * users; then `creatorIds`' auth users. Throws at the first failure. Returns what was done, so the
 * caller logs nothing before everything succeeded.
 */
export async function deleteCreators(
  supabase: Client,
  plan: CleanupPlan,
  who: { creatorIds: string[]; anonymousIds: string[] },
): Promise<CleanupResult> {
  await removeObjects(supabase, plan.paths);
  const anonymousDeleted: string[] = [];
  const anonymousKept: string[] = [];
  for (const id of who.anonymousIds) {
    if (await anonymousUserDeletable(supabase, id, plan.submissionIds)) anonymousDeleted.push(id);
    else anonymousKept.push(id);
  }
  const events = await deleteEvents(supabase, [...who.creatorIds, ...anonymousDeleted], plan.submissionIds);
  for (const id of anonymousDeleted) await deleteAuthUser(supabase, id);
  for (const id of who.creatorIds) await deleteAuthUser(supabase, id);
  return { objects: plan.paths.length, events, anonymousDeleted, anonymousKept };
}

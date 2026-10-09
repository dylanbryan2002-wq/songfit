import "server-only";
import { createServiceClient } from "../client";
import { countSubmissionsSince } from "./submissions";
import { isUuid } from "@/src/shared/ids";
import { LIMITS } from "@/src/shared/config";

export const RUNS_PER_PAGE = 20;

/** One row of "My Songfits": a submission and the song the creator chose, if any. */
export type AccountRun = {
  id: string;
  created_at: string;
  status: string;
  chosen: { title: string; artist: string; artwork_url: string | null } | null;
};

export type RunCursor = { createdAt: string; id: string };

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

/** `?before=<created_at>_<id>` → its parts, or null when it is not exactly that shape. */
export function parseRunCursor(raw: unknown): RunCursor | null {
  if (typeof raw !== "string") return null;
  const cut = raw.lastIndexOf("_");
  if (cut < 0) return null;
  const createdAt = raw.slice(0, cut);
  const id = raw.slice(cut + 1);
  return TIMESTAMP.test(createdAt) && isUuid(id) ? { createdAt, id } : null;
}

export function runCursor(run: { created_at: string; id: string }): string {
  return `${run.created_at}_${run.id}`;
}

/**
 * The creator's submissions, newest first in the stable order (created_at desc, id desc), one page
 * after `before`, each with its selected recommendation. `next` is the cursor of the last row when
 * more rows follow.
 */
export async function listAccountRuns(
  creatorId: string,
  before: RunCursor | null,
): Promise<{ runs: AccountRun[]; next: string | null }> {
  let q = createServiceClient()
    .from("submissions")
    .select("id, created_at, status, recommendations(title, artist, artwork_url)")
    .eq("creator_id", creatorId)
    .eq("recommendations.selected", true);
  if (before) {
    // Values double-quoted: the timestamp holds ":" and "+" (PostgREST logic-tree syntax).
    q = q.or(`created_at.lt."${before.createdAt}",and(created_at.eq."${before.createdAt}",id.lt.${before.id})`);
  }
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RUNS_PER_PAGE + 1);
  if (error) throw error;
  const rows = data ?? [];
  const runs = rows.slice(0, RUNS_PER_PAGE).map((r) => ({
    id: r.id,
    created_at: r.created_at,
    status: r.status,
    chosen: r.recommendations[0] ?? null,
  }));
  const last = runs[runs.length - 1];
  return { runs, next: rows.length > RUNS_PER_PAGE && last ? runCursor(last) : null };
}

/** Uploads left under the rolling 24 h cap that create_submission() enforces (same count, same caps). */
export async function uploadsLeft(creatorId: string, anonymous: boolean): Promise<number> {
  const cap = anonymous ? LIMITS.dailyUploadsAnonymous : LIMITS.dailyUploadsPerCreator;
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  return Math.max(0, cap - (await countSubmissionsSince(creatorId, since)));
}

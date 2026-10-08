import "server-only";
import { createServiceClient } from "../client";
import { normalizeKey } from "@/src/engine/catalog/normalize";

/** One row per "Couldn't find it" report. catalog_key is null when the pick has no linked candidate. */
export type NotFoundSong = { title: string; artist: string; catalog_key: string | null; creator_id: string | null };

/** A song is banned for everyone only once this many distinct creators reported it. */
const BAN_MIN_CREATORS = 2;

const CHUNK = 100; // keeps the .in() URL well under PostgREST limits

function rankOf(metadata: unknown): number | null {
  const r = (metadata as { rank?: unknown } | null)?.rank;
  if (typeof r !== "number" && typeof r !== "string") return null;
  const n = typeof r === "string" && r.trim() === "" ? NaN : Number(r);
  return Number.isInteger(n) && n >= 1 && n <= 15 ? n : null;
}

/** Every report (admin table): events → (submission, rank) → recommendation → candidate. */
export async function listNotFoundReports(limit = 500): Promise<NotFoundSong[]> {
  const db = createServiceClient();
  const { data: events, error } = await db
    .from("events")
    .select("submission_id, creator_id, metadata")
    .eq("name", "song_not_found")
    .not("submission_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const pairs = (events ?? []).flatMap((e) => {
    const rank = rankOf(e.metadata);
    return e.submission_id && rank !== null ? [{ submission_id: e.submission_id, creator_id: e.creator_id, rank }] : [];
  });
  if (pairs.length === 0) return [];

  const ids = [...new Set(pairs.map((p) => p.submission_id))];
  const recs: { submission_id: string; rank: number; title: string; artist: string; candidate_id: string | null }[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error: recError } = await db
      .from("recommendations")
      .select("submission_id, rank, title, artist, candidate_id")
      .in("submission_id", ids.slice(i, i + CHUNK));
    if (recError) throw recError;
    recs.push(...(data ?? []));
  }
  const recAt = new Map(recs.map((r) => [`${r.submission_id}:${r.rank}`, r]));
  const hit = pairs.flatMap((p) => {
    const r = recAt.get(`${p.submission_id}:${p.rank}`);
    return r ? [{ ...r, creator_id: p.creator_id }] : [];
  });

  const candIds = [...new Set(hit.flatMap((r) => (r.candidate_id ? [r.candidate_id] : [])))];
  const deezerById = new Map<string, string | null>();
  for (let i = 0; i < candIds.length; i += CHUNK) {
    const { data, error: candError } = await db
      .from("candidates")
      .select("id, deezer_id")
      .in("id", candIds.slice(i, i + CHUNK));
    if (candError) throw candError;
    for (const c of data ?? []) deezerById.set(c.id, c.deezer_id);
  }

  return hit.map((r) => {
    const d = r.candidate_id ? deezerById.get(r.candidate_id) : null;
    return { title: r.title, artist: r.artist, catalog_key: d ? `deezer:${d}` : null, creator_id: r.creator_id };
  });
}

/** Reports for banned songs only: those at least two distinct creators reported. */
export async function listNotFoundSongs(limit = 500): Promise<NotFoundSong[]> {
  const rows = await listNotFoundReports(limit);
  const banned = new Set(countReports(rows).filter((r) => r.creators >= BAN_MIN_CREATORS).map((r) => r.key));
  return rows.filter((r) => banned.has(reportKey(r)));
}

const reportKey = (r: NotFoundSong) => r.catalog_key ?? normalizeKey(r.title, r.artist);

type ReportCount = { key: string; title: string; artist: string; reports: number; creators: number };

/** Group reports by song (same identity the engine bans on), most reported first. Anonymous reports add no creator. */
export function countReports(rows: NotFoundSong[]): ReportCount[] {
  const by = new Map<string, ReportCount & { ids: Set<string> }>();
  for (const r of rows) {
    const k = reportKey(r);
    const cur = by.get(k) ?? { key: k, title: r.title, artist: r.artist, reports: 0, creators: 0, ids: new Set<string>() };
    cur.reports += 1;
    if (r.creator_id) cur.ids.add(r.creator_id);
    by.set(k, cur);
  }
  return [...by.values()]
    .map(({ ids, ...c }) => ({ ...c, creators: ids.size }))
    .sort((a, b) => b.reports - a.reports);
}

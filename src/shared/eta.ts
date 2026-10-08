import { median } from "./stats";
import type { SubmissionStatus } from "./types";

/** Seconds each pipeline stage takes: analysis = analyzed_at − created_at, recommend = recommended_at − analyzed_at. */
export type StageMedians = { analysisSeconds: number; recommendSeconds: number };

/** Used until there are at least MIN_SAMPLES finished runs to learn from. */
export const FALLBACK_MEDIANS: StageMedians = { analysisSeconds: 75, recommendSeconds: 110 };
const MIN_SAMPLES = 3;

type Timings = { created_at: string | null; analyzed_at: string | null; recommended_at: string | null };

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** Median stage durations across recent ready runs; rows missing a timestamp or out of order are skipped. */
export function stageMedians(rows: Timings[]): StageMedians {
  const analysis: number[] = [];
  const recommend: number[] = [];
  for (const r of rows) {
    const a = (ms(r.analyzed_at) - ms(r.created_at)) / 1000;
    const b = (ms(r.recommended_at) - ms(r.analyzed_at)) / 1000;
    if (!(a >= 0) || !(b >= 0)) continue; // NaN-safe
    analysis.push(a);
    recommend.push(b);
  }
  if (analysis.length < MIN_SAMPLES) return FALLBACK_MEDIANS;
  return { analysisSeconds: median(analysis) ?? 0, recommendSeconds: median(recommend) ?? 0 };
}

/** Seconds until ready: what is left of the current stage plus the stages after it. null when unknown or failed. */
export function etaSeconds(
  sub: { status: SubmissionStatus; created_at: string | null | undefined; analyzed_at: string | null | undefined },
  m: StageMedians,
  nowMs: number,
): number | null {
  if (sub.status === "ready") return 0;
  if (sub.status === "failed") return null;
  if (sub.status === "recommending") {
    const since = ms(sub.analyzed_at);
    if (Number.isNaN(since)) return Math.round(m.recommendSeconds);
    return Math.round(Math.max(0, m.recommendSeconds - (nowMs - since) / 1000));
  }
  const since = ms(sub.created_at);
  if (Number.isNaN(since)) return null;
  return Math.round(Math.max(0, m.analysisSeconds - (nowMs - since) / 1000) + m.recommendSeconds);
}

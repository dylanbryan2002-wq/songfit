import "server-only";
import { z } from "zod";
import { createServiceClient } from "../client";
import { median } from "@/src/shared/stats";

const Raw = z.object({
  eventCounts: z.array(z.object({ name: z.string(), count: z.number() })),
  funnel: z.array(z.object({ stage: z.string(), submissions: z.number(), creators: z.number() })),
  uploadToReadySeconds: z.array(z.number()),
  readyToSelectionSeconds: z.array(z.number()),
  byCategory: z.array(z.object({ category: z.string(), ready: z.number(), selected: z.number() })),
  paidCreators: z.number(),
  paidEvents: z.number(),
  returningCreators: z.number(),
});

export type Metrics = {
  eventCounts: { name: string; count: number }[];
  funnel: { stage: string; submissions: number; creators: number }[];
  medianUploadToReadySeconds: number | null;
  medianReadyToSelectionSeconds: number | null;
  byCategory: { category: string; ready: number; selected: number }[];
  paidCreators: number;
  paidEvents: number;
  returningCreators: number;
};

export async function getMetrics(): Promise<Metrics> {
  const { data, error } = await createServiceClient().rpc("metrics_summary");
  if (error) throw new Error(`metrics_summary: ${error.message}`);
  const raw = Raw.parse(data);
  return {
    eventCounts: raw.eventCounts,
    funnel: raw.funnel,
    medianUploadToReadySeconds: median(raw.uploadToReadySeconds),
    medianReadyToSelectionSeconds: median(raw.readyToSelectionSeconds),
    byCategory: raw.byCategory,
    paidCreators: raw.paidCreators,
    paidEvents: raw.paidEvents,
    returningCreators: raw.returningCreators,
  };
}

/** The vibe step shipped here; only submissions created since count toward the vibe row. */
export const VIBE_LAUNCHED_AT = "2026-10-08T20:00:00Z";
/** A creator "picked a song" when any of these fired for the submission. */
const PICKED_EVENTS = ["recommendation_selected", "title_copied", "open_app"];

export type VibeMetrics = {
  total: number;
  tagged: { n: number; picked: number };
  untagged: { n: number; picked: number };
};

export function summarizeVibe(subs: { id: string; vibe_tags?: string[] | null }[], pickedIds: Set<string>): VibeMetrics {
  const out: VibeMetrics = { total: subs.length, tagged: { n: 0, picked: 0 }, untagged: { n: 0, picked: 0 } };
  for (const s of subs) {
    const bucket = s.vibe_tags?.length ? out.tagged : out.untagged;
    bucket.n += 1;
    if (pickedIds.has(s.id)) bucket.picked += 1;
  }
  return out;
}

export async function getVibeMetrics(): Promise<VibeMetrics> {
  const db = createServiceClient();
  const [subs, events] = await Promise.all([
    db.from("submissions").select("*").gte("created_at", VIBE_LAUNCHED_AT),
    db.from("events").select("submission_id").in("name", PICKED_EVENTS).gte("created_at", VIBE_LAUNCHED_AT),
  ]);
  if (subs.error) throw new Error(`vibe metrics: ${subs.error.message}`);
  if (events.error) throw new Error(`vibe metrics: ${events.error.message}`);
  const picked = new Set(events.data.map((e) => e.submission_id).filter((id): id is string => id !== null));
  // Cast until `pnpm db:types` includes 0008_vibe.sql.
  return summarizeVibe(subs.data as { id: string; vibe_tags?: string[] | null }[], picked);
}

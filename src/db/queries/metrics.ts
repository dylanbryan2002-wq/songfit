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

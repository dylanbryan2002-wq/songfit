import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type EventRow = Database["public"]["Tables"]["events"]["Row"];
export type EventInsert = Database["public"]["Tables"]["events"]["Insert"];

export async function insertEvent(row: EventInsert): Promise<void> {
  const { error } = await createServiceClient().from("events").insert(row);
  if (error) throw error;
}

export async function listEventsForSubmission(submissionId: string): Promise<EventRow[]> {
  const { data, error } = await createServiceClient()
    .from("events")
    .select("*")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function countEventsForSubmission(submissionId: string, name: string): Promise<number> {
  const { count, error } = await createServiceClient()
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("submission_id", submissionId)
    .eq("name", name);
  if (error) throw error;
  return count ?? 0;
}

/** Returns { name: count } across all events. Used by the admin metrics page. */
export async function countEventsByName(): Promise<Record<string, number>> {
  const { data, error } = await createServiceClient().from("events").select("name");
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of data) counts[row.name] = (counts[row.name] ?? 0) + 1;
  return counts;
}

export async function listEvents(limit = 5000): Promise<EventRow[]> {
  const { data, error } = await createServiceClient()
    .from("events")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data;
}

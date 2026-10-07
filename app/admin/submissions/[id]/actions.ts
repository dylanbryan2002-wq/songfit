"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/src/auth/session";
import { runSubmission } from "@/src/pipeline/run";
import { isUuid } from "@/src/shared/ids";

/**
 * Admin retry. Goes through the same claimed runner as the submit route (ruling C3), so a
 * retry while a run is still in flight is a safe no-op, and a stale in-flight row
 * (updated_at older than LIMITS.inFlightStaleMinutes) can be reclaimed.
 */
export async function retrySubmission(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("missing submission id");
  if (!isUuid(id)) throw new Error("invalid id");
  await runSubmission(id);
  revalidatePath(`/admin/submissions/${id}`);
  revalidatePath("/admin");
}

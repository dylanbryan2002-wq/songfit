import "server-only";
import { createServiceClient } from "../client";
import { logger } from "@/src/shared/logger";

/**
 * Records a Stripe event id AFTER it was processed successfully (C4 ruling).
 * Returns true when the row was written, false when the id already existed
 * (a redelivery that reached the end a second time; harmless).
 */
export async function recordStripeEvent(id: string, type: string): Promise<boolean> {
  const { error } = await createServiceClient().from("stripe_events").insert({ id, type });
  if (!error) return true;
  if (error.code === "23505") {
    logger.info("stripe event already recorded", { id, type });
    return false;
  }
  throw error;
}

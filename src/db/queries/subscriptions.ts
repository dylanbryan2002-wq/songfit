import "server-only";
import { createServiceClient } from "../client";
import type { Database } from "../types";

export type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];
export type SubscriptionStatus = "active" | "canceled" | "past_due";

export async function getActiveSubscription(creatorId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await createServiceClient()
    .from("subscriptions")
    .select("*")
    .eq("creator_id", creatorId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Idempotent on stripe_subscription_id (plain UNIQUE constraint in 0001_init.sql). */
export async function activateSubscription(input: {
  creatorId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): Promise<SubscriptionRow> {
  const { data, error } = await createServiceClient()
    .from("subscriptions")
    .upsert(
      {
        creator_id: input.creatorId,
        stripe_customer_id: input.stripeCustomerId,
        stripe_subscription_id: input.stripeSubscriptionId,
        status: "active",
        started_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setSubscriptionStatus(
  stripeSubscriptionId: string,
  status: SubscriptionStatus,
): Promise<void> {
  const { error } = await createServiceClient()
    .from("subscriptions")
    .update({ status })
    .eq("stripe_subscription_id", stripeSubscriptionId);
  if (error) throw error;
}

"use client";
import { createBrowserClient as createSsrBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

let client: SupabaseClient<Database> | undefined;

/** Browser client (anon key, RLS enforced). Safe for client components. */
export function createBrowserClient(): SupabaseClient<Database> {
  if (!client) {
    client = createSsrBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    ) as unknown as SupabaseClient<Database>;
  }
  return client;
}

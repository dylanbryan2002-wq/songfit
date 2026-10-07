import "server-only";
import { createServerClient as createSsrServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "@/src/shared/config";
import type { Database } from "./types";

export type Db = SupabaseClient<Database>;

/** Cookie-bound client that respects RLS. Use in server components, route handlers and server actions. */
export async function createServerClient(): Promise<Db> {
  const cookieStore = await cookies();
  // @supabase/ssr 0.5.2 types its return with the older 3-generic SupabaseClient; cast to the installed supabase-js shape.
  return createSsrServerClient<Database>(
    env("NEXT_PUBLIC_SUPABASE_URL"),
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component; middleware refreshes the session instead.
          }
        },
      },
    },
  ) as unknown as Db;
}

let serviceClient: Db | undefined;

/** Service-role client that bypasses RLS. Server only. Never expose to the browser. */
export function createServiceClient(): Db {
  if (!serviceClient) {
    serviceClient = createClient<Database>(
      env("NEXT_PUBLIC_SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return serviceClient;
}

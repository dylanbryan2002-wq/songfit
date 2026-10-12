import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS } from "@/src/shared/config";

// 0011 created the usage ledger; 0013 holds the current create_submission() body (15 uploads a day since 2026-10-12).
const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/0011_usage_ledger.sql"), "utf8");
const current = readFileSync(path.join(process.cwd(), "supabase/migrations/0013_fifteen_uploads.sql"), "utf8");
const fn = sql.slice(sql.indexOf("create or replace function public.create_submission"));

describe("create_submission() caps match src/shared/config.ts", () => {
  it("per-creator daily cap: anonymous (email null) vs signed in", () => {
    const m = current.match(/case when c\.email is null then (\d+) else (\d+) end/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(LIMITS.dailyUploadsAnonymous);
    expect(Number(m![2])).toBe(LIMITS.dailyUploadsPerCreator);
    expect(LIMITS.dailyUploadsPerCreator).toBe(15); // Dylan, 2026-10-12
    // No creators row: fall back to the anonymous cap.
    expect(current).toContain(`coalesce(daily_cap, ${LIMITS.dailyUploadsAnonymous})`);
  });

  it("global 24 h ceiling", () => {
    const m = current.match(/global_count >= (\d+)/);
    expect(Number(m?.[1])).toBe(LIMITS.globalDailySubmissions);
    expect(LIMITS.globalDailySubmissions).toBe(150);
  });

  it("raises distinguishable errors and keeps the paywall check", () => {
    expect(current).toContain("raise exception 'daily_limit'");
    expect(current).toContain("raise exception 'global_limit'");
    expect(current).toContain("raise exception 'needs_subscription'");
  });
});

describe("0011 usage ledger", () => {
  it("creates the append-only usage table with no FK, the index, RLS and no client grants", () => {
    expect(sql).toMatch(/create table public\.usage \(/);
    expect(sql).toMatch(/creator_id uuid not null,/);
    expect(sql).not.toMatch(/references/i);
    expect(sql).toContain("check (kind in ('submission'))");
    expect(sql).toContain("on public.usage (creator_id, created_at)");
    expect(sql).toContain("alter table public.usage enable row level security");
    expect(sql).toContain("revoke all on public.usage from anon, authenticated");
    expect(sql).not.toMatch(/create policy/i);
  });

  it("both caps count usage, never submissions", () => {
    expect(fn).toMatch(/select count\(\*\) into daily_count\s+from public\.usage\s+where creator_id = p_creator_id and created_at > now\(\) - interval '24 hours'/);
    expect(fn).toMatch(/select count\(\*\) into global_count\s+from public\.usage\s+where created_at > now\(\) - interval '24 hours'/);
  });

  it("writes one usage row with the submission, after the idempotent early return, and keeps both locks", () => {
    const insertUsage = fn.indexOf("insert into public.usage (creator_id, kind)");
    expect(insertUsage).toBeGreaterThan(fn.indexOf("insert into public.submissions"));
    expect(insertUsage).toBeGreaterThan(fn.indexOf("return existing;"));
    expect(fn).toContain("pg_advisory_xact_lock(hashtext('create_submission:global'))");
    expect(fn).toContain("pg_advisory_xact_lock(hashtext(p_creator_id::text))");
  });

  it("backfills the last 24 h of submissions", () => {
    expect(sql).toContain(
      "insert into public.usage (creator_id, created_at, kind)\nselect creator_id, created_at, 'submission' from public.submissions\nwhere created_at > now() - interval '24 hours';",
    );
  });
});

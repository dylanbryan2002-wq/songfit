import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS } from "@/src/shared/config";

const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/0010_hardening.sql"), "utf8");

describe("create_submission() caps match src/shared/config.ts", () => {
  it("per-creator daily cap: anonymous (email null) vs signed in", () => {
    const m = sql.match(/case when c\.email is null then (\d+) else (\d+) end/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(LIMITS.dailyUploadsAnonymous);
    expect(Number(m![2])).toBe(LIMITS.dailyUploadsPerCreator);
    // No creators row: fall back to the anonymous cap.
    expect(sql).toContain(`coalesce(daily_cap, ${LIMITS.dailyUploadsAnonymous})`);
  });

  it("global 24 h ceiling", () => {
    const m = sql.match(/global_count >= (\d+)/);
    expect(Number(m?.[1])).toBe(LIMITS.globalDailySubmissions);
    expect(LIMITS.globalDailySubmissions).toBe(150);
  });

  it("raises distinguishable errors and keeps the paywall check", () => {
    expect(sql).toContain("raise exception 'daily_limit'");
    expect(sql).toContain("raise exception 'global_limit'");
    expect(sql).toContain("raise exception 'needs_subscription'");
  });
});

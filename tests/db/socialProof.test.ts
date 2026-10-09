import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const m = vi.hoisted(() => ({ calls: [] as string[], count: 0 as number | null, error: null as Error | null }));
vi.mock("@/src/db/client", () => ({
  createServiceClient: () => ({
    from: (t: string) => {
      m.calls.push(`from ${t}`);
      const q = {
        select: (c: string, o: { count: string; head: boolean }) => (m.calls.push(`select ${c} ${o.count} ${o.head}`), q),
        eq: (c: string, v: unknown) => (m.calls.push(`eq ${c} ${String(v)}`), Promise.resolve({ count: m.count, error: m.error })),
      };
      return q;
    },
  }),
}));

import { READY_COUNT_TTL_MS, countReadySubmissions, resetReadyCountCache } from "@/src/db/queries/socialProof";
import { Headline } from "@/components/landing/Hero";
import { SOCIAL_PROOF_MIN } from "@/components/landing/copy";

beforeEach(() => {
  m.calls.length = 0;
  m.count = 0;
  m.error = null;
  resetReadyCountCache();
});

describe("countReadySubmissions", () => {
  it("counts ready submissions (head-only count) and caches the result for 10 minutes", async () => {
    m.count = 120;
    expect(await countReadySubmissions(0)).toBe(120);
    expect(m.calls).toEqual(["from submissions", "select id exact true", "eq status ready"]);
    m.count = 130;
    expect(await countReadySubmissions(READY_COUNT_TTL_MS - 1)).toBe(120);
    expect(m.calls).toHaveLength(3);
    expect(await countReadySubmissions(READY_COUNT_TTL_MS)).toBe(130);
  });

  it("throws on a database error and caches nothing", async () => {
    m.error = new Error("db down");
    await expect(countReadySubmissions(0)).rejects.toThrow("db down");
    m.error = null;
    m.count = 7;
    expect(await countReadySubmissions(1)).toBe(7);
  });
});

describe("social-proof line", () => {
  const html = (matched: number | null) => renderToStaticMarkup(createElement(Headline, { matched }));

  it("shows the real count from SOCIAL_PROOF_MIN (100) up", () => {
    expect(SOCIAL_PROOF_MIN).toBe(100);
    expect(html(100)).toContain("100 videos matched so far");
    expect(html(1234)).toContain("1,234 videos matched so far");
    expect(html(1234)).toContain("font-mono");
  });

  it("is hidden below 100 or when the count is unknown", () => {
    expect(html(99)).not.toContain("videos matched");
    expect(html(null)).not.toContain("videos matched");
    expect(renderToStaticMarkup(createElement(Headline))).not.toContain("videos matched");
  });
});

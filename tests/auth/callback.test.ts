import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({
  exchange: vi.fn(), getUser: vi.fn(), ensureCreator: vi.fn(), claimAnonymous: vi.fn(), logEvent: vi.fn(),
}));
vi.mock("@/src/db/client", () => ({
  createServerClient: async () => ({ auth: { exchangeCodeForSession: m.exchange, getUser: m.getUser } }),
}));
vi.mock("@/src/db/queries/creators", () => ({ ensureCreator: m.ensureCreator, claimAnonymous: m.claimAnonymous }));
vi.mock("@/src/feedback/events", () => ({ logEvent: m.logEvent }));

import { GET } from "@/app/auth/callback/route";

const NEXT = "/results/11111111-1111-4111-8111-111111111111";
const call = (cookie?: string) =>
  GET(
    new NextRequest(`http://x/auth/callback?code=abc&next=${encodeURIComponent(NEXT)}`, {
      headers: cookie ? { cookie } : {},
    }),
  );
const names = () => m.logEvent.mock.calls.map((c) => (c[0] as { name: string }).name);

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.exchange.mockResolvedValue({ error: null });
  m.getUser.mockResolvedValue({ data: { user: { id: "g1", email: "a@b.co", user_metadata: {} } } });
  m.ensureCreator.mockResolvedValue({ id: "g1", created_at: "2020-01-01T00:00:00Z" });
  m.claimAnonymous.mockResolvedValue(2);
  m.logEvent.mockResolvedValue(undefined);
});

describe("GET /auth/callback: claim", () => {
  it("moves the anonymous runs, logs results_gate_signed_in, clears the cookie, redirects to next", async () => {
    const res = await call("sf_claim=tok123");
    expect(m.claimAnonymous).toHaveBeenCalledWith(createHash("sha256").update("tok123").digest("hex"), "g1");
    expect(m.logEvent).toHaveBeenCalledWith({ name: "results_gate_signed_in", creatorId: "g1", metadata: { moved: 2 } });
    expect(res.headers.get("set-cookie") ?? "").toMatch(/sf_claim=;.*(Max-Age=0|Expires=Thu, 01 Jan 1970)/i);
    expect(res.headers.get("location")).toBe(`http://x${NEXT}`);
  });

  it("skips the claim without the cookie", async () => {
    const res = await call();
    expect(m.claimAnonymous).not.toHaveBeenCalled();
    expect(names()).not.toContain("results_gate_signed_in");
    expect(res.headers.get("location")).toBe(`http://x${NEXT}`);
  });

  it("a failed claim still signs the creator in and clears the cookie", async () => {
    m.claimAnonymous.mockRejectedValue(new Error("db down"));
    const res = await call("sf_claim=tok123");
    expect(res.headers.get("location")).toBe(`http://x${NEXT}`);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/sf_claim=;/);
    expect(names()).not.toContain("results_gate_signed_in");
  });

  it("never claims when the code exchange fails", async () => {
    m.exchange.mockResolvedValue({ error: new Error("bad code") });
    const res = await call("sf_claim=tok123");
    expect(m.claimAnonymous).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("http://x/?auth=failed");
  });
});

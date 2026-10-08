import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ getCreator: vi.fn(), checkUploadRate: vi.fn(), getSignedUploadUrl: vi.fn() }));
vi.mock("@/src/auth/session", () => ({ getCreator: m.getCreator }));
vi.mock("@/src/billing/rateLimit", () => ({ checkUploadRate: m.checkUploadRate }));
vi.mock("@/src/billing/paywall", () => ({ canSubmit: async () => ({ ok: true }) }));
vi.mock("@/src/media/storage", () => ({ getSignedUploadUrl: m.getSignedUploadUrl }));

import { POST } from "@/app/api/upload-url/route";

const call = () =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ext: "mp4", sizeBytes: 1000 }) }));

beforeEach(() => {
  m.getCreator.mockReset().mockResolvedValue({ id: "c1", email: "a@b.co" });
  m.checkUploadRate.mockReset().mockResolvedValue("ok");
  m.getSignedUploadUrl.mockReset().mockResolvedValue({ path: "p", token: "t", signedUrl: "u" });
});

describe("POST /api/upload-url", () => {
  it("429 daily_limit when today's cap is used", async () => {
    m.checkUploadRate.mockResolvedValue("daily_limit");
    const res = await call();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily_limit" });
    expect(m.getSignedUploadUrl).not.toHaveBeenCalled();
  });
  it("429 rate_limited on a burst", async () => {
    m.checkUploadRate.mockResolvedValue("rate_limited");
    const res = await call();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
  });
  it("issues a URL otherwise", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(m.getSignedUploadUrl).toHaveBeenCalled();
  });
});

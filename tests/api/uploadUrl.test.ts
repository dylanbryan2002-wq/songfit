import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ getViewer: vi.fn(), countSubmissionsSince: vi.fn(), getSignedUploadUrl: vi.fn() }));
vi.mock("@/src/auth/session", () => ({ getViewer: m.getViewer }));
vi.mock("@/src/db/queries/submissions", () => ({ countSubmissionsSince: m.countSubmissionsSince }));
vi.mock("@/src/billing/paywall", () => ({ canSubmit: async () => ({ ok: true }) }));
vi.mock("@/src/media/storage", () => ({ getSignedUploadUrl: m.getSignedUploadUrl }));

import { POST } from "@/app/api/upload-url/route";

let n = 0;
let id = "";
const call = () =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ext: "mp4", sizeBytes: 1000 }) }));
/** Today's submissions; the per-minute count stays 0. */
const today = (count: number) =>
  m.countSubmissionsSince.mockImplementation(async (_c: string, since: string) =>
    Date.now() - Date.parse(since) > 3_600_000 ? count : 0,
  );

beforeEach(() => {
  id = `v${++n}`; // fresh id per case: the in-memory burst store is module-level
  m.getViewer.mockReset().mockResolvedValue({ id, anonymous: false, email: "a@b.co" });
  m.countSubmissionsSince.mockReset();
  today(0);
  m.getSignedUploadUrl.mockReset().mockResolvedValue({ path: "p", token: "t", signedUrl: "u" });
});

describe("POST /api/upload-url", () => {
  it("401 without any session", async () => {
    m.getViewer.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
  it("429 daily_limit when today's cap is used", async () => {
    today(15);
    const res = await call();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily_limit" });
    expect(m.getSignedUploadUrl).not.toHaveBeenCalled();
  });
  it("rejects a 4th anonymous upload in 24 h, allows the 3rd", async () => {
    m.getViewer.mockResolvedValue({ id, anonymous: true, email: null });
    today(2);
    expect((await call()).status).toBe(200);
    today(3);
    const res = await call();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily_limit" });
  });
  it("issues a URL under the viewer's own folder", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(m.getSignedUploadUrl).toHaveBeenCalledWith(id, expect.any(String), "mp4");
  });
});

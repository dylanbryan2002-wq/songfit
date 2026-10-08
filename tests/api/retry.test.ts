import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ getCreator: vi.fn(), getSubmission: vi.fn(), runSubmission: vi.fn(), waitUntil: vi.fn() }));
vi.mock("@/src/auth/session", () => ({ getCreator: m.getCreator }));
vi.mock("@/src/db/queries/submissions", () => ({ getSubmission: m.getSubmission }));
vi.mock("@/src/pipeline/run", () => ({ runSubmission: m.runSubmission }));
vi.mock("@vercel/functions", () => ({ waitUntil: m.waitUntil }));

import { POST, maxDuration } from "@/app/api/submissions/[id]/retry/route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (id = ID) => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id }) });
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const sub = (status: string, updatedMin = 1, creator_id = "c1") => ({ id: ID, creator_id, status, updated_at: minutesAgo(updatedMin) });

beforeEach(() => {
  m.getCreator.mockReset().mockResolvedValue({ id: "c1", email: "a@b.co" });
  m.getSubmission.mockReset().mockResolvedValue(sub("failed"));
  m.runSubmission.mockReset().mockResolvedValue(undefined);
  m.waitUntil.mockReset();
});

describe("POST /api/submissions/[id]/retry", () => {
  it("has the full function budget", () => {
    expect(maxDuration).toBe(300);
  });
  it("401 when signed out", async () => {
    m.getCreator.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
  it("404 for a bad id or unknown submission", async () => {
    expect((await call("nope")).status).toBe(404);
    m.getSubmission.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
  });
  it("403 for someone else's submission, admins included", async () => {
    m.getCreator.mockResolvedValue({ id: "admin", email: "admin@x.co" });
    expect((await call()).status).toBe(403);
    expect(m.runSubmission).not.toHaveBeenCalled();
  });
  it("409 when ready or still fresh in flight", async () => {
    for (const s of [sub("ready", 60), sub("analyzing", 1)]) {
      m.getSubmission.mockResolvedValueOnce(s);
      const res = await call();
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "not_retryable" });
    }
    expect(m.runSubmission).not.toHaveBeenCalled();
  });
  it("202 and runs in the background when failed or stale in flight", async () => {
    expect((await call()).status).toBe(202);
    m.getSubmission.mockResolvedValueOnce(sub("recommending", 7));
    expect((await call()).status).toBe(202);
    expect(m.runSubmission).toHaveBeenCalledTimes(2);
    expect(m.runSubmission).toHaveBeenCalledWith(ID);
    expect(m.waitUntil).toHaveBeenCalledTimes(2);
  });
});

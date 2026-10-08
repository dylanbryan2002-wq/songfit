import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ getCreator: vi.fn(), getSubmission: vi.fn(), runSubmission: vi.fn(), waitUntil: vi.fn() }));
vi.mock("@/src/auth/session", () => ({ getCreator: m.getCreator, isAdmin: () => false }));
vi.mock("@/src/db/queries/submissions", () => ({ getSubmission: m.getSubmission }));
vi.mock("@/src/pipeline/run", () => ({ runSubmission: m.runSubmission }));
vi.mock("@vercel/functions", () => ({ waitUntil: m.waitUntil }));
vi.mock("@/src/db/queries/recommendations", () => ({ listRecommendations: async () => [] }));

import { GET, maxDuration } from "@/app/api/submissions/[id]/route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (id = ID) => GET(new Request("http://x"), { params: Promise.resolve({ id }) });
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const sub = (status: string, updatedMin = 1, creator_id = "c1") => ({
  id: ID, creator_id, status, error: status === "failed" ? "raw boom" : null, updated_at: minutesAgo(updatedMin),
});

beforeEach(() => {
  m.getCreator.mockReset().mockResolvedValue({ id: "c1", email: "a@b.co" });
  m.getSubmission.mockReset().mockResolvedValue(sub("analyzing"));
  m.runSubmission.mockReset().mockResolvedValue(undefined);
  m.waitUntil.mockReset();
});

describe("GET /api/submissions/[id]", () => {
  it("has the full function budget for a self-heal run", () => {
    expect(maxDuration).toBe(300);
  });
  it("401 signed out, 404 for a bad id or someone else's", async () => {
    expect((await call("nope")).status).toBe(404);
    m.getSubmission.mockResolvedValueOnce(sub("ready", 1, "other"));
    expect((await call()).status).toBe(404);
    m.getCreator.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
  it("does not restart a fresh in-flight run", async () => {
    await call();
    expect(m.runSubmission).not.toHaveBeenCalled();
    expect(m.waitUntil).not.toHaveBeenCalled();
  });
  it("restarts a stale in-flight run in the background", async () => {
    m.getSubmission.mockResolvedValue(sub("recommending", 7));
    const res = await call();
    expect((await res.json()).status).toBe("recommending");
    expect(m.runSubmission).toHaveBeenCalledWith(ID);
    expect(m.waitUntil).toHaveBeenCalledTimes(1);
  });
  it("never restarts failed or ready from the poll", async () => {
    for (const status of ["failed", "ready"]) {
      m.getSubmission.mockResolvedValue(sub(status, 60));
      await call();
    }
    expect(m.runSubmission).not.toHaveBeenCalled();
  });
});

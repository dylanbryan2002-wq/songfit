import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  getViewer: vi.fn(),
  getSubmission: vi.fn(),
  listRecentReadyTimings: vi.fn(),
  runSubmission: vi.fn(),
  waitUntil: vi.fn(),
  countEventsForSubmission: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/src/db/queries/events", () => ({ countEventsForSubmission: m.countEventsForSubmission }));
vi.mock("@/src/feedback/events", () => ({ logEvent: m.logEvent }));
vi.mock("@/src/auth/session", () => ({ getViewer: m.getViewer, isAdmin: () => false }));
vi.mock("@/src/db/queries/submissions", () => ({
  getSubmission: m.getSubmission,
  listRecentReadyTimings: m.listRecentReadyTimings,
}));
vi.mock("@/src/pipeline/run", () => ({ runSubmission: m.runSubmission }));
vi.mock("@vercel/functions", () => ({ waitUntil: m.waitUntil }));

import { GET, maxDuration } from "@/app/api/submissions/[id]/route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (id = ID) => GET(new Request("http://x"), { params: Promise.resolve({ id }) });
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
const sub = (status: string, updatedMin = 1, creator_id = "c1") => ({
  id: ID, creator_id, status, error: status === "failed" ? "raw boom" : null, updated_at: minutesAgo(updatedMin),
  created_at: minutesAgo(updatedMin), analyzed_at: null,
});

beforeEach(() => {
  m.getViewer.mockReset().mockResolvedValue({ id: "c1", anonymous: false, email: "a@b.co" });
  m.getSubmission.mockReset().mockResolvedValue(sub("analyzing"));
  m.listRecentReadyTimings.mockReset().mockResolvedValue([]);
  m.runSubmission.mockReset().mockResolvedValue(undefined);
  m.waitUntil.mockReset();
  m.countEventsForSubmission.mockReset().mockResolvedValue(0);
  m.logEvent.mockReset().mockResolvedValue(undefined);
});

describe("GET /api/submissions/[id]", () => {
  it("has the full function budget for a self-heal run", () => {
    expect(maxDuration).toBe(300);
  });
  it("401 signed out, 404 for a bad id or someone else's", async () => {
    expect((await call("nope")).status).toBe(404);
    m.getSubmission.mockResolvedValueOnce(sub("ready", 1, "other"));
    expect((await call()).status).toBe(404);
    m.getViewer.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
  it("lets an anonymous viewer poll their own submission, not someone else's", async () => {
    m.getViewer.mockResolvedValue({ id: "a1", anonymous: true, email: null });
    m.getSubmission.mockResolvedValue(sub("analyzing", 1, "a1"));
    expect((await (await call()).json()).status).toBe("analyzing");
    m.getSubmission.mockResolvedValue(sub("analyzing", 1, "c1"));
    expect((await call()).status).toBe(404);
  });
  it("returns status, error and eta only, never the raw message", async () => {
    m.getSubmission.mockResolvedValue(sub("ready", 30));
    expect(await (await call()).json()).toEqual({ status: "ready", error: null, etaSeconds: 0 });
    m.getSubmission.mockResolvedValue(sub("failed", 30));
    expect(await (await call()).json()).toEqual({ status: "failed", error: "failed", etaSeconds: null });
  });
  it("estimates the time left from recent runs (fallback medians with no history)", async () => {
    m.getSubmission.mockResolvedValue({ ...sub("analyzing"), created_at: new Date(Date.now() - 25_000).toISOString() });
    const { etaSeconds } = await (await call()).json();
    expect(etaSeconds).toBeGreaterThanOrEqual(159); // 75 - 25 + 110
    expect(etaSeconds).toBeLessThanOrEqual(161);
  });
  it("etaSeconds is null, not an error, when it cannot be estimated", async () => {
    m.getSubmission.mockResolvedValue({ ...sub("analyzing"), created_at: null });
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).etaSeconds).toBeNull();
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
    expect(m.countEventsForSubmission).toHaveBeenCalledWith(ID, "stale_restart");
    expect(m.logEvent).toHaveBeenCalledWith({
      name: "stale_restart", creatorId: "c1", submissionId: ID, metadata: { status: "recommending" },
    });
  });
  it("restarts at most twice per submission, counted from stale_restart events", async () => {
    m.getSubmission.mockResolvedValue(sub("analyzing", 7));
    m.countEventsForSubmission.mockResolvedValue(1);
    await call();
    expect(m.runSubmission).toHaveBeenCalledTimes(1);
    m.countEventsForSubmission.mockResolvedValue(2);
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("analyzing");
    expect(m.runSubmission).toHaveBeenCalledTimes(1);
    expect(m.logEvent).toHaveBeenCalledTimes(1);
  });
  it("a fresh run reads no restart count", async () => {
    await call();
    expect(m.countEventsForSubmission).not.toHaveBeenCalled();
  });
  it("never restarts failed or ready from the poll", async () => {
    for (const status of ["failed", "ready"]) {
      m.getSubmission.mockResolvedValue(sub(status, 60));
      await call();
    }
    expect(m.runSubmission).not.toHaveBeenCalled();
  });
});

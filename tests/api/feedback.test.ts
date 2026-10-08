import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ getCreator: vi.fn(), getSubmission: vi.fn(), applyFeedback: vi.fn() }));
vi.mock("@/src/db/queries/recommendations", () => ({ markRecommendationFeedback: vi.fn() }));
vi.mock("@/src/auth/session", () => ({ getCreator: m.getCreator }));
vi.mock("@/src/db/queries/submissions", () => ({ getSubmission: m.getSubmission }));
vi.mock("@/src/feedback/actions", async (orig) => ({ ...(await orig<object>()), applyFeedback: m.applyFeedback }));

import { POST } from "@/app/api/submissions/[id]/feedback/route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (body: unknown, id = ID) =>
  POST(new Request("http://x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  m.getCreator.mockReset().mockResolvedValue({ id: "c1", email: "a@b.co" });
  m.getSubmission.mockReset().mockResolvedValue({ id: ID, creator_id: "c1", status: "ready" });
  m.applyFeedback.mockReset().mockResolvedValue("ok");
});

describe("POST /api/submissions/[id]/feedback", () => {
  it("401 when signed out", async () => {
    m.getCreator.mockResolvedValue(null);
    expect((await call({ action: "select", rank: 1 })).status).toBe(401);
  });

  it("400 on a bad body", async () => {
    for (const body of ["not json", { action: "select" }, { action: "select", rank: 16 }, { action: "select", rank: 0 }, { action: "select", rank: 1.5 }, { action: "love", rank: 1 }]) {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    expect(m.applyFeedback).not.toHaveBeenCalled();
  });

  it("403 for someone else's submission, admins included", async () => {
    m.getSubmission.mockResolvedValue({ id: ID, creator_id: "other", status: "ready" });
    const res = await call({ action: "select", rank: 1 });
    expect(res.status).toBe(403);
    expect(m.applyFeedback).not.toHaveBeenCalled();
  });

  it("404 for a bad id, unknown submission, not ready, or no such recommendation", async () => {
    expect((await call({ action: "select", rank: 1 }, "nope")).status).toBe(404);
    m.getSubmission.mockResolvedValueOnce(null);
    expect((await call({ action: "select", rank: 1 })).status).toBe(404);
    m.getSubmission.mockResolvedValueOnce({ id: ID, creator_id: "c1", status: "recommending" });
    expect((await call({ action: "select", rank: 1 })).status).toBe(404);
    m.applyFeedback.mockResolvedValueOnce("not_found");
    expect((await call({ action: "select", rank: 3 })).status).toBe(404);
  });

  it("204 and applies the action as the owner", async () => {
    const res = await call({ action: "reject", rank: 2 });
    expect(res.status).toBe(204);
    expect(m.applyFeedback).toHaveBeenCalledWith("c1", ID, { action: "reject", rank: 2 });
    expect((await call({ action: "select", rank: 15 })).status).toBe(204);
    expect(m.applyFeedback).toHaveBeenLastCalledWith("c1", ID, { action: "select", rank: 15 });
    expect((await call({ action: "all_rejected" })).status).toBe(204);
    expect(m.applyFeedback).toHaveBeenLastCalledWith("c1", ID, { action: "all_rejected" });
  });
});

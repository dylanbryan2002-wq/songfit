import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ getCreator: vi.fn(), getSubmission: vi.fn(), logEvent: vi.fn() }));
vi.mock("@/src/auth/session", () => ({ getCreator: m.getCreator }));
vi.mock("@/src/db/queries/submissions", () => ({ getSubmission: m.getSubmission }));
vi.mock("@/src/feedback/events", () => ({ logEvent: m.logEvent }));

import { POST } from "@/app/api/submissions/[id]/events/route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (body: unknown, id = ID) =>
  POST(new Request("http://x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  m.getCreator.mockReset().mockResolvedValue({ id: "c1", email: "a@b.co" });
  m.getSubmission.mockReset().mockResolvedValue({ id: ID, creator_id: "c1", status: "ready" });
  m.logEvent.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/submissions/[id]/events", () => {
  it("401 when signed out", async () => {
    m.getCreator.mockResolvedValue(null);
    expect((await call({ name: "song_previewed", rank: 1 })).status).toBe(401);
  });

  it("400 for any name outside the five UI events", async () => {
    for (const name of ["recommendation_selected", "paid", "all_rejected", "anything"]) {
      expect((await call({ name, rank: 1 })).status).toBe(400);
    }
    expect((await call({ name: "song_previewed", rank: 5 })).status).toBe(400);
    expect((await call({ name: "open_app", rank: 1 })).status).toBe(400); // destination required
    expect((await call({ name: "open_app", rank: 1, destination: "youtube" })).status).toBe(400);
    expect((await call("nope")).status).toBe(400);
    expect(m.logEvent).not.toHaveBeenCalled();
  });

  it("403 for someone else's submission", async () => {
    m.getSubmission.mockResolvedValue({ id: ID, creator_id: "other", status: "ready" });
    expect((await call({ name: "song_previewed", rank: 1 })).status).toBe(403);
  });

  it("404 for a bad id, unknown submission or not ready", async () => {
    expect((await call({ name: "song_previewed", rank: 1 }, "nope")).status).toBe(404);
    m.getSubmission.mockResolvedValueOnce(null);
    expect((await call({ name: "song_previewed", rank: 1 })).status).toBe(404);
    m.getSubmission.mockResolvedValueOnce({ id: ID, creator_id: "c1", status: "analyzing" });
    expect((await call({ name: "song_previewed", rank: 1 })).status).toBe(404);
  });

  it("204 and logs { rank } for the four plain events", async () => {
    for (const name of ["song_previewed", "explanation_opened", "title_copied", "song_not_found"]) {
      const res = await call({ name, rank: 2 });
      expect(res.status).toBe(204);
      expect(m.logEvent).toHaveBeenLastCalledWith({ name, creatorId: "c1", submissionId: ID, metadata: { rank: 2 } });
    }
  });

  it("204 and logs { rank, destination } for open_app", async () => {
    const res = await call({ name: "open_app", rank: 1, destination: "instagram" });
    expect(res.status).toBe(204);
    expect(m.logEvent).toHaveBeenCalledWith({
      name: "open_app",
      creatorId: "c1",
      submissionId: ID,
      metadata: { rank: 1, destination: "instagram" },
    });
  });
});

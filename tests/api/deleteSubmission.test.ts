import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../stubs/fakeDb";

const m = vi.hoisted(() => ({
  getCreator: vi.fn(),
  logEvent: vi.fn(),
  db: null as unknown,
}));
vi.mock("@/src/auth/session", () => ({ getCreator: m.getCreator, getViewer: vi.fn(), isAdmin: () => false }));
vi.mock("@/src/feedback/events", () => ({ logEvent: m.logEvent }));
vi.mock("@/src/db/client", () => ({ createServiceClient: () => m.db }));
vi.mock("@/src/pipeline/run", () => ({ runSubmission: vi.fn() }));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

const { DELETE } = await import("@/app/api/submissions/[id]/route");
const { resetDeleteTokens } = await import("@/src/account/deletion");

const C = "c0000000-0000-4000-8000-000000000000";
const S = "51111111-1111-4111-8111-111111111111";
const S2 = "52222222-2222-4222-8222-222222222222";

const call = (id = S, origin: string | null = "https://thissongfits.com") =>
  DELETE(
    new Request(`https://thissongfits.com/api/submissions/${id}`, {
      method: "DELETE",
      headers: { host: "thissongfits.com", ...(origin ? { origin } : {}) },
    }),
    { params: Promise.resolve({ id }) },
  );

let f: ReturnType<typeof fakeDb>;
function seed(status = "ready", creator_id = C) {
  f = fakeDb({
    tables: {
      submissions: [
        { id: S, creator_id, status, video_path: `${C}/${S}.mp4`, playback_path: `${C}/${S}/playback.mp4` },
        { id: S2, creator_id: C, status: "ready", video_path: `${C}/${S2}.mp4`, playback_path: null },
      ],
      recommendations: [{ id: "r1", submission_id: S, selected: true }],
      events: [
        { id: "e1", submission_id: S, creator_id: C, name: "wanted_instead", metadata: { text: "something else" } },
        { id: "e2", submission_id: S, creator_id: C, name: "recommendations_viewed", metadata: null },
      ],
    },
    objects: [`${C}/${S}.mp4`, `${C}/${S}/playback.mp4`, `${C}/${S2}.mp4`],
  });
  m.db = f.client;
}

beforeEach(() => {
  resetDeleteTokens();
  m.getCreator.mockReset().mockResolvedValue({ id: C, email: "maya@example.com" });
  m.logEvent.mockReset().mockImplementation(async (e: { name: string }) => {
    f.ops.push(`log ${e.name}`);
  });
  seed();
});

describe("DELETE /api/submissions/[id]", () => {
  it("401 for anonymous or signed-out sessions (getCreator is null for both)", async () => {
    m.getCreator.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(f.ops).toEqual([]);
  });

  it("403 cross-origin or without an Origin header, before anything else", async () => {
    expect((await call(S, "https://evil.example")).status).toBe(403);
    expect((await call(S, null)).status).toBe(403);
    expect(m.getCreator).not.toHaveBeenCalled();
    expect(f.ops).toEqual([]);
  });

  it("404 for a bad id, a missing row, or someone else's video", async () => {
    expect((await call("nope")).status).toBe(404);
    expect((await call("59999999-9999-4999-8999-999999999999")).status).toBe(404);
    seed("ready", "other-creator");
    expect((await call()).status).toBe(404);
    expect(f.ops).toEqual([]);
  });

  it.each(["uploaded", "analyzing", "recommending"])("409 in_progress while %s", async (status) => {
    seed(status);
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "in_progress" });
    expect(f.ops).toEqual([]);
  });

  it("success: storage, then the free-text events, then the row, then submission_deleted", async () => {
    const res = await call();
    expect(res.status).toBe(204);
    expect(f.ops).toEqual([
      `remove ${C}/${S}.mp4,${C}/${S}/playback.mp4`,
      "delete events 1",
      "delete submissions 1",
      "log submission_deleted",
    ]);
    expect(f.objects()).toEqual([`${C}/${S2}.mp4`]);
    expect(f.tables.events!.map((e) => e.id)).toEqual(["e2"]); // kept; the FK nulls submission_id
    expect(f.tables.submissions!.map((s) => s.id)).toEqual([S2]);
    expect(m.logEvent).toHaveBeenCalledWith({ name: "submission_deleted", creatorId: C, metadata: { had_choice: true } });
  });

  it("failed videos can be deleted; had_choice false without a selected song", async () => {
    seed("failed");
    f.tables.recommendations = [];
    expect((await call()).status).toBe(204);
    expect(m.logEvent).toHaveBeenCalledWith({ name: "submission_deleted", creatorId: C, metadata: { had_choice: false } });
  });

  it("never removes a file another submission references", async () => {
    f.tables.submissions!.push({ id: "s3", creator_id: "other", status: "ready", video_path: `${C}/${S}.mp4`, playback_path: null });
    expect((await call()).status).toBe(204);
    expect(f.objects()).toContain(`${C}/${S}.mp4`);
  });

  it("storage failure → 500, row and events kept, nothing logged", async () => {
    f.fail.remove = "boom";
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "delete_failed" });
    expect(f.tables.submissions).toHaveLength(2);
    expect(f.tables.events).toHaveLength(2);
    expect(m.logEvent).not.toHaveBeenCalled();
  });

  it("429 after 10 deletes a minute per creator", async () => {
    for (let i = 0; i < 10; i++) await call("nope");
    expect((await call()).status).toBe(429);
    expect(f.ops).toEqual([]);
  });
});

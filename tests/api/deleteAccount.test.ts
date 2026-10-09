import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "../stubs/fakeDb";

const m = vi.hoisted(() => ({
  getCreator: vi.fn(),
  logEvent: vi.fn(),
  signOut: vi.fn(),
  db: null as unknown,
}));
vi.mock("@/src/auth/session", () => ({ getCreator: m.getCreator }));
vi.mock("@/src/feedback/events", () => ({ logEvent: m.logEvent }));
vi.mock("@/src/db/client", () => ({
  createServiceClient: () => m.db,
  createServerClient: async () => ({ auth: { signOut: m.signOut } }),
}));

const { DELETE } = await import("@/app/api/account/route");
const { resetDeleteTokens } = await import("@/src/account/deletion");

const G = "g0000000-0000-4000-8000-000000000000";
const A = "a0000000-0000-4000-8000-000000000000";
const S1 = "51111111-1111-4111-8111-111111111111"; // claimed from A: files under A's folder
const S2 = "52222222-2222-4222-8222-222222222222";

const call = (body: unknown = { confirm: "DELETE" }, origin: string | null = "https://thissongfits.com") =>
  DELETE(
    new Request("https://thissongfits.com/api/account", {
      method: "DELETE",
      headers: { host: "thissongfits.com", "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

let f: ReturnType<typeof fakeDb>;
function seed(status2 = "ready") {
  f = fakeDb({
    tables: {
      creators: [
        { id: G, email: "maya@example.com" },
        { id: A, email: null },
      ],
      submissions: [
        { id: S1, creator_id: G, status: "ready", video_path: `${A}/${S1}.mp4`, playback_path: `${A}/${S1}/playback.mp4` },
        { id: S2, creator_id: G, status: status2, video_path: `${G}/${S2}.mp4`, playback_path: null },
      ],
      events: [
        { id: "e1", creator_id: G, submission_id: S2, name: "wanted_instead", metadata: { text: "x" } },
        { id: "e2", creator_id: null, submission_id: S1, name: "recommendations_ready", metadata: null },
      ],
    },
    objects: [`${A}/${S1}.mp4`, `${A}/${S1}/playback.mp4`, `${G}/${S2}.mp4`, `${G}/stray.mp4`],
  });
  m.db = f.client;
}

beforeEach(() => {
  resetDeleteTokens();
  m.getCreator.mockReset().mockResolvedValue({ id: G, email: "maya@example.com" });
  m.logEvent.mockReset().mockImplementation(async (e: { name: string }) => {
    f.ops.push(`log ${e.name}`);
  });
  m.signOut.mockReset().mockImplementation(async () => {
    f.ops.push("signOut");
    return { error: null };
  });
  seed();
});

describe("DELETE /api/account", () => {
  it("401 for anonymous or signed-out sessions", async () => {
    m.getCreator.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(f.ops).toEqual([]);
  });

  it("403 cross-origin or without Origin", async () => {
    expect((await call(undefined, "https://evil.example")).status).toBe(403);
    expect((await call(undefined, null)).status).toBe(403);
    expect(f.ops).toEqual([]);
  });

  it.each([{}, { confirm: "delete" }, { confirm: "DELETE " }, "not json"])("400 without confirm DELETE: %j", async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(f.ops).toEqual([]);
  });

  it("409 while any run is in flight", async () => {
    seed("analyzing");
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "in_progress" });
    expect(f.ops).toEqual([]);
  });

  it("success: storage (incl. the claimed anonymous folder), events, anonymous user, auth user, then the event and sign-out", async () => {
    const res = await call();
    expect(res.status).toBe(204);
    expect(f.ops).toEqual([
      `remove ${A}/${S1}.mp4,${A}/${S1}/playback.mp4,${G}/${S2}.mp4,${G}/stray.mp4`,
      "delete events 1", // by creator (G and A)
      "delete events 1", // by submission
      `deleteUser ${A}`,
      `deleteUser ${G}`,
      "log account_deleted",
      "signOut",
    ]);
    expect(f.objects()).toEqual([]);
    expect(m.logEvent).toHaveBeenCalledWith({ name: "account_deleted", creatorId: null, metadata: { submissions: 2 } });
  });

  it("storage failure → 500: no events, no auth user deleted, nothing logged, still signed in", async () => {
    f.fail.remove = "boom";
    expect((await call()).status).toBe(500);
    expect(f.ops).toEqual([]);
    expect(f.tables.events).toHaveLength(2);
    expect(m.logEvent).not.toHaveBeenCalled();
    expect(m.signOut).not.toHaveBeenCalled();
  });

  it("auth failure → 500 and nothing logged; a retry finishes", async () => {
    f.fail.deleteUser = "auth down";
    expect((await call()).status).toBe(500);
    expect(m.logEvent).not.toHaveBeenCalled();
    f.fail.deleteUser = null;
    expect((await call()).status).toBe(204);
    expect(f.ops).toContain(`deleteUser ${G}`);
    expect(m.logEvent).toHaveBeenCalledTimes(1);
  });

  it("idempotent: a creator that no longer exists → 204, nothing deleted or logged", async () => {
    f.tables.creators = [];
    expect((await call()).status).toBe(204);
    expect(f.ops).toEqual(["signOut"]);
    expect(m.logEvent).not.toHaveBeenCalled();
  });
});

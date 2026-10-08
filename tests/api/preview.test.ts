import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({ getCreator: vi.fn(), getSubmission: vi.fn(), refreshPreview: vi.fn() }));
vi.mock("@/src/auth/session", async (orig) => ({ ...(await orig<object>()), getCreator: m.getCreator }));
vi.mock("@/src/db/queries/submissions", () => ({ getSubmission: m.getSubmission }));
vi.mock("@/src/feedback/picker", () => ({ refreshPreview: m.refreshPreview }));

import { GET } from "@/app/api/submissions/[id]/preview/[rank]/route";
import { ProviderError } from "@/src/engine/catalog/deezer";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (id = ID, rank = "1") =>
  GET(new Request("http://x"), { params: Promise.resolve({ id, rank }) });

beforeEach(() => {
  m.getCreator.mockReset().mockResolvedValue({ id: "c1", email: "a@b.co" });
  m.getSubmission.mockReset().mockResolvedValue({ id: ID, creator_id: "c1", status: "ready" });
  m.refreshPreview.mockReset().mockResolvedValue("https://fresh.mp3");
});

describe("GET /api/submissions/[id]/preview/[rank]", () => {
  it("401 when signed out", async () => {
    m.getCreator.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });
  it("404 for a non-UUID id", async () => {
    expect((await call("nope")).status).toBe(404);
  });
  it("404 for a non-owner", async () => {
    m.getSubmission.mockResolvedValue({ id: ID, creator_id: "other", status: "ready" });
    expect((await call()).status).toBe(404);
  });
  it("404 for an unknown submission or one that is not ready", async () => {
    m.getSubmission.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    m.getSubmission.mockResolvedValue({ id: ID, creator_id: "c1", status: "analyzing" });
    expect((await call()).status).toBe(404);
  });
  it("404 for a rank outside 1..15 or not a plain integer", async () => {
    for (const r of ["0", "16", "01", "1.5", "1e1", " 2", "abc", ""]) expect((await call(ID, r)).status).toBe(404);
    expect(m.refreshPreview).not.toHaveBeenCalled();
  });
  it("200 with the fresh url", async () => {
    const res = await call(ID, "2");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ preview_url: "https://fresh.mp3" });
    expect(m.refreshPreview).toHaveBeenCalledWith(ID, 2);
    expect((await call(ID, "15")).status).toBe(200);
    expect(m.refreshPreview).toHaveBeenLastCalledWith(ID, 15);
  });
  it("503 on ProviderError without leaking the message", async () => {
    m.refreshPreview.mockRejectedValue(new ProviderError("deezer 503 secret", 503));
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "provider" });
  });
});

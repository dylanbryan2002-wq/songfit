import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getSubmission: vi.fn(), runSubmission: vi.fn() }));
vi.mock("@/src/db/queries/submissions", () => ({ getSubmission: m.getSubmission }));
vi.mock("@/src/pipeline/run", () => ({ runSubmission: m.runSubmission }));

import { POST } from "@/app/api/submissions/[id]/run/route";
import { isInternalToken } from "@/src/auth/internalToken";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (id: string, token?: string) =>
  POST(new Request("http://x", { method: "POST", headers: token ? { "x-internal-token": token } : {} }), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  vi.stubEnv("INTERNAL_TOKEN", "secret-token");
  m.getSubmission.mockReset().mockResolvedValue(null);
  m.runSubmission.mockReset();
});

describe("isInternalToken", () => {
  it("matches only the exact token, whatever the length of the guess", () => {
    expect(isInternalToken("secret-token")).toBe(true);
    expect(isInternalToken("secret-toke")).toBe(false);
    expect(isInternalToken("secret-token-and-more")).toBe(false);
    expect(isInternalToken("")).toBe(false);
    expect(isInternalToken(null)).toBe(false);
  });
  it("never matches when INTERNAL_TOKEN is unset or empty", () => {
    vi.stubEnv("INTERNAL_TOKEN", "");
    expect(isInternalToken("")).toBe(false);
    expect(isInternalToken("anything")).toBe(false);
  });
});

describe("POST /api/submissions/[id]/run", () => {
  it("403 without or with a wrong token", async () => {
    expect((await call(ID)).status).toBe(403);
    expect((await call(ID, "nope")).status).toBe(403);
    expect(m.getSubmission).not.toHaveBeenCalled();
  });
  it("404 for a malformed id, before any lookup", async () => {
    expect((await call("not-a-uuid", "secret-token")).status).toBe(404);
    expect(m.getSubmission).not.toHaveBeenCalled();
  });
  it("404 for an unknown id with the right token", async () => {
    expect((await call(ID, "secret-token")).status).toBe(404);
    expect(m.getSubmission).toHaveBeenCalledWith(ID);
  });
});

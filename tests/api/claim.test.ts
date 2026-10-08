import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const m = vi.hoisted(() => ({ getViewer: vi.fn(), setClaimTokenHash: vi.fn() }));
vi.mock("@/src/auth/session", () => ({ getViewer: m.getViewer }));
vi.mock("@/src/db/queries/creators", () => ({ setClaimTokenHash: m.setClaimTokenHash }));

import { POST } from "@/app/api/claim/route";
import { CLAIM_COOKIE, hashClaimToken } from "@/src/auth/claim";

const call = () => POST();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

beforeEach(() => {
  m.getViewer.mockReset().mockResolvedValue({ id: "a1", anonymous: true, email: null });
  m.setClaimTokenHash.mockReset().mockResolvedValue(undefined);
});

describe("hashClaimToken", () => {
  it("is the sha256 hex of the token", () => {
    expect(hashClaimToken("abc")).toBe(sha256("abc"));
  });
});

describe("POST /api/claim", () => {
  it("stores only the hash of a fresh 32-byte token and sets it as a 1 h httpOnly cookie", async () => {
    const res = await call();
    expect(res.status).toBe(204);
    const cookie = res.headers.get("set-cookie") ?? "";
    const token = /sf_claim=([^;]+)/.exec(cookie)?.[1] ?? "";
    expect(CLAIM_COOKIE).toBe("sf_claim");
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(m.setClaimTokenHash).toHaveBeenCalledWith("a1", sha256(token));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=3600/);
  });

  it("a new token each call", async () => {
    await call();
    await call();
    const [a, b] = m.setClaimTokenHash.mock.calls.map((c) => c[1]);
    expect(a).not.toBe(b);
  });

  it("refuses signed-in creators and visitors without a session", async () => {
    m.getViewer.mockResolvedValue({ id: "c1", anonymous: false, email: "a@b.co" });
    expect((await call()).status).toBe(403);
    m.getViewer.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(m.setClaimTokenHash).not.toHaveBeenCalled();
  });
});

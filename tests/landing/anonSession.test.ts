import { describe, it, expect, vi } from "vitest";
import { ensureAnonSession } from "@/components/landing/anonSession";

const auth = (session: unknown, signIn: () => Promise<{ error: unknown }>) => ({
  getSession: vi.fn(async () => ({ data: { session } })),
  signInAnonymously: vi.fn(signIn),
});

describe("ensureAnonSession", () => {
  it("starts an anonymous session when there is none", async () => {
    const a = auth(null, async () => ({ error: null }));
    expect(await ensureAnonSession(a)).toBe("started");
    expect(a.signInAnonymously).toHaveBeenCalledTimes(1);
  });
  it("reuses an existing session (a reload, or Upload another)", async () => {
    const a = auth({ access_token: "t" }, async () => ({ error: null }));
    expect(await ensureAnonSession(a)).toBe("existing");
    expect(a.signInAnonymously).not.toHaveBeenCalled();
  });
  it("falls back to the Google button when anonymous sign-in returns an error or throws", async () => {
    expect(await ensureAnonSession(auth(null, async () => ({ error: new Error("Anonymous sign-ins are disabled") })))).toBe("failed");
    expect(await ensureAnonSession(auth(null, async () => { throw new Error("network"); }))).toBe("failed");
  });
});

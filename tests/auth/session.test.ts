import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getUser: vi.fn(), ensureCreator: vi.fn(), redirect: vi.fn() }));
vi.mock("@/src/db/client", () => ({ createServerClient: async () => ({ auth: { getUser: m.getUser } }) }));
vi.mock("@/src/db/queries/creators", () => ({ ensureCreator: m.ensureCreator }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));

import { googleEmail } from "@/src/auth/identity";
import { getViewer, requireAdmin } from "@/src/auth/session";

const CONFIRMED = "2026-10-01T00:00:00Z";
const ADMIN = "boss@example.com";
const google = (extra: Record<string, unknown> = {}) => ({
  id: "g1", email: ADMIN, email_confirmed_at: CONFIRMED, app_metadata: { provider: "google" }, user_metadata: {}, ...extra,
});
const as = (user: unknown) => m.getUser.mockResolvedValue({ data: { user }, error: null });

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.ensureCreator.mockResolvedValue({});
  m.redirect.mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  });
  vi.stubEnv("ADMIN_EMAILS", ADMIN);
});

describe("googleEmail", () => {
  it("accepts a confirmed Google user by provider or by identity", () => {
    expect(googleEmail(google())).toBe(ADMIN);
    expect(googleEmail(google({ app_metadata: { provider: "email" }, identities: [{ provider: "google" }] }))).toBe(ADMIN);
  });
  it("rejects other providers, unconfirmed emails and missing emails", () => {
    expect(googleEmail(google({ app_metadata: { provider: "email" } }))).toBeNull();
    expect(googleEmail(google({ app_metadata: { provider: "email" }, identities: [{ provider: "email" }] }))).toBeNull();
    expect(googleEmail(google({ email_confirmed_at: null }))).toBeNull();
    expect(googleEmail(google({ email: null }))).toBeNull();
    expect(googleEmail({})).toBeNull();
  });
});

describe("getViewer", () => {
  it("a confirmed Google user is a creator", async () => {
    as(google());
    expect(await getViewer()).toEqual({ id: "g1", anonymous: false, email: ADMIN });
    expect(m.ensureCreator).toHaveBeenCalledWith("g1", ADMIN, null);
  });
  it("an email/password session, even with the admin's address, is no session", async () => {
    as(google({ app_metadata: { provider: "email" }, identities: [{ provider: "email" }] }));
    expect(await getViewer()).toBeNull();
    expect(m.ensureCreator).not.toHaveBeenCalled();
  });
  it("an unconfirmed Google email is no session", async () => {
    as(google({ email_confirmed_at: null }));
    expect(await getViewer()).toBeNull();
  });
  it("an anonymous session stays anonymous, even if it carries an email", async () => {
    as({ id: "a1", is_anonymous: true, email: ADMIN, email_confirmed_at: CONFIRMED, app_metadata: { provider: "anonymous" } });
    expect(await getViewer()).toEqual({ id: "a1", anonymous: true, email: null });
  });
});

describe("requireAdmin", () => {
  it("passes a confirmed Google admin", async () => {
    as(google());
    expect(await requireAdmin()).toEqual({ id: "g1", email: ADMIN });
  });
  it("redirects an email-provider session with the admin's address", async () => {
    as(google({ app_metadata: { provider: "email" } }));
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
  });
  it("redirects an anonymous session, whatever its email", async () => {
    as({ id: "a1", is_anonymous: true, email: ADMIN, email_confirmed_at: CONFIRMED, app_metadata: { provider: "google" } });
    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT");
  });
});

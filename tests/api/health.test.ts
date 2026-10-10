import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/health/route";

beforeEach(() => { vi.stubEnv("INTERNAL_TOKEN", "secret-token"); });

const call = (headers: Record<string, string> = {}) =>
  GET(new Request("http://x/api/health?sleep=0.01", { headers }));

describe("GET /api/health (uptime monitor)", () => {
  it("answers 200 at once with no token and no parameters", async () => {
    const started = Date.now();
    const res = await GET(new Request("http://x/api/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, slept: 0 });
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("GET /api/health?sleep=", () => {
  it("ignores sleep without the internal token", async () => {
    expect(await (await call()).json()).toEqual({ ok: true, slept: 0 });
  });
  it("ignores sleep with a wrong internal token", async () => {
    expect(await (await call({ "x-internal-token": "nope" })).json()).toEqual({ ok: true, slept: 0 });
  });
  it("honours sleep with the internal token", async () => {
    expect(await (await call({ "x-internal-token": "secret-token" })).json()).toEqual({ ok: true, slept: 0.01 });
  });
  it("ignores sleep when INTERNAL_TOKEN is unset", async () => {
    vi.stubEnv("INTERNAL_TOKEN", "");
    expect(await (await call({ "x-internal-token": "" })).json()).toEqual({ ok: true, slept: 0 });
  });
});

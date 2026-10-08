import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({ getCreator: vi.fn(), getViewer: vi.fn(), logEvent: vi.fn() }));
vi.mock("@/src/auth/session", () => ({ getCreator: m.getCreator, getViewer: m.getViewer }));
vi.mock("@/src/feedback/events", () => ({ logEvent: m.logEvent }));

import { POST } from "@/app/api/landing-events/route";

const LANDING_EVENTS_PER_MINUTE = 30; // ruling I4

const FLOW = "11111111-1111-4111-8111-111111111111";
let ipSeq = 0;
let ip = "";
const call = (body: unknown, fromIp = ip) =>
  POST(
    new Request("http://x/api/landing-events", {
      method: "POST",
      headers: { "x-forwarded-for": `${fromIp}, 10.0.0.1` },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  ip = `203.0.113.${++ipSeq}`; // a fresh IP per test so the per-IP limiter starts empty
  m.getCreator.mockReset().mockResolvedValue(null);
  m.getViewer.mockReset().mockResolvedValue(null);
  m.logEvent.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/landing-events", () => {
  it("204 and logs the three anonymous events with creator null and only flow_id", async () => {
    for (const name of ["landing_viewed", "video_chosen", "sign_in_started"]) {
      expect((await call({ name, flow_id: FLOW })).status).toBe(204);
      expect(m.logEvent).toHaveBeenLastCalledWith({ name, creatorId: null, metadata: { flow_id: FLOW } });
    }
    expect(m.getCreator).not.toHaveBeenCalled();
  });

  it("logs sign_in_completed only for a signed-in creator, with the creator id", async () => {
    expect((await call({ name: "sign_in_completed", flow_id: FLOW })).status).toBe(401);
    expect(m.logEvent).not.toHaveBeenCalled();
    m.getCreator.mockResolvedValue({ id: "c1", email: "a@b.co" });
    expect((await call({ name: "sign_in_completed", flow_id: FLOW })).status).toBe(204);
    expect(m.logEvent).toHaveBeenLastCalledWith({ name: "sign_in_completed", creatorId: "c1", metadata: { flow_id: FLOW } });
  });

  it("logs anon_session_started only for an anonymous session, with the anonymous id", async () => {
    expect((await call({ name: "anon_session_started", flow_id: FLOW })).status).toBe(401);
    m.getViewer.mockResolvedValue({ id: "c1", anonymous: false, email: "a@b.co" });
    expect((await call({ name: "anon_session_started", flow_id: FLOW })).status).toBe(401);
    expect(m.logEvent).not.toHaveBeenCalled();
    m.getViewer.mockResolvedValue({ id: "a1", anonymous: true, email: null });
    expect((await call({ name: "anon_session_started", flow_id: FLOW })).status).toBe(204);
    expect(m.logEvent).toHaveBeenLastCalledWith({ name: "anon_session_started", creatorId: "a1", metadata: { flow_id: FLOW } });
  });

  it("400 for other names, bad flow_id, extra fields, junk", async () => {
    for (const name of ["signed_up", "paid", "song_previewed", "anything"]) {
      expect((await call({ name, flow_id: FLOW })).status).toBe(400);
    }
    for (const flow_id of ["nope", "", 5, null]) expect((await call({ name: "video_chosen", flow_id })).status).toBe(400);
    expect((await call({ name: "video_chosen" })).status).toBe(400);
    expect((await call({ name: "video_chosen", flow_id: FLOW, file: "clip.mov" })).status).toBe(400);
    expect((await call("nope")).status).toBe(400);
    expect(m.logEvent).not.toHaveBeenCalled();
  });

  it("400 for a body over 200 bytes", async () => {
    const body = JSON.stringify({ name: "video_chosen", flow_id: FLOW }) + " ".repeat(200);
    expect((await call(body)).status).toBe(400);
    expect(m.logEvent).not.toHaveBeenCalled();
  });

  it("429 after the per-IP limit, other IPs unaffected", async () => {
    for (let i = 0; i < LANDING_EVENTS_PER_MINUTE; i++) {
      expect((await call({ name: "landing_viewed", flow_id: FLOW })).status).toBe(204);
    }
    expect((await call({ name: "landing_viewed", flow_id: FLOW })).status).toBe(429);
    expect(m.logEvent).toHaveBeenCalledTimes(LANDING_EVENTS_PER_MINUTE);
    expect((await call({ name: "landing_viewed", flow_id: FLOW }, "198.51.100.7")).status).toBe(204);
  });
});

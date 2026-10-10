import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock("@/src/feedback/events", () => ({ logEvent: m.logEvent }));

import { WELCOME_FROM, WELCOME_SUBJECT, sendWelcomeEmail } from "@/src/email/welcome";

const creator = { id: "g1", email: "new@creator.co" };
const ok = async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 });

beforeEach(() => {
  m.logEvent.mockReset();
  vi.unstubAllEnvs();
});

describe("sendWelcomeEmail", () => {
  it("without RESEND_API_KEY sends nothing and logs no event", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const f = vi.fn<typeof fetch>(ok);
    expect(await sendWelcomeEmail(creator, f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(m.logEvent).not.toHaveBeenCalled();
  });

  it("with a key: one POST to Resend with the right payload, then welcome_email_sent", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const f = vi.fn<typeof fetch>(ok);
    expect(await sendWelcomeEmail(creator, f)).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer re_test", "content-type": "application/json" });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      from: "Songfit <hello@thissongfits.com>",
      to: ["new@creator.co"],
      reply_to: "dylanbryan2002@gmail.com",
      subject: "Welcome to Songfit",
    });
    expect(WELCOME_FROM).toBe(body.from);
    expect(WELCOME_SUBJECT).toBe(body.subject);
    for (const part of [body.text, body.html]) {
      expect(part).toContain("Thanks for trying Songfit.");
      expect(part).toContain("https://thissongfits.com/account");
      expect(part).toContain("Your videos and songs live here");
      expect(part).toContain("Delete anytime from My Songfits");
    }
    expect(m.logEvent).toHaveBeenCalledWith({ name: "welcome_email_sent", creatorId: "g1" });
  });

  it("a non-2xx answer logs no event and does not throw", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const f = vi.fn<typeof fetch>(async () => new Response("{\"message\":\"domain not verified\"}", { status: 403 }));
    expect(await sendWelcomeEmail(creator, f)).toBe(false);
    expect(m.logEvent).not.toHaveBeenCalled();
  });

  it("a network error logs no event and does not throw", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const f = vi.fn<typeof fetch>(async () => {
      throw new Error("ECONNRESET");
    });
    expect(await sendWelcomeEmail(creator, f)).toBe(false);
    expect(m.logEvent).not.toHaveBeenCalled();
  });
});

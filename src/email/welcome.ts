import { logEvent } from "@/src/feedback/events";
import { CONTACT_EMAIL } from "@/src/shared/config";
import { logger } from "@/src/shared/logger";
import { SITE_ORIGIN } from "@/src/shared/site";

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export const WELCOME_FROM = "Songfit <hello@thissongfits.com>";
export const WELCOME_SUBJECT = "Welcome to Songfit";
const ACCOUNT_URL = `${SITE_ORIGIN}/account`;

export const WELCOME_TEXT = [
  "Thanks for trying Songfit.",
  `Your videos and songs live here: ${ACCOUNT_URL}`,
  "Delete anytime from My Songfits.",
].join("\n\n");

export const WELCOME_HTML = [
  "<p>Thanks for trying Songfit.</p>",
  `<p><a href="${ACCOUNT_URL}">Your videos and songs live here</a></p>`,
  "<p>Delete anytime from My Songfits.</p>",
].join("\n");

/**
 * Welcome email on a creator's first Google sign-in, through the Resend REST API. Never throws:
 * without RESEND_API_KEY it sends nothing and logs `email.skipped`; any failure is logged. The
 * welcome_email_sent event is written only when Resend answers 2xx. Returns whether it was sent.
 */
export async function sendWelcomeEmail(creator: { id: string; email: string }, f: typeof fetch = fetch): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    logger.info("email.skipped", { creatorId: creator.id, reason: "no RESEND_API_KEY" });
    return false;
  }
  try {
    const res = await f(RESEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: WELCOME_FROM,
        to: [creator.email],
        reply_to: CONTACT_EMAIL,
        subject: WELCOME_SUBJECT,
        text: WELCOME_TEXT,
        html: WELCOME_HTML,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.error("email.failed", { creatorId: creator.id, status: res.status, body: (await res.text()).slice(0, 300) });
      return false;
    }
    await logEvent({ name: "welcome_email_sent", creatorId: creator.id });
    return true;
  } catch (err) {
    logger.error("email.failed", { creatorId: creator.id, err: String(err) });
    return false;
  }
}

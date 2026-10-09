import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {} }) }));

import { DAILY_LIMIT, DAILY_LIMIT_ANONYMOUS, UploadForm } from "@/components/UploadForm";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("upload screen: uploads left", () => {
  it("signed in: '7 uploads left' with the reset hint, and the My Songfits link", () => {
    const t = text(renderToStaticMarkup(createElement(UploadForm, { creator: { email: "maya@example.com" }, uploadsLeft: 7 })));
    expect(t).toContain("7 uploads left");
    expect(t).toContain("Resets 24 hours after each upload");
    expect(t).toMatch(/Signed in as maya@example\.com · My Songfits · Sign out/);
  });

  it("anonymous: '2 free tries left', no hint", () => {
    const t = text(renderToStaticMarkup(createElement(UploadForm, { creator: { email: null }, uploadsLeft: 2 })));
    expect(t).toContain("2 free tries left");
    expect(t).not.toContain("Resets");
  });

  it("hidden when unknown", () => {
    const t = text(renderToStaticMarkup(createElement(UploadForm, { creator: { email: "maya@example.com" } })));
    expect(t).not.toContain("left");
  });

  it("cap messages speak of the rolling window, not tomorrow", () => {
    expect(DAILY_LIMIT).toBe("You've used your 10 uploads for now. Each one frees up 24 hours after it was made.");
    expect(DAILY_LIMIT_ANONYMOUS).toBe("You've used your 3 free tries for now. Sign in to upload more.");
  });
});

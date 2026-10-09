import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PrivacyPage from "@/app/privacy/page";

const text = renderToStaticMarkup(createElement(PrivacyPage)).replace(/<[^>]+>/g, " ").replace(/&#x27;|&quot;/g, "'").replace(/\s+/g, " ");

describe("privacy page (audit 22, M3)", () => {
  it("names every processor and what it receives", () => {
    for (const s of ["Google: sign-in", "OpenAI (Whisper)", "Anthropic", "Deezer", "Supabase", "Vercel"]) expect(text).toContain(s);
    expect(text).toContain("still frames, a text transcript of any speech");
  });
  it("states retention, the anonymous purge and the deletion path", () => {
    expect(text).toContain("until you ask us to delete them");
    expect(text).toContain("no automatic expiry yet");
    expect(text).toContain("never claimed by signing in are deleted after 30 days");
    expect(text).toContain("Email dylanbryan2002@gmail.com and we will delete");
  });
  it("never shown to other creators", () => {
    expect(text).toContain("We never show your video or your results to other creators");
  });
});

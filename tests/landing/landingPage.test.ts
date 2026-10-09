import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {} }) }));

import * as copy from "@/components/landing/copy";
import { Landing, LandingView } from "@/components/landing/Landing";
import { DemoLoop } from "@/components/landing/DemoLoop";
import { FileCard } from "@/components/landing/FileCard";
import { UploadForm } from "@/components/UploadForm";

const MB = 1024 * 1024;
const clip = () => new File([new Uint8Array(18 * MB)], "clip.mov", { type: "video/quicktime" });
const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
const buttons = (html: string) => html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("landing copy", () => {
  it("keeps every line in copy.ts", () => {
    expect(copy.HEADLINE).toBe("We find the perfect song to help your video go viral.");
    expect(copy.MONO_LINE).toBe("+ THE EXACT SECONDS TO USE.");
    expect(copy.SUBLINE).toBe("Upload a Reel or TikTok. Get 15 real songs and hear each one over your clip.");
    expect(copy.CHOOSE).toBe("Choose your video");
    expect(copy.NO_SIGN_UP).toBe("No sign-up to start.");
    expect(copy.NOW_PLAYING).toBe("NOW PLAYING");
    expect(copy.EXAMPLE).toBe("EXAMPLE");
    expect(copy.DEMO_SONG).toBe("Waiting Room · Fugazi");
    expect(copy.DEMO_USE).toBe("USE 0:00–0:14");
    expect(copy.PICK_A_FEEL).toBe("Now pick a feel.");
    expect(copy.YOUR_VIDEO).toBe("YOUR VIDEO");
    expect(copy.CHANGE).toBe("CHANGE");
  });
});

describe("(a) empty state", () => {
  it("renders H1, mono line, subline, demo and the sticky Choose button; no 'No sign-up' by default", () => {
    const html = render(createElement(Landing, { authFailed: false }));
    const t = text(html);
    expect(html).toMatch(/<h1[^>]*>We find the perfect song to help your video go viral\.<\/h1>/);
    expect(t).toContain(copy.MONO_LINE);
    expect(t).toContain(copy.SUBLINE);
    expect(t).toContain(copy.DEMO_USE);
    expect(buttons(html).some((b) => text(b) === copy.CHOOSE && b.includes("rounded-md"))).toBe(true);
    expect(html).toContain("sticky bottom-0");
    expect(t).not.toContain(copy.NO_SIGN_UP);
    expect(t).not.toContain("1.");
  });

  it("shows 'No sign-up to start.' only when anonymous sign-in is live", () => {
    expect(text(render(createElement(Landing, { authFailed: false, anonymousLive: true })))).toContain(copy.NO_SIGN_UP);
    expect(text(render(createElement(LandingView, { view: "empty", anonymousLive: true })))).toContain(copy.NO_SIGN_UP);
    expect(text(render(createElement(LandingView, { view: "empty" })))).not.toContain(copy.NO_SIGN_UP);
  });

  it("centres the phone column, keeps the laptop columns left-aligned, no rounded-2xl, no orange", () => {
    const html = render(createElement(Landing, { authFailed: false }));
    // Dylan 2026-10-09: the phone layout is centred; the ≥1024 grid stays left-aligned.
    expect(html).toContain("text-center lg:text-left");
    expect(html).not.toContain("rounded-2xl");
    expect(html.toLowerCase()).not.toContain("ff5b1f");
    expect(html).not.toContain("cue");
  });
});

describe("(c) chosen on the signed-out page (Google fallback)", () => {
  const html = render(
    createElement(LandingView, { view: "chosen", chosen: { file: clip(), durationSeconds: 24 } }),
  );
  const t = text(html);

  it("keeps the H1 and shows the clip caption with length and size, CHANGE and the X", () => {
    expect(t).toContain(copy.HEADLINE);
    expect(t).not.toContain(copy.PICK_A_FEEL);
    expect(html).toContain("YOUR VIDEO  0:24 · 18 MB");
    expect(buttons(html).some((b) => text(b) === copy.CHANGE)).toBe(true);
    expect(html).toContain('aria-label="Remove video"');
    expect(html).toContain("h-[260px]");
  });

  it("shows the Google button and the privacy line, and no sticky button or demo", () => {
    expect(t).toContain("Continue with Google");
    expect(t).toContain("From Google we use your name and email.");
    expect(html).not.toContain("sticky");
    expect(t).not.toContain(copy.CHOOSE);
    expect(t).not.toContain(copy.DEMO_SONG);
  });
});

describe("(d) in-app browser", () => {
  it("replaces the chooser with the notice and renders no sticky button", () => {
    const html = render(createElement(LandingView, { view: "inApp" }));
    const t = text(html);
    expect(t).toContain("Google sign-in doesn't work inside this app.");
    expect(t).not.toContain(copy.CHOOSE);
    expect(html).not.toContain("sticky");
  });
});

describe("(b) chosen on the signed-in form", () => {
  it("shows 'Now pick a feel.', the 260 px clip with caption, chips, note and Find my songs", () => {
    const html = render(
      createElement(UploadForm, { creator: { email: "a@b.co" }, initialFile: clip(), initialDurationSeconds: 24 }),
    );
    const t = text(html);
    expect(html).toMatch(/<h1[^>]*>Now pick a feel\.<\/h1>/);
    expect(t).not.toContain(copy.HEADLINE);
    expect(html).toContain("YOUR VIDEO  0:24 · 18 MB");
    expect(buttons(html).some((b) => text(b) === copy.CHANGE)).toBe(true);
    expect(html).toContain('aria-label="Remove video"');
    expect(t).toContain("How should it feel?");
    // The note field is hidden until "Something else…" is tapped (Dylan 2026-10-09).
    expect(html).not.toContain('aria-label="Anything else?"');
    expect(t).toContain("Something else…");
    const submit = buttons(html).find((b) => text(b) === "Find my songs")!;
    expect(submit).toContain("rounded-md");
    expect(submit).not.toContain("rounded-2xl");
  });

  it("without a file shows the headline and the demo", () => {
    const t = text(render(createElement(UploadForm, { creator: { email: "a@b.co" } })));
    expect(t).toContain(copy.HEADLINE);
    expect(t).toContain(copy.DEMO_USE);
  });
});

describe("DemoLoop", () => {
  it("poster first: still, play control, EXAMPLE caption (not NOW PLAYING until it plays)", () => {
    const html = render(createElement(DemoLoop, { videoAvailable: true }));
    expect(html).toContain('src="/brand/demo-poster.jpg"');
    expect(html).not.toContain("<video");
    expect(html).toContain('aria-label="Play demo"');
    expect(html).toContain("EXAMPLE  Waiting Room · Fugazi");
    expect(text(html)).toContain(copy.DEMO_USE);
    expect(html).not.toContain(copy.NOW_PLAYING);
  });

  it("while the recording is missing (DEMO_VIDEO_AVAILABLE false): the still, no play control, no video", () => {
    expect(copy.DEMO_VIDEO_AVAILABLE).toBe(false);
    const html = render(createElement(DemoLoop));
    expect(html).toContain('src="/brand/demo-poster.jpg"');
    expect(html).not.toContain("<video");
    expect(html).not.toContain("demo.mp4");
    expect(html).not.toContain('aria-label="Play demo"');
    expect(html).toContain("EXAMPLE  Waiting Room · Fugazi");
  });

  it("with neither file, the ink box still carries the caption", () => {
    const html = render(createElement(DemoLoop, { initial: "ink" }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<video");
    expect(html).toContain("bg-ink");
    expect(html).toContain("EXAMPLE  Waiting Room · Fugazi");
    expect(text(html)).toContain(copy.DEMO_USE);
  });

  it("is 9:16 with square corners and no ring", () => {
    const html = render(createElement(DemoLoop));
    expect(html).toContain("aspect-[9/16]");
    expect(html).not.toMatch(/rounded-|ring-/);
  });
});

describe("FileCard", () => {
  it("shows the caption even when the length is unknown", () => {
    const html = render(
      createElement(FileCard, { file: clip(), durationSeconds: null, onChange: () => {}, onRemove: () => {} }),
    );
    expect(html).toContain("YOUR VIDEO  length unknown · 18 MB");
    expect(html).toContain("uppercase");
  });
});

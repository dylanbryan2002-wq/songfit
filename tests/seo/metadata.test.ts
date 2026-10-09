import { describe, it, expect, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Bricolage_Grotesque: () => ({ variable: "" }),
  DM_Mono: () => ({ variable: "" }),
}));

import { metadata } from "@/app/layout";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { size } from "@/app/opengraph-image";
import { SUBLINE } from "@/components/landing/copy";

describe("share previews and SEO basics", () => {
  it("sets the base URL, title, description, OpenGraph and a large Twitter card", () => {
    expect(String(metadata.metadataBase)).toBe("https://thissongfits.com/");
    expect(metadata.title).toBe("Songfit - the perfect song for your video");
    expect(metadata.description).toBe(SUBLINE);
    expect(metadata.openGraph).toMatchObject({ title: metadata.title, description: SUBLINE });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("draws a 1200×630 share image", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
  });

  it("lists / and /privacy in the sitemap and points robots.txt at it", () => {
    expect(sitemap().map((e) => e.url)).toEqual(["https://thissongfits.com/", "https://thissongfits.com/privacy"]);
    expect(robots()).toMatchObject({
      sitemap: "https://thissongfits.com/sitemap.xml",
      rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api"] }],
    });
  });
});

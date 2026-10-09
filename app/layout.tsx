import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Mono } from "next/font/google";
import { SUBLINE } from "@/components/landing/copy";
import { SITE_ORIGIN } from "@/src/shared/site";
import "./globals.css";

/** The two web fonts. Display: the landing H1s only (preloaded). Mono: timestamps and captions only. Body is system. */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz", "wdth"],
  variable: "--font-display",
  display: "swap",
});
const mono = DM_Mono({
  subsets: ["latin"],
  weight: "500",
  variable: "--font-mono",
  display: "swap",
  preload: false,
});

const TITLE = "Songfit - the perfect song for your video";

/** Share previews. app/opengraph-image.tsx (1200×630) fills openGraph.images and twitter.images. */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: TITLE,
  description: SUBLINE,
  openGraph: { type: "website", url: "/", siteName: "Songfit", title: TITLE, description: SUBLINE },
  twitter: { card: "summary_large_image", title: TITLE, description: SUBLINE },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F7F8FA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}

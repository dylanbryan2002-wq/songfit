import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Songfit",
  description: "Find the right song for your content, and exactly which part to use.",
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

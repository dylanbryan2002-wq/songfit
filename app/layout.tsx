import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Songfit",
  description: "The right song, and the exact moment, for your next Reel.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-canvas font-sans text-ink">{children}</body>
    </html>
  );
}

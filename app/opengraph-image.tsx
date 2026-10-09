import { ImageResponse } from "next/og";
import { HEADLINE } from "@/components/landing/copy";
import { BRAND, CANVAS, INK, NoteMark } from "@/components/NoteMark";

export const alt = HEADLINE;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Share card: ink on canvas, the note mark + "Songfit" wordmark, and the landing H1. Nothing else. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: CANVAS,
          color: INK,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <NoteMark size={64} />
          <div style={{ display: "flex", fontSize: 60, fontWeight: 800, letterSpacing: -1 }}>
            <span style={{ color: INK }}>Song</span>
            <span style={{ color: BRAND }}>fit</span>
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }}>
          {HEADLINE}
        </div>
      </div>
    ),
    size,
  );
}

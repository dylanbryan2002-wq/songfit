import { ImageResponse } from "next/og";
import { CANVAS, NoteMark } from "@/components/NoteMark";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

/** Favicon: the red note mark on canvas. Next links it from every page, so no /favicon.ico request. */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: CANVAS }}>
        <NoteMark size={28} />
      </div>
    ),
    size,
  );
}

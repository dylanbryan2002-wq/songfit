import { ImageResponse } from "next/og";
import { CANVAS, NoteMark } from "@/components/NoteMark";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the red note mark on canvas. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: CANVAS }}>
        <NoteMark size={128} />
      </div>
    ),
    size,
  );
}

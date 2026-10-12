import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("next.config headers()", () => {
  it("sends the security headers on every path, and no CSP yet", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe("/:path*");
    const h = Object.fromEntries(rules[0]!.headers.map((x) => [x.key, x.value]));
    expect(h).toEqual({
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
  });

  it("keeps the ffmpeg packages external (the binaries must not be bundled)", () => {
    expect(nextConfig.serverExternalPackages).toEqual(["ffmpeg-static", "ffprobe-static", "onnxruntime-web"]); // faces runtime (new engine)
  });
});

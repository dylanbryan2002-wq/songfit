import type { NextConfig } from "next";

const TRACED_BINARIES = [
  "./node_modules/.pnpm/ffmpeg-static*/node_modules/ffmpeg-static/ffmpeg",
  "./node_modules/.pnpm/ffprobe-static*/node_modules/ffprobe-static/bin/linux/x64/ffprobe",
  // New engine faces (2026-10-11): the two ONNX models and onnxruntime-web's WASM runtime.
  "./src/media/models/*.onnx",
  "./node_modules/.pnpm/onnxruntime-web*/node_modules/onnxruntime-web/dist/*.wasm",
  "./node_modules/.pnpm/onnxruntime-web*/node_modules/onnxruntime-web/dist/ort.node.min.mjs",
  "./node_modules/.pnpm/onnxruntime-web*/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*.mjs",
];

/** Sent on every response. No Content-Security-Policy yet: Next's inline scripts and the Deezer CDN need a tested allow-list first. */
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // ffmpeg-static / ffprobe-static ship native binaries; they must not be bundled.
  // Task 4.7 edits this file and MUST keep this line.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static", "onnxruntime-web"],
  // Trace the native binaries into the serverless functions (pnpm store layout).
  outputFileTracingIncludes: {
    "/api/submissions/**": TRACED_BINARIES,
    "/admin/**": TRACED_BINARIES,
    "/api/health": TRACED_BINARIES,
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net" },
      { protocol: "https", hostname: "cdn-images.dzcdn.net" },
    ],
  },
};

export default nextConfig;

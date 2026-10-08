import type { NextConfig } from "next";

const TRACED_BINARIES = [
  "./node_modules/.pnpm/ffmpeg-static*/node_modules/ffmpeg-static/ffmpeg",
  "./node_modules/.pnpm/ffprobe-static*/node_modules/ffprobe-static/bin/linux/x64/ffprobe",
];

const nextConfig: NextConfig = {
  // ffmpeg-static / ffprobe-static ship native binaries; they must not be bundled.
  // Task 4.7 edits this file and MUST keep this line.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  // Trace the native binaries into the serverless functions (pnpm store layout).
  outputFileTracingIncludes: {
    "/api/submissions/**": TRACED_BINARIES,
    "/admin/**": TRACED_BINARIES,
    "/api/health": TRACED_BINARIES,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net" },
      { protocol: "https", hostname: "cdn-images.dzcdn.net" },
    ],
  },
};

export default nextConfig;

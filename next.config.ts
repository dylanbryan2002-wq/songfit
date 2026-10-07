import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static / ffprobe-static ship native binaries; they must not be bundled.
  // Task 4.7 edits this file and MUST keep this line.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "e-cdns-images.dzcdn.net" },
      { protocol: "https", hostname: "cdn-images.dzcdn.net" },
      { protocol: "https", hostname: "**.mzstatic.com" },
    ],
  },
};

export default nextConfig;

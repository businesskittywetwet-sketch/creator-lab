import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native binaries (SVG rasterizer, ffmpeg) must stay outside the bundle.
  serverExternalPackages: ["@resvg/resvg-js", "ffmpeg-static"],
};

export default nextConfig;

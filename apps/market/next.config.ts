import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The widget SDK ships TypeScript source (shared with the desktop app).
  transpilePackages: ["@repo/widget-sdk", "@repo/design-system"],
};

export default nextConfig;

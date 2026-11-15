import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The widget SDK ships TypeScript source (shared with the desktop app).
  transpilePackages: ["@repo/widget-sdk", "@repo/design-system"],
  async redirects() {
    return [
      // the Marketplace used to be the home page: keep its old category links working
      {
        source: "/",
        has: [{ type: "query", key: "category" }],
        destination: "/marketplace",
        permanent: true,
      },
      { source: "/faq", destination: "/help", permanent: true },
    ];
  },
};

export default nextConfig;

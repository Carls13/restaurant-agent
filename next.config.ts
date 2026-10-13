import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  experimental: {
    serverActions: {
      // Menu spreadsheets are small; leave headroom for multipart overhead
      // while staying under Vercel's 4.5MB function payload limit.
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;

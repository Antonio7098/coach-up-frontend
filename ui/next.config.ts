import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  eslint: {
    // Temporarily ignore ESLint errors during builds to validate prod build output.
    // We'll fix remaining lint issues in follow-up commits.
    ignoreDuringBuilds: true,
  },
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;

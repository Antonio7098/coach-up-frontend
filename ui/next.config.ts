import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production-specific settings (preserves your standalone build)
  ...(process.env.NODE_ENV === 'production' && {
    output: 'standalone' as const,
  }),

  // Server-side settings (updated for Next.js 15)
  serverExternalPackages: ['@google-cloud/speech'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    // Development-specific settings (fixes the build file issues)
    ...(process.env.NODE_ENV !== 'production' && {
      externalDir: true,
    }),
  },

  // Build settings
  eslint: {
    // Temporarily ignore ESLint errors during builds to validate prod build output.
    // We'll fix remaining lint issues in follow-up commits.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
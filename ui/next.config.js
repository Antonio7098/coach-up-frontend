const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@google-cloud/speech'],
    serverActions: true,
    serverActionsBodySizeLimit: '2mb',
  },
  // ... rest of the config ...
}

module.exports = nextConfig;

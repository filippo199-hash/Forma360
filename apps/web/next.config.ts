import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@forma360/api',
    '@forma360/auth',
    '@forma360/db',
    '@forma360/i18n',
    '@forma360/permissions',
    '@forma360/shared',
    '@forma360/ui',
  ],

  images: {
    remotePatterns: [],
  },

  serverExternalPackages: ['pg', 'bullmq', 'ioredis', '@aws-sdk/client-s3'],

  // Internal packages use NodeNext-style `./foo.js` imports that resolve to
  // `./foo.ts` at type-check time. Webpack does not do that substitution by
  // default. Mutate config.resolve in place (rather than reassigning) so Next
  // picks up the extensionAlias on every webpack layer (client, edge, node).
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    };
    return config;
  },

  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    // Turbopack's own `.js`→`.ts` alias key; mirrors the webpack block.
    resolveAlias: {},
  },
};

export default nextConfig;

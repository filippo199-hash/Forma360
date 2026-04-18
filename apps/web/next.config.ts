import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

// Point next-intl at the request config living in the shared i18n package.
const withNextIntl = createNextIntlPlugin('../../packages/i18n/src/request.ts');

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
    resolveAlias: {},
  },
};

export default withNextIntl(nextConfig);

import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

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

// Wrap with next-intl first (the i18n plugin has to be the innermost wrap so
// Sentry can instrument the final handler), then with Sentry.
export default withSentryConfig(withNextIntl(nextConfig), {
  // Only upload source maps in CI where SENTRY_AUTH_TOKEN is set.
  silent: !process.env.SENTRY_AUTH_TOKEN,
  // Disable telemetry pings from the Sentry build plugin.
  telemetry: false,
  // Hide source maps from clients even when uploaded.
  hideSourceMaps: true,
  // Automatically tree-shake Sentry's logger code in production.
  disableLogger: true,
});

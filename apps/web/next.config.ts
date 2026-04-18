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
// Sentry can instrument the final handler), then with Sentry — but only
// when SENTRY_DSN is configured. Without a DSN, skipping the Sentry wrap
// avoids pulling @sentry/nextjs's server-side instrumentation into the
// middleware + RSC bundles, which matters because the current Sentry
// release (8.x) isn't certified against Next 16 and its edge code path
// trips on `node:crypto`. Set SENTRY_DSN when you're ready for production
// error tracking; the wrap re-engages automatically on the next build.
const withIntl = withNextIntl(nextConfig);
const finalConfig = process.env.SENTRY_DSN
  ? withSentryConfig(withIntl, {
      silent: !process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      hideSourceMaps: true,
      disableLogger: true,
    })
  : withIntl;

export default finalConfig;

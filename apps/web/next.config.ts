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

  // puppeteer-core is dynamically imported by @forma360/render at runtime for
  // PDF rendering; keep it external so Next resolves it from node_modules
  // instead of bundling it (and its chromium glue) into the server build.
  serverExternalPackages: ['pg', 'bullmq', 'ioredis', '@aws-sdk/client-s3', 'puppeteer-core'],

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
//
// The wrap used to be conditional on SENTRY_DSN because Sentry 8.x was not
// certified against Next 16 and its edge code path tripped on `node:crypto`.
// Sentry 10 fixes that, so the wrap is now unconditional — a build that only
// engages Sentry in production is a build whose Sentry-specific breakage can
// only be discovered in production. Runtime behaviour is still governed by
// the DSN: `Sentry.init({ dsn: undefined })` no-ops.
//
// Source maps upload only when SENTRY_AUTH_TOKEN is present; without it the
// build still succeeds and you get minified frames.
const withIntl = withNextIntl(nextConfig);

export default withSentryConfig(withIntl, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  // Upload source maps for readable stack traces, then delete them from the
  // deployed bundle so the client never serves them.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  disableLogger: true,
  // Route browser events through our own origin so ad-blockers do not eat
  // the client error reports we most need from field devices.
  tunnelRoute: '/monitoring',
});

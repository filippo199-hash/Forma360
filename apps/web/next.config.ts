import { withSentryConfig } from '@sentry/nextjs';
import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('../../packages/i18n/src/request.ts');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Whether this deployment is actually reached over TLS.
 *
 * Distinct from `isProduction` on purpose: the Playwright job builds and boots
 * with `NODE_ENV=production` but serves `http://localhost:3000`, and both HSTS
 * and `upgrade-insecure-requests` are actively harmful there — the first pins
 * `localhost` to https in the developer's browser, which is genuinely hard to
 * undo, and the second rewrites the app's own requests to a scheme nothing is
 * listening on.
 */
const isHttpsDeployment = (process.env.APP_URL ?? '').startsWith('https://');

/**
 * Content-Security-Policy.
 *
 * The app shipped with no security headers at all, which left every
 * authenticated surface framable — permit sign-off, RAMS acceptance and user
 * administration are all one-click destructive actions, so clickjacking was
 * the sharpest edge. `frame-ancestors` closes that; the rest is
 * defence-in-depth around a codebase where no XSS sink is currently reachable.
 *
 * Each allowance below is here because something real needs it. Do not prune
 * one without checking what breaks:
 *
 * - `frame-ancestors 'self'`, not `'none'`: the document viewer frames our own
 *   `/api/documents/download`, and inspection instructions frame
 *   `/api/files`. `frame-ancestors` is evaluated on the FRAMED response, and
 *   this header applies to those routes too, so `'none'` would blank the
 *   document viewer while still not being any safer against third parties.
 * - `connect-src` names Nominatim: site address type-ahead calls it straight
 *   from the browser (`site-location-card.tsx`). It is the only cross-origin
 *   client fetch in the app — everything else, Sentry included, is tunnelled
 *   through our own origin.
 * - `frame-src` names Google Maps and the two privacy-mode video hosts:
 *   site location embeds and template video instructions (`video-embed.ts`).
 * - `img-src`/`media-src` allow `https:` because attachments are served as a
 *   redirect to a per-deployment R2 domain. Naming the bucket host here would
 *   couple the policy to an env var and break on a custom domain; images and
 *   video cannot execute, so the width costs little.
 * - `script-src` keeps `'unsafe-inline'`: Next's App Router inlines its
 *   hydration bootstrap, and there is no nonce plumbing (middleware skips
 *   `/api`, `/render`, `/s` and `/scan`, so a nonce would cover only part of
 *   the app and leave the public routes bare). This is the policy's weakest
 *   line and the honest place to tighten next; note it still blocks script
 *   loaded from any other origin, which is the exfiltration half of XSS.
 * - `'unsafe-eval'` in development only: React Fast Refresh needs it.
 */
const cspDirectives: Record<string, string[]> = {
  'default-src': ["'self'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'frame-ancestors': ["'self'"],
  'form-action': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'", ...(isProduction ? [] : ["'unsafe-eval'"])],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'https:'],
  'font-src': ["'self'", 'data:'],
  'media-src': ["'self'", 'blob:', 'https:'],
  'connect-src': ["'self'", 'https://nominatim.openstreetmap.org'],
  'frame-src': [
    "'self'",
    'blob:',
    'https://maps.google.com',
    'https://www.youtube-nocookie.com',
    'https://player.vimeo.com',
  ],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
};

const contentSecurityPolicy = [
  ...Object.entries(cspDirectives).map(([key, values]) => `${key} ${values.join(' ')}`),
  // Only where the app is genuinely served over TLS. On an http origin this
  // rewrites the app's own requests to a scheme nothing is listening on.
  ...(isHttpsDeployment ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Belt and braces with `frame-ancestors` for anything that predates CSP.
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  // Opaque access tokens live IN URLs on this app (`/s/<token>`,
  // `/scan/<token>`, `/render/<kind>/<id>?token=`), so a full Referer sent
  // cross-origin would hand them to a third party.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Restrict only what the product never uses. Camera (QR scanning, incident
  // photos), microphone (dictation) and geolocation (site capture) are all
  // real field features, and the media-related features the video iframe
  // needs are left at their browser defaults deliberately.
  {
    key: 'Permissions-Policy',
    value: [
      'camera=(self)',
      'microphone=(self)',
      'geolocation=(self)',
      'payment=()',
      'usb=()',
      'serial=()',
      'bluetooth=()',
      'idle-detection=()',
      'display-capture=()',
    ].join(', '),
  },
  // HSTS only where TLS is real: sent from an http origin it is ignored at
  // best, and pins http://localhost to https at worst — hard to undo by hand.
  ...(isHttpsDeployment
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The briefings module moved from /heads-up to /briefings. Old links
      // survive in sent emails, stored notification rows and bookmarks, so
      // both shapes redirect permanently. The locale segment is preserved;
      // internal /api/heads-up endpoints are untouched (nothing user-facing
      // links to them).
      {
        source: '/:locale/heads-up',
        destination: '/:locale/briefings',
        permanent: true,
      },
      {
        source: '/:locale/heads-up/:path*',
        destination: '/:locale/briefings/:path*',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // Token-bearing and machine-facing routes must never be indexed. A
        // crawled, cached `/s/<token>` is a permanent public leak of whatever
        // that link opens, and several of these tokens have no expiry.
        source: '/:prefix(s|scan|render|api)/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }],
      },
    ];
  },

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

  // Needed for readable browser stack traces in Sentry — Next does not emit
  // browser source maps in production otherwise. They are uploaded and then
  // deleted from the bundle by `sourcemaps.deleteSourcemapsAfterUpload`, so
  // nothing ships to the client.
  productionBrowserSourceMaps: true,

  // puppeteer-core is dynamically imported by @forma360/render at runtime for
  // PDF rendering; keep it external so Next resolves it from node_modules
  // instead of bundling it (and its chromium glue) into the server build.
  //
  // pino + pino-pretty are here for a sharper reason: pino spawns its
  // transport in a worker thread via `thread-stream`, which locates the
  // worker with `join(__dirname, 'lib', 'worker.js')`. Bundled, `__dirname`
  // becomes the chunk directory and the path resolves to
  // `.next/server/chunks/lib/worker.js` — a file webpack never emits. The
  // worker dies at boot, takes the logger's output with it, and raises an
  // uncaught exception. Externalised, pino resolves from node_modules and
  // finds its own worker. Both are declared in this package's package.json
  // so Node can resolve them from `.next/server` under pnpm.
  serverExternalPackages: [
    'pg',
    'bullmq',
    'ioredis',
    '@aws-sdk/client-s3',
    'puppeteer-core',
    'pino',
    'pino-pretty',
  ],

  // NOTE: production builds run `next build --webpack` (see package.json).
  // Turbopack emits *indexed* source maps — a `sections` array with an empty
  // top-level `sources` — and Sentry's symbolicator reads only the top level,
  // so every server frame came back `js_no_source: Source code was not found`
  // even with the map uploaded to the right project and the debug IDs
  // matching. Webpack emits flat maps with embedded `sourcesContent`, which
  // Sentry resolves. Costs ~4 min of build time; buys readable stack traces.
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

// `exactOptionalPropertyTypes` is on, and `SentryBuildOptions` declares these
// three as `string` rather than `string | undefined` — so passing the env vars
// through unconditionally is a type error when they are unset (which is the
// normal case locally and in CI). Spread them only when present: same runtime
// behaviour, no `as` and no ignore comment.
const sentryCredentials = {
  ...(process.env.SENTRY_ORG === undefined ? {} : { org: process.env.SENTRY_ORG }),
  ...(process.env.SENTRY_PROJECT === undefined ? {} : { project: process.env.SENTRY_PROJECT }),
  ...(process.env.SENTRY_AUTH_TOKEN === undefined
    ? {}
    : { authToken: process.env.SENTRY_AUTH_TOKEN }),
};

export default withSentryConfig(withIntl, {
  ...sentryCredentials,
  silent: !process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  // Upload source maps for readable stack traces, then delete them from the
  // deployed bundle so the client never serves them.
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  // Strip the SDK's own debug logging from the bundle. `disableLogger` was
  // deprecated in Sentry 10 and warns at error severity on every boot.
  webpack: { treeshake: { removeDebugLogging: true } },
  // Route browser events through our own origin so ad-blockers do not eat
  // the client error reports we most need from field devices.
  tunnelRoute: '/monitoring',
});

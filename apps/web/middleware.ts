import { routing } from '@forma360/i18n/routing';
import createMiddleware from 'next-intl/middleware';

/**
 * Locale detection + redirect. Strips away the bare-path navigation so
 * `/anything-without-a-locale` becomes `/<detected>/anything-without-a-locale`.
 * Detection order: cookie → Accept-Language → default.
 */
export default createMiddleware(routing);

export const config = {
  // Match every path except Next internals, /api/* (tRPC + better-auth),
  // static assets, and the public folder. The locale segment is added by
  // the middleware itself, so this matcher intentionally does NOT list it.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};

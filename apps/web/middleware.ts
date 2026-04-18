import { routing } from '@forma360/i18n/routing';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { ulid } from 'ulid';

const intlMiddleware = createMiddleware(routing);

/**
 * Root middleware. Runs for every request matching the matcher below
 * (excluding /api/*, _next/*, _vercel/*, static files).
 *
 * Responsibilities:
 *   1. Ensure every request carries `x-request-id`. Generated on entry so
 *      downstream handlers, logs, and Sentry events can correlate without
 *      coordinating on a separate id. Re-used when the client sends one
 *      already (e.g. a retry from a monitoring tool).
 *   2. Delegate locale detection + redirect to next-intl's middleware.
 *
 * /api/* route handlers generate their own request id — they're never
 * reached by this middleware.
 */
export default function middleware(request: NextRequest): NextResponse {
  const requestId = request.headers.get('x-request-id') ?? ulid();

  // Propagate x-request-id down to the handler via a request-header rewrite
  // so RSC and the route layer see the same id.
  request.headers.set('x-request-id', requestId);

  const response = intlMiddleware(request) ?? NextResponse.next();
  response.headers.set('x-request-id', requestId);
  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
  // Run on the Node.js runtime, not the edge runtime. Three reasons:
  //   1. @sentry/nextjs 8.x wraps middleware and transitively imports
  //      node:crypto, which blows up the edge runtime.
  //   2. `next-intl`'s middleware + our request-id logic are modest enough
  //      that edge cold-start gains don't matter.
  //   3. Railway is a single-region Node server — there's no CDN edge to
  //      exploit anyway.
  // Stable since Next 15.3; see https://nextjs.org/docs/app/api-reference/file-conventions/middleware#runtime
  runtime: 'nodejs',
};

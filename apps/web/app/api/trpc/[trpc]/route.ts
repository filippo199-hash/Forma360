/**
 * tRPC HTTP entrypoint.
 *
 * Wires the root router behind Next 16's App Router. One file; handles
 * GET (queries) and POST (mutations) via @trpc/server's fetch adapter.
 *
 * Request-id flow:
 *   - If the caller already sent `x-request-id`, reuse it.
 *   - Otherwise, the tRPC context factory generates a fresh ULID.
 *   - Echo the id back to the caller on the response so they can correlate
 *     server logs with client-side telemetry.
 */
import { buildAppRouter } from '@forma360/api';
import * as Sentry from '@sentry/nextjs';
import { isId } from '@forma360/shared/id';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { logger } from '../../../../src/server/logger';
import { authDeps } from '../../../../src/server/auth-deps';
import { exportsDeps } from '../../../../src/server/exports-deps';
import { headsUpsDeps } from '../../../../src/server/heads-up-deps';
import { inspectionsDeps } from '../../../../src/server/inspections-deps';
import { inspectionsExportDeps } from '../../../../src/server/inspections-export-deps';
import { issuesDeps } from '../../../../src/server/issues-deps';
import { riskAssessmentsDeps } from '../../../../src/server/risk-assessments-deps';
import { coshhDeps } from '../../../../src/server/coshh-deps';
import { dashboardsDeps } from '../../../../src/server/dashboards-deps';
import { permitsDeps } from '../../../../src/server/permits-deps';
import { fireSafetyDeps } from '../../../../src/server/fire-safety-deps';
import { incidentsDeps } from '../../../../src/server/incidents-deps';
import { ramsDeps } from '../../../../src/server/rams-deps';
import { trainingDeps } from '../../../../src/server/training-deps';
import { env } from '../../../../src/server/env';
import { createContext } from '../../../../src/server/trpc';
// Side-effect import: wires the users router's invite email + appUrl deps.
import '../../../../src/server/users-deps';
import '../../../../src/server/actions-deps';

// Build the router once with production dependencies (R2-backed
// renderers, HMAC-signed render tokens, APP_URL-based share URLs).
// Risk Assessments is brand-gated (ADR 0010): enabled only where the
// active brand's module catalogue includes it.
const appRouter = buildAppRouter({
  exports: exportsDeps,
  inspectionsExport: inspectionsExportDeps,
  auth: authDeps,
  inspections: inspectionsDeps,
  issues: issuesDeps,
  headsUps: headsUpsDeps,
  riskAssessments: riskAssessmentsDeps,
  coshh: coshhDeps,
  permits: permitsDeps,
  fireSafety: fireSafetyDeps,
  incidents: incidentsDeps,
  rams: ramsDeps,
  training: trainingDeps,
  dashboards: dashboardsDeps,
});

/**
 * Cross-site write protection for the tRPC transport.
 *
 * The only thing standing between a cross-site page and an authenticated
 * mutation was `sameSite: 'lax'` on the session cookie. That does hold today —
 * Lax withholds the cookie on a cross-site POST — but it was an implicit,
 * single-layer defence with nothing naming it and no test pinning it, so
 * flipping the cookie to `sameSite: 'none'` for an embedded or mobile-webview
 * client would silently expose every mutation in the product.
 *
 * This adds the explicit layer. It refuses a request whose `Origin` is present
 * and is not ours, or whose `Sec-Fetch-Site` says `cross-site`. Absent headers
 * are allowed: non-browser callers legitimately omit `Origin`, and for those
 * there is no cookie to ride anyway. Same-origin fetches from our own pages
 * always send a matching `Origin` on POST, so nothing legitimate is refused.
 *
 * Server-side callers are unaffected — they use `createServerCaller`, not HTTP.
 */
function isCrossSiteWrite(req: Request): boolean {
  if (req.method !== 'POST') return false;

  if (req.headers.get('sec-fetch-site') === 'cross-site') return true;

  const origin = req.headers.get('origin');
  if (origin === null || origin === '') return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true; // an unparseable Origin is not one of ours
  }

  // Compared by HOST, not by full origin: the scheme cannot be inferred
  // reliably here. Behind Railway's proxy the app speaks http internally while
  // the browser saw https, and a phone testing the PWA over the LAN arrives as
  // `http://192.168.x.x:3000` — guessing a scheme would 403 both. Host
  // equality is what actually distinguishes an attacker's page from ours.
  const allowedHosts = new Set<string>();
  const host = req.headers.get('host');
  if (host !== null && host !== '') allowedHosts.add(host);
  try {
    allowedHosts.add(new URL(env.APP_URL).host);
  } catch {
    /* APP_URL is URL-validated by the env schema; ignore if that ever changes */
  }

  return !allowedHosts.has(originHost);
}

async function handler(req: Request): Promise<Response> {
  if (isCrossSiteWrite(req)) {
    logger.warn(
      { origin: req.headers.get('origin'), site: req.headers.get('sec-fetch-site') },
      '[trpc] refused a cross-site write',
    );
    return Response.json({ error: { message: 'Cross-site request refused' } }, { status: 403 });
  }

  const incomingId = req.headers.get('x-request-id');
  const presetId = isId(incomingId) ? incomingId : undefined;

  let contextRequestId: string | undefined;
  let contextTenantId: string | undefined;
  let contextUserId: string | undefined;

  const response = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: async ({ req: adaptedReq }) => {
      const ctx = await createContext({
        headers: adaptedReq.headers,
        ...(presetId !== undefined ? { requestId: presetId as never } : {}),
      });
      contextRequestId = ctx.requestId;
      contextTenantId = ctx.auth?.tenantId;
      contextUserId = ctx.auth?.userId;
      return ctx;
    },
    // Without this hook the fetch adapter swallows procedure errors in
    // production — a 500 leaves no server-side trace at all. Log every
    // INTERNAL error (and the cause chain) so incidents are diagnosable.
    onError({ error, path, type }) {
      logger.error(
        {
          err: error,
          cause: error.cause instanceof Error ? error.cause.message : undefined,
          code: error.code,
          path,
          type,
          requestId: contextRequestId,
        },
        '[trpc] procedure error',
      );
      // Only genuine 500s reach Sentry. Every other code is a domain guard
      // doing its job — `rams-pack-not-issued`, `last-admin`, an expired
      // permit window — and reporting those would bury the real failures
      // under thousands of correctly-refused mutations.
      if (error.code !== 'INTERNAL_SERVER_ERROR') return;
      Sentry.withScope((scope) => {
        scope.setTag('procedure', path ?? 'unknown');
        scope.setTag('trpc.type', type);
        if (contextTenantId !== undefined) scope.setTag('tenantId', contextTenantId);
        if (contextUserId !== undefined) scope.setUser({ id: contextUserId });
        if (contextRequestId !== undefined) scope.setTag('x-request-id', contextRequestId);
        // Report the cause when tRPC has wrapped the real error, so the
        // Sentry title is the actual failure and not "INTERNAL_SERVER_ERROR".
        Sentry.captureException(error.cause instanceof Error ? error.cause : error);
      });
    },
  });

  if (contextRequestId !== undefined) {
    response.headers.set('x-request-id', contextRequestId);
  }
  return response;
}

export { handler as GET, handler as POST };

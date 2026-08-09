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

async function handler(req: Request): Promise<Response> {
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

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
import { brandHasModule } from '@forma360/shared/brand';
import { isId } from '@forma360/shared/id';
import { activeBrand } from '../../../../src/lib/brand';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { logger } from '../../../../src/server/logger';
import { authDeps } from '../../../../src/server/auth-deps';
import { exportsDeps } from '../../../../src/server/exports-deps';
import { headsUpsDeps } from '../../../../src/server/heads-up-deps';
import { inspectionsDeps } from '../../../../src/server/inspections-deps';
import { inspectionsExportDeps } from '../../../../src/server/inspections-export-deps';
import { issuesDeps } from '../../../../src/server/issues-deps';
import { createContext } from '../../../../src/server/trpc';
// Side-effect import: wires the users router's invite email + appUrl deps.
import '../../../../src/server/users-deps';

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
  riskAssessments: { enabled: brandHasModule(activeBrand.id, 'riskAssessments') },
});

async function handler(req: Request): Promise<Response> {
  const incomingId = req.headers.get('x-request-id');
  const presetId = isId(incomingId) ? incomingId : undefined;

  let contextRequestId: string | undefined;

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
    },
  });

  if (contextRequestId !== undefined) {
    response.headers.set('x-request-id', contextRequestId);
  }
  return response;
}

export { handler as GET, handler as POST };

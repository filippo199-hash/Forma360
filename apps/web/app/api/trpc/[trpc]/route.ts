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
import { isId } from '@forma360/shared/id';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { exportsDeps } from '../../../../src/server/exports-deps';
import { createContext } from '../../../../src/server/trpc';

// Build the router once with production dependencies (R2-backed
// renderers, HMAC-signed render tokens, APP_URL-based share URLs).
const appRouter = buildAppRouter({ exports: exportsDeps });

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
  });

  if (contextRequestId !== undefined) {
    response.headers.set('x-request-id', contextRequestId);
  }
  return response;
}

export { handler as GET, handler as POST };

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
import { appRouter } from '@forma360/api';
import { isId } from '@forma360/shared/id';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { createContext } from '../../../../src/server/trpc';

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

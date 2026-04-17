/**
 * tRPC HTTP entrypoint.
 *
 * Wires the root router behind Next 16's App Router. One file; handles
 * GET (queries) and POST (mutations) via @trpc/server's fetch adapter.
 */
import { appRouter } from '@forma360/api';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { createContext } from '../../../../src/server/trpc';

function handler(req: Request): Promise<Response> {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: ({ req: adaptedReq }) => createContext({ headers: adaptedReq.headers }),
  });
}

export { handler as GET, handler as POST };

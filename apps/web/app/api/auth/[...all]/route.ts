/**
 * better-auth HTTP entrypoint. Catches every route under /api/auth/* and
 * dispatches to the auth handler exposed by the server instance.
 */
import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '../../../../src/server/auth';

export const { GET, POST } = toNextJsHandler(auth);

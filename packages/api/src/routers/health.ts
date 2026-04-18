/**
 * Health / smoke-test routes.
 *
 * `health.ping` is the public liveness probe. `health.me` is the minimum
 * end-to-end auth test: it exercises the session → context → procedure →
 * response path and is the procedure Phase 0's exit criterion #2 verifies.
 */
import { authedProcedure, publicProcedure } from '../procedures';
import { router } from '../trpc';

export const healthRouter = router({
  ping: publicProcedure.query(() => ({
    ok: true as const,
    time: new Date().toISOString(),
  })),

  me: authedProcedure.query(({ ctx }) => ({
    userId: ctx.auth.userId,
    email: ctx.auth.email,
    tenantId: ctx.auth.tenantId,
  })),
});

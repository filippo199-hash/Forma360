/**
 * Procedure builders.
 *
 * Every procedure in the app is built from one of these three helpers. They
 * encode the authorisation level of the route in the procedure name itself,
 * so a reviewer can tell at a glance whether a handler is open to everyone
 * (`publicProcedure`), requires a session (`authedProcedure`), or requires a
 * session bound to a tenant (`tenantProcedure`).
 *
 * Clients never supply the tenant id directly — it comes from the session
 * via the context. That's the core invariant of our multi-tenancy model
 * (see ADR 0002).
 *
 * Phase 1 will add `requirePermission(perm)` on top of `tenantProcedure`
 * for per-action authorisation; this file will grow a fourth helper then.
 */
import { middleware, procedure, TRPCError } from './trpc';

/**
 * Fully public. Use for anything safe to call without a session: health
 * probes, public share links, signup (sign-up itself is handled by
 * better-auth, not tRPC).
 */
export const publicProcedure = procedure;

const requireSession = middleware(({ ctx, next }) => {
  if (ctx.auth === null) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }
  return next({
    ctx: {
      ...ctx,
      auth: ctx.auth,
    },
  });
});

/**
 * Requires a valid session. Tenant scope is NOT yet guaranteed — use
 * `tenantProcedure` unless you have a specific reason to accept an
 * authenticated-but-tenantless caller (which, in practice, we don't).
 */
export const authedProcedure = procedure.use(requireSession);

const requireTenant = middleware(({ ctx, next }) => {
  if (ctx.auth === null) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }
  return next({
    ctx: {
      ...ctx,
      auth: ctx.auth,
      tenantId: ctx.auth.tenantId,
    },
  });
});

/**
 * Requires a session AND a tenant binding. This is the default for almost
 * every procedure in the app. The tenant id is available as `ctx.tenantId`
 * and is derived from the session — **never from client input**.
 */
export const tenantProcedure = procedure.use(requireTenant);

/**
 * Procedure builders.
 *
 * Every procedure in the app is built from one of these helpers. They
 * encode the authorisation level of the route in the procedure name itself,
 * so a reviewer can tell at a glance whether a handler is open to everyone
 * (`publicProcedure`), requires a session (`authedProcedure`), requires a
 * session bound to a tenant (`tenantProcedure`), or requires a specific
 * permission (`tenantProcedure.use(requirePermission('users.manage'))`).
 *
 * Clients never supply the tenant id directly — it comes from the session
 * via the context. That's the core invariant of our multi-tenancy model
 * (see ADR 0002).
 */
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import type { PermissionKey } from '@forma360/permissions/catalogue';
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

/**
 * Per-procedure permission guard, layered on top of `tenantProcedure`.
 *
 * Usage:
 *   tenantProcedure
 *     .use(requirePermission('users.manage'))
 *     .mutation(async ({ ctx, input }) => { ... })
 *
 * After the middleware runs, `ctx.permissions` is available as a
 * `readonly PermissionKey[]` so handlers can render per-action enablement
 * in responses without a second DB round-trip. On refusal the middleware
 * throws `TRPCError({ code: 'FORBIDDEN' })` with the missing key in the
 * message.
 */
export function requirePermission(perm: PermissionKey) {
  return middleware(async ({ ctx, next }) => {
    if (ctx.auth === null) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
    if (!perms.includes(perm)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Missing permission: ${perm}`,
      });
    }
    return next({
      ctx: {
        ...ctx,
        auth: ctx.auth,
        tenantId: ctx.auth.tenantId,
        permissions: perms,
      },
    });
  });
}

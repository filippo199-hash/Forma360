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
import { tenants } from '@forma360/db/schema';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { grantsAdminAccess, type PermissionKey } from '@forma360/permissions/catalogue';
import { settingsHaveEntitlement, type EntitlementKey } from '@forma360/shared/entitlements';
import { eq } from 'drizzle-orm';
import { middleware, procedure, TRPCError } from './trpc';

/**
 * Translate a saturated render queue into a client-facing refusal.
 *
 * `@forma360/render` caps concurrent Chromium pages and now also caps the
 * queue waiting behind them, throwing `RenderQueueFullError` rather than
 * parking a request handler forever. Left alone, tRPC would wrap that as
 * `INTERNAL_SERVER_ERROR`, which means a 500 to the caller AND a Sentry event
 * per refusal — turning back-pressure into alert noise. `TOO_MANY_REQUESTS`
 * is the truth: come back shortly.
 *
 * Duck-typed on `code` so this package needs no dependency on
 * `@forma360/render` (the renderers reach the routers by injection).
 */
const RENDER_QUEUE_FULL = 'RENDER_QUEUE_FULL';

const translateRenderBackPressure = middleware(async ({ next }) => {
  try {
    return await next();
  } catch (err) {
    if (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === RENDER_QUEUE_FULL
    ) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'The document renderer is busy. Try again in a moment.',
        cause: err,
      });
    }
    throw err;
  }
});

/**
 * Fully public. Use for anything safe to call without a session: health
 * probes, public share links, signup (sign-up itself is handled by
 * better-auth, not tRPC).
 */
export const publicProcedure = procedure.use(translateRenderBackPressure);

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
export const authedProcedure = procedure.use(translateRenderBackPressure).use(requireSession);

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
export const tenantProcedure = procedure.use(translateRenderBackPressure).use(requireTenant);

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
    // Administrators (org.settings) implicitly hold every key — a permission
    // set snapshotted before a module existed must not lock admins out of it.
    if (!perms.includes(perm) && !grantsAdminAccess(perms)) {
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

/**
 * Paid-plan gate (ADR 0018), layered on top of `tenantProcedure` the same
 * way `requirePermission` is. Refuses with `PAYMENT_REQUIRED` — a code no
 * other guard uses — so the web client can render the upgrade surface
 * instead of a generic error. Permissions answer "may this person do
 * this"; entitlements answer "does this tenant's plan include this" —
 * a procedure that needs both stacks both middlewares.
 *
 * The plan is read from `tenants.settings.plan` through
 * `settingsHaveEntitlement`, so a corrupt settings row degrades to the
 * free plan (locked out of paid features, never locked out of the app).
 */
export function requireEntitlement(key: EntitlementKey) {
  return middleware(async ({ ctx, next }) => {
    if (ctx.auth === null) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    const rows = await ctx.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.auth.tenantId))
      .limit(1);
    if (!settingsHaveEntitlement(rows[0]?.settings, key)) {
      throw new TRPCError({
        code: 'PAYMENT_REQUIRED',
        message: `Plan does not include: ${key}`,
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
}

/**
 * Any-of variant of `requirePermission`. Passes when the caller holds at
 * least ONE of the listed keys (administrators still bypass via
 * `grantsAdminAccess`, same as the single-key guard).
 *
 * Use it where one operation is legitimately reachable from two different
 * job roles — contractor gate check-in, say, which both the contractor
 * manager (`contractors.manage`) and the reception operator
 * (`contractors.gate`) must be able to perform. Prefer `requirePermission`
 * when there is only one right key, and an in-handler check when the
 * decision needs row data (see `assertCanRecord` in routers/permits.ts).
 *
 * The rest-parameter tuple type makes an empty call a compile error — a
 * zero-key guard would silently authorise everyone.
 */
export function requireAnyPermission(...perms: readonly [PermissionKey, ...PermissionKey[]]) {
  return middleware(async ({ ctx, next }) => {
    if (ctx.auth === null) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    const held = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
    if (!perms.some((p) => held.includes(p)) && !grantsAdminAccess(held)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Missing permission: one of ${perms.join(', ')}`,
      });
    }
    return next({
      ctx: {
        ...ctx,
        auth: ctx.auth,
        tenantId: ctx.auth.tenantId,
        permissions: held,
      },
    });
  });
}

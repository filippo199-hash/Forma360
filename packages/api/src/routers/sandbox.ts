/**
 * Sandbox router — claiming a try-it-now workspace (ADR 0017).
 *
 * The visitor already has a real session at this point; what they do
 * not have is an address we can reach them at. `claim` swaps the
 * placeholder `@sandbox.invalid` address on their user row for a real
 * one and stamps `settings.sandbox.claimedAt`, which is what takes the
 * workspace out of the TTL sweep. The client then triggers the ordinary
 * email-OTP send, so coming back later is exactly the flow every other
 * FreeHS user already has — no second kind of magic link to maintain.
 *
 * The workspace is never held hostage: everything is saved as they go,
 * and `claim` is offered at the first artefact they authored rather
 * than gating any of the work behind it.
 *
 * Deliberate refusals:
 *   - a tenant that is not an unclaimed sandbox (claiming twice, or
 *     claiming an ordinary tenant, is a bug not a flow);
 *   - an address that already belongs to a user, which is a fork in the
 *     road rather than an error — the caller gets `email-in-use` and the
 *     UI offers to sign them into the account they already have.
 */
import { tenants, user } from '@forma360/db/schema';
import { getEmailDomain, isFreeEmailDomain } from '@forma360/shared/email-domains';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isSandboxEmail } from '../sandbox/provision';
import { tenantProcedure } from '../procedures';
import { router } from '../trpc';

const claimInput = z.object({
  // `.trim()` runs before `.email()`. Without it a pasted address with a
  // trailing space is rejected as malformed — and pasting is how most
  // people enter an address on a phone.
  email: z.string().trim().email(),
  /** Optional — the visitor's own name, stamped onto documents. */
  name: z.string().min(1).max(100).optional(),
  /** Optional — replaces the placeholder workspace name. */
  companyName: z.string().min(1).max(100).optional(),
});

export const sandboxRouter = router({
  /**
   * Is the caller sitting in an unclaimed sandbox? Drives the save
   * prompt and the "demo data" banner. Cheap enough to call on any
   * page that wants to know.
   */
  status: tenantProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    const sandbox = rows[0]?.settings.sandbox;
    if (sandbox === undefined) {
      return { isSandbox: false, isClaimed: false, scenarioId: null, refinementId: null } as const;
    }
    return {
      isSandbox: true,
      isClaimed: sandbox.claimedAt !== undefined,
      scenarioId: sandbox.scenarioId,
      refinementId: sandbox.refinementId,
    } as const;
  }),

  /**
   * Attach a real email address to this workspace. On success the
   * caller should POST to `/api/auth/email-otp/send-verification-otp`
   * so the visitor receives the code that lets them return.
   */
  claim: tenantProcedure.input(claimInput).mutation(async ({ ctx, input }) => {
    const email = input.email.toLowerCase().trim();

    // One claim per IP-ish window: this mutation sends the visitor down
    // a path that ends in an outbound email, so it is abuse-prone.
    const rl = await ctx.rateLimit(`sandbox:claim:${ctx.clientIp}`, {
      limit: 10,
      windowSec: 3600,
      // RL-F02: unauthenticated, and it ends in an outbound email.
      failClosed: true,
    });
    if (!rl.ok) {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'rate-limited' });
    }

    const tenantRows = await ctx.db
      .select({ settings: tenants.settings, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    const tenant = tenantRows[0];
    if (tenant === undefined) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'tenant-not-found' });
    }
    const sandbox = tenant.settings.sandbox;
    if (sandbox === undefined) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'not-a-sandbox' });
    }
    if (sandbox.claimedAt !== undefined) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'already-claimed' });
    }
    // UXW2-03: only the provisioning visitor — the account still carrying
    // the placeholder address — may claim. An invited member claiming
    // would repoint the workspace's ownership at their own inbox.
    if (!ctx.auth.email.endsWith('@sandbox.invalid')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'not-sandbox-owner' });
    }

    // Taken by someone else? That is a fork, not a failure — the UI
    // offers to sign them into the account they already have.
    const existing = await ctx.db
      .select({ id: user.id })
      .from(user)
      .where(and(eq(user.email, email), ne(user.id, ctx.auth.userId)))
      .limit(1);
    if (existing[0] !== undefined) {
      throw new TRPCError({ code: 'CONFLICT', message: 'email-in-use' });
    }

    // Does their WORK domain already have a workspace? Surfaced so the
    // UI can offer "ask to join" rather than stranding them in a
    // parallel tenant nobody else can see.
    //
    // Consumer domains are excluded, and that exclusion is the whole
    // point of the check being safe: every gmail.com user shares a
    // domain with every other, so matching on it told an anonymous
    // stranger the NAME of an unrelated customer. A colleague hint is
    // only meaningful when the domain actually implies a colleague.
    const domain = getEmailDomain(email);
    let existingTenant: { id: string; name: string } | null = null;
    if (domain !== null && !isFreeEmailDomain(email)) {
      const matches = await ctx.db
        .select({ tenantId: user.tenantId, tenantName: tenants.name })
        .from(user)
        .innerJoin(tenants, eq(user.tenantId, tenants.id))
        .where(
          and(
            sql`lower(${user.email}) like ${'%@' + domain}`,
            ne(user.tenantId, ctx.tenantId),
            isNull(user.deactivatedAt),
            isNull(tenants.archivedAt),
          ),
        )
        .limit(1);
      const found = matches[0];
      if (found !== undefined) {
        existingTenant = { id: found.tenantId, name: found.tenantName };
      }
    }

    const claimedAt = new Date();
    await ctx.db.transaction(async (tx) => {
      const nameParts = input.name?.trim().split(/\s+/) ?? [];
      const first = nameParts[0];
      const last = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

      await tx
        .update(user)
        .set({
          email,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(first !== undefined ? { firstName: first } : {}),
          ...(last !== undefined ? { lastName: last } : {}),
          updatedAt: claimedAt,
        })
        .where(eq(user.id, ctx.auth.userId));

      await tx
        .update(tenants)
        .set({
          ...(input.companyName !== undefined ? { name: input.companyName } : {}),
          settings: {
            ...tenant.settings,
            sandbox: { ...sandbox, claimedAt: claimedAt.toISOString() },
          },
          updatedAt: claimedAt,
        })
        .where(eq(tenants.id, ctx.tenantId));
    });

    ctx.logger.info(
      { tenantId: ctx.tenantId, scenarioId: sandbox.scenarioId },
      '[sandbox] workspace claimed',
    );

    return { claimed: true as const, existingTenant };
  }),
});

/** Re-exported so the web layer can label a user row without importing internals. */
export { isSandboxEmail };

import type { TenantSettings } from '@forma360/db/schema';
import {
  invitations,
  issueCategories,
  riskAssessments,
  sites,
  templates,
  tenants,
  user,
} from '@forma360/db/schema';
import { TRPCError } from '@trpc/server';
import { and, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

/**
 * First-run setup state for the "Set up your workspace" checklist on
 * My work (UXW1-03/06). A brand-new workspace used to land its owner in
 * an AI chat with nothing pointing at "add your sites, invite your
 * team" — this is the in-app counterpart of the marketing page's
 * "Make it yours" step.
 *
 * Admin-only (`org.settings`): setting the workspace up is the owner's
 * job, and non-admins never fetch this. Every step is derived from the
 * real registers — nothing is stamped when a step completes, so the
 * checklist can never disagree with the data (the sandbox "seed must
 * agree with itself" lesson, applied to real tenants).
 */
export const onboardingRouter = router({
  status: tenantProcedure.use(requirePermission('org.settings')).query(async ({ ctx }) => {
    const now = new Date();
    const [siteRows, teamRows, inviteRows, raRows, templateRows, qrRows, tenantRows] =
      await Promise.all([
        ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(sites)
          .where(and(eq(sites.tenantId, ctx.tenantId), isNull(sites.archivedAt))),
        ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(user)
          .where(and(eq(user.tenantId, ctx.tenantId), isNull(user.deactivatedAt))),
        ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(invitations)
          .where(
            and(
              eq(invitations.tenantId, ctx.tenantId),
              isNull(invitations.acceptedAt),
              gt(invitations.expiresAt, now),
            ),
          ),
        ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(riskAssessments)
          .where(
            and(eq(riskAssessments.tenantId, ctx.tenantId), eq(riskAssessments.status, 'active')),
          ),
        ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(templates)
          .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.status, 'published'))),
        ctx.db
          .select({ n: sql<number>`count(*)::int` })
          .from(issueCategories)
          .where(
            and(
              eq(issueCategories.tenantId, ctx.tenantId),
              isNotNull(issueCategories.publicShareToken),
            ),
          ),
        ctx.db
          .select({ settings: tenants.settings })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId))
          .limit(1),
      ]);

    const settings = tenantRows[0]?.settings ?? {};
    return {
      steps: {
        sites: (siteRows[0]?.n ?? 0) > 0,
        // Team counts as started once anyone beyond the founder exists —
        // an accepted colleague or a pending invitation both qualify.
        team: (teamRows[0]?.n ?? 0) > 1 || (inviteRows[0]?.n ?? 0) > 0,
        riskAssessment: (raRows[0]?.n ?? 0) > 0,
        template: (templateRows[0]?.n ?? 0) > 0,
        qr: (qrRows[0]?.n ?? 0) > 0,
      },
      dismissed: settings.onboardingDismissedAt !== undefined,
      // A sandbox IS the guided experience — the checklist would stack
      // under the sandbox banner and nag about steps the seed did on
      // purpose. Hidden until the workspace is claimed.
      isSandbox: settings.sandbox !== undefined && settings.sandbox.claimedAt === undefined,
    };
  }),

  dismiss: tenantProcedure.use(requirePermission('org.settings')).mutation(async ({ ctx }) => {
    const rows = await ctx.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);
    const current = rows[0]?.settings;
    if (current === undefined) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
    const next: TenantSettings = { ...current, onboardingDismissedAt: new Date().toISOString() };
    await ctx.db
      .update(tenants)
      .set({ settings: next, updatedAt: new Date() })
      .where(eq(tenants.id, ctx.tenantId));
    ctx.logger.info({ tenantId: ctx.tenantId }, '[onboarding] checklist dismissed');
    return { ok: true as const };
  }),
});

/**
 * Auth router — sign-up / invite-acceptance / domain lookup / request-to-join.
 *
 * Procedures here are public (no session required) by design: they run
 * BEFORE the caller has a user row. The mutations create the user row
 * (no credential `account` row — Forma360 is passwordless and uses
 * email-OTP via better-auth's `emailOTP` plugin) so a successful
 * response means the caller can immediately request an OTP at
 * `/api/auth/email-otp/send-verification-otp` and exchange it at
 * `/api/auth/sign-in/email-otp`.
 *
 *   - lookupEmailDomain  — frontend asks "does this look like a personal
 *     address, a known business tenant, or an unknown business domain?"
 *     to branch the sign-up UI between "create a tenant" and "ask to join".
 *   - signUpWithTenant   — provisions a new tenant + seeds permission sets
 *     + creates the administrator user in one tx. Mirrors
 *     `packages/permissions/src/scripts/bootstrap-tenant.ts` — re-use
 *     the same primitives so the two paths can't drift.
 *   - requestToJoin      — emails every administrator of the named tenant
 *     to tell them someone wants in. No DB writes.
 *   - acceptInvite       — looks up an `invitations.token`, validates,
 *     creates the user row, marks the invite accepted.
 *   - getInviteDetails   — read-only; used by the accept page to render
 *     the tenant name and inviter context.
 */
import {
  contractorUsers,
  groupMembers,
  invitations,
  permissionSets,
  siteMembers,
  tenants,
  type TenantSettings,
  user,
} from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { appLink } from '@forma360/shared/app-link';
import { getEmailDomain, isFreeEmailDomain } from '@forma360/shared/email-domains';
import { newId } from '@forma360/shared/id';
import type { Logger } from '@forma360/shared/logger';
import type { SendTemplatedEmail } from '@forma360/shared/email';
import { TRPCError } from '@trpc/server';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { publicProcedure } from '../procedures';
import { seedTenantDefaults } from '../tenant-defaults';
import { router } from '../trpc';

/** Injected dependencies for the auth router (wired at app boot). */
export interface AuthRouterDeps {
  /** Sends templated emails. Resend in prod, pino-console in dev. */
  sendEmail: SendTemplatedEmail;
  /** Pino logger (request-scoped child loggers come via `ctx.logger`). */
  logger: Logger;
  /** Canonical APP_URL — e.g. "https://app.forma360.com" (no trailing slash). */
  appUrl: string;
}

const lookupInput = z.object({ email: z.string().email() });

const signUpInput = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  companyName: z.string().min(1).max(100),
});

const requestToJoinInput = z.object({
  tenantId: z.string().length(26),
  requesterEmail: z.string().email(),
  requesterName: z.string().min(1).max(100),
});

const acceptInviteInput = z.object({
  token: z.string().length(64),
  firstName: z.string().min(1).max(60).optional(),
  lastName: z.string().min(1).max(60).optional(),
  /** Legacy single-field fallback; first/last take precedence when given. */
  name: z.string().min(1).max(100).optional(),
});

const getInviteDetailsInput = z.object({ token: z.string().length(64) });

export function createAuthRouter(deps: AuthRouterDeps) {
  const appUrl = deps.appUrl.replace(/\/$/, '');

  return router({
    /**
     * Classify an email address into one of three buckets so the sign-up
     * UI can branch:
     *   - "invalid"  — malformed; no further info returned.
     *   - "free"     — personal / consumer domain (gmail, yahoo, ...) —
     *                  the UI shows the "create a new tenant" flow.
     *   - "business" — anything else. We also probe for an existing tenant
     *                  on that domain and surface it as a request-to-join
     *                  candidate. We do NOT leak which tenant a given
     *                  user belongs to — `emailExists` is a boolean only.
     */
    lookupEmailDomain: publicProcedure.input(lookupInput).query(async ({ ctx, input }) => {
      // Throttle unauthenticated account/tenant enumeration.
      const lookupRl = await ctx.rateLimit(`auth:lookup:${ctx.clientIp}`, {
        limit: 20,
        windowSec: 60,
        // RL-F02: unauthenticated, and this limiter is the only brake on a
        // cross-tenant account-existence oracle.
        failClosed: true,
      });
      if (!lookupRl.ok) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'rate-limited' });
      }
      const email = input.email.toLowerCase().trim();
      const domain = getEmailDomain(email);
      if (domain === null) {
        return {
          status: 'invalid' as const,
          existingTenant: null,
          emailExists: false,
        };
      }

      const existing = await ctx.db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1);
      const emailExists = existing[0] !== undefined;

      if (isFreeEmailDomain(email)) {
        return {
          status: 'free' as const,
          existingTenant: null,
          emailExists,
        };
      }

      // Business domain. Look for one active user on this domain whose
      // tenant is not archived and surface their tenant id + name as a
      // "you might want to join" hint. We don't leak which user matched —
      // only the tenant.
      const matches = await ctx.db
        .select({
          tenantId: user.tenantId,
          tenantName: tenants.name,
        })
        .from(user)
        .innerJoin(tenants, eq(user.tenantId, tenants.id))
        .where(
          and(
            sql`lower(${user.email}) like ${'%@' + domain}`,
            isNull(user.deactivatedAt),
            isNull(tenants.archivedAt),
          ),
        )
        .limit(1);

      const found = matches[0];
      return {
        status: 'business' as const,
        existingTenant: found === undefined ? null : { id: found.tenantId, name: found.tenantName },
        emailExists,
      };
    }),

    /**
     * Provision a brand-new tenant from a self-service sign-up.
     *
     * In one transaction:
     *   1. Insert the tenant (slug derived from companyName + ULID suffix).
     *   2. Seed the three default permission sets.
     *   3. Insert the user with `emailVerified=false` and the Administrator
     *      permission set. The frontend then triggers the email-OTP flow
     *      (`/api/auth/email-otp/send-verification-otp`); a successful
     *      `/sign-in/email-otp` flips `emailVerified` to true.
     *
     * No password / credential `account` row is created — Forma360 is
     * passwordless. The caller signs in by requesting a one-time code at
     * the OTP endpoint and exchanging it for a session.
     */
    signUpWithTenant: publicProcedure.input(signUpInput).mutation(async ({ ctx, input }) => {
      // Throttle anonymous tenant creation (resource-exhaustion guard).
      const signUpRl = await ctx.rateLimit(`auth:signup:${ctx.clientIp}`, {
        limit: 5,
        windowSec: 3600,
        // RL-F02: anonymous tenant creation. Failing open here is an
        // unbounded write path, not graceful degradation.
        failClosed: true,
      });
      if (!signUpRl.ok) {
        throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'rate-limited' });
      }
      const email = input.email.toLowerCase().trim();

      const existing = await ctx.db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .limit(1);
      if (existing[0] !== undefined) {
        throw new TRPCError({ code: 'CONFLICT', message: 'email-in-use' });
      }

      const tenantId = newId();
      const userId = `usr_${newId()}`;

      // Company email → pre-fill the website from the domain and ask the app
      // to derive a palette from it on first admin load (ADR 0018). Free /
      // consumer domains (gmail, ...) keep the standard brand until an admin
      // opts in, so we seed no branding for them.
      const domain = getEmailDomain(email);
      const isCompanyEmail = domain !== null && !isFreeEmailDomain(email);
      const brandingSeed: TenantSettings['branding'] | undefined = isCompanyEmail
        ? { websiteUrl: `https://${domain}`, autoDeriveFromWebsite: true }
        : undefined;

      const result = await ctx.db.transaction(async (tx) => {
        // 1. Tenant — unique slug derived from companyName + tenantId suffix.
        const slug = makeSlug(input.companyName, tenantId);
        await tx.insert(tenants).values({
          id: tenantId,
          name: input.companyName,
          slug,
          ...(brandingSeed !== undefined ? { settings: { branding: brandingSeed } } : {}),
        });

        // 2. Permission sets (idempotent — first call will insert all three).
        const sets = await seedDefaultPermissionSets(tx, tenantId);

        // 3. User row. `emailVerified=false`; the OTP exchange flips it.
        // Derive first/last from the supplied name so "Prepared by" shows
        // a full name for the founding admin too (To-Do #4).
        const nameParts = input.name.trim().split(/\s+/);
        const adminFirst = nameParts[0];
        const adminLast = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;
        await tx.insert(user).values({
          id: userId,
          name: input.name,
          ...(adminFirst !== undefined ? { firstName: adminFirst } : {}),
          ...(adminLast !== undefined ? { lastName: adminLast } : {}),
          email,
          emailVerified: false,
          tenantId,
          permissionSetId: sets.administrator,
        });

        // 4. Default observation categories and action types — the two
        // dropdowns that are unusable when empty. See `tenant-defaults`.
        await seedTenantDefaults(tx as unknown as typeof ctx.db, tenantId, userId);

        return { tenantId, userId };
      });

      ctx.logger.info(
        { tenantId: result.tenantId, userId: result.userId },
        '[auth] tenant created via sign-up',
      );
      return result;
    }),

    /**
     * Notify the administrators of `tenantId` that someone with
     * `requesterEmail` wants in. Does not create any DB rows — that
     * happens when an admin issues an actual invitation from Settings →
     * Users. Returns `notifiedCount` so the UI can confirm at least one
     * admin received the message.
     */
    requestToJoin: publicProcedure.input(requestToJoinInput).mutation(async ({ ctx, input }) => {
      // Throttle the admin-inbox notification fan-out (spam/phishing guard):
      // per source IP and per target tenant.
      for (const key of [`auth:join:ip:${ctx.clientIp}`, `auth:join:tenant:${input.tenantId}`]) {
        const joinRl = await ctx.rateLimit(key, { limit: 5, windowSec: 600 });
        if (!joinRl.ok) {
          throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'rate-limited' });
        }
      }
      const tenantRow = await ctx.db
        .select()
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      const tenant = tenantRow[0];
      if (tenant === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      const admins = await ctx.db
        .select({
          email: user.email,
          name: user.name,
        })
        .from(user)
        .innerJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
        .where(
          and(
            eq(user.tenantId, input.tenantId),
            eq(permissionSets.name, 'Administrator'),
            isNull(user.deactivatedAt),
          ),
        );

      // DOC-A01: no per-admin locale is loaded on this path, so this is the
      // app default rather than an oversight. `appLink` makes that explicit.
      const settingsUrl = appLink(appUrl, null, '/settings/users');
      for (const admin of admins) {
        await deps.sendEmail({
          to: admin.email,
          templateKey: 'request-to-join',
          variables: {
            requesterEmail: input.requesterEmail,
            requesterName: input.requesterName,
            tenantName: tenant.name,
            adminName: admin.name,
            settingsUrl,
          },
        });
      }

      ctx.logger.info(
        {
          tenantId: input.tenantId,
          notifiedCount: admins.length,
          requesterEmail: input.requesterEmail,
        },
        '[auth] request-to-join sent',
      );
      return { notifiedCount: admins.length };
    }),

    /**
     * Accept a pending invitation. The token is the opaque 64-hex string
     * the invite email carried. On success the user row is created and
     * the invite is stamped `acceptedAt`. No password is set — the user
     * signs in via the OTP flow.
     */
    acceptInvite: publicProcedure.input(acceptInviteInput).mutation(async ({ ctx, input }) => {
      const inviteRows = await ctx.db
        .select()
        .from(invitations)
        .where(eq(invitations.token, input.token))
        .limit(1);
      const invite = inviteRows[0];
      if (invite === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'invite-not-found' });
      }
      if (invite.acceptedAt !== null) {
        throw new TRPCError({ code: 'CONFLICT', message: 'already-accepted' });
      }
      if (invite.expiresAt.getTime() < Date.now()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'expired' });
      }

      const inviteEmail = invite.email.toLowerCase();
      const existing = await ctx.db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, inviteEmail))
        .limit(1);
      if (existing[0] !== undefined) {
        throw new TRPCError({ code: 'CONFLICT', message: 'email-in-use' });
      }

      const userId = `usr_${newId()}`;

      const result = await ctx.db.transaction(async (tx) => {
        // Prefer structured first/last (To-Do #4); fall back to a single
        // name, the admin-supplied invite name, or the email local-part.
        let first = input.firstName?.trim();
        let last = input.lastName?.trim();
        const structuredName =
          first !== undefined && last !== undefined ? `${first} ${last}`.trim() : undefined;
        const displayName =
          structuredName ?? input.name ?? invite.name ?? inviteEmail.split('@')[0] ?? 'New user';
        // When first/last weren't supplied explicitly, derive them from the
        // display name (admin invites already pass "First Last") so the
        // structured columns are populated from day one.
        if (first === undefined || last === undefined) {
          const parts = displayName.trim().split(/\s+/);
          first = first ?? parts[0];
          last = last ?? (parts.length > 1 ? parts.slice(1).join(' ') : undefined);
        }
        await tx.insert(user).values({
          id: userId,
          name: displayName,
          ...(first !== undefined ? { firstName: first } : {}),
          ...(last !== undefined ? { lastName: last } : {}),
          email: inviteEmail,
          // Invite acceptance proves they own the inbox (they clicked
          // the link in their email), so flip verified to true.
          emailVerified: true,
          tenantId: invite.tenantId,
          permissionSetId: invite.permissionSetId,
          // Apply the phone number pre-filled by the admin at invite time.
          ...(invite.phone !== null && invite.phone !== undefined ? { phone: invite.phone } : {}),
        });
        await tx
          .update(invitations)
          .set({ acceptedAt: new Date() })
          .where(eq(invitations.id, invite.id));

        // Auto-apply group and site memberships that were chosen at invite time.
        const now = new Date();
        if (
          invite.groupIds !== null &&
          invite.groupIds !== undefined &&
          invite.groupIds.length > 0
        ) {
          await tx
            .insert(groupMembers)
            .values(
              invite.groupIds.map((groupId) => ({
                tenantId: invite.tenantId,
                groupId,
                userId,
                addedVia: 'invite' as const,
                addedAt: now,
              })),
            )
            .onConflictDoNothing();
        }
        if (invite.siteIds !== null && invite.siteIds !== undefined && invite.siteIds.length > 0) {
          await tx
            .insert(siteMembers)
            .values(
              invite.siteIds.map((siteId) => ({
                tenantId: invite.tenantId,
                siteId,
                userId,
                addedVia: 'invite' as const,
                addedAt: now,
              })),
            )
            .onConflictDoNothing();
        }

        // External contractor invites (Phase 4) — link the new user to the
        // contractor with the granted portal activities.
        if (invite.contractorId !== null && invite.contractorId !== undefined) {
          await tx
            .insert(contractorUsers)
            .values({
              id: newId(),
              tenantId: invite.tenantId,
              contractorId: invite.contractorId,
              userId,
              activities: invite.contractorActivities ?? [],
            })
            .onConflictDoNothing();
        }

        return { userId, tenantId: invite.tenantId };
      });

      ctx.logger.info(
        { userId: result.userId, tenantId: result.tenantId, inviteId: invite.id },
        '[auth] invite accepted',
      );
      return result;
    }),

    /**
     * Render-time read for the invite-accept page. Returns null when no
     * invite matches (the page should then render its 404 state). Never
     * exposes the token itself or any hashed value.
     */
    getInviteDetails: publicProcedure.input(getInviteDetailsInput).query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          email: invitations.email,
          name: invitations.name,
          expiresAt: invitations.expiresAt,
          acceptedAt: invitations.acceptedAt,
          tenantName: tenants.name,
          inviterName: user.name,
        })
        .from(invitations)
        .innerJoin(tenants, eq(invitations.tenantId, tenants.id))
        .innerJoin(user, eq(invitations.invitedByUserId, user.id))
        .where(eq(invitations.token, input.token))
        .limit(1);

      const i = rows[0];
      if (i === undefined) return null;
      const expired = i.expiresAt.getTime() < Date.now();
      const status: 'accepted' | 'expired' | 'active' =
        i.acceptedAt !== null ? 'accepted' : expired ? 'expired' : 'active';
      return {
        email: i.email,
        name: i.name,
        tenantName: i.tenantName,
        inviterName: i.inviterName,
        status,
      };
    }),
  });
}

/**
 * Slugify a company name for the tenant `slug` column. The result is
 * lowercase alphanumeric with dashes plus a 6-char tenant-id suffix to
 * guarantee global uniqueness without round-trips. Maps non-ASCII via
 * NFKD decomposition; empty results fall back to `tenant-<suffix>`.
 */
export function makeSlug(companyName: string, tenantId: string): string {
  const base = companyName
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  const suffix = tenantId.slice(-6).toLowerCase();
  return base.length > 0 ? `${base}-${suffix}` : `tenant-${suffix}`;
}

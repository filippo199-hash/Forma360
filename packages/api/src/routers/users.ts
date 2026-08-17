/**
 * Users admin router.
 *
 * Covers:
 *   - list (users.view)         — paginated tenant-scoped list.
 *   - get (users.view)          — one user + their custom-field values.
 *   - updateProfile (self)      — name; available to every authed user
 *                                 on their own row (no `users.manage`).
 *   - invite (users.invite)     — creates an `invitations` row + sends
 *                                 the invite email. Re-uses an existing
 *                                 active invite for the same email if
 *                                 one exists (refreshes the token + ttl).
 *   - cancelInvite (users.invite)    — deletes the invitations row.
 *   - listInvitations (users.view)   — lists active (un-accepted,
 *                                 un-expired) invitations.
 *   - deactivate (users.deactivate) — sets deactivatedAt, runs S-E02
 *                                 last-admin guard.
 *   - reactivate (users.manage) — clears deactivatedAt.
 *   - anonymise (users.anonymise) — S-E09 flow: overwrites PII +
 *                                 deactivates + logs.
 *   - setCustomFieldValue (users.manage) — upserts one value.
 */
import { randomBytes } from 'node:crypto';
import {
  customUserFields,
  groupMembers,
  groups,
  invitations,
  permissionSets,
  session,
  siteMembers,
  sites,
  tenants,
  user,
  userCustomFieldValues,
  whatsappLinkCodes,
} from '@forma360/db/schema';
import { wouldDropBelowMinAdmins } from '@forma360/permissions/admins';
import { appLink } from '@forma360/shared/app-link';
import { parseCsv, toCsv } from '@forma360/shared/csv';
import type { SendTemplatedEmail } from '@forma360/shared/email';
import { newId } from '@forma360/shared/id';
import {
  WHATSAPP_LINK_CODE_ALPHABET,
  WHATSAPP_LINK_CODE_BODY_LENGTH,
  WHATSAPP_LINK_CODE_PREFIX,
} from '@forma360/shared/whatsapp-link';
import { TRPCError } from '@trpc/server';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { assertGroupsInTenant, assertSitesInTenant, assertUsersInTenant } from '../tenant-guards';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { router } from '../trpc';

const listInput = z
  .object({
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z.string().optional(),
    includeDeactivated: z.boolean().default(false),
    /**
     * Name / email substring. Without it every picker in the product is
     * capped at the first `limit` people with no way to reach the rest —
     * which is how a person-picker silently truncates at 50 (TR-A2).
     */
    search: z.string().trim().max(200).optional(),
  })
  .default({});

/**
 * Mutable side-channel for the few mutations on this router that need to
 * dispatch email (the invite flow). The web app populates this at boot
 * via `setUsersRouterDeps`; tests that exercise invite-by-email
 * populate it themselves before building the router. By default, no
 * email is sent and the row is just persisted — keeps non-invite tests
 * working without wiring a dispatcher.
 */
export interface UsersRouterDeps {
  sendEmail: SendTemplatedEmail | null;
  appUrl: string;
  /**
   * Sends the "your number is connected" WhatsApp greeting when someone adds
   * a phone number to their own profile.
   *
   * Must be an approved *template* send, not free-form text: the person has
   * not messaged us, so no 24-hour customer-service window is open and a
   * plain text send would be refused. Returns whether it went out; null in
   * tests and any deployment without WhatsApp configured.
   */
  sendWhatsAppWelcome?: ((phone: string, firstName: string) => Promise<boolean>) | null;
}

const usersDeps: UsersRouterDeps = {
  sendEmail: null,
  appUrl: 'http://localhost:3000',
  sendWhatsAppWelcome: null,
};

/**
 * Wire (or rewire) the email + appUrl deps used by users.invite. Called
 * from `apps/web/src/server/users-deps.ts` at boot, and from tests that
 * need to observe the invite email payload.
 */
export function setUsersRouterDeps(deps: UsersRouterDeps): void {
  usersDeps.sendEmail = deps.sendEmail;
  usersDeps.appUrl = deps.appUrl;
  usersDeps.sendWhatsAppWelcome = deps.sendWhatsAppWelcome ?? null;
}

/** Seven-day TTL on a freshly-issued invitation. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 64-hex random token (32 bytes → 64 hex chars). */
function newInviteToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * How long a WhatsApp link code stays usable. Long enough to open the link on
 * another device (scan the QR from a laptop with your phone, get distracted,
 * come back), short enough that a code left in a stale browser tab stops
 * being a way to attach a number to someone's account.
 */
const WHATSAPP_LINK_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Random link code, `LK` + 10 symbols from the shared alphabet. Rejection-free
 * modulo bias is not worth chasing at 50 bits, but we still draw from
 * `randomBytes` rather than Math.random — this code is the only thing standing
 * between a stranger and read access to a tenant's data over WhatsApp.
 */
function newWhatsAppLinkCode(): string {
  const bytes = randomBytes(WHATSAPP_LINK_CODE_BODY_LENGTH);
  let body = '';
  for (const byte of bytes) {
    body += WHATSAPP_LINK_CODE_ALPHABET[byte % WHATSAPP_LINK_CODE_ALPHABET.length];
  }
  return `${WHATSAPP_LINK_CODE_PREFIX}${body}`;
}

export const usersRouter = router({
  list: tenantProcedure
    .use(requirePermission('users.view'))
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const whereParts = [eq(user.tenantId, ctx.tenantId)];
      if (!input.includeDeactivated) {
        whereParts.push(sql`${user.deactivatedAt} IS NULL`);
      }
      if (input.search !== undefined && input.search !== '') {
        const term = `%${input.search.toLowerCase()}%`;
        // BUG-20: this searched `name` and `email` only, while every picker
        // DISPLAYS `firstName lastName` when both are set. A user whose
        // `name` holds just the surname was findable by surname and
        // invisible by the first name shown on screen — "Dave" returned
        // nothing, "Mullins" found him. Search the columns the reader can
        // actually see.
        whereParts.push(
          sql`(lower(${user.name}) LIKE ${term}
            OR lower(${user.email}) LIKE ${term}
            OR lower(coalesce(${user.firstName}, '')) LIKE ${term}
            OR lower(coalesce(${user.lastName}, '')) LIKE ${term}
            OR lower(coalesce(${user.firstName}, '') || ' ' || coalesce(${user.lastName}, ''))
               LIKE ${term})`,
        );
      }
      const rows = await ctx.db
        .select({
          id: user.id,
          name: user.name,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          emailVerified: user.emailVerified,
          permissionSetId: user.permissionSetId,
          deactivatedAt: user.deactivatedAt,
          createdAt: user.createdAt,
        })
        .from(user)
        .where(and(...whereParts))
        .orderBy(input.search !== undefined && input.search !== '' ? user.name : user.createdAt)
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      return {
        users: rows.slice(0, input.limit),
        hasMore,
      };
    }),

  /**
   * Get one user. Self-access is allowed for any authed user on their own
   * row; others require `users.view`.
   */
  get: tenantProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    // Reading your OWN record is always allowed; reading anyone else's
    // requires `users.view` (their email + custom-field values are PII).
    if (input.id !== ctx.auth.userId) {
      const perms = await loadUserPermissions(ctx.db, ctx.tenantId, ctx.auth.userId);
      if (!perms.includes('users.view')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Missing permission: users.view' });
      }
    }
    const row = await ctx.db
      .select({
        id: user.id,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        emailVerified: user.emailVerified,
        phone: user.phone,
        permissionSetId: user.permissionSetId,
        // Human-readable set name so surfaces like the profile page can show
        // "Standard" instead of the raw ULID (bug B2). Null if the set is gone.
        permissionSetName: permissionSets.name,
        deactivatedAt: user.deactivatedAt,
        createdAt: user.createdAt,
      })
      .from(user)
      .leftJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
      .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.id)))
      .limit(1);
    if (row[0] === undefined) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }

    const fieldValues = await ctx.db
      .select()
      .from(userCustomFieldValues)
      .where(
        and(
          eq(userCustomFieldValues.tenantId, ctx.tenantId),
          eq(userCustomFieldValues.userId, input.id),
        ),
      );

    // Group + site memberships for the profile page. Tenant-scoped inner
    // joins so archived / cross-tenant rows never leak. Additive — existing
    // consumers of `get` keep working.
    const groupMemberships = await ctx.db
      .select({
        id: groups.id,
        name: groups.name,
        addedVia: groupMembers.addedVia,
      })
      .from(groupMembers)
      .innerJoin(
        groups,
        and(eq(groupMembers.groupId, groups.id), eq(groups.tenantId, ctx.tenantId)),
      )
      .where(and(eq(groupMembers.tenantId, ctx.tenantId), eq(groupMembers.userId, input.id)))
      .orderBy(groups.name);

    const siteMemberships = await ctx.db
      .select({
        id: sites.id,
        name: sites.name,
        depth: sites.depth,
        addedVia: siteMembers.addedVia,
      })
      .from(siteMembers)
      .innerJoin(sites, and(eq(siteMembers.siteId, sites.id), eq(sites.tenantId, ctx.tenantId)))
      .where(and(eq(siteMembers.tenantId, ctx.tenantId), eq(siteMembers.userId, input.id)))
      .orderBy(sites.name);

    return { user: row[0], fieldValues, groupMemberships, siteMemberships };
  }),

  /**
   * Self-service profile update. Collects first + last name and keeps the
   * canonical `name` in sync as "First Last" so every display surface
   * (notably "Prepared by") shows a full name (To-Do #4). Also accepts an
   * optional `phone`: sending a value sets it, sending "" clears it, and
   * omitting the field leaves the stored number untouched.
   */
  /**
   * State for the "get this on WhatsApp" prompt, plus the one-time code
   * behind it. One call so the sidebar can decide whether to show the prompt
   * without a second round trip.
   *
   * A code is minted only for users who still have no number — there is
   * nothing to link otherwise. An unused, unexpired code is reused rather
   * than replaced so that reopening the dialog doesn't invalidate a link the
   * user already sent to their own phone and hasn't got round to opening.
   */
  whatsappLink: tenantProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ phone: user.phone })
      .from(user)
      .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, ctx.auth.userId)))
      .limit(1);
    if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
    if (row.phone !== null && row.phone !== '') {
      return { hasPhone: true as const, phone: row.phone, code: null };
    }

    const now = new Date();
    const [existing] = await ctx.db
      .select({ code: whatsappLinkCodes.code })
      .from(whatsappLinkCodes)
      .where(
        and(
          eq(whatsappLinkCodes.tenantId, ctx.tenantId),
          eq(whatsappLinkCodes.userId, ctx.auth.userId),
          isNull(whatsappLinkCodes.usedAt),
          gt(whatsappLinkCodes.expiresAt, now),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      return { hasPhone: false as const, phone: null, code: existing.code };
    }

    const code = newWhatsAppLinkCode();
    await ctx.db.insert(whatsappLinkCodes).values({
      code,
      tenantId: ctx.tenantId,
      userId: ctx.auth.userId,
      expiresAt: new Date(now.getTime() + WHATSAPP_LINK_CODE_TTL_MS),
    });
    return { hasPhone: false as const, phone: null, code };
  }),

  /**
   * PF-20: persist the user's preferred language. Called by the settings
   * language switcher; emails and future sessions follow it.
   */
  setLocale: tenantProcedure
    .input(z.object({ locale: z.string().regex(/^[a-z]{2}$/) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(user)
        .set({ locale: input.locale, updatedAt: new Date() })
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, ctx.auth.userId)));
      return { ok: true as const };
    }),

  updateProfile: tenantProcedure
    .input(
      z.object({
        firstName: z.string().min(1).max(60),
        // Empty last name is allowed, matching `updateName` — single-name and
        // bulk-imported users legitimately have none, and requiring one here
        // locked them out of editing their own profile at all.
        lastName: z.string().max(60),
        /** E.164-ish phone, e.g. "+447700900123". "" clears; omitted = keep. */
        phone: z.string().max(30).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const firstName = input.firstName.trim();
      const lastName = input.lastName.trim();
      const name = [firstName, lastName].filter(Boolean).join(' ');

      // Normalise to "+<digits>" / "<digits>" before storing: the WhatsApp
      // webhook resolves senders by exact string match on this column
      // (`findUserByPhone` tries "+<digits>" then bare digits), so spacing
      // or punctuation left in the stored value would break the linkage.
      let phoneUpdate: { phone: string | null } | Record<string, never> = {};
      if (input.phone !== undefined) {
        const normalised = input.phone.replace(/[\s\-().]/g, '');
        if (normalised !== '' && !/^\+?\d{7,15}$/.test(normalised)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Enter the phone in international format, e.g. +447700900123.',
          });
        }
        phoneUpdate = { phone: normalised === '' ? null : normalised };
      }

      // Read the old number before writing, so we can tell "just added a
      // number" from "saved the form again with the same number" — the
      // greeting should arrive once, not on every profile save.
      const [before] = await ctx.db
        .select({ phone: user.phone })
        .from(user)
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, ctx.auth.userId)))
        .limit(1);

      await ctx.db
        .update(user)
        .set({
          name,
          firstName,
          lastName: lastName === '' ? null : lastName,
          ...phoneUpdate,
          updatedAt: new Date(),
        })
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, ctx.auth.userId)));

      // Greet the number they just connected. Best-effort and deliberately
      // last: a courtesy message must never fail the save that triggered it.
      const newPhone = 'phone' in phoneUpdate ? phoneUpdate.phone : null;
      const isNewNumber =
        newPhone !== null && newPhone !== '' && (before?.phone ?? '') !== newPhone;
      const greet = usersDeps.sendWhatsAppWelcome;
      if (isNewNumber && greet !== null && greet !== undefined) {
        try {
          await greet(newPhone, firstName);
        } catch {
          // Swallowed on purpose — see above.
        }
      }
      return { ok: true as const };
    }),

  /**
   * Admin edit of another user's name (`users.manage`). Unlike
   * `updateProfile` (which is hardcoded to `ctx.auth.userId`), this targets
   * an arbitrary tenant member. Keeps the canonical `name` in sync as
   * "First Last" so every display surface shows the full name.
   */
  updateName: tenantProcedure
    .use(requirePermission('users.manage'))
    .input(
      z.object({
        userId: z.string().min(1),
        firstName: z.string().min(1).max(60),
        // Allow an empty last name — single-name and bulk-imported users
        // legitimately have none. Stored as null when blank.
        lastName: z.string().max(60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const firstName = input.firstName.trim();
      const lastName = input.lastName.trim();
      const name = [firstName, lastName].filter(Boolean).join(' ');
      await ctx.db
        .update(user)
        .set({
          name,
          firstName,
          lastName: lastName === '' ? null : lastName,
          updatedAt: new Date(),
        })
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)));
      return { ok: true as const };
    }),

  /**
   * Create or refresh an invitation. Inserts into `invitations`; does
   * NOT create a user row (that happens when the invitee accepts).
   *
   * If an active (un-accepted) invitation already exists for the same
   * (tenant, email) we update it in place — new token, new 7-day ttl,
   * permissionSet / name overwritten — and email the refreshed link.
   * This means re-inviting is idempotent and never produces duplicate
   * row collisions against the partial unique index.
   */
  invite: tenantProcedure
    .use(requirePermission('users.invite'))
    .input(
      z.object({
        email: z.string().email(),
        name: z.string().min(1).max(120).optional(),
        /** E.164-ish phone, e.g. "+15551234567". Optional. */
        phone: z.string().max(30).optional(),
        permissionSetId: z.string().length(26),
        /** Group IDs to add the new user to automatically on acceptance. */
        groupIds: z.array(z.string().length(26)).max(50).default([]),
        /** Site IDs to add the new user to automatically on acceptance. */
        siteIds: z.array(z.string().length(26)).max(50).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const emailLower = input.email.toLowerCase().trim();

      // Refuse if a real user already exists at this address — they
      // should use forgot-password rather than the invite flow.
      const existingUser = await ctx.db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.email, emailLower)))
        .limit(1);
      if (existingUser[0] !== undefined) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A user with this email already exists in this tenant.',
        });
      }

      // Verify the permission set belongs to this tenant.
      const ps = await ctx.db
        .select({ id: permissionSets.id })
        .from(permissionSets)
        .where(
          and(
            eq(permissionSets.tenantId, ctx.tenantId),
            eq(permissionSets.id, input.permissionSetId),
          ),
        )
        .limit(1);
      if (ps[0] === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Permission set not found' });
      }
      // Group / site pre-assignments must belong to this tenant, else the
      // accept-invite flow could auto-join the new user to a foreign group/site.
      await assertGroupsInTenant(ctx.db, ctx.tenantId, input.groupIds ?? []);
      await assertSitesInTenant(ctx.db, ctx.tenantId, input.siteIds ?? []);

      const token = newInviteToken();
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
      const name = input.name ?? null;
      const phone = input.phone?.trim() || null;

      // Look up any active invitation for (tenant, email) — the partial
      // unique index makes this at-most-one. If found, update in place;
      // otherwise insert.
      const existingInvite = await ctx.db
        .select({ id: invitations.id })
        .from(invitations)
        .where(
          and(
            eq(invitations.tenantId, ctx.tenantId),
            sql`lower(${invitations.email}) = ${emailLower}`,
            isNull(invitations.acceptedAt),
          ),
        )
        .limit(1);

      let invitationId: string;
      // Only include optional columns in SQL when they carry a value.
      // This keeps the INSERT/UPDATE compatible with DBs that haven't run
      // migrations 0024/0025 yet (columns added by those migrations are
      // nullable with no default, so omitting them is safe — they land as
      // NULL via the DB default path).
      const groupIds = input.groupIds.length > 0 ? input.groupIds : null;
      const siteIds = input.siteIds.length > 0 ? input.siteIds : null;
      const optionalCols = {
        ...(groupIds !== null ? { groupIds } : {}),
        ...(siteIds !== null ? { siteIds } : {}),
        ...(phone !== null ? { phone } : {}),
      } as const;

      if (existingInvite[0] !== undefined) {
        invitationId = existingInvite[0].id;
        await ctx.db
          .update(invitations)
          .set({
            email: emailLower,
            name,
            permissionSetId: input.permissionSetId,
            token,
            invitedByUserId: ctx.auth.userId,
            expiresAt,
            ...optionalCols,
          })
          .where(eq(invitations.id, invitationId));
      } else {
        invitationId = newId();
        await ctx.db.insert(invitations).values({
          id: invitationId,
          tenantId: ctx.tenantId,
          email: emailLower,
          name,
          permissionSetId: input.permissionSetId,
          token,
          invitedByUserId: ctx.auth.userId,
          expiresAt,
          ...optionalCols,
        });
      }

      // Send the invite email if a dispatcher is wired. In tests with
      // no dispatcher (most existing tests), this is a no-op — the row
      // is created and the test reads it directly.
      // Email failure is non-fatal: the invite row is already persisted and
      // the admin can use "Resend" to re-issue the email.
      if (usersDeps.sendEmail !== null) {
        try {
          const [tenantRow] = await ctx.db
            .select({ name: tenants.name })
            .from(tenants)
            .where(eq(tenants.id, ctx.tenantId))
            .limit(1);
          const [inviterRow] = await ctx.db
            .select({ name: user.name })
            .from(user)
            .where(eq(user.id, ctx.auth.userId))
            .limit(1);
          // DOC-A01: an invitee has no account yet and therefore no locale.
          const inviteUrl = appLink(usersDeps.appUrl, null, `/invite/${token}`);
          await usersDeps.sendEmail({
            to: emailLower,
            templateKey: 'invite',
            variables: {
              inviterName: inviterRow?.name ?? 'An administrator',
              tenantName: tenantRow?.name ?? 'your organisation',
              inviteUrl,
              expiresIn: '7 days',
            },
          });
        } catch (err) {
          ctx.logger.error(
            { err, invitationId, email: emailLower },
            '[users] invite email failed — invite row is still active; admin can resend',
          );
        }
      }

      ctx.logger.info({ invitationId, email: emailLower }, '[users] invitation issued');
      return { invitationId, token };
    }),

  /**
   * Admin-only: cancel an outstanding invitation by id. Hard-deletes
   * the row; the partial unique index then frees up the (tenant, email)
   * slot for re-issuing if needed.
   */
  cancelInvite: tenantProcedure
    .use(requirePermission('users.invite'))
    .input(z.object({ invitationId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db
        .delete(invitations)
        .where(and(eq(invitations.tenantId, ctx.tenantId), eq(invitations.id, input.invitationId)))
        .returning({ id: invitations.id });
      if (result[0] === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      ctx.logger.info({ invitationId: input.invitationId }, '[users] invitation cancelled');
      return { ok: true as const };
    }),

  /**
   * List active (un-accepted, un-expired) invitations for the tenant.
   * Sorted by newest first.
   */
  listInvitations: tenantProcedure.use(requirePermission('users.view')).query(async ({ ctx }) => {
    const now = new Date();
    const rows = await ctx.db
      .select({
        id: invitations.id,
        email: invitations.email,
        name: invitations.name,
        permissionSetId: invitations.permissionSetId,
        invitedByUserId: invitations.invitedByUserId,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.tenantId, ctx.tenantId),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, now),
        ),
      )
      .orderBy(sql`${invitations.createdAt} DESC`);
    return { invitations: rows };
  }),

  deactivate: tenantProcedure
    .use(requirePermission('users.deactivate'))
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.auth.userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot deactivate yourself. Ask another administrator.',
        });
      }
      const dropped = await wouldDropBelowMinAdmins(ctx.db, {
        tenantId: ctx.tenantId,
        targetUserId: input.userId,
        afterPermissions: null,
      });
      if (dropped) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Cannot deactivate the last administrator. Assign another user as Administrator first.',
        });
      }
      await ctx.db
        .update(user)
        .set({ deactivatedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)));
      // Drop the stored sessions as well. `isUserActive` in the request path
      // is what actually revokes access (better-auth keeps sessions in Redis
      // secondary storage, so this delete alone would not be enough), but
      // leaving rows for a departed user behind is its own small liability.
      await ctx.db.delete(session).where(eq(session.userId, input.userId));
      ctx.logger.warn(
        { userId: input.userId, actor: ctx.auth.userId },
        '[users] deactivated — sessions revoked',
      );
      return { ok: true as const };
    }),

  reactivate: tenantProcedure
    .use(requirePermission('users.manage'))
    .input(z.object({ userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(user)
        .set({ deactivatedAt: null, updatedAt: new Date() })
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)));
      return { ok: true as const };
    }),

  /**
   * S-E09 GDPR anonymisation. Overwrites PII with tombstone placeholders
   * + deactivates. Irreversible. Leaves the row in place so FKs from
   * historical records (inspections, signatures, audit) stay intact.
   *
   * In Phase 1 this touches `user` and `user_custom_field_values`. Later
   * phases extend the flow via `registerAnonymiser('inspections', fn)`
   * (a follow-on API; not in this PR).
   */
  anonymise: tenantProcedure
    .use(requirePermission('users.anonymise'))
    .input(z.object({ userId: z.string(), confirmEmail: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.auth.userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot anonymise yourself.',
        });
      }
      const row = await ctx.db
        .select()
        .from(user)
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)))
        .limit(1);
      const existing = row[0];
      if (existing === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      if (existing.email !== input.confirmEmail) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Confirm email does not match the target user.',
        });
      }

      // Last-admin guard applies to anonymise too — it deactivates.
      const dropped = await wouldDropBelowMinAdmins(ctx.db, {
        tenantId: ctx.tenantId,
        targetUserId: input.userId,
        afterPermissions: null,
      });
      if (dropped) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot anonymise the last administrator.',
        });
      }

      const tombstone = `deleted-${input.userId.slice(-8)}@anonymised.local`;
      await ctx.db
        .update(user)
        .set({
          name: 'Anonymised User',
          // `firstName`/`lastName`/`phone` (added after this handler first
          // shipped) are PII and are now rendered across the UI — scrub them
          // too, or the person's real name survives anonymisation.
          firstName: null,
          lastName: null,
          phone: null,
          email: tombstone,
          image: null,
          deactivatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, input.userId)));

      await ctx.db
        .delete(userCustomFieldValues)
        .where(
          and(
            eq(userCustomFieldValues.tenantId, ctx.tenantId),
            eq(userCustomFieldValues.userId, input.userId),
          ),
        );

      // Revoke synchronously rather than waiting on the cascade below. The
      // worker deletes these rows too, but it is best-effort and was in fact
      // unreachable for the whole life of the codebase (the queue name was
      // mis-spelled), which left "anonymised" users holding live sessions.
      await ctx.db.delete(session).where(eq(session.userId, input.userId));

      ctx.logger.warn({ userId: input.userId, actor: ctx.auth.userId }, '[users] anonymised');
      // Fan out to Phase 2+ modules registered via the async anonymiser
      // hook — noop in Phase 1 beyond logging.
      ctx.enqueue('forma360-user-anonymisation', {
        tenantId: ctx.tenantId,
        userId: input.userId,
        actorId: ctx.auth.userId,
      });
      return { ok: true as const };
    }),

  setCustomFieldValue: tenantProcedure
    .use(requirePermission('users.manage'))
    .input(
      z.object({
        userId: z.string(),
        fieldId: z.string().length(26),
        value: z.string().max(1000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the field belongs to this tenant.
      const field = await ctx.db
        .select()
        .from(customUserFields)
        .where(
          and(eq(customUserFields.tenantId, ctx.tenantId), eq(customUserFields.id, input.fieldId)),
        )
        .limit(1);
      if (field[0] === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found' });
      }
      // The target user must belong to this tenant.
      await assertUsersInTenant(ctx.db, ctx.tenantId, [input.userId]);
      await ctx.db
        .insert(userCustomFieldValues)
        .values({
          tenantId: ctx.tenantId,
          userId: input.userId,
          fieldId: input.fieldId,
          value: input.value,
        })
        .onConflictDoUpdate({
          target: [userCustomFieldValues.userId, userCustomFieldValues.fieldId],
          set: { value: input.value, updatedAt: new Date() },
        });
      return { ok: true as const };
    }),

  // ─── Users admin count (for UI badges + audit) ────────────────────────────
  adminCount: tenantProcedure.use(requirePermission('users.view')).query(async ({ ctx }) => {
    // Reuse the primitive; direct import rather than rebuilding the query.
    const { countAdmins } = await import('@forma360/permissions/admins');
    return { count: await countAdmins(ctx.db, ctx.tenantId) };
  }),

  // ─── CSV bulk import (S-E05) ──────────────────────────────────────────────
  /**
   * Upsert-by-email bulk import. Existing users are updated in place; new
   * users are created. Returns a { created, updated, skipped, errors }
   * summary with per-row error messages for the G-E05 review screen.
   *
   * CSV columns (header-matched, all optional except email + name):
   *   email, name, permissionSet, groups, sites
   * `permissionSet` is a name-match against permission_sets; `groups` and
   * `sites` are semicolon-separated name lists. Unknown names are
   * rejected for the row rather than silently dropped.
   */
  bulkImport: tenantProcedure
    .use(requirePermission('users.invite'))
    .input(
      z.object({
        csv: z.string().min(1).max(10_000_000),
        /** Dry-run; validate but do not write. */
        dryRun: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rowSchema = z.object({
        email: z.string().email(),
        name: z.string().min(1).max(120),
        permissionSet: z.string().min(1).optional(),
        groups: z.string().optional(),
        sites: z.string().optional(),
      });
      const parsed = parseCsv(input.csv, { schema: rowSchema, limit: 10_000 });

      // Load name → id maps once per import.
      const [allSets, allGroups, allSites] = await Promise.all([
        ctx.db
          .select({ id: permissionSets.id, name: permissionSets.name })
          .from(permissionSets)
          .where(eq(permissionSets.tenantId, ctx.tenantId)),
        ctx.db
          .select({ id: groups.id, name: groups.name })
          .from(groups)
          .where(eq(groups.tenantId, ctx.tenantId)),
        ctx.db
          .select({ id: sites.id, name: sites.name })
          .from(sites)
          .where(eq(sites.tenantId, ctx.tenantId)),
      ]);
      const setByName = new Map(allSets.map((s) => [s.name, s.id]));
      const groupByName = new Map(allGroups.map((g) => [g.name, g.id]));
      const siteByName = new Map(allSites.map((s) => [s.name, s.id]));

      const errors: { line: number; message: string; raw: Record<string, string> }[] = [
        ...parsed.errors,
      ];
      let created = 0;
      let updated = 0;

      // Find default permission set (Standard) — used when the CSV omits.
      const defaultSet = allSets.find((s) => s.name === 'Standard');

      for (const { line, row } of parsed.ok) {
        // Resolve names → ids with per-row error surfaces.
        const resolvedSetId = row.permissionSet ? setByName.get(row.permissionSet) : defaultSet?.id;
        if (resolvedSetId === undefined) {
          errors.push({
            line,
            message: row.permissionSet
              ? `Unknown permission set: ${row.permissionSet}`
              : 'No permission set given and no "Standard" default found',
            raw: row as unknown as Record<string, string>,
          });
          continue;
        }

        const groupNames = row.groups
          ? row.groups
              .split(';')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : [];
        const siteNames = row.sites
          ? row.sites
              .split(';')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
          : [];
        const resolvedGroupIds = groupNames
          .map((n) => groupByName.get(n))
          .filter((v): v is string => v !== undefined);
        const resolvedSiteIds = siteNames
          .map((n) => siteByName.get(n))
          .filter((v): v is string => v !== undefined);

        const unknownGroups = groupNames.filter((n) => !groupByName.has(n));
        const unknownSites = siteNames.filter((n) => !siteByName.has(n));
        if (unknownGroups.length > 0 || unknownSites.length > 0) {
          const parts: string[] = [];
          if (unknownGroups.length > 0) parts.push(`groups: ${unknownGroups.join(', ')}`);
          if (unknownSites.length > 0) parts.push(`sites: ${unknownSites.join(', ')}`);
          errors.push({
            line,
            message: `Unknown ${parts.join('; ')}`,
            raw: row as unknown as Record<string, string>,
          });
          continue;
        }

        if (input.dryRun) {
          // Count what would happen without writing.
          const existing = await ctx.db
            .select({ id: user.id })
            .from(user)
            .where(and(eq(user.tenantId, ctx.tenantId), eq(user.email, row.email)))
            .limit(1);
          if (existing[0] === undefined) created++;
          else updated++;
          continue;
        }

        // Upsert by (tenantId, email).
        const existing = await ctx.db
          .select({ id: user.id })
          .from(user)
          .where(and(eq(user.tenantId, ctx.tenantId), eq(user.email, row.email)))
          .limit(1);

        let userId: string;
        if (existing[0] === undefined) {
          userId = `usr_${newId()}`;
          await ctx.db.insert(user).values({
            id: userId,
            tenantId: ctx.tenantId,
            name: row.name,
            email: row.email,
            permissionSetId: resolvedSetId,
          });
          created++;
          // Invite email is fire-and-forget via the queue — the
          // user-invitation queue is a Phase 2 concern; for now, we
          // rely on better-auth's password-setup flow initiated by the
          // user on first sign-in.
        } else {
          userId = existing[0].id;
          await ctx.db
            .update(user)
            .set({
              name: row.name,
              permissionSetId: resolvedSetId,
              updatedAt: new Date(),
            })
            .where(and(eq(user.tenantId, ctx.tenantId), eq(user.id, userId)));
          updated++;
        }

        // Membership upserts — clear manual rows for this user/tenant and
        // re-add the requested set. Rule-based memberships are untouched.
        if (resolvedGroupIds.length > 0) {
          await ctx.db
            .delete(groupMembers)
            .where(
              and(
                eq(groupMembers.tenantId, ctx.tenantId),
                eq(groupMembers.userId, userId),
                eq(groupMembers.addedVia, 'manual'),
              ),
            );
          await ctx.db
            .insert(groupMembers)
            .values(
              resolvedGroupIds.map((groupId) => ({
                tenantId: ctx.tenantId,
                groupId,
                userId,
                addedVia: 'manual',
                addedBy: ctx.auth.userId,
              })),
            )
            .onConflictDoNothing();
        }

        if (resolvedSiteIds.length > 0) {
          await ctx.db
            .delete(siteMembers)
            .where(
              and(
                eq(siteMembers.tenantId, ctx.tenantId),
                eq(siteMembers.userId, userId),
                eq(siteMembers.addedVia, 'manual'),
              ),
            );
          await ctx.db
            .insert(siteMembers)
            .values(
              resolvedSiteIds.map((siteId) => ({
                tenantId: ctx.tenantId,
                siteId,
                userId,
                addedVia: 'manual',
              })),
            )
            .onConflictDoNothing();
        }
      }

      ctx.logger.info(
        { created, updated, errors: errors.length, dryRun: input.dryRun },
        '[users] bulk import',
      );

      return {
        created,
        updated,
        skipped: 0,
        errorCount: errors.length,
        errors: errors.slice(0, 50), // cap for response size; full CSV via rejectedCsv below
        rejectedCsv: parsed.rejectedCsv(),
      };
    }),

  // ─── CSV export (S-10) ────────────────────────────────────────────────────
  /**
   * Full tenant user list as CSV. Columns: id, name, email,
   * permissionSet, groups, sites, activatedAt, deactivatedAt. The UI
   * passes the returned string straight to a Blob download.
   */
  listExport: tenantProcedure.use(requirePermission('users.view')).query(async ({ ctx }) => {
    const users = await ctx.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        permissionSet: permissionSets.name,
        createdAt: user.createdAt,
        deactivatedAt: user.deactivatedAt,
      })
      .from(user)
      .innerJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
      .where(eq(user.tenantId, ctx.tenantId))
      .orderBy(user.email);

    if (users.length === 0) {
      return {
        csv: toCsv(
          [],
          [
            'id',
            'name',
            'email',
            'permissionSet',
            'groups',
            'sites',
            'activatedAt',
            'deactivatedAt',
          ],
        ),
      };
    }

    const userIds = users.map((u) => u.id);
    const [gRows, sRows] = await Promise.all([
      ctx.db
        .select({
          userId: groupMembers.userId,
          groupName: groups.name,
        })
        .from(groupMembers)
        .innerJoin(groups, eq(groupMembers.groupId, groups.id))
        .where(and(eq(groupMembers.tenantId, ctx.tenantId), inArray(groupMembers.userId, userIds))),
      ctx.db
        .select({
          userId: siteMembers.userId,
          siteName: sites.name,
        })
        .from(siteMembers)
        .innerJoin(sites, eq(siteMembers.siteId, sites.id))
        .where(and(eq(siteMembers.tenantId, ctx.tenantId), inArray(siteMembers.userId, userIds))),
    ]);

    const groupsByUser = new Map<string, string[]>();
    for (const row of gRows) {
      const list = groupsByUser.get(row.userId) ?? [];
      list.push(row.groupName);
      groupsByUser.set(row.userId, list);
    }
    const sitesByUser = new Map<string, string[]>();
    for (const row of sRows) {
      const list = sitesByUser.get(row.userId) ?? [];
      list.push(row.siteName);
      sitesByUser.set(row.userId, list);
    }

    const rows = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      permissionSet: u.permissionSet,
      groups: (groupsByUser.get(u.id) ?? []).join(';'),
      sites: (sitesByUser.get(u.id) ?? []).join(';'),
      activatedAt: u.createdAt.toISOString(),
      deactivatedAt: u.deactivatedAt !== null ? u.deactivatedAt.toISOString() : '',
    }));

    const csv = toCsv(rows, [
      'id',
      'name',
      'email',
      'permissionSet',
      'groups',
      'sites',
      'activatedAt',
      'deactivatedAt',
    ]);
    return { csv };
  }),
});

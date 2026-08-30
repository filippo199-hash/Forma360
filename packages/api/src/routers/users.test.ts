/**
 * Users admin router tests.
 *
 * Covers:
 *   - updateName (users.manage) — an admin renames another user; name /
 *     firstName / lastName all land, and a non-manager is rejected by
 *     requirePermission.
 *   - updateProfile (self) — phone is normalised for the WhatsApp
 *     webhook's exact-match lookup, "" clears it, omitting keeps it,
 *     and junk is rejected.
 *   - get — group + site memberships are folded into the response.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from '../context';
import { appRouter } from '../router';
import { setUsersRouterDeps } from './users';
import { createCallerFactory } from '../trpc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return { client, db };
}

const createCaller = createCallerFactory(appRouter);
const silentLogger = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

describe('users router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let memberUserId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@x.test`, tenantId: tenantId as never },
    });
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminUserId = newId();
    memberUserId = newId();
    await db.insert(schema.user).values([
      {
        id: adminUserId,
        name: 'Admin',
        email: 'admin@acme.test',
        tenantId,
        permissionSetId: seeded.administrator,
      },
      {
        id: memberUserId,
        name: 'Mia Member',
        email: 'mia@acme.test',
        tenantId,
        permissionSetId: seeded.standard,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  describe('list contractor linkage', () => {
    it('returns the linked contractor for portal users and null for staff', async () => {
      const contractorId = newId();
      await db.insert(schema.contractors).values({
        id: contractorId,
        tenantId,
        name: 'Rossi Mechanical Services',
      });
      await db.insert(schema.contractorUsers).values({
        id: newId(),
        tenantId,
        contractorId,
        userId: memberUserId,
      });

      const caller = createCaller(ctxFor(adminUserId));
      const { users } = await caller.users.list({ includeDeactivated: true });
      const member = users.find((u) => u.id === memberUserId);
      const admin = users.find((u) => u.id === adminUserId);
      expect(member?.contractorId).toBe(contractorId);
      expect(member?.contractorName).toBe('Rossi Mechanical Services');
      expect(admin?.contractorId).toBeNull();
      expect(admin?.contractorName).toBeNull();
    });

    it('search still reaches contractor-linked users by name', async () => {
      const contractorId = newId();
      await db.insert(schema.contractors).values({
        id: contractorId,
        tenantId,
        name: 'Halden Electrical Ltd',
      });
      await db.insert(schema.contractorUsers).values({
        id: newId(),
        tenantId,
        contractorId,
        userId: memberUserId,
      });
      const caller = createCaller(ctxFor(adminUserId));
      const { users } = await caller.users.list({ search: 'Mia' });
      expect(users).toHaveLength(1);
      expect(users[0]?.contractorId).toBe(contractorId);
    });
  });

  describe('updateName', () => {
    it('renames another user (name + firstName + lastName)', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      await caller.users.updateName({
        userId: memberUserId,
        firstName: 'Mia',
        lastName: 'Rossi',
      });

      const got = await caller.users.get({ id: memberUserId });
      expect(got.user.name).toBe('Mia Rossi');
      expect(got.user.firstName).toBe('Mia');
      expect(got.user.lastName).toBe('Rossi');
    });

    it('rejects a caller without users.manage', async () => {
      const caller = createCaller(ctxFor(memberUserId));
      await expect(
        caller.users.updateName({ userId: adminUserId, firstName: 'X', lastName: 'Y' }),
      ).rejects.toThrow();
    });
  });

  describe('get hasPassword', () => {
    it('reports false with no credential row and true once one exists', async () => {
      const caller = createCaller(ctxFor(memberUserId));
      const before = await caller.users.get({ id: memberUserId });
      expect(before.hasPassword).toBe(false);

      await db.insert(schema.account).values({
        id: newId(),
        userId: memberUserId,
        accountId: memberUserId,
        providerId: 'credential',
        password: 'a-scrypt-hash-not-a-password',
      });
      const after = await caller.users.get({ id: memberUserId });
      expect(after.hasPassword).toBe(true);
    });
  });

  describe('updateProfile phone', () => {
    it('stores the phone normalised to +<digits> and returns it from get', async () => {
      const caller = createCaller(ctxFor(memberUserId));
      await caller.users.updateProfile({
        firstName: 'Mia',
        lastName: 'Member',
        phone: '+44 7378 591-803',
      });

      const got = await caller.users.get({ id: memberUserId });
      expect(got.user.phone).toBe('+447378591803');
    });

    it('clears the phone when "" is sent and keeps it when omitted', async () => {
      const caller = createCaller(ctxFor(memberUserId));
      await caller.users.updateProfile({
        firstName: 'Mia',
        lastName: 'Member',
        phone: '+447378591803',
      });

      // Omitted → untouched.
      await caller.users.updateProfile({ firstName: 'Mia', lastName: 'Member' });
      let got = await caller.users.get({ id: memberUserId });
      expect(got.user.phone).toBe('+447378591803');

      // Empty string → cleared.
      await caller.users.updateProfile({ firstName: 'Mia', lastName: 'Member', phone: '' });
      got = await caller.users.get({ id: memberUserId });
      expect(got.user.phone).toBeNull();
    });

    it('saves a phone for a user with no last name', async () => {
      const caller = createCaller(ctxFor(memberUserId));
      await caller.users.updateProfile({
        firstName: 'Mia',
        lastName: '',
        phone: '+447378591803',
      });

      const got = await caller.users.get({ id: memberUserId });
      expect(got.user.phone).toBe('+447378591803');
      expect(got.user.lastName).toBeNull();
      expect(got.user.name).toBe('Mia');
    });

    it('rejects a value that is not a plausible international number', async () => {
      const caller = createCaller(ctxFor(memberUserId));
      await expect(
        caller.users.updateProfile({ firstName: 'Mia', lastName: 'Member', phone: 'not-a-phone' }),
      ).rejects.toThrow(/international format/);
    });
  });

  describe('WhatsApp welcome on adding a number', () => {
    /** Captures (phone, firstName) for each greeting the router dispatches. */
    function captureGreetings(): Array<[string, string]> {
      const sent: Array<[string, string]> = [];
      setUsersRouterDeps({
        sendEmail: null,
        appUrl: 'http://localhost:3000',
        sendWhatsAppWelcome: async (phone, firstName) => {
          sent.push([phone, firstName]);
          return true;
        },
      });
      return sent;
    }

    afterEach(() => {
      setUsersRouterDeps({ sendEmail: null, appUrl: 'http://localhost:3000' });
    });

    it('greets the number the first time one is added', async () => {
      const sent = captureGreetings();
      const caller = createCaller(ctxFor(memberUserId));
      await caller.users.updateProfile({
        firstName: 'Mia',
        lastName: '',
        phone: '+44 7378 591803',
      });
      // Normalised before the greeting, so the number we message is the same
      // one the webhook will match on later.
      expect(sent).toEqual([['+447378591803', 'Mia']]);
    });

    it('does not greet again when the same number is saved twice', async () => {
      const sent = captureGreetings();
      const caller = createCaller(ctxFor(memberUserId));
      const args = { firstName: 'Mia', lastName: '', phone: '+447378591803' };
      await caller.users.updateProfile(args);
      await caller.users.updateProfile(args);
      // Editing your name shouldn't re-trigger it either.
      await caller.users.updateProfile({ ...args, firstName: 'Mia-Rose' });
      expect(sent).toHaveLength(1);
    });

    it('greets again when the number actually changes', async () => {
      const sent = captureGreetings();
      const caller = createCaller(ctxFor(memberUserId));
      await caller.users.updateProfile({ firstName: 'Mia', lastName: '', phone: '+447378591803' });
      await caller.users.updateProfile({ firstName: 'Mia', lastName: '', phone: '+447700900123' });
      expect(sent.map(([p]) => p)).toEqual(['+447378591803', '+447700900123']);
    });

    it('sends nothing when the number is cleared or left alone', async () => {
      const sent = captureGreetings();
      const caller = createCaller(ctxFor(memberUserId));
      await caller.users.updateProfile({ firstName: 'Mia', lastName: '', phone: '' });
      await caller.users.updateProfile({ firstName: 'Mia', lastName: '' });
      expect(sent).toHaveLength(0);
    });

    it('still saves the profile when the greeting throws', async () => {
      setUsersRouterDeps({
        sendEmail: null,
        appUrl: 'http://localhost:3000',
        sendWhatsAppWelcome: async () => {
          throw new Error('template not approved yet');
        },
      });
      const caller = createCaller(ctxFor(memberUserId));
      await expect(
        caller.users.updateProfile({ firstName: 'Mia', lastName: '', phone: '+447378591803' }),
      ).resolves.toEqual({ ok: true });

      const got = await caller.users.get({ id: memberUserId });
      expect(got.user.phone).toBe('+447378591803');
    });
  });

  describe('whatsappLink', () => {
    it('mints a code for a user with no number and reuses it on reopen', async () => {
      const caller = createCaller(ctxFor(memberUserId));
      const first = await caller.users.whatsappLink();
      expect(first.hasPhone).toBe(false);
      expect(first.code).toMatch(/^LK[0-9A-HJ-NP-TV-Z]{10}$/);

      // Reopening the dialog must not invalidate a link the user already
      // sent to their own phone and hasn't opened yet.
      const second = await caller.users.whatsappLink();
      expect(second.code).toBe(first.code);
    });

    it('offers no code once the user has a number', async () => {
      const caller = createCaller(ctxFor(memberUserId));
      await caller.users.updateProfile({
        firstName: 'Mia',
        lastName: '',
        phone: '+447378591803',
      });

      const state = await caller.users.whatsappLink();
      expect(state.hasPhone).toBe(true);
      expect(state.code).toBeNull();
      expect(state.phone).toBe('+447378591803');
    });

    it('gives different users different codes', async () => {
      const mine = await createCaller(ctxFor(memberUserId)).users.whatsappLink();
      const theirs = await createCaller(ctxFor(adminUserId)).users.whatsappLink();
      expect(mine.code).not.toBe(theirs.code);
    });
  });

  describe('get memberships', () => {
    it('folds group + site memberships into the response', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { id: groupId } = await caller.groups.create({ name: 'Electricians' });
      await caller.groups.addMember({ groupId, userId: memberUserId });
      const { id: siteId } = await caller.sites.create({ name: 'Riverside', kind: 'project' });
      await caller.sites.addMembers({ siteId, userIds: [memberUserId] });

      const got = await caller.users.get({ id: memberUserId });
      expect(got.groupMemberships).toHaveLength(1);
      expect(got.groupMemberships[0]?.id).toBe(groupId);
      expect(got.groupMemberships[0]?.name).toBe('Electricians');
      expect(got.groupMemberships[0]?.addedVia).toBe('manual');

      expect(got.siteMemberships).toHaveLength(1);
      expect(got.siteMemberships[0]?.id).toBe(siteId);
      expect(got.siteMemberships[0]?.name).toBe('Riverside');
      expect(got.siteMemberships[0]?.depth).toBe(0);
      expect(got.siteMemberships[0]?.addedVia).toBe('manual');
    });
  });

  describe('getInviteLink (UXW1-12)', () => {
    async function seedInvitation(token: string, expiresAt: Date): Promise<string> {
      const invitationId = newId();
      const [set] = await db
        .select({ id: schema.permissionSets.id })
        .from(schema.permissionSets)
        .limit(1);
      await db.insert(schema.invitations).values({
        id: invitationId,
        tenantId,
        email: 'invitee@acme.test',
        token,
        permissionSetId: set?.id ?? '',
        invitedByUserId: adminUserId,
        expiresAt,
      });
      return invitationId;
    }

    it('returns the accept URL carrying the invitation token', async () => {
      const token = 'f'.repeat(64);
      const invitationId = await seedInvitation(token, new Date(Date.now() + 86_400_000));
      const caller = createCaller(ctxFor(adminUserId));
      const { url } = await caller.users.getInviteLink({ invitationId });
      expect(url).toContain(`/invite/${token}`);
    });

    it('refuses expired invitations, unknown ids, and foreign tenants', async () => {
      const expiredId = await seedInvitation('e'.repeat(64), new Date(Date.now() - 1000));
      const caller = createCaller(ctxFor(adminUserId));
      await expect(caller.users.getInviteLink({ invitationId: expiredId })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(caller.users.getInviteLink({ invitationId: newId() })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('requires users.invite', async () => {
      const invitationId = await seedInvitation('d'.repeat(64), new Date(Date.now() + 86_400_000));
      const caller = createCaller(ctxFor(memberUserId));
      await expect(caller.users.getInviteLink({ invitationId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  describe('self-deactivation message (UXW1-18)', () => {
    it('names the sole-administrator case instead of advising to ask a peer', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      await expect(caller.users.deactivate({ userId: adminUserId })).rejects.toMatchObject({
        message: expect.stringContaining('only administrator') as string,
      });
    });

    it('keeps the ask-another-administrator advice when a peer admin exists', async () => {
      const [adminSet] = await db
        .select({ permissionSetId: schema.user.permissionSetId })
        .from(schema.user)
        .where(eq(schema.user.id, adminUserId));
      const adminSetId = adminSet?.permissionSetId;
      if (adminSetId === null || adminSetId === undefined) {
        throw new Error('seed invariant: the admin user must hold a permission set');
      }
      const secondAdminId = newId();
      await db.insert(schema.user).values({
        id: secondAdminId,
        name: 'Second Admin',
        email: 'admin2@acme.test',
        tenantId,
        permissionSetId: adminSetId,
      });
      const caller = createCaller(ctxFor(adminUserId));
      await expect(caller.users.deactivate({ userId: adminUserId })).rejects.toMatchObject({
        message: expect.stringContaining('Ask another administrator') as string,
      });
    });
  });

  describe('overview (profile page aggregate)', () => {
    async function seedIncidents(): Promise<void> {
      await db.insert(schema.incidents).values([
        {
          id: newId(),
          tenantId,
          referenceNumber: 'IN-000001',
          title: 'Slip on wet floor',
          kind: 'injury',
          occurredAt: new Date(),
          reportedByUserId: memberUserId,
        },
        {
          id: newId(),
          tenantId,
          referenceNumber: 'IN-000002',
          title: 'Needlestick in treatment room',
          kind: 'sharps_exposure',
          confidential: true,
          occurredAt: new Date(),
          reportedByUserId: memberUserId,
        },
      ]);
    }

    it('US-O01: a viewer without incidents.confidential.view gets a total that matches the visible list — a per-person count must not attribute a confidential record', async () => {
      await seedIncidents();
      // Custom set: can open the profile page and see incidents, but NOT
      // confidential ones.
      const limitedSetId = newId();
      await db.insert(schema.permissionSets).values({
        id: limitedSetId,
        tenantId,
        name: 'Limited viewer',
        permissions: ['users.view', 'incidents.view'],
      });
      const limitedViewerId = newId();
      await db.insert(schema.user).values({
        id: limitedViewerId,
        name: 'Lena Limited',
        email: 'lena@acme.test',
        tenantId,
        permissionSetId: limitedSetId,
      });

      const seen = await createCaller(ctxFor(limitedViewerId)).users.overview({
        id: memberUserId,
      });
      expect(seen.incidents?.total).toBe(1);
      expect(seen.incidents?.recent.map((r) => r.referenceNumber)).toEqual(['IN-000001']);

      // The admin holds incidents.confidential.view: full count, list
      // still only names the non-confidential rows.
      const admin = await createCaller(ctxFor(adminUserId)).users.overview({ id: memberUserId });
      expect(admin.incidents?.total).toBe(2);
      expect(admin.incidents?.recent.map((r) => r.referenceNumber)).toEqual(['IN-000001']);
    });

    it('US-O02: blocks the viewer lacks permission for come back null', async () => {
      const noModulesSetId = newId();
      await db.insert(schema.permissionSets).values({
        id: noModulesSetId,
        tenantId,
        name: 'Users only',
        permissions: ['users.view'],
      });
      const bareViewerId = newId();
      await db.insert(schema.user).values({
        id: bareViewerId,
        name: 'Bare Viewer',
        email: 'bare@acme.test',
        tenantId,
        permissionSetId: noModulesSetId,
      });
      const seen = await createCaller(ctxFor(bareViewerId)).users.overview({ id: memberUserId });
      expect(seen.incidents).toBeNull();
      expect(seen.actions).toBeNull();
      expect(seen.inspections).toBeNull();
    });

    it('US-O03: a contractor portal user cannot read the aggregate at all — same NOT_FOUND as a missing user', async () => {
      const contractorId = newId();
      await db.insert(schema.contractors).values({
        id: contractorId,
        tenantId,
        name: 'Halden Electrical',
      });
      // acknowledgedAt set = induction satisfied (legacy counts as v1), so
      // the refusal under test is overview's own, not the induction gate.
      await db.insert(schema.contractorUsers).values({
        id: newId(),
        tenantId,
        contractorId,
        userId: adminUserId,
        acknowledgedAt: new Date(),
      });
      await expect(
        createCaller(ctxFor(adminUserId)).users.overview({ id: memberUserId }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

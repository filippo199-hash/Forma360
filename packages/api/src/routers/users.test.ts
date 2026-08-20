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
});

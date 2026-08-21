/**
 * Integration tests for the auth router (sign-up / invite-acceptance /
 * domain lookup / request-to-join).
 *
 * Covers:
 *   - lookupEmailDomain → "free" for gmail.com
 *   - lookupEmailDomain → "business" + null tenant for unknown business domain
 *   - lookupEmailDomain → "business" + existing tenant when a user exists
 *   - signUpWithTenant creates tenant + user + credential account row whose
 *     hash better-auth's own scrypt verifies
 *   - signUpWithTenant rejects duplicate email with CONFLICT
 *   - password policy: too-short and breached passwords are refused on both
 *     signUpWithTenant and acceptInvite
 *   - acceptInvite happy path (verified user + credential account row)
 *   - acceptInvite rejects expired invite
 *   - acceptInvite rejects already-accepted invite
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyPassword } from '@forma360/auth/crypto';
import * as schema from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { eq } from 'drizzle-orm';
import { createTestContext, type Context } from '../context';
import { __authStubMailbox, appRouter, stubAuthDeps, type AuthStubMail } from '../router';
import { createAuthRouter } from './auth';
import { createCallerFactory, router } from '../trpc';

/** Any policy-passing password for flows where the value doesn't matter. */
const TEST_PASSWORD = 'orca-tide-brambles-42';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');
/**
 * Every migration in the directory, in order.
 *
 * This used to be a CURATED list — the subset a given suite needed, for
 * speed. The cost was a manual chore CLAUDE.md had to document ("add the
 * next migration to that list"), and missing it left a table half-built:
 * Drizzle writes every column it knows about, so the first insert failed
 * with `column does not exist`, in a suite unrelated to the change that
 * caused it. Sixteen lists had drifted.
 *
 * Applying all of them costs about two seconds, which is not worth a
 * recurring footgun on a schema that changes every week. `MIG-L01` pins
 * that the lists and the ORM agree.
 */
async function migrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
}

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  for (const file of await migrationFiles()) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return { client, db };
}

function silentLogger() {
  return createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
}

const createCaller = createCallerFactory(appRouter);

describe('auth router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let mailbox: AuthStubMail[];

  // Build a public-procedure caller (no session).
  function publicCtx(): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: null,
    });
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    // Reset the shared stub mailbox before each test.
    __authStubMailbox.length = 0;
    mailbox = __authStubMailbox;
  });

  afterEach(async () => {
    await client.close();
  });

  describe('lookupEmailDomain', () => {
    it('returns "free" for gmail.com', async () => {
      const caller = createCaller(publicCtx());
      const result = await caller.auth.lookupEmailDomain({ email: 'alice@gmail.com' });
      expect(result.status).toBe('free');
      expect(result.existingTenant).toBe(null);
      expect(result.emailExists).toBe(false);
    });

    it('returns "business" + null tenant for an unknown business domain', async () => {
      const caller = createCaller(publicCtx());
      const result = await caller.auth.lookupEmailDomain({ email: 'alice@unknown-co.example' });
      expect(result.status).toBe('business');
      expect(result.existingTenant).toBe(null);
      expect(result.emailExists).toBe(false);
    });

    it('returns "business" with the existing tenant when a user matches', async () => {
      // Seed a tenant + administrator user on @acme.test.
      const tenantId = newId();
      await db
        .insert(schema.tenants)
        .values({ id: tenantId, name: 'Acme Safety', slug: 'acme-safety' });
      const sets = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
      const adminId = `usr_${newId()}`;
      await db.insert(schema.user).values({
        id: adminId,
        name: 'Alice',
        email: 'alice@acme.test',
        tenantId,
        permissionSetId: sets.administrator,
      });

      const caller = createCaller(publicCtx());
      const result = await caller.auth.lookupEmailDomain({ email: 'bob@acme.test' });
      expect(result.status).toBe('business');
      expect(result.existingTenant).not.toBe(null);
      expect(result.existingTenant?.id).toBe(tenantId);
      expect(result.existingTenant?.name).toBe('Acme Safety');
      expect(result.emailExists).toBe(false);
    });
  });

  describe('signUpWithTenant', () => {
    it('creates tenant + unverified user + a credential row better-auth can verify', async () => {
      const caller = createCaller(publicCtx());
      const { tenantId, userId } = await caller.auth.signUpWithTenant({
        email: 'founder@my-startup.example',
        name: 'Founder',
        companyName: 'My Startup',
        password: TEST_PASSWORD,
      });

      // Tenant row.
      const tenantRow = (
        await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId))
      )[0];
      expect(tenantRow).toBeDefined();
      expect(tenantRow?.name).toBe('My Startup');
      expect(tenantRow?.slug).toMatch(/^my-startup-/);

      // Permission sets seeded.
      const sets = await db
        .select()
        .from(schema.permissionSets)
        .where(eq(schema.permissionSets.tenantId, tenantId));
      expect(sets).toHaveLength(3);
      const adminSet = sets.find((s) => s.name === 'Administrator');
      expect(adminSet).toBeDefined();

      // Default observation categories seeded so the report-observation form
      // is usable immediately on a fresh tenant.
      const cats = await db
        .select()
        .from(schema.issueCategories)
        .where(eq(schema.issueCategories.tenantId, tenantId));
      expect(cats.map((c) => c.name)).toEqual(
        expect.arrayContaining([
          'Hazard',
          'Near miss',
          // The one that is not a fault report. A register that can only
          // ever collect bad news is one nobody keeps filling in.
          'Good practice',
          'Quality',
          'Environmental',
        ]),
      );

      // Action types, seeded by the same helper. Every tenant used to
      // open the "Action type" dropdown to exactly one entry — "No
      // type", the NULL fallback — in a module whose subject is
      // corrective action.
      const types = await db
        .select()
        .from(schema.actionTypes)
        .where(eq(schema.actionTypes.tenantId, tenantId));
      expect(types.map((t) => t.name)).toEqual(
        expect.arrayContaining(['Corrective', 'Preventive', 'Improvement', 'Maintenance']),
      );
      expect(types.filter((t) => t.isDefault).map((t) => t.name)).toEqual(['Corrective']);

      // User row — emailVerified=false until they complete OTP.
      const userRow = (await db.select().from(schema.user).where(eq(schema.user.id, userId)))[0];
      expect(userRow).toBeDefined();
      expect(userRow?.email).toBe('founder@my-startup.example');
      expect(userRow?.emailVerified).toBe(false);
      expect(userRow?.tenantId).toBe(tenantId);
      expect(userRow?.permissionSetId).toBe(adminSet?.id);

      // Credential account row, hashed with the exact scrypt better-auth
      // verifies at /sign-in/email. `accountId === userId` and
      // `providerId === 'credential'` are better-auth's own conventions —
      // get either wrong and the row is invisible to sign-in.
      const accountRows = await db
        .select()
        .from(schema.account)
        .where(eq(schema.account.userId, userId));
      expect(accountRows).toHaveLength(1);
      const credential = accountRows[0];
      expect(credential?.providerId).toBe('credential');
      expect(credential?.accountId).toBe(userId);
      expect(credential?.password).not.toBe(null);
      expect(credential?.password).not.toContain(TEST_PASSWORD);
      if (credential?.password == null) throw new Error('credential row has no password hash');
      await expect(
        verifyPassword({ hash: credential.password, password: TEST_PASSWORD }),
      ).resolves.toBe(true);
      await expect(
        verifyPassword({ hash: credential.password, password: 'wrong-password-guess' }),
      ).resolves.toBe(false);
    });

    it('rejects duplicate email with CONFLICT', async () => {
      const caller = createCaller(publicCtx());
      await caller.auth.signUpWithTenant({
        email: 'taken@example.com',
        name: 'First',
        companyName: 'Org A',
        password: TEST_PASSWORD,
      });
      await expect(() =>
        caller.auth.signUpWithTenant({
          email: 'taken@example.com',
          name: 'Second',
          companyName: 'Org B',
          password: TEST_PASSWORD,
        }),
      ).rejects.toThrow(/email-in-use|CONFLICT/);
    });

    it('rejects a password below the 12-character floor', async () => {
      const caller = createCaller(publicCtx());
      await expect(() =>
        caller.auth.signUpWithTenant({
          email: 'short-pw@example.com',
          name: 'Shorty',
          companyName: 'Short Co',
          password: 'elevenchars',
        }),
      ).rejects.toThrow();
      // Nothing half-created: the refusal happened before any insert.
      const users = await db
        .select()
        .from(schema.user)
        .where(eq(schema.user.email, 'short-pw@example.com'));
      expect(users).toHaveLength(0);
    });

    it('lowercases the email before storing', async () => {
      const caller = createCaller(publicCtx());
      const { userId } = await caller.auth.signUpWithTenant({
        email: 'Mixed@CASE.example',
        name: 'Alice',
        companyName: 'Case Co',
        password: TEST_PASSWORD,
      });
      const row = (await db.select().from(schema.user).where(eq(schema.user.id, userId)))[0];
      expect(row?.email).toBe('mixed@case.example');
    });

    it('seeds website + auto-derive branding for a company email', async () => {
      const caller = createCaller(publicCtx());
      const { tenantId } = await caller.auth.signUpWithTenant({
        email: 'founder@acme-industrial.example',
        name: 'Founder',
        companyName: 'Acme Industrial',
        password: TEST_PASSWORD,
      });
      const tenant = (
        await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId))
      )[0];
      expect(tenant?.settings.branding?.websiteUrl).toBe('https://acme-industrial.example');
      expect(tenant?.settings.branding?.autoDeriveFromWebsite).toBe(true);
      // No colours yet — those come from the first-load derivation.
      expect(tenant?.settings.branding?.primaryColor).toBeUndefined();
    });

    it('does NOT seed branding for a free/consumer email', async () => {
      const caller = createCaller(publicCtx());
      const { tenantId } = await caller.auth.signUpWithTenant({
        email: 'someone@gmail.com',
        name: 'Someone',
        companyName: 'Personal Co',
        password: TEST_PASSWORD,
      });
      const tenant = (
        await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId))
      )[0];
      expect(tenant?.settings.branding).toBeUndefined();
    });
  });

  describe('breached passwords', () => {
    /** Caller whose breach check reports EVERY password as breached. */
    function breachedCaller() {
      const breachedRouter = router({
        auth: createAuthRouter({ ...stubAuthDeps, checkPasswordBreached: async () => true }),
      });
      return createCallerFactory(breachedRouter)(publicCtx());
    }

    it('signUpWithTenant refuses a breached password before writing anything', async () => {
      const caller = breachedCaller();
      await expect(() =>
        caller.auth.signUpWithTenant({
          email: 'breached@example.com',
          name: 'Breached',
          companyName: 'Breach Co',
          password: TEST_PASSWORD,
        }),
      ).rejects.toThrow(/password-breached/);
      const users = await db
        .select()
        .from(schema.user)
        .where(eq(schema.user.email, 'breached@example.com'));
      expect(users).toHaveLength(0);
    });

    it('acceptInvite refuses a breached password and leaves the invite open', async () => {
      // Seed a live invite through the ordinary caller's tenant fixtures.
      const tenantId = newId();
      await db
        .insert(schema.tenants)
        .values({ id: tenantId, name: 'Acme', slug: `acme-breach-${tenantId.toLowerCase()}` });
      const sets = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
      const inviterUserId = `usr_${newId()}`;
      await db.insert(schema.user).values({
        id: inviterUserId,
        name: 'Inviter',
        email: 'inviter@acme-breach.test',
        tenantId,
        permissionSetId: sets.administrator,
      });
      const token = newId().toLowerCase().padEnd(64, '0').slice(0, 64);
      await db.insert(schema.invitations).values({
        id: newId(),
        tenantId,
        email: 'breached-invitee@acme.test',
        permissionSetId: sets.standard,
        token,
        invitedByUserId: inviterUserId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const caller = breachedCaller();
      await expect(() =>
        caller.auth.acceptInvite({ token, password: TEST_PASSWORD }),
      ).rejects.toThrow(/password-breached/);
      const invite = (
        await db.select().from(schema.invitations).where(eq(schema.invitations.token, token))
      )[0];
      expect(invite?.acceptedAt).toBe(null);
    });
  });

  describe('acceptInvite', () => {
    async function seedInvite(opts: {
      expiresAt: Date;
      acceptedAt?: Date | null;
      email?: string;
    }): Promise<{
      tenantId: string;
      permissionSetId: string;
      inviterUserId: string;
      token: string;
      inviteId: string;
    }> {
      const tenantId = newId();
      await db
        .insert(schema.tenants)
        .values({ id: tenantId, name: 'Acme', slug: `acme-${newId().slice(-6)}` });
      const sets = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
      const inviterUserId = `usr_${newId()}`;
      await db.insert(schema.user).values({
        id: inviterUserId,
        name: 'Inviter',
        email: `inviter-${newId().slice(-6)}@acme.test`,
        tenantId,
        permissionSetId: sets.administrator,
      });
      const inviteId = newId();
      const token = 'a'.repeat(64).slice(0, 60) + newId().slice(-4).toLowerCase();
      // ensure 64 chars
      const realToken = token.padEnd(64, '0').slice(0, 64);
      await db.insert(schema.invitations).values({
        id: inviteId,
        tenantId,
        email: opts.email ?? 'invitee@acme.test',
        permissionSetId: sets.standard,
        token: realToken,
        invitedByUserId: inviterUserId,
        expiresAt: opts.expiresAt,
        ...(opts.acceptedAt !== undefined ? { acceptedAt: opts.acceptedAt } : {}),
      });
      return {
        tenantId,
        permissionSetId: sets.standard,
        inviterUserId,
        token: realToken,
        inviteId,
      };
    }

    it('happy path: creates verified user + credential row, marks invite accepted', async () => {
      const { tenantId, permissionSetId, token, inviteId } = await seedInvite({
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const caller = createCaller(publicCtx());
      const { userId, tenantId: returnedTenant } = await caller.auth.acceptInvite({
        token,
        name: 'Invitee Person',
        password: TEST_PASSWORD,
      });

      expect(returnedTenant).toBe(tenantId);
      const userRow = (await db.select().from(schema.user).where(eq(schema.user.id, userId)))[0];
      expect(userRow).toBeDefined();
      expect(userRow?.email).toBe('invitee@acme.test');
      expect(userRow?.emailVerified).toBe(true);
      expect(userRow?.tenantId).toBe(tenantId);
      expect(userRow?.permissionSetId).toBe(permissionSetId);
      expect(userRow?.name).toBe('Invitee Person');

      // Credential account row — the invite page signs the user straight
      // in with this password (`emailVerified=true` clears the
      // requireEmailVerification gate).
      const accountRows = await db
        .select()
        .from(schema.account)
        .where(eq(schema.account.userId, userId));
      expect(accountRows).toHaveLength(1);
      expect(accountRows[0]?.providerId).toBe('credential');
      const hash = accountRows[0]?.password;
      if (hash == null) throw new Error('credential row has no password hash');
      await expect(verifyPassword({ hash, password: TEST_PASSWORD })).resolves.toBe(true);

      // Invite is stamped as accepted.
      const inviteRow = (
        await db.select().from(schema.invitations).where(eq(schema.invitations.id, inviteId))
      )[0];
      expect(inviteRow?.acceptedAt).not.toBe(null);
    });

    it('rejects expired invite', async () => {
      const { token } = await seedInvite({
        expiresAt: new Date(Date.now() - 60 * 1000),
      });
      const caller = createCaller(publicCtx());
      await expect(() =>
        caller.auth.acceptInvite({ token, password: TEST_PASSWORD }),
      ).rejects.toThrow(/expired/);
    });

    it('rejects already-accepted invite', async () => {
      const { token } = await seedInvite({
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        acceptedAt: new Date(),
      });
      const caller = createCaller(publicCtx());
      await expect(() =>
        caller.auth.acceptInvite({ token, password: TEST_PASSWORD }),
      ).rejects.toThrow(/already-accepted|CONFLICT/);
    });

    it('rejects unknown token with NOT_FOUND', async () => {
      const caller = createCaller(publicCtx());
      await expect(() =>
        caller.auth.acceptInvite({ token: '0'.repeat(64), password: TEST_PASSWORD }),
      ).rejects.toThrow(/invite-not-found|NOT_FOUND/);
    });
  });

  describe('requestToJoin', () => {
    /** Seed a tenant with two administrator users. */
    async function seedTenantWithTwoAdmins(): Promise<{
      tenantId: string;
      admin1: string;
      admin2: string;
    }> {
      const tenantId = newId();
      await db
        .insert(schema.tenants)
        .values({ id: tenantId, name: 'Acme', slug: `acme-request-${tenantId}` });
      const sets = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
      const admin1 = `usr_${newId()}`;
      const admin2 = `usr_${newId()}`;
      await db.insert(schema.user).values([
        {
          id: admin1,
          name: 'Admin One',
          email: 'admin1@acme.test',
          tenantId,
          permissionSetId: sets.administrator,
        },
        {
          id: admin2,
          name: 'Admin Two',
          email: 'admin2@acme.test',
          tenantId,
          permissionSetId: sets.administrator,
        },
      ]);
      return { tenantId, admin1, admin2 };
    }

    it('sends one email per administrator of the tenant', async () => {
      const { tenantId, admin1, admin2 } = await seedTenantWithTwoAdmins();

      const caller = createCaller(publicCtx());
      const { notifiedCount } = await caller.auth.requestToJoin({
        tenantId,
        requesterEmail: 'newperson@acme.test',
        requesterName: 'New Person',
      });

      expect(notifiedCount).toBe(2);
      expect(mailbox).toHaveLength(2);
      expect(mailbox.map((m) => m.to).sort()).toEqual(['admin1@acme.test', 'admin2@acme.test']);
      const sample = mailbox[0];
      if (sample === undefined) throw new Error('mailbox empty');
      expect(sample.templateKey).toBe('request-to-join');
      expect(sample.variables.tenantName).toBe('Acme');
      expect(sample.variables.requesterEmail).toBe('newperson@acme.test');

      // Each admin also gets a bell row (kind request_to_join).
      const bells = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.kind, 'request_to_join'));
      expect(bells.map((b) => b.userId).sort()).toEqual([admin1, admin2].sort());
      expect(bells[0]?.title).toBe('New Person (newperson@acme.test) wants to join');
      expect(bells[0]?.href).toBe('/settings/users');
    });

    it('request_to_join: an email-muted admin is skipped; the others and the bells are unaffected', async () => {
      const { tenantId, admin1, admin2 } = await seedTenantWithTwoAdmins();
      await db
        .update(schema.user)
        .set({ notificationPrefs: { 'email:request_to_join': false } })
        .where(eq(schema.user.id, admin1));

      const caller = createCaller(publicCtx());
      await caller.auth.requestToJoin({
        tenantId,
        requesterEmail: 'newperson@acme.test',
        requesterName: 'New Person',
      });

      expect(mailbox.map((m) => m.to)).toEqual(['admin2@acme.test']);
      const bells = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.kind, 'request_to_join'));
      expect(bells.map((b) => b.userId).sort()).toEqual([admin1, admin2].sort());
    });

    it('request_to_join: an inapp-muted admin still gets the email but no bell row', async () => {
      const { tenantId, admin1, admin2 } = await seedTenantWithTwoAdmins();
      await db
        .update(schema.user)
        .set({ notificationPrefs: { 'inapp:request_to_join': false } })
        .where(eq(schema.user.id, admin1));

      const caller = createCaller(publicCtx());
      await caller.auth.requestToJoin({
        tenantId,
        requesterEmail: 'newperson@acme.test',
        requesterName: 'New Person',
      });

      expect(mailbox.map((m) => m.to).sort()).toEqual(['admin1@acme.test', 'admin2@acme.test']);
      const bells = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.kind, 'request_to_join'));
      expect(bells.map((b) => b.userId)).toEqual([admin2]);
    });
  });
});

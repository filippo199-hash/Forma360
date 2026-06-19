/**
 * Integration tests for the auth router (sign-up / invite-acceptance /
 * domain lookup / request-to-join).
 *
 * Covers:
 *   - lookupEmailDomain → "free" for gmail.com
 *   - lookupEmailDomain → "business" + null tenant for unknown business domain
 *   - lookupEmailDomain → "business" + existing tenant when a user exists
 *   - signUpWithTenant creates tenant + user (no password — OTP flow)
 *   - signUpWithTenant rejects duplicate email with CONFLICT
 *   - acceptInvite happy path (no password — OTP flow)
 *   - acceptInvite rejects expired invite
 *   - acceptInvite rejects already-accepted invite
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@forma360/db/schema';
import type { Database } from '@forma360/db/client';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { eq } from 'drizzle-orm';
import { createTestContext, type Context } from '../context';
import { __authStubMailbox, appRouter, type AuthStubMail } from '../router';
import { createCallerFactory } from '../trpc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');
const MIGRATION_FILES = [
  '0000_initial.sql',
  '0001_auth.sql',
  '0002_permissions.sql',
  '0003_phase1_org_backbone.sql',
  '0004_phase2_templates_inspections.sql',
  '0005_phase2_inspections.sql',
  '0006_phase2_schedules.sql',
  '0007_inspections_archived_at.sql',
  '0008_invitations.sql',
  '0009_signature_workflow.sql',
  '0010_issues.sql',
  '0011_observations_richer.sql',
  '0012_actions_phase4.sql',
  '0013_actions_phase4b.sql',
  '0014_phase5.sql',
  '0015_phase8_compliance.sql',
  '0016_headsup_share_reactions.sql',
  '0017_heads_up_enhancements.sql',
  '0018_documents_v2.sql',
  '0019_schedule_enhancements.sql',
  '0020_compliance_scope.sql',
  '0021_compliance_features.sql',
  '0022_action_type_labels.sql',
  '0023_inspections_source_link.sql',
  '0024_invite_group_site.sql',
  '0025_user_phone.sql',
  '0026_asset_description.sql',
  '0027_maintenance_notifications.sql',
  '0028_observation_notification_recipients.sql',
  '0029_asset_links.sql',
  '0030_drop_compliance.sql',
  '0031_ai_assistant.sql',
  '0032_user_first_last_name.sql',
  '0033_document_visibility.sql',
  '0034_maintenance_programs.sql',
  '0035_asset_owner.sql',
];

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  for (const file of MIGRATION_FILES) {
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
    it('creates tenant + unverified user — OTP flow, no password stored', async () => {
      const caller = createCaller(publicCtx());
      const { tenantId, userId } = await caller.auth.signUpWithTenant({
        email: 'founder@my-startup.example',
        name: 'Founder',
        companyName: 'My Startup',
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

      // User row — emailVerified=false until they complete OTP.
      const userRow = (await db.select().from(schema.user).where(eq(schema.user.id, userId)))[0];
      expect(userRow).toBeDefined();
      expect(userRow?.email).toBe('founder@my-startup.example');
      expect(userRow?.emailVerified).toBe(false);
      expect(userRow?.tenantId).toBe(tenantId);
      expect(userRow?.permissionSetId).toBe(adminSet?.id);

      // No credential account row — Forma360 is passwordless.
      const accountRows = await db
        .select()
        .from(schema.account)
        .where(eq(schema.account.userId, userId));
      expect(accountRows).toHaveLength(0);
    });

    it('rejects duplicate email with CONFLICT', async () => {
      const caller = createCaller(publicCtx());
      await caller.auth.signUpWithTenant({
        email: 'taken@example.com',
        name: 'First',
        companyName: 'Org A',
      });
      await expect(() =>
        caller.auth.signUpWithTenant({
          email: 'taken@example.com',
          name: 'Second',
          companyName: 'Org B',
        }),
      ).rejects.toThrow(/email-in-use|CONFLICT/);
    });

    it('lowercases the email before storing', async () => {
      const caller = createCaller(publicCtx());
      const { userId } = await caller.auth.signUpWithTenant({
        email: 'Mixed@CASE.example',
        name: 'Alice',
        companyName: 'Case Co',
      });
      const row = (await db.select().from(schema.user).where(eq(schema.user.id, userId)))[0];
      expect(row?.email).toBe('mixed@case.example');
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

    it('happy path: creates verified user (no password), marks invite accepted', async () => {
      const { tenantId, permissionSetId, token, inviteId } = await seedInvite({
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      const caller = createCaller(publicCtx());
      const { userId, tenantId: returnedTenant } = await caller.auth.acceptInvite({
        token,
        name: 'Invitee Person',
      });

      expect(returnedTenant).toBe(tenantId);
      const userRow = (await db.select().from(schema.user).where(eq(schema.user.id, userId)))[0];
      expect(userRow).toBeDefined();
      expect(userRow?.email).toBe('invitee@acme.test');
      expect(userRow?.emailVerified).toBe(true);
      expect(userRow?.tenantId).toBe(tenantId);
      expect(userRow?.permissionSetId).toBe(permissionSetId);
      expect(userRow?.name).toBe('Invitee Person');

      // No credential account row — Forma360 is passwordless.
      const accountRows = await db
        .select()
        .from(schema.account)
        .where(eq(schema.account.userId, userId));
      expect(accountRows).toHaveLength(0);

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
      await expect(() => caller.auth.acceptInvite({ token })).rejects.toThrow(/expired/);
    });

    it('rejects already-accepted invite', async () => {
      const { token } = await seedInvite({
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        acceptedAt: new Date(),
      });
      const caller = createCaller(publicCtx());
      await expect(() => caller.auth.acceptInvite({ token })).rejects.toThrow(
        /already-accepted|CONFLICT/,
      );
    });

    it('rejects unknown token with NOT_FOUND', async () => {
      const caller = createCaller(publicCtx());
      await expect(() => caller.auth.acceptInvite({ token: '0'.repeat(64) })).rejects.toThrow(
        /invite-not-found|NOT_FOUND/,
      );
    });
  });

  describe('requestToJoin', () => {
    it('sends one email per administrator of the tenant', async () => {
      // Seed a tenant with two admins.
      const tenantId = newId();
      await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme-request' });
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
    });
  });
});

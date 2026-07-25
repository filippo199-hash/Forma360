/**
 * Users admin router tests.
 *
 * Covers:
 *   - updateName (users.manage) — an admin renames another user; name /
 *     firstName / lastName all land, and a non-manager is rejected by
 *     requirePermission.
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

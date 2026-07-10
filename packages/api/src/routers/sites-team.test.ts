/**
 * Tests for the Team & access surface: assigning groups to a site/project,
 * bulk member add, the consolidated `team` roll-up, and the access union
 * (a group's members inherit the site's membership via loadViewerMemberships).
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
import { loadViewerMemberships } from './document-visibility';
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

describe('sites team & access', () => {
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

  it('assigns a group and folds its members into the effective roster', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'Riverside', kind: 'project' });
    const { id: groupId } = await caller.groups.create({ name: 'Electricians' });
    await caller.groups.addMember({ groupId, userId: memberUserId });

    await caller.sites.addGroup({ siteId, groupId });

    const team = await caller.sites.team({ siteId });
    expect(team.groups).toHaveLength(1);
    expect(team.groups[0]?.memberCount).toBe(1);
    // Mia is in the effective roster via the group (not a direct member).
    const mia = team.effective.find((p) => p.userId === memberUserId);
    expect(mia).toBeDefined();
    expect(mia?.direct).toBe(false);
    expect(mia?.viaGroupIds).toContain(groupId);
    expect(team.memberIds).not.toContain(memberUserId);
  });

  it('a group member inherits the site access via loadViewerMemberships', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'Riverside', kind: 'project' });
    const { id: groupId } = await caller.groups.create({ name: 'Electricians' });
    await caller.groups.addMember({ groupId, userId: memberUserId });

    // Before assignment: no site membership.
    let vm = await loadViewerMemberships(db, tenantId, memberUserId);
    expect(vm.siteIds.has(siteId)).toBe(false);

    await caller.sites.addGroup({ siteId, groupId });

    // After: the site shows up as a membership for the group member.
    vm = await loadViewerMemberships(db, tenantId, memberUserId);
    expect(vm.siteIds.has(siteId)).toBe(true);

    // Removing the group revokes it again.
    await caller.sites.removeGroup({ siteId, groupId });
    vm = await loadViewerMemberships(db, tenantId, memberUserId);
    expect(vm.siteIds.has(siteId)).toBe(false);
  });

  it('bulk-adds individual members', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'Riverside', kind: 'project' });

    await caller.sites.addMembers({ siteId, userIds: [adminUserId, memberUserId] });

    const team = await caller.sites.team({ siteId });
    expect(team.memberIds).toHaveLength(2);
    expect(team.effective.every((p) => p.direct)).toBe(true);
  });
});

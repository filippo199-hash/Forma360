/**
 * Contractors router — external contractor users / portal (Phase 4).
 *
 * Covers the full invite → accept → portal lifecycle: invite creates a
 * platform-managed permission set + external invitation; acceptance creates the
 * user + contractor_users link with the granted activities; the derived
 * permission set carries the right keys and is hidden from the admin list;
 * `me`/`acknowledge` and `updateActivities`/`remove` behave.
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
import { and, eq } from 'drizzle-orm';
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

describe('contractors.users portal (Phase 4)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let contractorId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@x.test`, tenantId: tenantId as never },
    });
  }
  function publicCtx(): Context {
    return createTestContext({ db: db as unknown as Database, logger: silentLogger(), auth: null });
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminUserId = newId();
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Admin',
      email: 'admin@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
    const caller = createCaller(ctxFor(adminUserId));
    ({ id: contractorId } = await caller.contractors.create({ name: 'Sparky Electrical' }));
  });

  afterEach(async () => {
    await client.close();
  });

  it('invite → accept links the user with activities + a hidden derived permission set', async () => {
    const admin = createCaller(ctxFor(adminUserId));
    const { token } = await admin.contractors.users.invite({
      contractorId,
      email: 'jane@sparky.test',
      name: 'Jane Sparks',
      activities: ['inspections', 'observations'],
    });

    // Pending invite shows up in the list.
    let listed = await admin.contractors.users.list({ contractorId });
    expect(listed.pending).toHaveLength(1);
    expect(listed.pending[0]?.email).toBe('jane@sparky.test');
    expect(listed.members).toHaveLength(0);

    // The invited person accepts via the public flow (as at first login).
    const pub = createCaller(publicCtx());
    const { userId } = await pub.auth.acceptInvite({ token, password: 'orca-tide-brambles-42' });

    // Now a member with the granted activities.
    listed = await admin.contractors.users.list({ contractorId });
    expect(listed.pending).toHaveLength(0);
    expect(listed.members).toHaveLength(1);
    expect(listed.members[0]?.activities).toEqual(['inspections', 'observations']);
    expect(listed.members[0]?.email).toBe('jane@sparky.test');

    // The derived permission set carries the mapped keys and is hidden.
    const [u] = await db
      .select({ permissionSetId: schema.user.permissionSetId })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (!u) throw new Error('expected the invited user row');
    const [set] = await db
      .select({
        permissions: schema.permissionSets.permissions,
        externalManaged: schema.permissionSets.externalManaged,
      })
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.id, u.permissionSetId))
      .limit(1);
    expect(set?.externalManaged).toBe(true);
    expect(new Set(set?.permissions)).toEqual(
      new Set([
        'inspections.view',
        'inspections.conduct',
        'inspections.sign',
        'issues.view',
        'issues.report',
      ]),
    );

    // Hidden from the admin permission-sets list.
    const sets = await admin.permissions.list();
    expect(sets.some((s) => s.name.startsWith('Contractor · '))).toBe(false);
  });

  it('portal me + acknowledge work for the external user', async () => {
    const admin = createCaller(ctxFor(adminUserId));
    const { token } = await admin.contractors.users.invite({
      contractorId,
      email: 'bob@sparky.test',
      activities: ['documents'],
    });
    const pub = createCaller(publicCtx());
    const { userId } = await pub.auth.acceptInvite({ token, password: 'orca-tide-brambles-42' });

    const portal = createCaller(ctxFor(userId));
    let me = await portal.contractors.users.me();
    expect(me?.contractorName).toBe('Sparky Electrical');
    expect(me?.activities).toEqual(['documents']);
    expect(me?.acknowledgedAt).toBeNull();

    await portal.contractors.users.acknowledge();
    me = await portal.contractors.users.me();
    expect(me?.acknowledgedAt).not.toBeNull();
  });

  it('updateActivities rewrites the derived permission set; remove revokes access', async () => {
    const admin = createCaller(ctxFor(adminUserId));
    const { token } = await admin.contractors.users.invite({
      contractorId,
      email: 'kim@sparky.test',
      activities: ['inspections'],
    });
    const pub = createCaller(publicCtx());
    const { userId } = await pub.auth.acceptInvite({ token, password: 'orca-tide-brambles-42' });

    await admin.contractors.users.updateActivities({ userId, activities: ['documents'] });
    const [u] = await db
      .select({ permissionSetId: schema.user.permissionSetId })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    if (!u) throw new Error('expected the invited user row');
    const [set] = await db
      .select({ permissions: schema.permissionSets.permissions })
      .from(schema.permissionSets)
      .where(eq(schema.permissionSets.id, u.permissionSetId))
      .limit(1);
    expect(new Set(set?.permissions)).toEqual(new Set(['documents.view']));

    await admin.contractors.users.remove({ userId });
    const listed = await admin.contractors.users.list({ contractorId });
    expect(listed.members).toHaveLength(0);
    const [deactivated] = await db
      .select({ deactivatedAt: schema.user.deactivatedAt })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);
    expect(deactivated?.deactivatedAt).not.toBeNull();
  });

  it('CT-P06: removal refuses a user who is not a portal user for this tenant', async () => {
    // `remove` accepted any tenant userId and unconditionally stamped
    // `deactivatedAt`, so `contractors.manage` — held by every seeded
    // Manager — was a way to deactivate ANY user without holding
    // `users.deactivate`, including the last administrator. A permanent
    // tenant lockout, routed around three guards.
    const admin = createCaller(ctxFor(adminUserId));
    const [systemSet] = await db
      .select({ id: schema.permissionSets.id })
      .from(schema.permissionSets)
      .where(
        and(eq(schema.permissionSets.tenantId, tenantId), eq(schema.permissionSets.isSystem, true)),
      )
      .limit(1);
    if (!systemSet) throw new Error('expected a seeded system permission set');
    const bystanderId = newId();
    await db.insert(schema.user).values({
      id: bystanderId,
      name: 'Bystander',
      email: 'bystander@acme.test',
      tenantId,
      permissionSetId: systemSet.id,
    });

    await expect(admin.contractors.users.remove({ userId: bystanderId })).rejects.toThrow(
      /contractor_user_not_found/,
    );
    const [row] = await db
      .select({ deactivatedAt: schema.user.deactivatedAt })
      .from(schema.user)
      .where(eq(schema.user.id, bystanderId))
      .limit(1);
    expect(row?.deactivatedAt).toBeNull();
  });

  it('CT-P06: you cannot remove your own portal access', async () => {
    const admin = createCaller(ctxFor(adminUserId));
    await expect(admin.contractors.users.remove({ userId: adminUserId })).rejects.toThrow(
      /cannot_remove_self/,
    );
  });

  it('inviting an email that already has a tenant user is rejected', async () => {
    const admin = createCaller(ctxFor(adminUserId));
    const [systemSet] = await db
      .select({ id: schema.permissionSets.id })
      .from(schema.permissionSets)
      .where(
        and(eq(schema.permissionSets.tenantId, tenantId), eq(schema.permissionSets.isSystem, true)),
      )
      .limit(1);
    if (!systemSet) throw new Error('expected a seeded system permission set');
    await db.insert(schema.user).values({
      id: newId(),
      name: 'Existing',
      email: 'dupe@sparky.test',
      tenantId,
      permissionSetId: systemSet.id,
    });
    await expect(
      admin.contractors.users.invite({
        contractorId,
        email: 'dupe@sparky.test',
        activities: [],
      }),
    ).rejects.toThrow(/contractor-user-email-taken/);
  });
});

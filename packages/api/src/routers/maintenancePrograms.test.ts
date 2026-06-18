/**
 * Integration tests for Maintenance Programs (To-Do #3) — program → trigger →
 * attach-to-asset → future-dated Action → complete → roll-forward.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  // Apply every migration so the schema is complete.
  const { readdir } = await import('node:fs/promises');
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
const silent = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

describe('Maintenance Programs (To-Do #3)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silent(),
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
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Admin',
      email: 'admin@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('attaches a program to an asset and materialises a future-dated action', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { assetId } = await caller.assets.create({ name: 'Van 1' });
    const { programId } = await caller.maintenancePrograms.create({ name: 'Van program' });
    await caller.maintenancePrograms.addTrigger({
      programId,
      title: 'Annual service',
      triggerType: 'time',
      intervalDays: 365,
    });

    const res = await caller.maintenancePrograms.attachAsset({ programId, assetId });
    expect(res.actionsCreated).toBe(1);

    const forAsset = await caller.maintenancePrograms.listForAsset({ assetId });
    expect(forAsset.programs).toHaveLength(1);
    expect(forAsset.actions).toHaveLength(1);
    const action = forAsset.actions[0];
    expect(action?.title).toContain('Annual service');
    expect(action?.dueAt).not.toBeNull(); // time trigger → concrete due date
  });

  it('rolls the next action forward when a maintenance action is completed', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { assetId } = await caller.assets.create({ name: 'Van 2' });
    const { programId } = await caller.maintenancePrograms.create({ name: 'P' });
    await caller.maintenancePrograms.addTrigger({
      programId,
      title: 'Oil change',
      triggerType: 'time',
      intervalDays: 30,
    });
    await caller.maintenancePrograms.attachAsset({ programId, assetId });

    const before = await caller.maintenancePrograms.listForAsset({ assetId });
    const firstActionId = before.actions[0]?.id;
    expect(firstActionId).toBeDefined();

    await caller.actions.setStatus({ actionId: firstActionId as string, status: 'completed' });

    // A new open maintenance action should have been generated (roll-forward).
    const after = await caller.maintenancePrograms.listForAsset({ assetId });
    const open = after.actions.filter((a) => a.status === 'open');
    expect(open).toHaveLength(1);
    expect(after.actions).toHaveLength(2); // completed + new open
  });

  it('attach is idempotent — re-attaching does not duplicate open actions', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { assetId } = await caller.assets.create({ name: 'Van 3' });
    const { programId } = await caller.maintenancePrograms.create({ name: 'P' });
    await caller.maintenancePrograms.addTrigger({
      programId,
      title: 'Check',
      triggerType: 'time',
      intervalDays: 90,
    });
    await caller.maintenancePrograms.attachAsset({ programId, assetId });
    const second = await caller.maintenancePrograms.attachAsset({ programId, assetId });
    expect(second.actionsCreated).toBe(0);
  });

  it('creates a program from a built-in template with its triggers', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { templates } = await caller.maintenancePrograms.templates();
    expect(templates.length).toBeGreaterThan(0);
    const van = templates.find((t) => t.key === 'van');
    expect(van).toBeDefined();

    const { programId } = await caller.maintenancePrograms.createFromTemplate({
      templateKey: 'van',
    });
    const got = await caller.maintenancePrograms.get({ programId });
    expect(got.triggers.length).toBe(van?.triggers.length);
  });

  it('distance trigger creates an action with no due date and a target in the description', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { assetId } = await caller.assets.create({ name: 'Van 4' });
    await caller.assets.readings.add({
      assetId,
      fieldName: 'odometer',
      value: 5000,
      unit: 'km',
    });
    const { programId } = await caller.maintenancePrograms.create({ name: 'P' });
    await caller.maintenancePrograms.addTrigger({
      programId,
      title: 'Change oil',
      triggerType: 'distance',
      intervalValue: 10000,
      usageField: 'odometer',
      unit: 'km',
    });
    await caller.maintenancePrograms.attachAsset({ programId, assetId });

    const forAsset = await caller.maintenancePrograms.listForAsset({ assetId });
    const action = forAsset.actions[0];
    expect(action?.dueAt ?? null).toBeNull();
    // current 5000 + interval 10000 = target 15000
    expect(action?.description ?? '').toContain('15000');
  });

  // Keep referenced for the schema-completeness check.
  it('schema has maintenance program tables', async () => {
    const rows = await db
      .select()
      .from(schema.maintenancePrograms)
      .where(eq(schema.maintenancePrograms.tenantId, tenantId));
    expect(Array.isArray(rows)).toBe(true);
  });
});

/**
 * Integration tests for the Assets router (Phase 5B).
 */
import { readFile, readdir } from 'node:fs/promises';
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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';

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

const createCaller = createCallerFactory(appRouter);

function silentLogger() {
  return createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
}

describe('Assets router (Phase 5B)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;

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
    // Production user ids are `usr_` + ULID (30 chars) — PF-29 regression:
    // the owner picker must accept them.
    adminUserId = `usr_${newId()}`;
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

  it('creates an asset type and uses it on an asset', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { typeId } = await caller.assetTypes.create({
      name: 'Vehicle',
      description: 'Motor vehicles',
    });

    const types = await caller.assetTypes.list({});
    expect(types.some((t) => t.id === typeId)).toBe(true);

    const { assetId } = await caller.assets.create({ name: 'Truck 001', typeId });
    const { asset, assetType } = await caller.assets.get({ assetId });
    expect(asset.name).toBe('Truck 001');
    expect(assetType?.id).toBe(typeId);
    expect(asset.qrToken).toBeDefined();
  });

  it('stores an owner on create and returns the owner name on get', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { assetId } = await caller.assets.create({
      name: 'Forklift #3',
      ownerUserId: adminUserId,
    });

    const { asset, ownerName } = await caller.assets.get({ assetId });
    expect(asset.ownerUserId).toBe(adminUserId);
    expect(ownerName).toBe('Admin');

    // Clearing the owner via update nulls it out.
    await caller.assets.update({ assetId, ownerUserId: null });
    const after = await caller.assets.get({ assetId });
    expect(after.asset.ownerUserId).toBeNull();
    expect(after.ownerName).toBeNull();
  });

  it('AS-E11: prevents creating an asset with a parent that itself has a parent', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { assetId: grandparentId } = await caller.assets.create({ name: 'Site A' });
    const { assetId: parentId } = await caller.assets.create({
      name: 'Zone 1',
      parentId: grandparentId,
    });

    await expect(caller.assets.create({ name: 'Sub-zone', parentId })).rejects.toThrow(
      'asset-parent-depth-exceeded',
    );
  });

  it('AS-E01: prevents archiving a parent with active sub-assets', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { assetId: parentId } = await caller.assets.create({ name: 'Parent' });
    await caller.assets.create({ name: 'Child', parentId });

    await expect(caller.assets.archive({ assetId: parentId })).rejects.toThrow(
      /asset-has-sub-assets/,
    );

    // After archiving the child, parent should be archivable.
    const { assetId: childId } = await caller.assets.create({
      name: 'Child2',
      parentId,
    });
    await caller.assets.archive({ assetId: childId });
    // The first child is still active, so should still fail.
    await expect(caller.assets.archive({ assetId: parentId })).rejects.toThrow(
      /asset-has-sub-assets/,
    );
  });

  it('AS-E12: prevents archiving a type with active assets', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { typeId } = await caller.assetTypes.create({ name: 'Crane' });
    await caller.assets.create({ name: 'Crane #1', typeId });

    await expect(caller.assetTypes.archive({ typeId })).rejects.toThrow(
      /asset-type-has-active-assets/,
    );
  });

  it('records readings and lists them', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { assetId } = await caller.assets.create({ name: 'Pump A' });

    await caller.assets.readings.add({
      assetId,
      fieldName: 'runtime_hours',
      value: 1250,
      unit: 'h',
      source: 'manual',
    });

    const readings = await caller.assets.readings.list({ assetId });
    expect(readings).toHaveLength(1);
    expect(readings[0]?.fieldName).toBe('runtime_hours');
    expect(readings[0]?.value).toBe('1250');
  });
  it('AS-CF05: changing type keeps old values and accepts the new type’s fields', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    // A plain type with no custom fields — the asset the user actually had.
    const { typeId: plainType } = await caller.assetTypes.create({ name: 'Generic' });
    const { assetId } = await caller.assets.create({ name: 'Unit 7', typeId: plainType });

    // Later, a richer type is defined.
    const { typeId: carType } = await caller.assetTypes.create({
      name: 'Cars',
      customFields: [
        { id: 'reg', name: 'Registration', fieldType: 'text', required: true },
        { id: 'mot', name: 'MOT due', fieldType: 'date' },
      ],
    });

    // Switching the asset onto it, and filling the new fields in the same
    // save — which is exactly what had no UI before this fix.
    await caller.assets.update({
      assetId,
      typeId: carType,
      customFieldValues: { reg: 'AB12 CDE', mot: '2027-03-01' },
    });

    const afterSwitch = await caller.assets.get({ assetId });
    expect(afterSwitch.assetType?.id).toBe(carType);
    // The detail page reads the type definition off `get`, so it must come
    // back with the fields or the page has nothing to render.
    expect(afterSwitch.assetType?.customFields).toHaveLength(2);
    expect(afterSwitch.asset.customFieldValues).toMatchObject({
      reg: 'AB12 CDE',
      mot: '2027-03-01',
    });

    // Switching to a third type must not destroy what the car type held —
    // the editor sends the whole map back, so switching BACK restores it.
    const { typeId: pumpType } = await caller.assetTypes.create({
      name: 'Pumps',
      customFields: [{ id: 'pressure', name: 'Pressure', fieldType: 'number' }],
    });
    await caller.assets.update({
      assetId,
      typeId: pumpType,
      customFieldValues: { reg: 'AB12 CDE', mot: '2027-03-01', pressure: '4.2' },
    });

    const afterSecond = await caller.assets.get({ assetId });
    expect(afterSecond.asset.customFieldValues).toMatchObject({
      reg: 'AB12 CDE',
      pressure: '4.2',
    });
  });
});

/**
 * Contractors router — contractor ↔ asset link (Phase 3).
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

describe('contractors.assets link (Phase 3)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let contractorId: string;
  let assetId: string;

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
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Admin',
      email: 'admin@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
    const caller = createCaller(ctxFor(adminUserId));
    ({ id: contractorId } = await caller.contractors.create({ name: 'Sparky Electrical' }));
    assetId = newId();
    await db.insert(schema.assets).values({ id: assetId, tenantId, name: 'Main Switchboard' });
  });

  afterEach(async () => {
    await client.close();
  });

  it('links a contractor to an asset, visible from both sides', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await caller.contractors.assets.link({ contractorId, assetId, note: 'Annual service' });

    const forContractor = await caller.contractors.assets.listForContractor({ contractorId });
    expect(forContractor).toHaveLength(1);
    expect(forContractor[0]?.name).toBe('Main Switchboard');
    expect(forContractor[0]?.note).toBe('Annual service');

    const forAsset = await caller.contractors.assets.listForAsset({ assetId });
    expect(forAsset).toHaveLength(1);
    expect(forAsset[0]?.name).toBe('Sparky Electrical');
  });

  it('linking the same pair twice is idempotent', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await caller.contractors.assets.link({ contractorId, assetId });
    await caller.contractors.assets.link({ contractorId, assetId });
    const forAsset = await caller.contractors.assets.listForAsset({ assetId });
    expect(forAsset).toHaveLength(1);
  });

  it('unlink removes the association', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await caller.contractors.assets.link({ contractorId, assetId });
    const [link] = await caller.contractors.assets.listForContractor({ contractorId });
    if (!link) throw new Error('expected a contractor-asset link');
    await caller.contractors.assets.unlink({ id: link.linkId });
    expect(await caller.contractors.assets.listForContractor({ contractorId })).toHaveLength(0);
  });

  it('rejects linking an asset from another tenant', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const otherTenant = newId();
    await db.insert(schema.tenants).values({ id: otherTenant, name: 'Other', slug: 'other' });
    const foreignAsset = newId();
    await db
      .insert(schema.assets)
      .values({ id: foreignAsset, tenantId: otherTenant, name: 'Foreign' });
    await expect(
      caller.contractors.assets.link({ contractorId, assetId: foreignAsset }),
    ).rejects.toThrow();
  });
});

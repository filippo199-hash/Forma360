/**
 * Cross-tenant reference-guard regression tests.
 *
 * Each case sets up TWO tenants and confirms a mutation in tenant A rejects a
 * reference id that belongs to tenant B — the class of bug the security review
 * flagged (a foreign userId / planId / storageKey accepted verbatim). A
 * same-tenant positive control proves the guard doesn't over-reject.
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
import { createTestContext, type Context } from './context';
import { appRouter } from './router';
import { createCallerFactory } from './trpc';
import { assertStorageKeyInTenant } from './tenant-guards';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

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
const silent = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

describe('tenant reference guards', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantA: string;
  let tenantB: string;
  let adminA: string;
  let adminB: string;

  function ctxFor(tenantId: string, userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silent(),
      auth: { userId, email: `${userId}@x.test`, tenantId: tenantId as never },
    });
  }

  async function seedTenant(name: string): Promise<{ tenantId: string; adminId: string }> {
    const tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name, slug: `${name}-${tenantId}` });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    const adminId = newId();
    await db.insert(schema.user).values({
      id: adminId,
      name: `Admin ${name}`,
      email: `admin-${tenantId}@x.test`,
      tenantId,
      permissionSetId: seeded.administrator,
    });
    return { tenantId, adminId };
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    ({ tenantId: tenantA, adminId: adminA } = await seedTenant('acme'));
    ({ tenantId: tenantB, adminId: adminB } = await seedTenant('globex'));
  });

  afterEach(async () => {
    await client.close();
  });

  it('groups.addMember rejects a user from another tenant but accepts an in-tenant user', async () => {
    const a = createCaller(ctxFor(tenantA, adminA));
    const { id: groupId } = await a.groups.create({ name: 'Ops' });

    // Cross-tenant: adminB belongs to tenant B → must be rejected.
    await expect(a.groups.addMember({ groupId, userId: adminB })).rejects.toThrow();

    // In-tenant: adminA is fine.
    await expect(a.groups.addMember({ groupId, userId: adminA })).resolves.toEqual({ ok: true });
    const members = await a.groups.members({ groupId });
    expect(members.map((m) => m.userId)).toEqual([adminA]);
  });

  it('sites.addMember rejects a user from another tenant', async () => {
    const a = createCaller(ctxFor(tenantA, adminA));
    const { id: siteId } = await a.sites.create({ name: 'HQ' });
    await expect(a.sites.addMember({ siteId, userId: adminB })).rejects.toThrow();
    await expect(a.sites.addMember({ siteId, userId: adminA })).resolves.toEqual({ ok: true });
  });

  it('maintenancePlans.unlinkAsset cannot target another tenant plan', async () => {
    const b = createCaller(ctxFor(tenantB, adminB));
    const { planId } = await b.maintenancePlans.create({
      name: 'Service',
      planType: 'time',
      intervalDays: 30,
    });

    // Tenant A must not be able to touch tenant B's plan (join table has no
    // tenantId, so the guard is the only thing standing between them).
    const a = createCaller(ctxFor(tenantA, adminA));
    await expect(a.maintenancePlans.unlinkAsset({ planId, assetId: newId() })).rejects.toThrow();
  });

  it('assertStorageKeyInTenant only accepts keys under the tenant prefix', () => {
    expect(() => assertStorageKeyInTenant(tenantA, `${tenantA}/issues/x/f.pdf`)).not.toThrow();
    // A key pointing at another tenant's object is rejected.
    expect(() => assertStorageKeyInTenant(tenantA, `${tenantB}/documents/x/secret.pdf`)).toThrow();
    // A key that merely mentions the tenant later in the path is rejected.
    expect(() => assertStorageKeyInTenant(tenantA, `evil/${tenantA}/f.pdf`)).toThrow();
  });
});

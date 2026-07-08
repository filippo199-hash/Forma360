/**
 * Integration tests for the Site/Project plans & pins router (Phase 3).
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

describe('sitePlans router (Phase 3)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;

  function ctxFor(userId: string, tid: string = tenantId): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@x.test`, tenantId: tid as never },
    });
  }

  async function seedTenant(slug: string): Promise<{ tid: string; admin: string }> {
    const tid = newId();
    await db.insert(schema.tenants).values({ id: tid, name: slug, slug });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tid);
    const admin = newId();
    await db.insert(schema.user).values({
      id: admin,
      name: `Admin ${slug}`,
      email: `admin@${slug}.test`,
      tenantId: tid,
      permissionSetId: seeded.administrator,
    });
    return { tid, admin };
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    const seeded = await seedTenant('acme');
    tenantId = seeded.tid;
    adminUserId = seeded.admin;
  });

  afterEach(async () => {
    await client.close();
  });

  it('creates plans, orders them, and reflects in getHub count', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'Tower', kind: 'project' });

    const p1 = await caller.sitePlans.createPlan({
      siteId,
      name: 'Ground floor',
      storageKey: `${tenantId}/site-plans/${siteId}/g.png`,
      mimeType: 'image/png',
    });
    await caller.sitePlans.createPlan({
      siteId,
      name: 'First floor',
      storageKey: `${tenantId}/site-plans/${siteId}/1.png`,
      mimeType: 'image/png',
    });

    const plans = await caller.sitePlans.listPlans({ siteId });
    expect(plans).toHaveLength(2);
    expect(plans[0]?.name).toBe('Ground floor'); // sortOrder 0 first
    expect(plans[1]?.sortOrder).toBe(1);

    const hub = await caller.sites.getHub({ id: siteId });
    expect(hub.counts.plans).toBe(2);
    expect(p1.id).toHaveLength(26);
  });

  it('derives kind=pdf from the mime type', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'S', kind: 'site' });
    await caller.sitePlans.createPlan({
      siteId,
      name: 'Drawing',
      storageKey: `${tenantId}/site-plans/${siteId}/d.pdf`,
      mimeType: 'application/pdf',
    });
    const plans = await caller.sitePlans.listPlans({ siteId });
    expect(plans[0]?.kind).toBe('pdf');
  });

  it('drops pins on a plan and lists them; note pins have no entity', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'S', kind: 'site' });
    const { id: planId } = await caller.sitePlans.createPlan({
      siteId,
      name: 'Plan',
      storageKey: `${tenantId}/site-plans/${siteId}/p.png`,
      mimeType: 'image/png',
    });

    await caller.sitePlans.createPin({
      planId,
      x: 0.25,
      y: 0.75,
      entityType: 'note',
      label: 'Cracked wall',
    });
    const pins = await caller.sitePlans.listPins({ planId });
    expect(pins).toHaveLength(1);
    expect(pins[0]?.x).toBeCloseTo(0.25);
    expect(pins[0]?.entityId).toBeNull();
    expect(pins[0]?.label).toBe('Cracked wall');
  });

  it('updates and archives a pin', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'S', kind: 'site' });
    const { id: planId } = await caller.sitePlans.createPlan({
      siteId,
      name: 'Plan',
      storageKey: `${tenantId}/site-plans/${siteId}/p.png`,
      mimeType: 'image/png',
    });
    const { id: pinId } = await caller.sitePlans.createPin({ planId, x: 0.1, y: 0.1 });

    await caller.sitePlans.updatePin({ id: pinId, x: 0.5, label: 'Moved' });
    let pins = await caller.sitePlans.listPins({ planId });
    expect(pins[0]?.x).toBeCloseTo(0.5);
    expect(pins[0]?.label).toBe('Moved');

    await caller.sitePlans.archivePin({ id: pinId });
    pins = await caller.sitePlans.listPins({ planId });
    expect(pins).toHaveLength(0);
  });

  it('archiving a plan hides it from the list', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'S', kind: 'site' });
    const { id: planId } = await caller.sitePlans.createPlan({
      siteId,
      name: 'Plan',
      storageKey: `${tenantId}/site-plans/${siteId}/p.png`,
      mimeType: 'image/png',
    });
    await caller.sitePlans.archivePlan({ id: planId });
    expect(await caller.sitePlans.listPlans({ siteId })).toHaveLength(0);
  });

  it('rejects creating a pin on another tenant plan', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'S', kind: 'site' });
    const { id: planId } = await caller.sitePlans.createPlan({
      siteId,
      name: 'Plan',
      storageKey: `${tenantId}/site-plans/${siteId}/p.png`,
      mimeType: 'image/png',
    });

    const other = await seedTenant('other');
    const otherCaller = createCaller(ctxFor(other.admin, other.tid));
    await expect(otherCaller.sitePlans.createPin({ planId, x: 0.1, y: 0.1 })).rejects.toThrow();
  });
});

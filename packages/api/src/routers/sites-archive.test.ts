/**
 * Tests for sites.archiveWithMode — the dissociate-vs-delete choice when
 * archiving a project that has attached records.
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

describe('sites.archiveWithMode', () => {
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

  async function seedProjectWithStuff() {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'Proj', kind: 'project' });
    const { categoryId } = await caller.issues.categories.create({ name: 'Safety' });
    await caller.issues.issues.create({ categoryId, title: 'Crack', siteId });
    await caller.siteMedia.create({
      siteId,
      storageKey: `${tenantId}/site-media/${siteId}/p.jpg`,
      filename: 'p.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
    });
    return { caller, siteId };
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

  it('dissociate: unlinks the observation but keeps media', async () => {
    const { caller, siteId } = await seedProjectWithStuff();
    let hub = await caller.sites.getHub({ id: siteId });
    expect(hub.counts.observations).toBe(1);
    expect(hub.counts.media).toBe(1);

    await caller.sites.archiveWithMode({ id: siteId, mode: 'dissociate' });

    hub = await caller.sites.getHub({ id: siteId });
    // Observation is unlinked (siteId null) → no longer counted for the site…
    expect(hub.counts.observations).toBe(0);
    // …but media stays with the archived project.
    expect(hub.counts.media).toBe(1);
    // Site itself is archived → present in the hub feed but flagged archived
    // (the page splits it into the Archived tab).
    const listed = (await caller.sites.hub()).find((s) => s.id === siteId);
    expect(listed?.archivedAt).not.toBeNull();
    // The observation still exists and is still active in its module.
    expect((await caller.issues.issues.list({})).items).toHaveLength(1);
  });

  it('restore: brings back the project and the records archived with it', async () => {
    const { caller, siteId } = await seedProjectWithStuff();
    await caller.sites.archiveWithMode({ id: siteId, mode: 'delete' });

    // Everything was archived along with the project.
    expect((await caller.issues.issues.list({})).items).toHaveLength(0);
    let hub = await caller.sites.getHub({ id: siteId });
    expect(hub.counts.media).toBe(0);

    await caller.sites.restore({ id: siteId });

    // The project is active again…
    const listed = (await caller.sites.hub()).find((s) => s.id === siteId);
    expect(listed?.archivedAt).toBeNull();
    // …and the records archived in the same action came back.
    expect((await caller.issues.issues.list({})).items).toHaveLength(1);
    hub = await caller.sites.getHub({ id: siteId });
    expect(hub.counts.media).toBe(1);
  });

  it('restore: rejects a project that is not archived', async () => {
    const { caller, siteId } = await seedProjectWithStuff();
    await expect(caller.sites.restore({ id: siteId })).rejects.toThrow();
  });

  it('delete: archives the observation and the media too', async () => {
    const { caller, siteId } = await seedProjectWithStuff();

    await caller.sites.archiveWithMode({ id: siteId, mode: 'delete' });

    const hub = await caller.sites.getHub({ id: siteId });
    expect(hub.counts.observations).toBe(0);
    expect(hub.counts.media).toBe(0);
    // The observation is archived (not in the default active list).
    expect((await caller.issues.issues.list({})).items).toHaveLength(0);
  });
});

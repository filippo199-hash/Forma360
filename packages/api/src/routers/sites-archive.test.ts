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
import { eq } from 'drizzle-orm';
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

  it('archive drops the site from schedules and unlinks contractor visits', async () => {
    const { caller, siteId } = await seedProjectWithStuff();

    // Seed a schedule targeting the site + a contractor visit at the site.
    const templateId = newId();
    await db.insert(schema.templates).values({
      id: templateId,
      tenantId,
      name: 'Tpl',
      createdBy: adminUserId,
    });
    const scheduleId = newId();
    await db.insert(schema.templateSchedules).values({
      id: scheduleId,
      tenantId,
      templateId,
      name: 'Weekly check',
      rrule: 'FREQ=WEEKLY',
      startAt: new Date('2026-01-01T00:00:00Z'),
      siteIds: [siteId],
      createdBy: adminUserId,
    });
    const contractorId = newId();
    await db.insert(schema.contractors).values({ id: contractorId, tenantId, name: 'Sparky' });
    const visitId = newId();
    await db.insert(schema.contractorVisits).values({
      id: visitId,
      tenantId,
      contractorId,
      siteId,
      title: 'Fix wiring',
      scheduledStart: new Date('2026-01-02T09:00:00Z'),
      createdByUserId: adminUserId,
    });

    await caller.sites.archiveWithMode({ id: siteId, mode: 'dissociate' });

    const [schedule] = await db
      .select()
      .from(schema.templateSchedules)
      .where(eq(schema.templateSchedules.id, scheduleId));
    expect(schedule?.siteIds ?? []).not.toContain(siteId);

    const [visit] = await db
      .select()
      .from(schema.contractorVisits)
      .where(eq(schema.contractorVisits.id, visitId));
    expect(visit?.siteId).toBeNull();
  });

  it('blocks archiving a site that has an active sub-site', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: parentId } = await caller.sites.create({ name: 'Parent' });
    await caller.sites.create({ name: 'Child', parentId });

    // Archiving the non-leaf parent is refused so the child cannot be
    // orphaned (active child, hidden archived ancestor).
    await expect(
      caller.sites.archiveWithMode({ id: parentId, mode: 'dissociate' }),
    ).rejects.toThrow(/sub-sites first|BAD_REQUEST/);

    // The parent stays active — nothing was archived.
    const listed = (await caller.sites.hub()).find((s) => s.id === parentId);
    expect(listed?.archivedAt).toBeNull();
  });

  it('archives a leaf, then the parent once its only child is archived', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: parentId } = await caller.sites.create({ name: 'Parent' });
    const { id: childId } = await caller.sites.create({ name: 'Child', parentId });

    // The leaf child archives fine.
    await caller.sites.archiveWithMode({ id: childId, mode: 'dissociate' });
    const listedChild = (await caller.sites.hub()).find((s) => s.id === childId);
    expect(listedChild?.archivedAt).not.toBeNull();

    // With the child archived, the parent is a leaf and now archives too.
    await caller.sites.archiveWithMode({ id: parentId, mode: 'dissociate' });
    const listedParent = (await caller.sites.hub()).find((s) => s.id === parentId);
    expect(listedParent?.archivedAt).not.toBeNull();
  });
});

/**
 * Integration tests for the Site/Project media gallery router (Phase 2a).
 */
import { readFile } from 'node:fs/promises';
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
import { readdir } from 'node:fs/promises';
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

function silentLogger() {
  return createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
}

describe('siteMedia router (Phase 2a)', () => {
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

  async function seedTenant(name: string, slug: string): Promise<{ tid: string; admin: string }> {
    const tid = newId();
    await db.insert(schema.tenants).values({ id: tid, name, slug });
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
    const seeded = await seedTenant('Acme', 'acme');
    tenantId = seeded.tid;
    adminUserId = seeded.admin;
  });

  afterEach(async () => {
    await client.close();
  });

  it('creates media, lists it with uploader name, and reflects in getHub count', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'Site A', kind: 'site' });

    await caller.siteMedia.create({
      siteId,
      storageKey: `${tenantId}/site-media/${siteId}/photo.jpg`,
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      caption: 'Foundation poured',
    });

    const list = await caller.siteMedia.list({ siteId });
    expect(list).toHaveLength(1);
    expect(list[0]?.caption).toBe('Foundation poured');
    expect(list[0]?.kind).toBe('photo');
    expect(list[0]?.uploaderName).toBe('Admin acme');

    const hub = await caller.sites.getHub({ id: siteId });
    expect(hub.counts.media).toBe(1);
  });

  it('derives kind=video from the mime type', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'Site V', kind: 'site' });
    await caller.siteMedia.create({
      siteId,
      storageKey: `${tenantId}/site-media/${siteId}/clip.mp4`,
      filename: 'clip.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 4096,
    });
    const list = await caller.siteMedia.list({ siteId });
    expect(list[0]?.kind).toBe('video');
  });

  it('rejects a storage key belonging to another tenant', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'Site A', kind: 'site' });
    await expect(
      caller.siteMedia.create({
        siteId,
        storageKey: `${newId()}/site-media/${siteId}/evil.jpg`,
        filename: 'evil.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1,
      }),
    ).rejects.toThrow();
  });

  it('rejects attaching media to a site in another tenant', async () => {
    const other = await seedTenant('Other', 'other');
    const otherCaller = createCaller(ctxFor(other.admin, other.tid));
    const { id: otherSiteId } = await otherCaller.sites.create({
      name: 'Other Site',
      kind: 'site',
    });

    const caller = createCaller(ctxFor(adminUserId));
    await expect(
      caller.siteMedia.create({
        siteId: otherSiteId,
        storageKey: `${tenantId}/site-media/${otherSiteId}/x.jpg`,
        filename: 'x.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1,
      }),
    ).rejects.toThrow();
  });

  it('updates a caption and archives (soft-deletes) media', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'Site A', kind: 'site' });
    const { id } = await caller.siteMedia.create({
      siteId,
      storageKey: `${tenantId}/site-media/${siteId}/photo.jpg`,
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
    });

    await caller.siteMedia.updateCaption({ id, caption: 'Updated caption' });
    let list = await caller.siteMedia.list({ siteId });
    expect(list[0]?.caption).toBe('Updated caption');

    await caller.siteMedia.archive({ id });
    list = await caller.siteMedia.list({ siteId });
    expect(list).toHaveLength(0);
    const hub = await caller.sites.getHub({ id: siteId });
    expect(hub.counts.media).toBe(0);
  });

  it('does not leak media across tenants in list', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: siteId } = await caller.sites.create({ name: 'Site A', kind: 'site' });
    await caller.siteMedia.create({
      siteId,
      storageKey: `${tenantId}/site-media/${siteId}/photo.jpg`,
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
    });

    const other = await seedTenant('Other', 'other');
    const otherCaller = createCaller(ctxFor(other.admin, other.tid));
    // Same siteId string, but scoped to the other tenant → empty.
    const leaked = await otherCaller.siteMedia.list({ siteId });
    expect(leaked).toHaveLength(0);
  });
});

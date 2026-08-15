/**
 * The permit snapshot carries the clock the document must be stamped in
 * (BUG-14, per-site).
 *
 * The first fix stamped every printed document in one deployment-wide
 * `APP_TIMEZONE`. That is correct for a single-country operator and wrong
 * the moment a customer runs sites in more than one zone: their Frankfurt
 * permit prints London time, which is the same defect with a different
 * offset. So the clock follows the WORK — the site, then the tenant, then
 * the deployment.
 *
 * The DECISION is pure and unit-tested in `@forma360/shared/timezone`
 * (TZ-D01..D05); the WRITING half is pinned in the permits audit suite
 * (PW-Z01/Z02). This is the loading half: without it, both levels could be
 * configured correctly and never reach the renderer.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { resolveDocumentTimeZone } from '@forma360/shared/timezone';
import { loadPermitSnapshot } from './snapshot';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');

async function bootDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return { client, db: db as unknown as Database };
}

const TENANT = '01J0000000000000000000TZ01';
const SITE = '01J0000000000000000000TZ02';
const TYPE = '01J0000000000000000000TZ03';
const PERMIT = '01J0000000000000000000TZ04';
const USER = 'usr_tz_admin';
const PERM_SET = '01J0000000000000000000TZ05';

describe('permit snapshot — document timezone', () => {
  let client: PGlite;
  let db: Database;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    await db.insert(schema.tenants).values({ id: TENANT, name: 'Zone Co', slug: 'zone-co' });
    await db.insert(schema.sites).values({ id: SITE, tenantId: TENANT, name: 'Frankfurt yard' });
    await db.insert(schema.permissionSets).values({
      id: PERM_SET,
      tenantId: TENANT,
      name: 'Administrator',
      permissions: [] as never,
    });
    await db.insert(schema.user).values({
      id: USER,
      tenantId: TENANT,
      name: 'Ada Admin',
      email: 'ada@zone.test',
      permissionSetId: PERM_SET,
    });
    await db.insert(schema.permitTypes).values({
      id: TYPE,
      tenantId: TENANT,
      category: 'hot_work',
      name: 'Hot work',
      maxDurationHours: 12,
      createdBy: USER,
    });
    await db.insert(schema.permits).values({
      id: PERMIT,
      tenantId: TENANT,
      permitTypeId: TYPE,
      siteId: SITE,
      title: 'Weld a handrail',
      workDescription: 'Welding.',
      validFrom: new Date('2026-08-15T07:00:00Z'),
      validTo: new Date('2026-08-15T15:00:00Z'),
      createdBy: USER,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('SNAP-TZ01 — both levels reach the renderer, and the site wins', async () => {
    const resolve = async (): Promise<string> => {
      const snap = await loadPermitSnapshot(db, { tenantId: TENANT, permitId: PERMIT });
      return resolveDocumentTimeZone(
        snap?.permit.siteTimeZone,
        snap?.permit.tenantTimeZone,
        'Europe/London',
      );
    };

    // Nothing declared → the deployment default.
    expect(await resolve()).toBe('Europe/London');

    await db
      .update(schema.tenants)
      .set({ settings: { timezone: 'Europe/Berlin' } })
      .where(eq(schema.tenants.id, TENANT));
    expect(await resolve()).toBe('Europe/Berlin');

    await db
      .update(schema.sites)
      .set({ timezone: 'America/New_York' })
      .where(eq(schema.sites.id, SITE));
    expect(await resolve()).toBe('America/New_York');
  });

  it('SNAP-TZ02 — a permit with no site still resolves, via the tenant', async () => {
    // Permits are not required to name a site, and a document with no site
    // must not lose its clock — or throw looking for one.
    await db.update(schema.permits).set({ siteId: null }).where(eq(schema.permits.id, PERMIT));
    await db
      .update(schema.tenants)
      .set({ settings: { timezone: 'Asia/Tokyo' } })
      .where(eq(schema.tenants.id, TENANT));

    const snap = await loadPermitSnapshot(db, { tenantId: TENANT, permitId: PERMIT });
    expect({
      site: snap?.permit.siteTimeZone ?? null,
      resolved: resolveDocumentTimeZone(
        snap?.permit.siteTimeZone,
        snap?.permit.tenantTimeZone,
        'Europe/London',
      ),
    }).toEqual({ site: null, resolved: 'Asia/Tokyo' });
  });
});

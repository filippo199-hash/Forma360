/**
 * Every printed document carries the tenant's company letterhead.
 *
 * The practitioners' PDFs (permit, FRA, risk assessment, RAMS pack) went
 * out with no company identity at all — no name, no address, no
 * registration numbers — which makes a filed permit look like it belongs
 * to nobody. The identity lives in `tenants.name` +
 * `settings.companyDetails` (set on settings/company) and reaches every
 * renderer through the snapshot's `company` block, loaded by the shared
 * `loadTenantRenderInfo` read.
 *
 * These tests pin the LOADING half against a real database on the permit
 * loader (all loaders share the same helper); the unit-hash tests in
 * `snapshot.test.ts` pin that changed details produce a new cache key.
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

const TENANT = '01J0000000000000000000CO01';
const TYPE = '01J0000000000000000000CO03';
const PERMIT = '01J0000000000000000000CO04';
const USER = 'usr_co_admin';
const PERM_SET = '01J0000000000000000000CO05';

describe('permit snapshot — company letterhead', () => {
  let client: PGlite;
  let db: Database;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    await db.insert(schema.tenants).values({ id: TENANT, name: 'Acme Scaffolding', slug: 'acme' });
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
      email: 'ada@acme.test',
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

  it('SNAP-CO01 — the saved company details reach the snapshot', async () => {
    await db
      .update(schema.tenants)
      .set({
        settings: {
          companyDetails: {
            legalName: 'Acme Scaffolding Holdings Ltd',
            addressLine1: '12 Foundry Lane',
            city: 'Leeds',
            postcode: 'LS1 4DN',
            country: 'United Kingdom',
            phone: '0113 496 0000',
            email: 'info@acme.test',
            website: 'acme.example.com',
            companyNumber: '12345678',
            vatNumber: 'GB123456789',
          },
          branding: { logoStorageKey: `${TENANT}/branding/logo.png` },
        },
      })
      .where(eq(schema.tenants.id, TENANT));

    const snap = await loadPermitSnapshot(db, { tenantId: TENANT, permitId: PERMIT });
    expect(snap).not.toBeNull();
    expect(snap?.company).toEqual({
      name: 'Acme Scaffolding',
      legalName: 'Acme Scaffolding Holdings Ltd',
      addressLine1: '12 Foundry Lane',
      addressLine2: null,
      city: 'Leeds',
      postcode: 'LS1 4DN',
      country: 'United Kingdom',
      phone: '0113 496 0000',
      email: 'info@acme.test',
      website: 'acme.example.com',
      companyNumber: '12345678',
      vatNumber: 'GB123456789',
      logoStorageKey: `${TENANT}/branding/logo.png`,
    });
  });

  it('SNAP-CO02 — a tenant with no saved details still has its name on the document', async () => {
    const snap = await loadPermitSnapshot(db, { tenantId: TENANT, permitId: PERMIT });
    expect(snap?.company.name).toBe('Acme Scaffolding');
    expect(snap?.company.addressLine1).toBeNull();
    expect(snap?.company.vatNumber).toBeNull();
    expect(snap?.company.logoStorageKey).toBeNull();
  });
});

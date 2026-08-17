/**
 * SEC-D01..D05 — deactivation is the revocation boundary.
 *
 * `users.deactivate` used to stamp `deactivatedAt` and nothing else, and
 * neither the request context nor `loadUserPermissions` consulted it. A
 * terminated administrator therefore kept full read/write access for as long
 * as their cookie lived — better-auth is configured with a 90-day window.
 * These pin both halves of the fix: `isUserActive` as the live check, and the
 * permission loader refusing to hand a deactivated account its keys.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { isUserActive, loadUserPermissions } from './requirePermission';
import { seedDefaultPermissionSets } from './seed';

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

describe('isUserActive / loadUserPermissions (deactivation revokes)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let otherTenantId: string;
  let adminSetId: string;

  async function createUser(opts: { email: string; deactivated?: boolean; tenant?: string }) {
    const id = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id,
      name: 'U',
      email: opts.email,
      tenantId: opts.tenant ?? tenantId,
      permissionSetId: adminSetId,
      ...(opts.deactivated === true ? { deactivatedAt: new Date() } : {}),
    });
    return id;
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    otherTenantId = newId();
    await db.insert(schema.tenants).values([
      { id: tenantId, name: 'Acme', slug: 'acme' },
      { id: otherTenantId, name: 'Other', slug: 'other' },
    ]);
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminSetId = seeded.administrator;
  });

  afterEach(async () => {
    await client.close();
  });

  it('SEC-D01: an active user is active', async () => {
    const id = await createUser({ email: 'a@x.test' });
    expect(await isUserActive(db as unknown as Database, tenantId, id)).toBe(true);
  });

  it('SEC-D02: a deactivated user is NOT active', async () => {
    const id = await createUser({ email: 'b@x.test', deactivated: true });
    expect(await isUserActive(db as unknown as Database, tenantId, id)).toBe(false);
  });

  it('SEC-D03: a missing user is not active, and a cross-tenant user is not active in the wrong tenant', async () => {
    expect(await isUserActive(db as unknown as Database, tenantId, `usr_${newId()}`)).toBe(false);
    const foreign = await createUser({ email: 'c@x.test', tenant: otherTenantId });
    expect(await isUserActive(db as unknown as Database, tenantId, foreign)).toBe(false);
  });

  it('SEC-D04: a deactivated administrator holds NO permissions', async () => {
    const id = await createUser({ email: 'd@x.test' });
    // Active: the Administrator set carries org.settings.
    const before = await loadUserPermissions(db as unknown as Database, tenantId, id);
    expect(before).toContain('org.settings');

    await db.update(schema.user).set({ deactivatedAt: new Date() }).where(eq(schema.user.id, id));

    const after = await loadUserPermissions(db as unknown as Database, tenantId, id);
    expect(after).toEqual([]);
  });

  it('SEC-D05: reactivating restores permissions', async () => {
    const id = await createUser({ email: 'e@x.test', deactivated: true });
    expect(await loadUserPermissions(db as unknown as Database, tenantId, id)).toEqual([]);

    await db.update(schema.user).set({ deactivatedAt: null }).where(eq(schema.user.id, id));

    expect(await isUserActive(db as unknown as Database, tenantId, id)).toBe(true);
    expect(await loadUserPermissions(db as unknown as Database, tenantId, id)).toContain(
      'org.settings',
    );
  });
});

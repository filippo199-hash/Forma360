import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { countAdmins, wouldDropBelowMinAdmins } from './admins';
import { seedDefaultPermissionSets } from './seed';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'db', 'migrations');
const MIGRATION_FILES = ['0000_initial.sql', '0001_auth.sql', '0002_permissions.sql'];

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  for (const file of MIGRATION_FILES) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return { client, db };
}

describe('countAdmins / wouldDropBelowMinAdmins (S-E02 last-admin guard)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminSetId: string;
  let managerSetId: string;
  let standardSetId: string;

  async function createUser(opts: {
    id?: string;
    email: string;
    permissionSetId: string;
    deactivated?: boolean;
  }): Promise<string> {
    const id = opts.id ?? `usr_${newId()}`;
    await db.insert(schema.user).values({
      id,
      name: 'U',
      email: opts.email,
      tenantId,
      permissionSetId: opts.permissionSetId,
      ...(opts.deactivated === true ? { deactivatedAt: new Date() } : {}),
    });
    return id;
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminSetId = seeded.administrator;
    managerSetId = seeded.manager;
    standardSetId = seeded.standard;
  });

  afterEach(async () => {
    await client.close();
  });

  it('returns 0 for a tenant with no users', async () => {
    expect(await countAdmins(db as unknown as Database, tenantId)).toBe(0);
  });

  it('counts only users whose permission set contains org.settings', async () => {
    await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    await createUser({ email: 'm@acme.test', permissionSetId: managerSetId });
    await createUser({ email: 's@acme.test', permissionSetId: standardSetId });
    expect(await countAdmins(db as unknown as Database, tenantId)).toBe(1);
  });

  it('ignores deactivated admins', async () => {
    await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    await createUser({
      email: 'old-admin@acme.test',
      permissionSetId: adminSetId,
      deactivated: true,
    });
    expect(await countAdmins(db as unknown as Database, tenantId)).toBe(1);
  });

  it('wouldDropBelowMinAdmins: true when the only admin tries to downgrade', async () => {
    const adminUserId = await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    const dropped = await wouldDropBelowMinAdmins(db as unknown as Database, {
      tenantId,
      targetUserId: adminUserId,
      afterPermissions: ['users.view'], // no org.settings
    });
    expect(dropped).toBe(true);
  });

  it('wouldDropBelowMinAdmins: false when another admin exists', async () => {
    const firstAdminId = await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    await createUser({ email: 'b@acme.test', permissionSetId: adminSetId });

    const dropped = await wouldDropBelowMinAdmins(db as unknown as Database, {
      tenantId,
      targetUserId: firstAdminId,
      afterPermissions: ['users.view'],
    });
    expect(dropped).toBe(false);
  });

  it('wouldDropBelowMinAdmins: true when the last admin is being deactivated (afterPermissions=null)', async () => {
    const adminUserId = await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    const dropped = await wouldDropBelowMinAdmins(db as unknown as Database, {
      tenantId,
      targetUserId: adminUserId,
      afterPermissions: null,
    });
    expect(dropped).toBe(true);
  });

  it('wouldDropBelowMinAdmins: false when a non-admin is being deactivated', async () => {
    await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    const standardUserId = await createUser({
      email: 's@acme.test',
      permissionSetId: standardSetId,
    });
    const dropped = await wouldDropBelowMinAdmins(db as unknown as Database, {
      tenantId,
      targetUserId: standardUserId,
      afterPermissions: null,
    });
    expect(dropped).toBe(false);
  });

  it('respects the min parameter — min: 2 flags a drop from 2 admins to 1', async () => {
    const firstAdminId = await createUser({ email: 'a@acme.test', permissionSetId: adminSetId });
    await createUser({ email: 'b@acme.test', permissionSetId: adminSetId });

    const dropped = await wouldDropBelowMinAdmins(db as unknown as Database, {
      tenantId,
      targetUserId: firstAdminId,
      afterPermissions: null,
      min: 2,
    });
    expect(dropped).toBe(true);
  });
});

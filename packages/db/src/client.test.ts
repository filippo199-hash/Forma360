/**
 * Integration test for the tenants table.
 *
 * Uses @electric-sql/pglite (in-memory Postgres compiled to WASM) so the test
 * suite runs everywhere — CI, a plane, a laptop with Docker off. The runtime
 * client (`node-postgres` pool) is covered by Docker-backed integration tests
 * introduced in PR 11.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { newId } from '@forma360/shared/id';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from './schema/index';
import { tenants } from './schema/tenants';
import { user } from './schema/auth';
import { permissionSets } from './schema/permissions';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const MIGRATION_FILES = ['0000_initial.sql', '0001_auth.sql', '0002_permissions.sql'];

async function bootDb(): Promise<{
  db: PgliteDatabase<typeof schema>;
  client: PGlite;
}> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  for (const file of MIGRATION_FILES) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    const statements = sqlText
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await client.exec(stmt);
    }
  }
  return { db, client };
}

describe('tenants table (pglite integration)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
  });

  afterEach(async () => {
    await client.close();
  });

  it('applies the 0000_initial migration', async () => {
    const result = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const tableNames = result.rows.map((r) => r.table_name);
    expect(tableNames).toContain('tenants');
  });

  it('round-trips an insert and select', async () => {
    const id = newId();
    const [inserted] = await db
      .insert(tenants)
      .values({ id, name: 'Acme Safety Ltd', slug: 'acme-safety' })
      .returning();

    expect(inserted).toBeDefined();
    expect(inserted?.id).toBe(id);
    expect(inserted?.name).toBe('Acme Safety Ltd');
    expect(inserted?.slug).toBe('acme-safety');
    expect(inserted?.createdAt).toBeInstanceOf(Date);
    expect(inserted?.updatedAt).toBeInstanceOf(Date);
    expect(inserted?.archivedAt).toBeNull();

    const fetched = await db.select().from(tenants).where(eq(tenants.id, id));
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.id).toBe(id);
  });

  it('enforces the slug unique constraint', async () => {
    await db.insert(tenants).values({ id: newId(), name: 'A', slug: 'duplicate' });
    await expect(
      db.insert(tenants).values({ id: newId(), name: 'B', slug: 'duplicate' }),
    ).rejects.toThrow();
  });

  it('allows archivedAt to be null (active) or a Date (archived)', async () => {
    const activeId = newId();
    const archivedId = newId();
    await db.insert(tenants).values([
      { id: activeId, name: 'Active', slug: 'active' },
      { id: archivedId, name: 'Archived', slug: 'archived', archivedAt: new Date() },
    ]);

    const active = await db.select().from(tenants).where(eq(tenants.id, activeId));
    const archived = await db.select().from(tenants).where(eq(tenants.id, archivedId));

    expect(active[0]?.archivedAt).toBeNull();
    expect(archived[0]?.archivedAt).toBeInstanceOf(Date);
  });
});

describe('auth schema (pglite integration)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
  });

  afterEach(async () => {
    await client.close();
  });

  /**
   * Seeds a tenant + a single permission set and returns the ids. Keeps
   * the individual tests focused on user semantics rather than the
   * permission-set foreign-key ritual.
   */
  async function seedTenantAndPermissionSet(): Promise<{
    tenantId: string;
    permissionSetId: string;
  }> {
    const tenantId = newId();
    await db.insert(tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const permissionSetId = newId();
    await db.insert(permissionSets).values({
      id: permissionSetId,
      tenantId,
      name: 'Administrator',
      permissions: ['org.settings'],
      isSystem: true,
    });
    return { tenantId, permissionSetId };
  }

  it('creates every Phase 0 + Phase 1 table via the migrations', async () => {
    const result = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const tableNames = new Set(result.rows.map((r) => r.table_name));
    expect(tableNames).toEqual(
      new Set([
        'tenants',
        'permission_sets',
        'user',
        'session',
        'account',
        'verification',
        'two_factor',
      ]),
    );
  });

  it('installs the user.tenant_id -> tenants.id FK with ON DELETE RESTRICT', async () => {
    const result = await client.query<{
      constraint_name: string;
      delete_rule: string;
    }>(
      `SELECT tc.constraint_name, rc.delete_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.referential_constraints rc
           ON tc.constraint_name = rc.constraint_name
        WHERE tc.table_name = 'user'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND tc.constraint_name LIKE '%tenant%'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.delete_rule).toBe('RESTRICT');
  });

  it('rejects a user insert referencing a non-existent tenant', async () => {
    const { permissionSetId } = await seedTenantAndPermissionSet();
    await expect(
      db.insert(user).values({
        id: 'usr_nonexistent',
        name: 'Orphan',
        email: 'orphan@example.com',
        tenantId: 'tenant-does-not-exist',
        permissionSetId,
      }),
    ).rejects.toThrow();
  });

  it('round-trips a user row linked to a real tenant', async () => {
    const { tenantId, permissionSetId } = await seedTenantAndPermissionSet();

    const userId = 'usr_' + newId().toLowerCase();
    await db.insert(user).values({
      id: userId,
      name: 'Alice',
      email: 'alice@acme.test',
      tenantId,
      permissionSetId,
    });

    const fetched = await db.select().from(user).where(eq(user.id, userId));
    expect(fetched).toHaveLength(1);
    expect(fetched[0]?.tenantId).toBe(tenantId);
    expect(fetched[0]?.permissionSetId).toBe(permissionSetId);
    expect(fetched[0]?.emailVerified).toBe(false);
    expect(fetched[0]?.twoFactorEnabled).toBe(false);
    expect(fetched[0]?.deactivatedAt).toBeNull();
  });

  it('enforces email uniqueness on user', async () => {
    const { tenantId, permissionSetId } = await seedTenantAndPermissionSet();

    await db.insert(user).values({
      id: 'usr_1',
      name: 'A',
      email: 'dup@acme.test',
      tenantId,
      permissionSetId,
    });
    await expect(
      db.insert(user).values({
        id: 'usr_2',
        name: 'B',
        email: 'dup@acme.test',
        tenantId,
        permissionSetId,
      }),
    ).rejects.toThrow();
  });

  it('refuses to hard-delete a tenant referenced by a user (RESTRICT)', async () => {
    const { tenantId, permissionSetId } = await seedTenantAndPermissionSet();
    await db.insert(user).values({
      id: 'usr_locked',
      name: 'Locked',
      email: 'locked@acme.test',
      tenantId,
      permissionSetId,
    });

    await expect(db.delete(tenants).where(eq(tenants.id, tenantId))).rejects.toThrow();

    // The tenant row must still be present — RESTRICT blocks the delete.
    const survivors = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(survivors).toHaveLength(1);
  });
});

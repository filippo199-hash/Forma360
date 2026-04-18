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
import { tenants } from './schema/tenants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = join(__dirname, '..', 'migrations', '0000_initial.sql');

async function bootDb(): Promise<{
  db: PgliteDatabase<{ tenants: typeof tenants }>;
  client: PGlite;
}> {
  const client = new PGlite();
  const db = drizzle(client, { schema: { tenants } });
  const sqlText = await readFile(MIGRATION_PATH, 'utf-8');
  // The migration file uses `--> statement-breakpoint` as a separator between
  // logical statements. For a single-statement migration like 0000_initial it
  // doesn't matter, but keep the split for future-proofing.
  const statements = sqlText
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await client.exec(stmt);
  }
  return { db, client };
}

describe('tenants table (pglite integration)', () => {
  let client: PGlite;
  let db: PgliteDatabase<{ tenants: typeof tenants }>;

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

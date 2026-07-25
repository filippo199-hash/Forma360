import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nextReferenceValue } from './reference-counter';

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

describe('nextReferenceValue', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
  });

  afterEach(async () => {
    await client.close();
  });

  it('increments sequentially, starting at 1', async () => {
    const database = db as unknown as Database;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      seen.push(await nextReferenceValue(database, tenantId, 'issue'));
    }
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps series independent', async () => {
    const database = db as unknown as Database;
    expect(await nextReferenceValue(database, tenantId, 'issue')).toBe(1);
    expect(await nextReferenceValue(database, tenantId, 'action')).toBe(1);
    expect(await nextReferenceValue(database, tenantId, 'issue')).toBe(2);
    expect(await nextReferenceValue(database, tenantId, 'action')).toBe(2);
  });

  it('never returns a duplicate under concurrent claims (the fix)', async () => {
    const database = db as unknown as Database;
    const results = await Promise.all(
      Array.from({ length: 20 }, () => nextReferenceValue(database, tenantId, 'action')),
    );
    // Atomic upsert → 20 concurrent claims yield 20 distinct values 1..20.
    expect(new Set(results).size).toBe(20);
    expect(Math.max(...results)).toBe(20);
  });

  it('is scoped per tenant', async () => {
    const database = db as unknown as Database;
    const other = newId();
    await db.insert(schema.tenants).values({ id: other, name: 'Beta', slug: 'beta' });
    expect(await nextReferenceValue(database, tenantId, 'issue')).toBe(1);
    expect(await nextReferenceValue(database, other, 'issue')).toBe(1);
    expect(await nextReferenceValue(database, tenantId, 'issue')).toBe(2);
  });
});

/**
 * Retention v1 tests (platform review PF-31).
 *
 * Edge cases:
 *   - RT-J01: notifications older than the tenant policy are deleted;
 *     younger rows and policy-less tenants are untouched
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRetentionSweep } from './retention-sweep';

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

const logger = createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
const NOW = new Date('2026-08-03T05:40:00Z');
const MONTH_MS = 31 * 86_400_000;

describe('retention-sweep (PF-31)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
  });
  afterEach(async () => {
    await client.close();
  });

  async function seedTenant(retentionMonths: number | null): Promise<string> {
    const id = newId();
    await db.insert(schema.tenants).values({
      id,
      name: 'T',
      slug: `t-${id}`,
      retentionMonths,
    });
    return id;
  }

  async function seedNotification(tenantId: string, ageMonths: number): Promise<string> {
    const id = newId();
    await db.insert(schema.notifications).values({
      id,
      tenantId,
      userId: `usr_${newId()}`,
      kind: 'test',
      title: 'old news',
      createdAt: new Date(NOW.getTime() - ageMonths * MONTH_MS),
    });
    return id;
  }

  it('RT-J01: trims per-tenant, respects policy-less tenants', async () => {
    const strict = await seedTenant(6);
    const lax = await seedTenant(null);
    const oldStrict = await seedNotification(strict, 8);
    const freshStrict = await seedNotification(strict, 1);
    const oldLax = await seedNotification(lax, 24);

    const result = await runRetentionSweep({ db: db as never, logger, now: () => NOW });
    expect(result.notificationsDeleted).toBe(1);

    const remaining = await db.select({ id: schema.notifications.id }).from(schema.notifications);
    const ids = remaining.map((r) => r.id);
    expect(ids).not.toContain(oldStrict);
    expect(ids).toContain(freshStrict);
    expect(ids).toContain(oldLax);
  });
});

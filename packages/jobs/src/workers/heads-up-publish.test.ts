/**
 * Unit tests for the scheduled Heads Up publisher (platform review PF-15).
 *
 * Edge cases:
 *   - HU-J01: a draft whose publishAt has arrived publishes with the
 *     stored recipient spec frozen (recipients materialised); future
 *     schedules and already-published notices are untouched; a second
 *     run is a no-op
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runHeadsUpPublish } from './heads-up-publish';

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
const NOW = new Date('2026-08-03T07:00:00Z');
const HOUR_MS = 3_600_000;

describe('heads-up-publish', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let permissionSetId: string;
  let authorId: string;
  let workerId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: `a-${tenantId}` });
    permissionSetId = newId();
    await db.insert(schema.permissionSets).values({
      id: permissionSetId,
      tenantId,
      name: 'Standard',
      permissions: ['headsUp.view'],
    });
    authorId = `usr_${newId()}`;
    workerId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: authorId,
        name: 'Ann Author',
        email: `ann-${tenantId}@acme.test`,
        tenantId,
        permissionSetId,
      },
      {
        id: workerId,
        name: 'Wes Worker',
        email: `wes-${tenantId}@acme.test`,
        tenantId,
        permissionSetId,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  async function seedHeadsUp(over: Partial<typeof schema.headsUps.$inferInsert>): Promise<string> {
    const id = newId();
    await db.insert(schema.headsUps).values({
      id,
      tenantId,
      title: over.title ?? 'Toolbox talk',
      description: 'Please read.',
      status: 'draft',
      createdByUserId: authorId,
      ...over,
    });
    return id;
  }

  it('HU-J01: publishes due drafts with frozen recipients; leaves the rest; idempotent', async () => {
    const due = await seedHeadsUp({
      publishAt: new Date(NOW.getTime() - HOUR_MS),
      recipientSpec: JSON.stringify({
        broadcastToAll: false,
        userIds: [workerId],
        groupIds: [],
        siteIds: [],
      }),
    });
    const future = await seedHeadsUp({ publishAt: new Date(NOW.getTime() + HOUR_MS) });
    const unscheduled = await seedHeadsUp({});

    const first = await runHeadsUpPublish({ db: db as never, logger, now: () => NOW });
    expect(first.published).toBe(1);

    const dueRow = await db.select().from(schema.headsUps).where(eq(schema.headsUps.id, due));
    expect(dueRow[0]?.status).toBe('published');
    const recipients = await db
      .select()
      .from(schema.headsUpRecipients)
      .where(eq(schema.headsUpRecipients.headsUpId, due));
    expect(recipients.map((r) => r.userId)).toEqual([workerId]);

    for (const id of [future, unscheduled]) {
      const row = await db.select().from(schema.headsUps).where(eq(schema.headsUps.id, id));
      expect(row[0]?.status).toBe('draft');
    }

    // Second run: the published notice no longer matches the draft filter.
    const second = await runHeadsUpPublish({ db: db as never, logger, now: () => NOW });
    expect(second.published).toBe(0);
  });
});

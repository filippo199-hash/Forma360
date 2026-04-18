/**
 * Unit tests for the schedule-materialise worker handler.
 *
 * Uses pglite + the real migrations so the schema assertions are
 * realistic. The BullMQ connection is stubbed — materialise only
 * enqueues reminder jobs (not every occurrence), so we validate the
 * stub was / wasn't called with the right shape.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { createLogger } from '@forma360/shared/logger';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@forma360/db/client';
import type { Job } from 'bullmq';
import { createScheduleMaterialiseHandler } from './schedule-materialise';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');
const MIGRATION_FILES = [
  '0000_initial.sql',
  '0001_auth.sql',
  '0002_permissions.sql',
  '0003_phase1_org_backbone.sql',
  '0004_phase2_templates_inspections.sql',
  '0005_phase2_inspections.sql',
  '0006_phase2_schedules.sql',
];

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

const silent = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

// Mock the enqueue helper so we can intercept reminder jobs without a
// live Redis. The materialise handler imports the helper lazily; we
// stub the module level export.
vi.mock('../enqueue', () => ({
  enqueue: vi.fn(async () => 'stub-job-id'),
}));

describe('schedule-materialise worker', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let templateId: string;
  let userId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    templateId = newId();
    userId = `usr_${newId()}`;
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    await db.insert(schema.templates).values({
      id: templateId,
      tenantId,
      name: 'T',
      createdBy: userId,
    });
    await db.insert(schema.user).values({
      id: userId,
      name: 'Alice',
      email: 'alice@acme.test',
      tenantId,
      permissionSetId: seeded.standard,
    });
  });

  afterEach(async () => {
    await client.close();
    vi.clearAllMocks();
  });

  function fakeJob(data: { tenantId: string; scheduleId: string }): Job<{
    tenantId: string;
    scheduleId: string;
  }> {
    return {
      id: 'job-1',
      queueName: 'forma360:schedule-materialise',
      data,
    } as unknown as Job<{ tenantId: string; scheduleId: string }>;
  }

  it('computes occurrences for a daily rrule over the 14-day window', async () => {
    const scheduleId = newId();
    // Anchor a week in the past so daily occurrences land inside the
    // forward window regardless of the test clock.
    const startAt = new Date('2026-04-11T00:00:00Z');
    const fakeNow = new Date('2026-04-18T00:00:00Z');
    await db.insert(schema.templateSchedules).values({
      id: scheduleId,
      tenantId,
      templateId,
      name: 'Daily',
      timezone: 'UTC',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      startAt,
      assigneeUserIds: [userId],
      assigneeGroupIds: [],
      siteIds: [],
      paused: false,
      createdBy: userId,
    });

    const handler = createScheduleMaterialiseHandler({
      db: db as unknown as Database,
      logger: silent(),
      connection: {} as never,
      now: () => fakeNow,
    });

    const result = await handler(fakeJob({ tenantId, scheduleId }));
    // 14 days of daily occurrences × 1 assignee == 14 rows (one per day).
    expect(result.created).toBe(14);

    const rows = await db
      .select()
      .from(schema.scheduledInspectionOccurrences)
      .where(eq(schema.scheduledInspectionOccurrences.scheduleId, scheduleId));
    expect(rows).toHaveLength(14);
    expect(rows.every((r) => r.assigneeUserId === userId)).toBe(true);
  });

  it('is idempotent — re-running creates zero new rows', async () => {
    const scheduleId = newId();
    const startAt = new Date('2026-04-11T00:00:00Z');
    const fakeNow = new Date('2026-04-18T00:00:00Z');
    await db.insert(schema.templateSchedules).values({
      id: scheduleId,
      tenantId,
      templateId,
      name: 'Daily',
      timezone: 'UTC',
      rrule: 'FREQ=DAILY;BYHOUR=9',
      startAt,
      assigneeUserIds: [userId],
      assigneeGroupIds: [],
      siteIds: [],
      paused: false,
      createdBy: userId,
    });

    const handler = createScheduleMaterialiseHandler({
      db: db as unknown as Database,
      logger: silent(),
      connection: {} as never,
      now: () => fakeNow,
    });

    const first = await handler(fakeJob({ tenantId, scheduleId }));
    const second = await handler(fakeJob({ tenantId, scheduleId }));
    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
  });

  it('skips paused schedules', async () => {
    const scheduleId = newId();
    await db.insert(schema.templateSchedules).values({
      id: scheduleId,
      tenantId,
      templateId,
      name: 'P',
      timezone: 'UTC',
      rrule: 'FREQ=DAILY',
      startAt: new Date('2026-04-11T00:00:00Z'),
      assigneeUserIds: [userId],
      assigneeGroupIds: [],
      siteIds: [],
      paused: true,
      createdBy: userId,
    });
    const handler = createScheduleMaterialiseHandler({
      db: db as unknown as Database,
      logger: silent(),
      connection: {} as never,
      now: () => new Date('2026-04-18T00:00:00Z'),
    });
    const result = await handler(fakeJob({ tenantId, scheduleId }));
    expect(result.created).toBe(0);
  });
});

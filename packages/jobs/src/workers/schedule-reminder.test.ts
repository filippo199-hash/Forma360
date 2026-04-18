/**
 * Unit tests for the schedule-reminder worker handler.
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
import { createScheduleReminderHandler } from './schedule-reminder';

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
  '0007_inspections_archived_at.sql',
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

describe('schedule-reminder worker', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let templateId: string;
  let scheduleId: string;
  let userId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    templateId = newId();
    scheduleId = newId();
    userId = `usr_${newId()}`;
    await db.insert(schema.tenants).values({ id: tenantId, name: 'A', slug: 'a' });
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
    await db.insert(schema.templateSchedules).values({
      id: scheduleId,
      tenantId,
      templateId,
      name: 'S',
      timezone: 'UTC',
      rrule: 'FREQ=DAILY',
      startAt: new Date(),
      assigneeUserIds: [userId],
      assigneeGroupIds: [],
      siteIds: [],
      paused: false,
      createdBy: userId,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  function fakeJob(data: { tenantId: string; occurrenceId: string }): Job<{
    tenantId: string;
    occurrenceId: string;
  }> {
    return {
      id: 'job-r',
      queueName: 'forma360:schedule-reminder',
      data,
    } as unknown as Job<{ tenantId: string; occurrenceId: string }>;
  }

  it('sends the reminder email and stamps reminderSentAt', async () => {
    const occurrenceId = newId();
    await db.insert(schema.scheduledInspectionOccurrences).values({
      id: occurrenceId,
      tenantId,
      scheduleId,
      templateId,
      occurrenceAt: new Date(Date.now() + 60 * 60 * 1000),
      assigneeUserId: userId,
      status: 'pending',
    });

    const sendEmail = vi.fn(async () => ({ delivery: 'console' as const }));
    const handler = createScheduleReminderHandler({
      db: db as unknown as Database,
      logger: silent(),
      sendEmail,
      appUrl: 'https://forma360.test',
    });

    const result = await handler(fakeJob({ tenantId, occurrenceId }));
    expect(result.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@acme.test',
        kind: 'schedule-reminder',
        userId,
      }),
    );

    const [row] = await db
      .select()
      .from(schema.scheduledInspectionOccurrences)
      .where(eq(schema.scheduledInspectionOccurrences.id, occurrenceId));
    expect(row?.reminderSentAt).toBeInstanceOf(Date);
  });

  it('skips when the reminder has already been sent', async () => {
    const occurrenceId = newId();
    await db.insert(schema.scheduledInspectionOccurrences).values({
      id: occurrenceId,
      tenantId,
      scheduleId,
      templateId,
      occurrenceAt: new Date(Date.now() + 60 * 60 * 1000),
      assigneeUserId: userId,
      status: 'pending',
      reminderSentAt: new Date(),
    });

    const sendEmail = vi.fn(async () => ({ delivery: 'console' as const }));
    const handler = createScheduleReminderHandler({
      db: db as unknown as Database,
      logger: silent(),
      sendEmail,
      appUrl: 'https://forma360.test',
    });

    const result = await handler(fakeJob({ tenantId, occurrenceId }));
    expect(result.sent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

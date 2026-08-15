/**
 * Unit tests for the schedule-reminder worker handler.
 */
import { readFile, readdir } from 'node:fs/promises';
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
/**
 * Every migration in the directory, in order.
 *
 * This used to be a CURATED list — the subset a given suite needed, for
 * speed. The cost was a manual chore CLAUDE.md had to document ("add the
 * next migration to that list"), and missing it left a table half-built:
 * Drizzle writes every column it knows about, so the first insert failed
 * with `column does not exist`, in a suite unrelated to the change that
 * caused it. Sixteen lists had drifted.
 *
 * Applying all of them costs about two seconds, which is not worth a
 * recurring footgun on a schema that changes every week. `MIG-L01` pins
 * that the lists and the ORM agree.
 */
async function migrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
}

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  for (const file of await migrationFiles()) {
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

  async function seedOccurrence(): Promise<string> {
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
    return occurrenceId;
  }

  function bellRows() {
    return db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
  }

  function makeHandler(sendEmail: ReturnType<typeof vi.fn>) {
    return createScheduleReminderHandler({
      db: db as unknown as Database,
      logger: silent(),
      sendEmail: sendEmail as unknown as Parameters<
        typeof createScheduleReminderHandler
      >[0]['sendEmail'],
      appUrl: 'https://forma360.test',
    });
  }

  it('NP-SR1: default prefs — email sent AND a schedule_reminder bell row lands', async () => {
    const occurrenceId = await seedOccurrence();
    const sendEmail = vi.fn(async () => ({ delivery: 'console' as const }));

    const result = await makeHandler(sendEmail)(fakeJob({ tenantId, occurrenceId }));
    expect(result.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const rows = await bellRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('schedule_reminder');
    expect(rows[0]?.title).toBe('T'); // the template's name
    expect(rows[0]?.href).toBe(`/inspections?upcoming=${occurrenceId}`);
  });

  it('NP-SR2: email:schedule_reminder muted — no email, bell row written, reminderSentAt still stamps', async () => {
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'email:schedule_reminder': false } })
      .where(eq(schema.user.id, userId));
    const occurrenceId = await seedOccurrence();
    const sendEmail = vi.fn(async () => ({ delivery: 'console' as const }));

    const result = await makeHandler(sendEmail)(fakeJob({ tenantId, occurrenceId }));
    expect(result.sent).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();

    // The bell row still lands…
    const rows = await bellRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('schedule_reminder');

    // …and so does the dedupe stamp: muted = handled, never re-queued.
    const [row] = await db
      .select()
      .from(schema.scheduledInspectionOccurrences)
      .where(eq(schema.scheduledInspectionOccurrences.id, occurrenceId));
    expect(row?.reminderSentAt).toBeInstanceOf(Date);
  });

  it('NP-SR3: inapp:schedule_reminder muted — email still sent, no bell row', async () => {
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'inapp:schedule_reminder': false } })
      .where(eq(schema.user.id, userId));
    const occurrenceId = await seedOccurrence();
    const sendEmail = vi.fn(async () => ({ delivery: 'console' as const }));

    const result = await makeHandler(sendEmail)(fakeJob({ tenantId, occurrenceId }));
    expect(result.sent).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await bellRows()).toHaveLength(0);
  });
});

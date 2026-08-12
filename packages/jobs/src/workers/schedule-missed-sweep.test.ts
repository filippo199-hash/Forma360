/**
 * Unit tests for the missed-occurrence sweep (platform review PF-3).
 *
 * Edge cases:
 *   - SCH-J01: pending occurrences past the grace window flip to
 *     'missed' and assignee + schedule owner get one email each
 *     (deduped when identical); within-grace and already-terminal
 *     occurrences are untouched; the sweep is idempotent
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
import { runScheduleMissedSweep, type MissedOccurrence } from './schedule-missed-sweep';

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
const NOW = new Date('2026-08-03T10:20:00Z');
const HOUR_MS = 3_600_000;

describe('schedule-missed-sweep', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let ownerId: string;
  let assigneeId: string;
  let templateId: string;
  let scheduleId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: `a-${tenantId}` });
    const permissionSetId = newId();
    await db.insert(schema.permissionSets).values({
      id: permissionSetId,
      tenantId,
      name: 'Standard',
      permissions: ['inspections.view'],
    });
    ownerId = `usr_${newId()}`;
    assigneeId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: ownerId,
        name: 'Olive Owner',
        email: `olive-${tenantId}@acme.test`,
        tenantId,
        permissionSetId,
      },
      {
        id: assigneeId,
        name: 'Ade Assignee',
        email: `ade-${tenantId}@acme.test`,
        tenantId,
        permissionSetId,
      },
    ]);
    templateId = newId();
    await db.insert(schema.templates).values({
      id: templateId,
      tenantId,
      name: 'Weekly walk',
      status: 'published',
      createdBy: ownerId,
    });
    scheduleId = newId();
    await db.insert(schema.templateSchedules).values({
      id: scheduleId,
      tenantId,
      templateId,
      name: 'Weekly walk',
      rrule: 'FREQ=WEEKLY',
      timezone: 'UTC',
      startAt: NOW,
      createdBy: ownerId,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  async function seedOccurrence(
    over: Partial<typeof schema.scheduledInspectionOccurrences.$inferInsert>,
  ): Promise<string> {
    const id = newId();
    await db.insert(schema.scheduledInspectionOccurrences).values({
      id,
      tenantId,
      scheduleId,
      templateId,
      assigneeUserId: assigneeId,
      occurrenceAt: over.occurrenceAt ?? NOW,
      status: 'pending',
      ...over,
    });
    return id;
  }

  it('SCH-J01: sweeps past-grace pending to missed, notifies assignee + owner, idempotent', async () => {
    const missedId = await seedOccurrence({
      occurrenceAt: new Date(NOW.getTime() - 30 * HOUR_MS),
    });
    const withinGrace = await seedOccurrence({
      occurrenceAt: new Date(NOW.getTime() - 2 * HOUR_MS),
    });
    const done = await seedOccurrence({
      occurrenceAt: new Date(NOW.getTime() - 40 * HOUR_MS),
      status: 'completed',
    });

    const sent: Array<{ to: string; missed: MissedOccurrence[] }> = [];
    const first = await runScheduleMissedSweep({
      db: db as never,
      logger,
      appUrl: 'https://app.test',
      notify: (r, missed) => {
        sent.push({ to: r.email, missed });
        return Promise.resolve();
      },
      now: () => NOW,
    });
    expect(first.swept).toBe(1);
    // Assignee + owner are different people → two emails.
    expect(sent.map((s) => s.to).sort()).toEqual(
      [`ade-${tenantId}@acme.test`, `olive-${tenantId}@acme.test`].sort(),
    );
    expect(sent[0]?.missed[0]?.templateName).toBe('Weekly walk');

    const swept = await db
      .select()
      .from(schema.scheduledInspectionOccurrences)
      .where(eq(schema.scheduledInspectionOccurrences.id, missedId));
    expect(swept[0]?.status).toBe('missed');
    for (const [id, expected] of [
      [withinGrace, 'pending'],
      [done, 'completed'],
    ] as const) {
      const row = await db
        .select()
        .from(schema.scheduledInspectionOccurrences)
        .where(eq(schema.scheduledInspectionOccurrences.id, id));
      expect(row[0]?.status).toBe(expected);
    }

    // Second run: nothing left to sweep.
    const second = await runScheduleMissedSweep({
      db: db as never,
      logger,
      appUrl: 'https://app.test',
      notify: () => Promise.resolve(),
      now: () => NOW,
    });
    expect(second.swept).toBe(0);
  });

  it('SCH-J02: per-channel prefs — muted email keeps the bell row; muted inapp keeps the email', async () => {
    // Assignee mutes the email channel; owner mutes the in-app channel.
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'email:schedule_missed': false } })
      .where(eq(schema.user.id, assigneeId));
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'inapp:schedule_missed': false } })
      .where(eq(schema.user.id, ownerId));
    await seedOccurrence({ occurrenceAt: new Date(NOW.getTime() - 30 * HOUR_MS) });

    const sent: Array<{ to: string; missed: MissedOccurrence[] }> = [];
    const result = await runScheduleMissedSweep({
      db: db as never,
      logger,
      appUrl: 'https://app.test',
      notify: (r, missed) => {
        sent.push({ to: r.email, missed });
        return Promise.resolve();
      },
      now: () => NOW,
    });
    expect(result.swept).toBe(1);
    // Only the owner (email unmuted) is emailed.
    expect(sent.map((s) => s.to)).toEqual([`olive-${tenantId}@acme.test`]);
    // Only the assignee (inapp unmuted) gets a bell row.
    const rows = await db.select().from(schema.notifications);
    expect(rows.map((r) => r.userId)).toEqual([assigneeId]);
    expect(rows[0]?.kind).toBe('schedule_missed');
  });
});

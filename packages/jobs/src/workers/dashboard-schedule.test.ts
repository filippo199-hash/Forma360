/**
 * Unit tests for the dashboard schedule workers (ADR 0018).
 *
 * Edge cases:
 *   - DH-J01: the tick enqueues ONE send for a due schedule (latest
 *     occurrence only — a catch-up after downtime is one email, not a
 *     backlog) and none when paused / dashboard draft or archived /
 *     not yet due / already covered by lastSentAt
 *   - DH-J02: the send emails every recipient with the PDF attached and
 *     stamps lastSentAt = occurrenceAt; re-running the same occurrence
 *     is a successful no-op; a mid-flight state change (unpublish)
 *     skips cleanly
 *   - DH-J03: a failing notify rethrows (BullMQ retries) and leaves
 *     lastSentAt unstamped — notify-then-stamp, the IN-A1 lesson
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DashboardScheduleSendPayload } from '../queues';
import { collectDueDashboardSends, runDashboardScheduleTick } from './dashboard-schedule-tick';
import {
  dashboardPdfFilename,
  runDashboardScheduleSend,
  type DashboardScheduleSendDeps,
} from './dashboard-schedule-send';

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
// A Saturday. 2026-08-01 (the weekly anchor below) is also a Saturday.
const NOW = new Date('2026-08-08T12:00:00.000Z');

describe('dashboard schedule workers', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let ownerId: string;

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({
      id: tenantId,
      name: 'Acme',
      slug: `a-${tenantId}`,
      settings: { plan: 'paid' },
    });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    ownerId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: ownerId,
      name: 'Olive Owner',
      email: `olive-${tenantId}@acme.test`,
      tenantId,
      permissionSetId: sets.administrator,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  async function seedDashboard(
    over: Partial<typeof schema.dashboards.$inferInsert> = {},
  ): Promise<string> {
    const id = newId();
    await db.insert(schema.dashboards).values({
      id,
      tenantId,
      ownerUserId: ownerId,
      title: 'Weekly safety overview',
      spec: {
        version: '1',
        widgets: [
          { id: 'open', kind: 'kpi', title: 'Open actions', source: 'actions', metric: 'open' },
        ],
      },
      status: 'published',
      ...over,
    });
    return id;
  }

  async function seedSchedule(
    dashboardId: string,
    over: Partial<typeof schema.dashboardSchedules.$inferInsert> = {},
  ): Promise<string> {
    const id = newId();
    await db.insert(schema.dashboardSchedules).values({
      id,
      tenantId,
      dashboardId,
      timezone: 'UTC',
      // Saturdays 07:00 — NOW is a Saturday 12:00, so today's occurrence
      // (07:00Z) sits inside the (now − 24h, now] window.
      rrule: 'FREQ=WEEKLY;BYDAY=SA;BYHOUR=7;BYMINUTE=0;BYSECOND=0',
      startAt: new Date('2026-08-01T07:00:00.000Z'),
      recipients: ['ops@client.example', 'qa@client.example'],
      createdBy: ownerId,
      ...over,
    });
    return id;
  }

  async function loadLastSentAt(scheduleId: string): Promise<Date | null> {
    const rows = await db
      .select({ lastSentAt: schema.dashboardSchedules.lastSentAt })
      .from(schema.dashboardSchedules)
      .where(eq(schema.dashboardSchedules.id, scheduleId));
    return rows[0]?.lastSentAt ?? null;
  }

  // ─── DH-J01 tick ──────────────────────────────────────────────────────

  it('DH-J01: enqueues one send for a due weekly schedule and none for the off states', async () => {
    const dueDashboard = await seedDashboard();
    const dueId = await seedSchedule(dueDashboard);

    // None of these may fire: paused, draft dashboard, archived
    // dashboard, startAt in the future, occurrence already covered by
    // the lastSentAt cursor.
    await seedSchedule(dueDashboard, { paused: true });
    const draftDashboard = await seedDashboard({ status: 'draft' });
    await seedSchedule(draftDashboard);
    const archivedDashboard = await seedDashboard({ status: 'archived', archivedAt: NOW });
    await seedSchedule(archivedDashboard);
    await seedSchedule(dueDashboard, { startAt: new Date('2026-08-15T07:00:00.000Z') });
    await seedSchedule(dueDashboard, { lastSentAt: new Date('2026-08-08T07:00:00.000Z') });
    // endAt before the occurrence — the walk is bounded by it.
    await seedSchedule(dueDashboard, { endAt: new Date('2026-08-05T00:00:00.000Z') });

    const sent: DashboardScheduleSendPayload[] = [];
    const result = await runDashboardScheduleTick({
      db: db as never,
      logger,
      now: () => NOW,
      enqueueSend: async (payload) => {
        sent.push(payload);
      },
    });

    expect(result.due).toBe(1);
    expect(sent).toEqual([
      { scheduleId: dueId, occurrenceAt: '2026-08-08T07:00:00.000Z' },
    ]);
  });

  it('DH-J01b: a catch-up window with several missed occurrences yields ONE send — the latest', async () => {
    const dashboardId = await seedDashboard();
    const scheduleId = await seedSchedule(dashboardId, {
      // Every hour on the hour; anchored well before the window.
      rrule: 'FREQ=HOURLY;BYMINUTE=0;BYSECOND=0',
      startAt: new Date('2026-08-01T00:00:00.000Z'),
    });

    const due = await collectDueDashboardSends(db as never, NOW);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      scheduleId,
      tenantId,
      // 23 occurrences sit inside (now − 24h, now]; only the newest fires.
      occurrenceAt: new Date('2026-08-08T12:00:00.000Z'),
    });
  });

  // ─── DH-J02 send ──────────────────────────────────────────────────────

  function sendDeps(over: Partial<DashboardScheduleSendDeps> = {}): DashboardScheduleSendDeps & {
    notified: Array<{ to: string; dashboardTitle: string; viewUrl: string; filename: string; bytes: Uint8Array }>;
  } {
    const notified: Array<{
      to: string;
      dashboardTitle: string;
      viewUrl: string;
      filename: string;
      bytes: Uint8Array;
    }> = [];
    return {
      notified,
      db: db as never,
      logger,
      appUrl: 'https://app.test',
      now: () => NOW,
      renderPdf: async () => ({ bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), stub: true }),
      notify: async (to, input) => {
        notified.push({
          to,
          dashboardTitle: input.dashboardTitle,
          viewUrl: input.viewUrl,
          filename: input.attachment.filename,
          bytes: input.attachment.content,
        });
      },
      ...over,
    };
  }

  it('DH-J02: emails every recipient with the PDF attached, stamps lastSentAt; a repeat is a no-op', async () => {
    const dashboardId = await seedDashboard();
    const scheduleId = await seedSchedule(dashboardId);
    const occurrenceAt = '2026-08-08T07:00:00.000Z';

    const deps = sendDeps();
    const result = await runDashboardScheduleSend(deps, { scheduleId, occurrenceAt });

    expect(result).toEqual({ sent: 2 });
    expect(deps.notified.map((n) => n.to)).toEqual(['ops@client.example', 'qa@client.example']);
    for (const n of deps.notified) {
      expect(n.dashboardTitle).toBe('Weekly safety overview');
      expect(n.filename).toBe('weekly-safety-overview.pdf');
      expect([...n.bytes]).toEqual([0x25, 0x50, 0x44, 0x46]);
      expect(n.viewUrl).toBe(`https://app.test/en/dashboards/${dashboardId}`);
    }
    expect(await loadLastSentAt(scheduleId)).toEqual(new Date(occurrenceAt));

    // Same occurrence again (a re-delivered job): successful no-op.
    const repeat = await runDashboardScheduleSend(sendDeps(), { scheduleId, occurrenceAt });
    expect(repeat).toEqual({ sent: 0, skipped: 'already-sent' });
  });

  it('DH-J02b: state changes between tick and send skip cleanly', async () => {
    const dashboardId = await seedDashboard();
    const scheduleId = await seedSchedule(dashboardId);
    const occurrenceAt = '2026-08-08T07:00:00.000Z';

    await db
      .update(schema.dashboards)
      .set({ status: 'draft' })
      .where(eq(schema.dashboards.id, dashboardId));
    const unpublished = await runDashboardScheduleSend(sendDeps(), { scheduleId, occurrenceAt });
    expect(unpublished).toEqual({ sent: 0, skipped: 'not-published' });

    await db
      .update(schema.dashboards)
      .set({ status: 'published' })
      .where(eq(schema.dashboards.id, dashboardId));
    await db
      .update(schema.dashboardSchedules)
      .set({ paused: true })
      .where(eq(schema.dashboardSchedules.id, scheduleId));
    const paused = await runDashboardScheduleSend(sendDeps(), { scheduleId, occurrenceAt });
    expect(paused).toEqual({ sent: 0, skipped: 'paused' });

    const missing = await runDashboardScheduleSend(sendDeps(), {
      scheduleId: newId(),
      occurrenceAt,
    });
    expect(missing).toEqual({ sent: 0, skipped: 'missing' });
    expect(await loadLastSentAt(scheduleId)).toBeNull();
  });

  // ─── DH-J03 notify-then-stamp ─────────────────────────────────────────

  it('DH-J03: a failing notify rethrows and leaves lastSentAt unstamped', async () => {
    const dashboardId = await seedDashboard();
    const scheduleId = await seedSchedule(dashboardId);
    const occurrenceAt = '2026-08-08T07:00:00.000Z';

    const deps = sendDeps({
      notify: async () => {
        throw new Error('smtp down');
      },
    });
    await expect(
      runDashboardScheduleSend(deps, { scheduleId, occurrenceAt }),
    ).rejects.toThrow('smtp down');

    // The stamp never ran — the next tick / BullMQ retry still owes
    // this occurrence.
    expect(await loadLastSentAt(scheduleId)).toBeNull();
  });

  it('names the attachment from the title, with a safe fallback', () => {
    expect(dashboardPdfFilename('Weekly safety overview')).toBe('weekly-safety-overview.pdf');
    expect(dashboardPdfFilename('***')).toBe('dashboard.pdf');
  });
});

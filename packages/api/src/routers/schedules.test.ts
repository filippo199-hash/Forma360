/**
 * Integration tests for the schedules router (Phase 2 PR 32).
 *
 * Covers:
 *   - CRUD round-trip
 *   - RRULE validation rejects garbage
 *   - At-least-one-assignee guard
 *   - Archive-template → all schedules paused
 *   - Pause / resume flips the flag
 *   - materialiseNow routes through ctx.enqueue
 *   - listUpcoming returns only current-user pending occurrences in window
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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { createTestContext, type Context } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';

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

const createCaller = createCallerFactory(appRouter);
const silent = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

describe('schedules router (Phase 2 PR 32)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let enqueueCalls: Array<{ name: string; payload: unknown }>;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silent(),
      auth: { userId, email: 'a@x', tenantId: tenantId as never },
      enqueue: (name: string, payload: unknown) => {
        enqueueCalls.push({ name, payload });
      },
    });
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    enqueueCalls = [];
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminUserId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Alice',
      email: 'alice@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  async function createTemplate(
    caller: ReturnType<typeof createCaller>,
    name = 'T',
  ): Promise<string> {
    const { templateId } = await caller.templates.create({ name });
    return templateId;
  }

  describe('CRUD', () => {
    it('creates, lists, gets, updates, deletes a schedule', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const templateId = await createTemplate(caller, 'Daily');

      const { scheduleId } = await caller.schedules.create({
        templateId,
        name: 'Daily 9am',
        timezone: 'UTC',
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        startAt: new Date('2026-05-01T00:00:00Z').toISOString(),
        endAt: null,
        assigneeUserIds: [adminUserId],
        assigneeGroupIds: [],
        siteIds: [],
        reminderMinutesBefore: 60,
      });
      expect(scheduleId).toHaveLength(26);

      const all = await caller.schedules.list({});
      expect(all).toHaveLength(1);
      expect(all[0]?.name).toBe('Daily 9am');

      const detail = await caller.schedules.get({ scheduleId });
      expect(detail.schedule.name).toBe('Daily 9am');
      expect(detail.upcomingPreview.length).toBeGreaterThan(0);

      await caller.schedules.update({
        scheduleId,
        name: 'Daily 10am',
        timezone: 'UTC',
        rrule: 'FREQ=DAILY;BYHOUR=10',
        startAt: new Date('2026-05-01T00:00:00Z').toISOString(),
        endAt: null,
        assigneeUserIds: [adminUserId],
        assigneeGroupIds: [],
        siteIds: [],
        reminderMinutesBefore: null,
      });
      const after = await caller.schedules.get({ scheduleId });
      expect(after.schedule.name).toBe('Daily 10am');
      expect(after.schedule.reminderMinutesBefore).toBeNull();

      await caller.schedules.delete({ scheduleId });
      const empty = await caller.schedules.list({});
      expect(empty).toHaveLength(0);
    });
  });

  describe('calendarOccurrences (To-Do #2)', () => {
    it('computes occurrences in a month range and reinterprets in the schedule timezone', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const templateId = await createTemplate(caller, 'Cal');

      await caller.schedules.create({
        templateId,
        name: 'Weekly Mon 9am London',
        timezone: 'Europe/London',
        rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
        startAt: new Date('2026-06-01T00:00:00Z').toISOString(),
        endAt: null,
        assigneeUserIds: [adminUserId],
        assigneeGroupIds: [],
        siteIds: [],
        reminderMinutesBefore: 60,
      });

      const res = await caller.schedules.calendarOccurrences({
        from: new Date('2026-06-01T00:00:00Z').toISOString(),
        to: new Date('2026-07-01T00:00:00Z').toISOString(),
        siteIds: [],
        groupIds: [],
        userIds: [],
      });

      // Mondays in June 2026: 1, 8, 15, 22, 29.
      expect(res.occurrences.length).toBe(5);
      // 09:00 Europe/London in summer (BST) is 08:00Z.
      expect(res.occurrences[0]?.occurrenceAt).toContain('T08:00:00');
      expect(res.occurrences[0]?.timezone).toBe('Europe/London');
    });

    it('filters by assigned user', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const templateId = await createTemplate(caller, 'CalFilter');
      await caller.schedules.create({
        templateId,
        name: 'Mine',
        timezone: 'UTC',
        rrule: 'FREQ=DAILY;BYHOUR=9',
        startAt: new Date('2026-06-01T00:00:00Z').toISOString(),
        endAt: null,
        assigneeUserIds: [adminUserId],
        assigneeGroupIds: [],
        siteIds: [],
        reminderMinutesBefore: null,
      });

      const mine = await caller.schedules.calendarOccurrences({
        from: new Date('2026-06-01T00:00:00Z').toISOString(),
        to: new Date('2026-06-04T00:00:00Z').toISOString(),
        siteIds: [],
        groupIds: [],
        userIds: [adminUserId],
      });
      expect(mine.occurrences.length).toBeGreaterThan(0);

      const other = await caller.schedules.calendarOccurrences({
        from: new Date('2026-06-01T00:00:00Z').toISOString(),
        to: new Date('2026-06-04T00:00:00Z').toISOString(),
        siteIds: [],
        groupIds: [],
        userIds: ['usr_nonexistent'],
      });
      expect(other.occurrences.length).toBe(0);
    });
  });

  describe('validation', () => {
    it('rejects an invalid rrule', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const templateId = await createTemplate(caller);
      await expect(
        caller.schedules.create({
          templateId,
          name: 'bad',
          timezone: 'UTC',
          rrule: 'NOT A REAL RRULE',
          startAt: new Date().toISOString(),
          endAt: null,
          assigneeUserIds: [adminUserId],
          assigneeGroupIds: [],
          siteIds: [],
          reminderMinutesBefore: null,
        }),
      ).rejects.toThrow(/rrule|Invalid/i);
    });

    it('rejects when no assignee is provided', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const templateId = await createTemplate(caller);
      await expect(
        caller.schedules.create({
          templateId,
          name: 'noassignee',
          timezone: 'UTC',
          rrule: 'FREQ=DAILY',
          startAt: new Date().toISOString(),
          endAt: null,
          assigneeUserIds: [],
          assigneeGroupIds: [],
          siteIds: [],
          reminderMinutesBefore: null,
        }),
      ).rejects.toThrow(/no-assignees/);
    });

    it('accepts a schedule whose only audience is a site', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const templateId = await createTemplate(caller);

      // Create a site directly — the sites router would also do this but
      // we want to keep the test tight on the schedules surface.
      const siteId = newId();
      await db.insert(schema.sites).values({
        id: siteId,
        tenantId,
        name: 'Site only',
        parentId: null,
        depth: 0,
        path: '',
      });

      const { scheduleId } = await caller.schedules.create({
        templateId,
        name: 'site-only',
        timezone: 'UTC',
        rrule: 'FREQ=DAILY',
        startAt: new Date('2026-05-01T00:00:00Z').toISOString(),
        endAt: null,
        assigneeUserIds: [],
        assigneeGroupIds: [],
        siteIds: [siteId],
        reminderMinutesBefore: null,
      });
      expect(scheduleId).toHaveLength(26);

      // list({ siteId }) filters via jsonb containment on siteIds.
      const filtered = await caller.schedules.list({ siteId });
      expect(filtered.map((r) => r.id)).toContain(scheduleId);
      const other = await caller.schedules.list({ siteId: newId() });
      expect(other.map((r) => r.id)).not.toContain(scheduleId);
    });
  });

  describe('pause / resume / archive', () => {
    it('pause and resume flip the flag', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const templateId = await createTemplate(caller);
      const { scheduleId } = await caller.schedules.create({
        templateId,
        name: 'x',
        timezone: 'UTC',
        rrule: 'FREQ=DAILY',
        startAt: new Date().toISOString(),
        endAt: null,
        assigneeUserIds: [adminUserId],
        assigneeGroupIds: [],
        siteIds: [],
        reminderMinutesBefore: null,
      });

      await caller.schedules.pause({ scheduleId });
      let row = (await caller.schedules.get({ scheduleId })).schedule;
      expect(row.paused).toBe(true);

      await caller.schedules.resume({ scheduleId });
      row = (await caller.schedules.get({ scheduleId })).schedule;
      expect(row.paused).toBe(false);
    });

    it('archiving the template pauses every schedule for it (T-E05)', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const templateId = await createTemplate(caller, 'Arch');
      const a = await caller.schedules.create({
        templateId,
        name: 'a',
        timezone: 'UTC',
        rrule: 'FREQ=DAILY',
        startAt: new Date().toISOString(),
        endAt: null,
        assigneeUserIds: [adminUserId],
        assigneeGroupIds: [],
        siteIds: [],
        reminderMinutesBefore: null,
      });
      const b = await caller.schedules.create({
        templateId,
        name: 'b',
        timezone: 'UTC',
        rrule: 'FREQ=WEEKLY',
        startAt: new Date().toISOString(),
        endAt: null,
        assigneeUserIds: [adminUserId],
        assigneeGroupIds: [],
        siteIds: [],
        reminderMinutesBefore: null,
      });

      await caller.templates.archive({ templateId });

      const rows = await db
        .select()
        .from(schema.templateSchedules)
        .where(eq(schema.templateSchedules.tenantId, tenantId));
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.paused)).toBe(true);
      // sanity
      expect(rows.map((r) => r.id).sort()).toEqual([a.scheduleId, b.scheduleId].sort());
    });
  });

  describe('materialiseNow', () => {
    it('routes through ctx.enqueue with the correct payload', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const templateId = await createTemplate(caller);
      const { scheduleId } = await caller.schedules.create({
        templateId,
        name: 'x',
        timezone: 'UTC',
        rrule: 'FREQ=DAILY',
        startAt: new Date().toISOString(),
        endAt: null,
        assigneeUserIds: [adminUserId],
        assigneeGroupIds: [],
        siteIds: [],
        reminderMinutesBefore: null,
      });
      enqueueCalls.length = 0;
      await caller.schedules.materialiseNow({ scheduleId });
      expect(enqueueCalls).toHaveLength(1);
      expect(enqueueCalls[0]?.name).toBe('forma360:schedule-materialise');
      expect(enqueueCalls[0]?.payload).toMatchObject({ tenantId, scheduleId });
    });
  });

  describe('listUpcoming', () => {
    it('returns only the current user pending occurrences within the window', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const templateId = await createTemplate(caller);
      const { scheduleId } = await caller.schedules.create({
        templateId,
        name: 'x',
        timezone: 'UTC',
        rrule: 'FREQ=DAILY',
        startAt: new Date().toISOString(),
        endAt: null,
        assigneeUserIds: [adminUserId],
        assigneeGroupIds: [],
        siteIds: [],
        reminderMinutesBefore: null,
      });

      // Seed some occurrences directly.
      const now = Date.now();
      const otherUserId = `usr_${newId()}`;
      const seededAgain = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
      await db.insert(schema.user).values({
        id: otherUserId,
        name: 'Bob',
        email: 'bob@acme.test',
        tenantId,
        permissionSetId: seededAgain.standard,
      });

      await db.insert(schema.scheduledInspectionOccurrences).values([
        {
          id: newId(),
          tenantId,
          scheduleId,
          templateId,
          occurrenceAt: new Date(now + 60 * 60 * 1000),
          assigneeUserId: adminUserId,
          status: 'pending',
        },
        {
          id: newId(),
          tenantId,
          scheduleId,
          templateId,
          occurrenceAt: new Date(now + 2 * 60 * 60 * 1000),
          assigneeUserId: otherUserId,
          status: 'pending',
        },
        {
          id: newId(),
          tenantId,
          scheduleId,
          templateId,
          occurrenceAt: new Date(now + 3 * 60 * 60 * 1000),
          assigneeUserId: adminUserId,
          status: 'completed',
        },
        {
          id: newId(),
          tenantId,
          scheduleId,
          templateId,
          occurrenceAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
          assigneeUserId: adminUserId,
          status: 'pending',
        },
      ]);

      const mine = await caller.schedules.listUpcoming({});
      expect(mine).toHaveLength(1);
      expect(mine[0]?.status).toBe('pending');
    });
  });
});

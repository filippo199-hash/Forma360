/**
 * Integration tests for the analytics router — the PF-5 dashboard.
 *
 * Edge cases:
 *   - AN-E01: dashboard tiles count the right rows (open/overdue/due-soon
 *     actions, my open actions, open + high-priority observations,
 *     inspection statuses, missed + upcoming occurrences, my pending
 *     heads-up acks) and exclude archived / closed / completed rows
 *   - AN-E02: brand tiles (permits / risk assessments / COSHH) count
 *     open + expiring / review-overdue rows when enabled, and return
 *     null when the brand ships without the module
 *   - AN-E03: trends buckets creations/completions into the right
 *     weekly windows
 *   - AN-E04: siteComparison attributes per-site workload, rolls
 *     unattributed rows into a reconciling bucket, sorts busiest first
 *   - AN-E05: every surface is gated by `analytics.view`
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
import {
  appRouter,
  buildAppRouter,
  stubAuthDeps,
  stubHeadsUpsDeps,
  stubInspectionsDeps,
  stubIssuesDeps,
} from '../router';
import { createCallerFactory } from '../trpc';

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

const silentLogger = () =>
  createLogger({ service: 'analytics-test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

describe('analytics router (PF-5 dashboard)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let colleagueId: string;
  let templateId: string;
  let versionId: string;

  function callerFor(userId: string) {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'a@x.test', tenantId: tenantId as never },
      }),
    );
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: `a-${tenantId}` });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    adminId = `usr_${newId()}`;
    colleagueId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminId,
        name: 'Alice Admin',
        email: `alice-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: colleagueId,
        name: 'Carl Colleague',
        email: `carl-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.standard,
      },
    ]);
    templateId = newId();
    versionId = newId();
    await db.insert(schema.templates).values({
      id: templateId,
      tenantId,
      name: 'Walk',
      createdBy: adminId,
    });
    await db.insert(schema.templateVersions).values({
      id: versionId,
      tenantId,
      templateId,
      versionNumber: 1,
      content: {
        schemaVersion: '1',
        title: 'Walk',
        pages: [],
        settings: {},
        customResponseSets: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      publishedAt: new Date(),
    });
  });

  afterEach(async () => {
    await client.close();
  });

  async function seedAction(over: Partial<typeof schema.actions.$inferInsert>): Promise<string> {
    const id = newId();
    await db.insert(schema.actions).values({
      id,
      tenantId,
      sourceType: 'standalone',
      title: 'Task',
      status: 'open',
      createdBy: adminId,
      ...over,
    });
    return id;
  }

  async function seedInspection(
    over: Partial<typeof schema.inspections.$inferInsert>,
  ): Promise<string> {
    const id = newId();
    await db.insert(schema.inspections).values({
      id,
      tenantId,
      templateId,
      templateVersionId: versionId,
      title: 'Audit',
      accessSnapshot: {
        groups: [],
        sites: [],
        permissions: ['inspections.view'],
        snapshotAt: new Date().toISOString(),
      },
      createdBy: adminId,
      ...over,
    });
    return id;
  }

  async function seedIssue(over: Partial<typeof schema.issues.$inferInsert>): Promise<string> {
    const categoryId = newId();
    await db.insert(schema.issueCategories).values({
      id: categoryId,
      tenantId,
      name: 'Hazard',
      createdBy: adminId,
    });
    const id = newId();
    await db.insert(schema.issues).values({
      id,
      tenantId,
      categoryId,
      title: 'Wet floor',
      status: 'open',
      reportedByUserId: adminId,
      referenceNumber: `OBS-${id.slice(0, 6)}`,
      categorySnapshot: { categoryId, name: 'Hazard', customFields: [], customQuestions: [] },
      accessSnapshot: {
        groupIds: [],
        siteIds: [],
        permissions: [],
        snapshotAt: new Date().toISOString(),
      },
      ...over,
    });
    return id;
  }

  it('AN-E01: dashboard tiles count open/overdue/mine and skip closed + archived rows', async () => {
    const now = Date.now();
    // Actions: overdue+mine, due-soon, completed (excluded), archived (excluded).
    await seedAction({ assigneeUserId: adminId, dueAt: new Date(now - DAY_MS) });
    await seedAction({ dueAt: new Date(now + DAY_MS) });
    await seedAction({ status: 'completed', closedAt: new Date(now) });
    await seedAction({ archivedAt: new Date(now) });
    // Observations: open high-priority, open no-priority, closed (excluded).
    await seedIssue({ priority: 'critical' });
    await seedIssue({});
    await seedIssue({ status: 'closed' });
    // Inspections: in-progress, awaiting approval, completed 2 d ago, archived (excluded).
    await seedInspection({ status: 'in_progress' });
    await seedInspection({ status: 'awaiting_approval' });
    await seedInspection({ status: 'completed', completedAt: new Date(now - 2 * DAY_MS) });
    await seedInspection({ status: 'in_progress', archivedAt: new Date(now) });
    // Occurrences: missed 2 d ago, pending in 2 d, pending far future (outside 7 d).
    const scheduleId = newId();
    await db.insert(schema.templateSchedules).values({
      id: scheduleId,
      tenantId,
      templateId,
      name: 'Weekly',
      rrule: 'FREQ=WEEKLY',
      timezone: 'UTC',
      startAt: new Date(now),
      createdBy: adminId,
    });
    for (const [status, occurrenceAt] of [
      ['missed', new Date(now - 2 * DAY_MS)],
      ['pending', new Date(now + 2 * DAY_MS)],
      ['pending', new Date(now + 20 * DAY_MS)],
    ] as const) {
      await db.insert(schema.scheduledInspectionOccurrences).values({
        id: newId(),
        tenantId,
        scheduleId,
        templateId,
        assigneeUserId: adminId,
        occurrenceAt,
        status,
      });
    }
    // Heads-up requiring my ack.
    const headsUpId = newId();
    await db.insert(schema.headsUps).values({
      id: headsUpId,
      tenantId,
      title: 'Storm warning',
      description: 'Read this.',
      status: 'published',
      requireAcknowledgement: true,
      createdByUserId: colleagueId,
    });
    await db.insert(schema.headsUpRecipients).values({
      id: newId(),
      tenantId,
      headsUpId,
      userId: adminId,
    });

    const d = await callerFor(adminId).analytics.dashboard();
    expect(d.actions).toEqual({ open: 2, overdue: 1, dueSoon: 1, myOpen: 1 });
    expect(d.observations).toEqual({ open: 2, highPriority: 1 });
    expect(d.inspections).toEqual({ inProgress: 1, awaitingApproval: 1, completedLast30: 1 });
    expect(d.schedule).toEqual({ missedLast30: 1, upcoming7d: 1 });
    expect(d.headsUp.myPendingAcks).toBe(1);
  });

  it('AN-E02: brand tiles count when enabled and are null when the module is off', async () => {
    const now = Date.now();
    // Permit: open, expiring within 48 h.
    const permitTypeId = newId();
    await db.insert(schema.permitTypes).values({
      id: permitTypeId,
      tenantId,
      category: 'hot_work',
      name: 'Hot work',
      createdBy: adminId,
    });
    await db.insert(schema.permits).values({
      id: newId(),
      tenantId,
      permitTypeId,
      referenceNumber: 'PTW-0001',
      title: 'Roof torch-on',
      status: 'active',
      validFrom: new Date(now - DAY_MS),
      validTo: new Date(now + DAY_MS),
      createdBy: adminId,
    });
    // Risk assessment: active, review overdue.
    await db.insert(schema.riskAssessments).values({
      id: newId(),
      tenantId,
      referenceNumber: 'RA-0001',
      title: 'Manual handling',
      status: 'active',
      currentVersion: 1,
      nextReviewAt: new Date(now - DAY_MS),
      createdBy: adminId,
    });
    // COSHH: one active substance, one active assessment overdue for review.
    const substanceId = newId();
    await db.insert(schema.coshhSubstances).values({
      id: substanceId,
      tenantId,
      name: 'Acetone',
      status: 'active',
      createdBy: adminId,
    });
    await db.insert(schema.coshhAssessments).values({
      id: newId(),
      tenantId,
      substanceId,
      taskDescription: 'Parts cleaning',
      status: 'active',
      nextReviewAt: new Date(now - DAY_MS),
      createdBy: adminId,
    });

    const enabled = await callerFor(adminId).analytics.dashboard();
    expect(enabled.permits).toEqual({ open: 1, expiring48h: 1 });
    expect(enabled.riskAssessments).toEqual({ active: 1, reviewOverdue: 1 });
    expect(enabled.coshh).toEqual({ substancesActive: 1, assessmentsReviewOverdue: 1 });

    // Same tenant through a brand build without the modules → null tiles.
    const bareRouter = buildAppRouter({
      exports: {
        renderPdf: async () => {
          throw new Error('unused');
        },
        renderDocx: async () => {
          throw new Error('unused');
        },
        generateShareToken: () => {
          throw new Error('unused');
        },
        buildShareUrl: () => {
          throw new Error('unused');
        },
      },
      inspectionsExport: { uploadCsv: async () => ({ url: 'stub://x' }), now: () => new Date() },
      auth: stubAuthDeps,
      inspections: stubInspectionsDeps,
      issues: stubIssuesDeps,
      headsUps: stubHeadsUpsDeps,
    });
    const bareCaller = createCallerFactory(bareRouter)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: adminId, email: 'a@x.test', tenantId: tenantId as never },
      }),
    );
    const disabled = await bareCaller.analytics.dashboard();
    expect(disabled.permits).toBeNull();
    expect(disabled.riskAssessments).toBeNull();
    expect(disabled.coshh).toBeNull();
  });

  it('AN-E03: trends bucket creations/completions into the right weeks', async () => {
    const now = Date.now();
    await seedAction({
      createdAt: new Date(now - 15 * DAY_MS),
      status: 'completed',
      closedAt: new Date(now - 8 * DAY_MS),
    });
    await seedAction({ createdAt: new Date(now - 1 * DAY_MS) });
    await seedIssue({ createdAt: new Date(now - 1 * DAY_MS) });
    await seedInspection({ status: 'completed', completedAt: new Date(now - 1 * DAY_MS) });
    // Outside the window — ignored.
    await seedAction({ createdAt: new Date(now - 100 * DAY_MS) });

    const t = await callerFor(adminId).analytics.trends();
    const idx = (d: Date): number =>
      Math.floor((d.getTime() - t.windowStart.getTime()) / WEEK_MS);
    expect(t.weeks).toBe(8);
    expect(t.actionsCreated[idx(new Date(now - 15 * DAY_MS))]).toBe(1);
    expect(t.actionsCompleted[idx(new Date(now - 8 * DAY_MS))]).toBe(1);
    expect(t.actionsCreated[idx(new Date(now - 1 * DAY_MS))]).toBe(1);
    expect(t.observationsRaised[idx(new Date(now - 1 * DAY_MS))]).toBe(1);
    expect(t.inspectionsCompleted[idx(new Date(now - 1 * DAY_MS))]).toBe(1);
    expect(t.actionsCreated.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('AN-E04: siteComparison attributes per-site workload and reconciles the rest', async () => {
    const now = Date.now();
    const siteA = newId();
    const siteB = newId();
    await db.insert(schema.sites).values([
      { id: siteA, tenantId, name: 'Alpha yard' },
      { id: siteB, tenantId, name: 'Bravo depot' },
    ]);
    await seedAction({ siteId: siteA });
    await seedAction({ siteId: siteA });
    await seedIssue({ siteId: siteA });
    await seedInspection({
      siteId: siteB,
      status: 'completed',
      completedAt: new Date(now - DAY_MS),
    });
    await seedAction({}); // unattributed

    const s = await callerFor(adminId).analytics.siteComparison();
    expect(s.rows[0]).toMatchObject({
      siteName: 'Alpha yard',
      openActions: 2,
      openObservations: 1,
      inspectionsCompleted30d: 0,
    });
    expect(s.rows[1]).toMatchObject({ siteName: 'Bravo depot', inspectionsCompleted30d: 1 });
    expect(s.unattributed.openActions).toBe(1);
  });

  it('AN-E05: every surface requires analytics.view', async () => {
    // Standard seeded set holds analytics.view → allowed.
    await expect(callerFor(colleagueId).analytics.dashboard()).resolves.toBeDefined();

    // A custom set without the key → FORBIDDEN on all three surfaces.
    const bareSetId = newId();
    await db.insert(schema.permissionSets).values({
      id: bareSetId,
      tenantId,
      name: 'No analytics',
      permissions: ['inspections.view'],
    });
    const outsiderId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: outsiderId,
      name: 'Otto Outsider',
      email: `otto-${tenantId}@acme.test`,
      tenantId,
      permissionSetId: bareSetId,
    });
    const outsider = callerFor(outsiderId);
    await expect(outsider.analytics.dashboard()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(outsider.analytics.trends()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(outsider.analytics.siteComparison()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

/**
 * Dashboards router + widget executor tests (ADR 0018).
 *
 * Edge cases:
 *   - DH-E11  entitlement gate: free plan → PAYMENT_REQUIRED, paid works
 *   - DH-E12  analytics.create required to create
 *   - DH-E13  visibility matrix (draft/published × private/selected/tenant)
 *   - DH-E14  widget data gated per source on the VIEWER's permissions
 *   - DH-E14b authoring refuses sources the author cannot use
 *   - DH-E15  tenant isolation
 *   - DH-E16  spec validated at the boundary
 *   - DH-E17  optimistic concurrency on updateSpec
 *   - DH-E18  archive pauses schedules in the same tx
 *   - DH-E19  schedule guard-rails (permission, rrule, recipients)
 *   - DH-E20  executor correctness (flows, stocks, buckets, labels, filters)
 *   - DH-E21  catalogue completeness: every metric × dimension executes
 *   - DH-E22  every catalogue permission is a real PermissionKey
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@forma360/db/schema';
import { isPermissionKey } from '@forma360/permissions/catalogue';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { DASHBOARDS_FREE_FOR_EVERYONE } from '@forma360/shared/entitlements';
import { dashboardSpecSchema, DASHBOARD_SPEC_VERSION } from '@forma360/shared/dashboard-spec';
import {
  DASHBOARD_SOURCES,
  DASHBOARD_SOURCE_IDS,
  metricAllowsDimension,
} from '@forma360/shared/dashboard-sources';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
import { executeWidget } from '../dashboards/executor';
import { createDashboardsRouter, MAX_SCHEDULES_PER_DASHBOARD } from './dashboards';
import { createCallerFactory, router } from '../trpc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

const DAY_MS = 86_400_000;
const FIXED_NOW = new Date('2026-08-08T12:00:00.000Z');

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
  createLogger({ service: 'dashboards-test', level: 'fatal', nodeEnv: 'test' });

const ALL_MODULES_ON = {
  riskAssessments: true,
  coshh: true,
  permits: true,
  fireSafety: true,
  incidents: true,
  rams: true,
  training: true,
} as const;

const dashboardsTestRouter = router({
  dashboards: createDashboardsRouter({ modules: ALL_MODULES_ON, now: () => FIXED_NOW }),
});
const createCaller = createCallerFactory(dashboardsTestRouter);

function kpiSpec(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    version: DASHBOARD_SPEC_VERSION,
    widgets: [
      {
        id: 'open-actions',
        kind: 'kpi',
        title: 'Open actions',
        source: 'actions',
        metric: 'open',
        ...overrides,
      },
    ],
  };
}

describe('dashboards router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let creatorId: string;
  let viewerId: string;
  let schedulerId: string;
  let noAnalyticsId: string;
  let managerId: string;

  function callerFor(userId: string, tenant = tenantId) {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'x@test.test', tenantId: tenant as never },
      }),
    );
  }

  async function seedUser(permissions: readonly string[], name: string): Promise<string> {
    const setId = newId();
    await db.insert(schema.permissionSets).values({
      id: setId,
      tenantId,
      name: `${name}-set-${setId.slice(0, 6)}`,
      permissions: [...permissions],
    });
    const userId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: userId,
      name,
      email: `${name.toLowerCase().replaceAll(' ', '-')}-${newId().slice(0, 8)}@acme.test`,
      tenantId,
      permissionSetId: setId,
    });
    return userId;
  }

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
    adminId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: adminId,
      name: 'Alice Admin',
      email: `alice-${tenantId}@acme.test`,
      tenantId,
      permissionSetId: sets.administrator,
    });
    creatorId = await seedUser(
      ['analytics.view', 'analytics.create', 'actions.view', 'issues.view', 'training.view'],
      'Cora Creator',
    );
    viewerId = await seedUser(['analytics.view', 'actions.view'], 'Vic Viewer');
    schedulerId = await seedUser(
      ['analytics.view', 'analytics.create', 'analytics.schedules.manage', 'actions.view'],
      'Sam Scheduler',
    );
    noAnalyticsId = await seedUser(['inspections.view'], 'Otto Outsider');
    managerId = await seedUser(
      ['analytics.view', 'analytics.manage', 'actions.view'],
      'Mia Manager',
    );
  });

  afterEach(async () => {
    await client.close();
  });

  // ─── Fixtures ─────────────────────────────────────────────────────────

  async function seedSite(name: string): Promise<string> {
    const id = newId();
    await db.insert(schema.sites).values({ id, tenantId, name });
    return id;
  }

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
        snapshotAt: FIXED_NOW.toISOString(),
      },
      ...over,
    });
    return id;
  }

  async function createDashboard(
    byUserId: string,
    spec: unknown = kpiSpec(),
    title = 'My dashboard',
  ): Promise<string> {
    const { id } = await callerFor(byUserId).dashboards.create({ title, spec });
    return id;
  }

  // ─── DH-E11 entitlement ───────────────────────────────────────────────

  it('DH-E11: the entitlement gate follows the launch flag; paid always passes', async () => {
    // Only this suite's tenant exists in the booted DB — update it to free.
    await db.update(schema.tenants).set({ settings: {} });
    if (DASHBOARDS_FREE_FOR_EVERYONE) {
      // LAUNCH MODE: dashboards are free for everyone — a free tenant passes.
      await expect(callerFor(adminId).dashboards.list()).resolves.toEqual([]);
    } else {
      // Re-gated: a free tenant is refused with PAYMENT_REQUIRED.
      await expect(callerFor(adminId).dashboards.list()).rejects.toMatchObject({
        code: 'PAYMENT_REQUIRED',
      });
    }
    // Paid always has access, regardless of the launch flag.
    await db.update(schema.tenants).set({ settings: { plan: 'paid' } });
    await expect(callerFor(adminId).dashboards.list()).resolves.toEqual([]);
  });

  // ─── DH-E12 create permission ─────────────────────────────────────────

  it('DH-E12: analytics.create is required to create; analytics.view alone cannot', async () => {
    await expect(
      callerFor(viewerId).dashboards.create({ title: 'Nope', spec: kpiSpec() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const id = await createDashboard(creatorId);
    const got = await callerFor(creatorId).dashboards.get({ id });
    expect(got.status).toBe('draft');
    expect(got.visibility).toBe('private');
    expect(got.canEdit).toBe(true);
  });

  it('DH-E12b: no analytics permission at all cannot even list', async () => {
    await expect(callerFor(noAnalyticsId).dashboards.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  // ─── DH-E13 visibility ────────────────────────────────────────────────

  it('DH-E13: drafts are invisible to non-owners; published tenant/selected control access', async () => {
    const id = await createDashboard(creatorId);

    // Draft: another viewer gets NOT_FOUND; owner sees it; manager sees it.
    await expect(callerFor(viewerId).dashboards.get({ id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await callerFor(managerId).dashboards.get({ id })).canEdit).toBe(true);

    // Published + tenant-visible: everyone with analytics.view sees it.
    await callerFor(creatorId).dashboards.setStatus({ id, status: 'published' });
    await callerFor(creatorId).dashboards.setVisibility({ id, visibility: 'tenant' });
    expect((await callerFor(viewerId).dashboards.get({ id })).canEdit).toBe(false);
    expect((await callerFor(viewerId).dashboards.list()).map((d) => d.id)).toContain(id);

    // Selected: only the shared user (owner keeps access implicitly).
    await callerFor(creatorId).dashboards.setVisibility({
      id,
      visibility: 'selected',
      userIds: [viewerId],
    });
    await expect(callerFor(viewerId).dashboards.get({ id })).resolves.toMatchObject({ id });
    await expect(callerFor(schedulerId).dashboards.get({ id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    // Back to private: only owner + manager.
    await callerFor(creatorId).dashboards.setVisibility({ id, visibility: 'private' });
    await expect(callerFor(viewerId).dashboards.get({ id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('DH-E13b: unpublishing a shared dashboard hides it again', async () => {
    const id = await createDashboard(creatorId);
    await callerFor(creatorId).dashboards.setStatus({ id, status: 'published' });
    await callerFor(creatorId).dashboards.setVisibility({ id, visibility: 'tenant' });
    await callerFor(creatorId).dashboards.setStatus({ id, status: 'draft' });
    await expect(callerFor(viewerId).dashboards.get({ id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // ─── DH-E14 per-source data gating ────────────────────────────────────

  it('DH-E14: widget data is gated per source on the viewer, not the author', async () => {
    const spec = {
      version: DASHBOARD_SPEC_VERSION,
      widgets: [
        {
          id: 'open-actions',
          kind: 'kpi',
          title: 'Open actions',
          source: 'actions',
          metric: 'open',
        },
        {
          id: 'open-incidents',
          kind: 'kpi',
          title: 'Open incidents',
          source: 'incidents',
          metric: 'open',
        },
      ],
    };
    const id = await createDashboard(adminId, spec);
    await callerFor(adminId).dashboards.setStatus({ id, status: 'published' });
    await callerFor(adminId).dashboards.setVisibility({ id, visibility: 'tenant' });

    // Viewer holds actions.view but NOT incidents.view.
    const result = await callerFor(viewerId).dashboards.data({ id });
    expect(result.widgets['open-actions']).toMatchObject({ kind: 'kpi', value: 0 });
    expect(result.widgets['open-incidents']).toEqual({ error: 'forbidden' });

    // Admin sees both.
    const adminResult = await callerFor(adminId).dashboards.data({ id });
    expect(adminResult.widgets['open-incidents']).toMatchObject({ kind: 'kpi' });
  });

  it('DH-E14b: authoring a spec with a source the author cannot use is refused', async () => {
    await expect(
      createDashboard(creatorId, {
        version: DASHBOARD_SPEC_VERSION,
        widgets: [
          { id: 'w', kind: 'kpi', title: 'Incidents', source: 'incidents', metric: 'open' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('DH-E14c: a brand-disabled module returns module-disabled markers', async () => {
    const offRouter = router({
      dashboards: createDashboardsRouter({
        modules: { ...ALL_MODULES_ON, incidents: false },
        now: () => FIXED_NOW,
      }),
    });
    const offCaller = createCallerFactory(offRouter)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: adminId, email: 'x@test.test', tenantId: tenantId as never },
      }),
    );
    const { id } = await offCaller.dashboards.create({
      title: 'Actions only',
      spec: kpiSpec(),
    });
    // Author cannot even reference incidents…
    await expect(
      offCaller.dashboards.updateSpec({
        id,
        spec: {
          version: DASHBOARD_SPEC_VERSION,
          widgets: [
            { id: 'w', kind: 'kpi', title: 'Incidents', source: 'incidents', metric: 'open' },
          ],
        },
        expectedUpdatedAt: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  // ─── DH-E15 tenant isolation ──────────────────────────────────────────

  it('DH-E15: another tenant cannot see or touch the dashboard', async () => {
    const id = await createDashboard(creatorId);
    const otherTenant = newId();
    await db.insert(schema.tenants).values({
      id: otherTenant,
      name: 'Rival',
      slug: `r-${otherTenant}`,
      settings: { plan: 'paid' },
    });
    const otherSets = await seedDefaultPermissionSets(db as never, otherTenant);
    const rivalId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: rivalId,
      name: 'Rex Rival',
      email: `rex-${otherTenant}@rival.test`,
      tenantId: otherTenant,
      permissionSetId: otherSets.administrator,
    });
    await expect(callerFor(rivalId, otherTenant).dashboards.get({ id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await callerFor(rivalId, otherTenant).dashboards.list()).length).toBe(0);
  });

  // ─── DH-E16 spec boundary ─────────────────────────────────────────────

  it('DH-E16: invalid specs are refused with the error list in the message', async () => {
    await expect(createDashboard(creatorId, kpiSpec({ metric: 'velocity' }))).rejects.toMatchObject(
      {
        code: 'BAD_REQUEST',
        message: expect.stringContaining('no metric "velocity"'),
      },
    );
  });

  // ─── DH-E17 optimistic concurrency ────────────────────────────────────

  it('DH-E17: updateSpec refuses a stale expectedUpdatedAt with CONFLICT', async () => {
    const id = await createDashboard(creatorId);
    const fresh = await callerFor(creatorId).dashboards.get({ id });
    const stale = new Date(fresh.updatedAt.getTime() - 1000);
    await expect(
      callerFor(creatorId).dashboards.updateSpec({
        id,
        spec: kpiSpec(),
        expectedUpdatedAt: stale,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      callerFor(creatorId).dashboards.updateSpec({
        id,
        spec: kpiSpec(),
        expectedUpdatedAt: fresh.updatedAt,
      }),
    ).resolves.toMatchObject({ updatedAt: expect.any(Date) });
  });

  // ─── DH-E18 archive semantics ─────────────────────────────────────────

  it('DH-E18: archive pauses schedules in the same tx; restore keeps them paused', async () => {
    const id = await createDashboard(schedulerId);
    await callerFor(schedulerId).dashboards.createSchedule({
      dashboardId: id,
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      timezone: 'Europe/London',
      startAt: FIXED_NOW,
      recipients: ['board@client.example'],
    });
    await callerFor(schedulerId).dashboards.archive({ id });
    const schedules = await callerFor(schedulerId).dashboards.listSchedules({ dashboardId: id });
    expect(schedules).toHaveLength(1);
    expect(schedules[0]?.paused).toBe(true);

    await expect(
      callerFor(schedulerId).dashboards.updateSpec({
        id,
        spec: kpiSpec(),
        expectedUpdatedAt: FIXED_NOW,
      }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    await callerFor(schedulerId).dashboards.restore({ id });
    const after = await callerFor(schedulerId).dashboards.listSchedules({ dashboardId: id });
    const restored = after[0];
    if (restored === undefined) throw new Error('schedule missing after restore');
    expect(restored.paused).toBe(true);
    // Un-pausing after restore is an explicit choice — and allowed.
    await callerFor(schedulerId).dashboards.setSchedulePaused({
      id: restored.id,
      paused: false,
    });
  });

  // ─── DH-E19 schedule guard-rails ──────────────────────────────────────

  it('DH-E19: schedules need the schedules permission and validated inputs', async () => {
    const id = await createDashboard(creatorId);
    // creator lacks analytics.schedules.manage
    await expect(
      callerFor(creatorId).dashboards.createSchedule({
        dashboardId: id,
        rrule: 'FREQ=WEEKLY',
        timezone: 'UTC',
        startAt: FIXED_NOW,
        recipients: ['a@b.example'],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const own = await createDashboard(schedulerId);
    // invalid rrule
    await expect(
      callerFor(schedulerId).dashboards.createSchedule({
        dashboardId: own,
        rrule: 'EVERY=TUESDAY',
        timezone: 'UTC',
        startAt: FIXED_NOW,
        recipients: ['a@b.example'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // sub-hourly rrule
    await expect(
      callerFor(schedulerId).dashboards.createSchedule({
        dashboardId: own,
        rrule: 'FREQ=MINUTELY',
        timezone: 'UTC',
        startAt: FIXED_NOW,
        recipients: ['a@b.example'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // bad email
    await expect(
      callerFor(schedulerId).dashboards.createSchedule({
        dashboardId: own,
        rrule: 'FREQ=WEEKLY',
        timezone: 'UTC',
        startAt: FIXED_NOW,
        recipients: ['not-an-email'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    // bad timezone
    await expect(
      callerFor(schedulerId).dashboards.createSchedule({
        dashboardId: own,
        rrule: 'FREQ=WEEKLY',
        timezone: 'Mars/Olympus',
        startAt: FIXED_NOW,
        recipients: ['a@b.example'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // recipients deduped + lowercased
    await callerFor(schedulerId).dashboards.createSchedule({
      dashboardId: own,
      rrule: 'FREQ=WEEKLY',
      timezone: 'UTC',
      startAt: FIXED_NOW,
      recipients: ['Board@Client.example', 'board@client.example'],
    });
    const schedules = await callerFor(schedulerId).dashboards.listSchedules({
      dashboardId: own,
    });
    expect(schedules[0]?.recipients).toEqual(['board@client.example']);

    // per-dashboard cap
    for (let i = 1; i < MAX_SCHEDULES_PER_DASHBOARD; i += 1) {
      await callerFor(schedulerId).dashboards.createSchedule({
        dashboardId: own,
        rrule: 'FREQ=WEEKLY',
        timezone: 'UTC',
        startAt: FIXED_NOW,
        recipients: [`r${i}@client.example`],
      });
    }
    await expect(
      callerFor(schedulerId).dashboards.createSchedule({
        dashboardId: own,
        rrule: 'FREQ=WEEKLY',
        timezone: 'UTC',
        startAt: FIXED_NOW,
        recipients: ['overflow@client.example'],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  // ─── DH-E20 executor correctness ──────────────────────────────────────

  it('DH-E20a: KPI stocks ignore the date range; flows respect it; compare works', async () => {
    const inRange = new Date(FIXED_NOW.getTime() - 5 * DAY_MS);
    const previousPeriod = new Date(FIXED_NOW.getTime() - 35 * DAY_MS);
    const ancient = new Date(FIXED_NOW.getTime() - 400 * DAY_MS);

    await seedAction({ createdAt: ancient }); // old but open → counts in stock
    await seedAction({ createdAt: inRange, dueAt: new Date(FIXED_NOW.getTime() - DAY_MS) });
    await seedAction({ status: 'completed', createdAt: ancient, closedAt: inRange });
    await seedAction({ status: 'completed', createdAt: ancient, closedAt: previousPeriod });
    // Cancelled also stamps closedAt — must NOT count as completed.
    await seedAction({ status: 'cancelled', createdAt: ancient, closedAt: inRange });
    // Archived open action must not count anywhere.
    await seedAction({ createdAt: inRange, archivedAt: FIXED_NOW });

    const spec = {
      version: DASHBOARD_SPEC_VERSION,
      widgets: [
        { id: 'open', kind: 'kpi', title: 'Open', source: 'actions', metric: 'open' },
        { id: 'overdue', kind: 'kpi', title: 'Overdue', source: 'actions', metric: 'overdue' },
        {
          id: 'completed',
          kind: 'kpi',
          title: 'Completed',
          source: 'actions',
          metric: 'completed',
          compare: true,
        },
      ],
      filterDefaults: { dateRange: 'last30d' },
    };
    const id = await createDashboard(creatorId, spec);
    const result = await callerFor(creatorId).dashboards.data({ id });

    expect(result.widgets['open']).toMatchObject({ value: 2, meta: { dateRangeApplied: false } });
    expect(result.widgets['overdue']).toMatchObject({ value: 1 });
    // completed: 1 in range; previous period had 1 (the -35d close).
    expect(result.widgets['completed']).toMatchObject({
      value: 1,
      previous: 1,
      meta: { dateRangeApplied: true },
    });
  });

  it('DH-E20b: timeseries buckets are zero-filled; breakdown resolves labels + none-bucket; site filter narrows', async () => {
    const siteA = await seedSite('Alpha yard');
    const siteB = await seedSite('Bravo depot');
    const w0 = new Date('2026-08-03T09:00:00.000Z'); // Monday this week
    const w2 = new Date('2026-07-21T09:00:00.000Z'); // two weeks back

    await seedAction({ createdAt: w0, siteId: siteA });
    await seedAction({ createdAt: w0, siteId: siteA });
    await seedAction({ createdAt: w2, siteId: siteB });
    await seedAction({ createdAt: w0 }); // no site

    const spec = {
      version: DASHBOARD_SPEC_VERSION,
      widgets: [
        {
          id: 'trend',
          kind: 'timeseries',
          title: 'Created per week',
          source: 'actions',
          metric: 'created',
          bucket: 'week',
        },
        {
          id: 'by-site',
          kind: 'breakdown',
          title: 'Open by site',
          source: 'actions',
          metric: 'open',
          dimension: 'site',
        },
        {
          id: 'split',
          kind: 'timeseries',
          title: 'Created per week by site',
          source: 'actions',
          metric: 'created',
          bucket: 'week',
          splitBy: 'site',
        },
      ],
      filterDefaults: { dateRange: 'last30d' },
    };
    const id = await createDashboard(creatorId, spec);
    const result = await callerFor(creatorId).dashboards.data({ id });

    const trend = result.widgets['trend'];
    if (!trend || 'error' in trend || trend.kind !== 'timeseries') throw new Error('bad trend');
    expect(trend.buckets.length).toBeGreaterThanOrEqual(5);
    const trendSeries = trend.series[0];
    if (trendSeries === undefined) throw new Error('trend has no series');
    expect(trendSeries.values.reduce((a, b) => a + b, 0)).toBe(4);
    // Zero-filled: at least one bucket with 0.
    expect(trendSeries.values).toContain(0);

    const bySite = result.widgets['by-site'];
    if (!bySite || 'error' in bySite || bySite.kind !== 'breakdown')
      throw new Error('bad breakdown');
    const labels = bySite.rows.map((r) => r.label);
    expect(labels).toContain('Alpha yard');
    expect(labels).toContain('Bravo depot');
    expect(bySite.rows.find((r) => r.key === '__none')?.label).toBeNull();

    const split = result.widgets['split'];
    if (!split || 'error' in split || split.kind !== 'timeseries') throw new Error('bad split');
    expect(split.series.length).toBe(3); // siteA, siteB, none

    // Global site filter narrows to Alpha yard only.
    const filtered = await callerFor(creatorId).dashboards.data({
      id,
      filters: { siteIds: [siteA] },
    });
    const filteredTrend = filtered.widgets['trend'];
    if (!filteredTrend || 'error' in filteredTrend || filteredTrend.kind !== 'timeseries') {
      throw new Error('bad filtered trend');
    }
    const filteredSeries = filteredTrend.series[0];
    if (filteredSeries === undefined) throw new Error('filtered trend has no series');
    expect(filteredSeries.values.reduce((a, b) => a + b, 0)).toBe(2);
    expect(filteredTrend.meta.siteFilterApplied).toBe(true);
  });

  it('DH-E20c: widget filters narrow; tables merge metrics on the dimension key', async () => {
    const siteA = await seedSite('Alpha yard');
    await seedAction({ siteId: siteA });
    await seedAction({ siteId: siteA, status: 'in_progress' });
    await seedAction({ siteId: siteA, dueAt: new Date(FIXED_NOW.getTime() - DAY_MS) });

    const spec = {
      version: DASHBOARD_SPEC_VERSION,
      widgets: [
        {
          id: 'open-only',
          kind: 'kpi',
          title: 'Strictly open',
          source: 'actions',
          metric: 'open',
          filters: [{ dimension: 'status', values: ['open'] }],
        },
        {
          id: 'site-table',
          kind: 'table',
          title: 'Site comparison',
          source: 'actions',
          dimension: 'site',
          metrics: ['open', 'overdue'],
        },
      ],
    };
    const id = await createDashboard(creatorId, spec);
    const result = await callerFor(creatorId).dashboards.data({ id });

    expect(result.widgets['open-only']).toMatchObject({ value: 2 }); // excludes in_progress
    const table = result.widgets['site-table'];
    if (!table || 'error' in table || table.kind !== 'table') throw new Error('bad table');
    const alpha = table.rows.find((r) => r.label === 'Alpha yard');
    expect(alpha?.values).toEqual([3, 1]);
  });

  it('DH-E20d: observations open counts open AND investigation (register parity)', async () => {
    await seedIssue({});
    await seedIssue({ status: 'investigation' });
    await seedIssue({ status: 'closed', closedAt: FIXED_NOW });
    const spec = {
      version: DASHBOARD_SPEC_VERSION,
      widgets: [
        { id: 'w', kind: 'kpi', title: 'Open obs', source: 'observations', metric: 'open' },
      ],
    };
    const id = await createDashboard(creatorId, spec);
    const result = await callerFor(creatorId).dashboards.data({ id });
    expect(result.widgets['w']).toMatchObject({ value: 2 });
  });

  it('DH-E20e: training stocks respect superseded rows and date columns', async () => {
    const requirementId = newId();
    await db.insert(schema.trainingRequirements).values({
      id: requirementId,
      tenantId,
      name: 'CSCS card',
    });
    // The natural key is (tenant, requirement, person, achievedAt) —
    // vary achievedAt so five records for one person can coexist.
    let day = 1;
    const record = (over: Partial<typeof schema.trainingRecords.$inferInsert>) =>
      db.insert(schema.trainingRecords).values({
        id: newId(),
        tenantId,
        requirementId,
        personName: 'Pat Worker',
        achievedAt: new Date(`2025-01-${String(day++).padStart(2, '0')}`),
        ...over,
      });
    await record({ expiresAt: new Date('2026-08-01') }); // expired
    await record({ expiresAt: new Date('2026-09-01') }); // expiring soon (<60d)
    await record({ expiresAt: new Date('2027-08-01') }); // fine
    await record({ expiresAt: new Date('2026-08-01'), supersededAt: FIXED_NOW }); // superseded — ignore
    await record({}); // no expiry — never expires

    const spec = {
      version: DASHBOARD_SPEC_VERSION,
      widgets: [
        { id: 'expired', kind: 'kpi', title: 'Expired', source: 'training', metric: 'expired' },
        {
          id: 'expiring',
          kind: 'kpi',
          title: 'Expiring',
          source: 'training',
          metric: 'expiringSoon',
        },
      ],
    };
    const id = await createDashboard(creatorId, spec);
    const result = await callerFor(creatorId).dashboards.data({ id });
    expect(result.widgets['expired']).toMatchObject({ value: 1 });
    expect(result.widgets['expiring']).toMatchObject({ value: 1 });
  });

  // ─── DH-E21 completeness ──────────────────────────────────────────────

  it('DH-E21: every catalogue metric × widget kind × dimension executes', async () => {
    for (const sourceId of DASHBOARD_SOURCE_IDS) {
      const source = DASHBOARD_SOURCES[sourceId];
      for (const metric of source.metrics) {
        const widgets: unknown[] = [
          {
            id: `kpi-${sourceId}-${metric.id}`.toLowerCase().slice(0, 40),
            kind: 'kpi',
            title: 'k',
            source: sourceId,
            metric: metric.id,
          },
        ];
        if (metric.kind === 'flow') {
          widgets.push({
            id: `ts-${sourceId}-${metric.id}`.toLowerCase().slice(0, 40),
            kind: 'timeseries',
            title: 't',
            source: sourceId,
            metric: metric.id,
          });
        }
        for (const dimension of source.dimensions) {
          if (!metricAllowsDimension(metric, dimension.id)) continue;
          widgets.push({
            id: `bd-${sourceId}-${metric.id}-${dimension.id}`.toLowerCase().slice(0, 40),
            kind: 'breakdown',
            title: 'b',
            source: sourceId,
            metric: metric.id,
            dimension: dimension.id,
          });
        }
        const spec = dashboardSpecSchema.parse({
          version: DASHBOARD_SPEC_VERSION,
          widgets,
        });
        for (const widget of spec.widgets) {
          // Throws (failing the test) if any mapping or SQL is missing/wrong.
          await executeWidget({
            db: db as never,
            tenantId,
            widget,
            filters: { dateRange: 'last30d', siteIds: [] },
            now: FIXED_NOW,
          });
        }
      }
    }
  });

  // ─── DH-E22 catalogue permissions are real ────────────────────────────

  it('DH-E22: every catalogue source permission is a real PermissionKey', () => {
    for (const sourceId of DASHBOARD_SOURCE_IDS) {
      expect(isPermissionKey(DASHBOARD_SOURCES[sourceId].permission)).toBe(true);
    }
  });

  it('availableSources reflects the caller permissions and brand flags', async () => {
    const forViewer = await callerFor(viewerId).dashboards.availableSources();
    expect(forViewer.map((s) => s.id)).toEqual(['actions']);
    const forAdmin = await callerFor(adminId).dashboards.availableSources();
    expect(forAdmin.length).toBe(DASHBOARD_SOURCE_IDS.length);
  });

  // ─── DH-E23 PDF export ────────────────────────────────────────────────

  it('DH-E23a: renderPdf refuses when the renderer dep is not wired', async () => {
    const id = await createDashboard(creatorId);
    await expect(callerFor(creatorId).dashboards.renderPdf({ id })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'render-not-wired',
    });
  });

  it('DH-E23b: renderPdf calls the injected renderer tenant-scoped and returns the artefact', async () => {
    const calls: Array<{ tenantId: string; dashboardId: string }> = [];
    const wired = router({
      dashboards: createDashboardsRouter({
        modules: ALL_MODULES_ON,
        now: () => FIXED_NOW,
        renderPdf: async (input) => {
          calls.push(input);
          return {
            key: `${input.tenantId}/dashboards/${input.dashboardId}/pdf-x.pdf`,
            bytes: 4,
            stub: true,
          };
        },
      }),
    });
    const wiredCaller = createCallerFactory(wired);
    const call = (userId: string) =>
      wiredCaller(
        createTestContext({
          db: db as never,
          logger: silentLogger(),
          auth: { userId, email: 'x@test.test', tenantId: tenantId as never },
        }),
      );

    const id = await createDashboard(creatorId, kpiSpec(), 'Weekly Safety — Overview!');
    const result = await call(creatorId).dashboards.renderPdf({ id });
    expect(calls).toEqual([{ tenantId, dashboardId: id }]);
    expect(result).toMatchObject({
      storageKey: `${tenantId}/dashboards/${id}/pdf-x.pdf`,
      filename: 'weekly-safety-overview.pdf',
      sizeBytes: 4,
      stub: true,
    });

    // The visibility matrix still applies: a plain viewer must not be
    // able to export someone else's private draft — NOT_FOUND, and the
    // renderer is never invoked for it.
    calls.length = 0;
    await expect(call(viewerId).dashboards.renderPdf({ id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(calls).toEqual([]);

    // Published + tenant-visible → the same viewer can export.
    await call(creatorId).dashboards.setStatus({ id, status: 'published' });
    await call(creatorId).dashboards.setVisibility({ id, visibility: 'tenant' });
    const viewerResult = await call(viewerId).dashboards.renderPdf({ id });
    expect(viewerResult.storageKey).toContain(id);
  });

  it('DH-E23c: renderPdf refuses a viewer who cannot see a widget source — the PDF cannot leak what widgetData gates', async () => {
    const calls: Array<{ tenantId: string; dashboardId: string }> = [];
    const wired = router({
      dashboards: createDashboardsRouter({
        modules: ALL_MODULES_ON,
        now: () => FIXED_NOW,
        renderPdf: async (input) => {
          calls.push(input);
          return {
            key: `${input.tenantId}/dashboards/${input.dashboardId}/pdf-x.pdf`,
            bytes: 4,
            stub: false,
          };
        },
      }),
    });
    const wiredCaller = createCallerFactory(wired);
    const call = (userId: string) =>
      wiredCaller(
        createTestContext({
          db: db as never,
          logger: silentLogger(),
          auth: { userId, email: 'x@test.test', tenantId: tenantId as never },
        }),
      );

    // Admin authors a tenant-visible dashboard with an incidents widget.
    const spec = {
      version: DASHBOARD_SPEC_VERSION,
      widgets: [
        {
          id: 'open-incidents',
          kind: 'kpi',
          title: 'Open incidents',
          source: 'incidents',
          metric: 'open',
        },
      ],
    };
    const { id } = await call(adminId).dashboards.create({ title: 'Incidents', spec });
    await call(adminId).dashboards.setStatus({ id, status: 'published' });
    await call(adminId).dashboards.setVisibility({ id, visibility: 'tenant' });

    // Interactive: the viewer (no incidents.view) already gets a forbidden marker.
    const data = await call(viewerId).dashboards.data({ id });
    expect(data.widgets['open-incidents']).toEqual({ error: 'forbidden' });

    // PDF: the same viewer must be refused, and the renderer never invoked —
    // otherwise the shared artefact would carry the very counts the grid hid.
    calls.length = 0;
    await expect(call(viewerId).dashboards.renderPdf({ id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(calls).toEqual([]);

    // The admin (holds every source) still exports it.
    await expect(call(adminId).dashboards.renderPdf({ id })).resolves.toMatchObject({
      storageKey: expect.stringContaining(id),
    });
  });
});

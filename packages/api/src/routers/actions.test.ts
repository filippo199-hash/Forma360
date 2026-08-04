/**
 * Integration tests for the actions router — platform HSE review wave.
 *
 * Edge cases:
 *   - AC-E01: list pagination — offset + totalCount make every action
 *     reachable (PF-9); the source-type filter accepts the five newer
 *     source types (PF-2)
 *   - AC-E02: myCounts reports the caller's open + overdue workload
 *   - AC-E03: actions.get resolves a labelled, linkable source for
 *     risk_assessment / coshh_assessment / fire_risk_assessment /
 *     fire_logbook_entry / fire_door_inspection (PF-2)
 *   - AC-E04: createFromIssue applies the priority→due-date automation,
 *     accepts an action type and enforces its required custom
 *     questions (PF-13)
 *   - AC-E05: assignment emails — sent on create-with-assignee and on
 *     reassignment; never for self-assignment (PF-4)
 *   - AC-E06: moving a due date clears both reminder stamps (PF-4)
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
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
import { appRouter } from '../router';
import { setActionsRouterDeps } from './actions';
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
  createLogger({ service: 'actions-test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);
const DAY_MS = 86_400_000;

describe('actions router (platform review)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let colleagueId: string;
  let sentEmails: Array<{ to: string; templateKey: string; variables: Record<string, string> }>;

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
    sentEmails = [];
    setActionsRouterDeps({
      sendEmail: async (input) => {
        sentEmails.push(input);
      },
      appUrl: 'https://freehs.test',
    });
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
        permissionSetId: sets.administrator,
      },
    ]);
  });

  afterEach(async () => {
    setActionsRouterDeps({ sendEmail: null, appUrl: '' });
    await client.close();
  });

  async function seedAction(over: Partial<typeof schema.actions.$inferInsert>): Promise<string> {
    const id = newId();
    await db.insert(schema.actions).values({
      id,
      tenantId,
      sourceType: 'standalone',
      title: over.title ?? 'Task',
      status: 'open',
      createdBy: adminId,
      ...over,
    });
    return id;
  }

  it('AC-E01: pagination reaches every action; source-type filter covers the new types', async () => {
    const caller = callerFor(adminId);
    for (let i = 0; i < 5; i += 1) {
      await seedAction({ title: `Task ${i}`, createdAt: new Date(Date.now() - i * 1000) });
    }
    const firstPage = await caller.actions.list({ limit: 2, sortBy: 'created' });
    expect(firstPage.totalCount).toBe(5);
    expect(firstPage.rows).toHaveLength(2);
    const lastPage = await caller.actions.list({ limit: 2, offset: 4, sortBy: 'created' });
    expect(lastPage.rows).toHaveLength(1);
    // The oldest action is reachable — PF-9's complaint.
    expect(lastPage.rows[0]?.title).toBe('Task 4');

    await seedAction({ title: 'Fire fail', sourceType: 'fire_logbook_entry', sourceId: newId() });
    const filtered = await caller.actions.list({ sourceType: 'fire_logbook_entry' });
    expect(filtered.totalCount).toBe(1);
    expect(filtered.rows[0]?.title).toBe('Fire fail');
  });

  it('AC-E02: myCounts reports my open + overdue workload', async () => {
    const caller = callerFor(adminId);
    await seedAction({ assigneeUserId: adminId, dueAt: new Date(Date.now() - DAY_MS) });
    await seedAction({ assigneeUserId: adminId, dueAt: new Date(Date.now() + DAY_MS) });
    await seedAction({ assigneeUserId: colleagueId, dueAt: new Date(Date.now() - DAY_MS) });
    await seedAction({ assigneeUserId: adminId, status: 'completed' });
    const counts = await caller.actions.myCounts();
    expect(counts).toEqual({ openAssigned: 2, overdueAssigned: 1 });
  });

  it('AC-E03: get resolves labelled, linkable sources for the five HSE types (PF-2)', async () => {
    const caller = callerFor(adminId);

    const raId = newId();
    await db.insert(schema.riskAssessments).values({
      id: raId,
      tenantId,
      referenceNumber: 'RA-0009',
      title: 'Manual handling',
      activity: 'Moving stock',
      createdBy: adminId,
    });
    const substanceId = newId();
    await db.insert(schema.coshhSubstances).values({
      id: substanceId,
      tenantId,
      name: 'Acetone',
      createdBy: adminId,
    });
    const coshhId = newId();
    await db.insert(schema.coshhAssessments).values({
      id: coshhId,
      tenantId,
      substanceId,
      referenceNumber: 'COSHH-0004',
      taskDescription: 'Parts cleaning',
      createdBy: adminId,
    });
    const buildingId = newId();
    await db.insert(schema.fireBuildings).values({
      id: buildingId,
      tenantId,
      name: 'Head Office',
      createdBy: adminId,
    });
    const fraId = newId();
    await db.insert(schema.fireRiskAssessments).values({
      id: fraId,
      tenantId,
      buildingId,
      referenceNumber: 'FRA-0002',
      title: 'HO fire risk assessment',
      createdBy: adminId,
    });
    const entryId = newId();
    await db.insert(schema.fireLogbookEntries).values({
      id: entryId,
      tenantId,
      buildingId,
      checkType: 'alarm_test',
      performedAt: new Date(),
      performedBy: adminId,
      result: 'fail',
    });
    const doorId = newId();
    await db.insert(schema.fireDoors).values({
      id: doorId,
      tenantId,
      buildingId,
      doorRef: 'FD-2-07',
      nextInspectionDueAt: new Date(),
      createdBy: adminId,
    });
    const inspectionId = newId();
    await db.insert(schema.fireDoorInspections).values({
      id: inspectionId,
      tenantId,
      doorId,
      inspectedAt: new Date(),
      inspectedBy: adminId,
      outcome: 'fail',
    });

    const cases: Array<{
      sourceType: (typeof schema.actions.$inferInsert)['sourceType'];
      sourceId: string;
      ref: string | null;
      titleContains: string;
      href: string;
    }> = [
      {
        sourceType: 'risk_assessment',
        sourceId: raId,
        ref: 'RA-0009',
        titleContains: 'Manual handling',
        href: `/risk-assessments/${raId}`,
      },
      {
        sourceType: 'coshh_assessment',
        sourceId: coshhId,
        ref: 'COSHH-0004',
        titleContains: 'Acetone',
        href: `/coshh/${substanceId}`,
      },
      {
        sourceType: 'fire_risk_assessment',
        sourceId: fraId,
        ref: 'FRA-0002',
        titleContains: 'HO fire risk assessment',
        href: `/fire-safety/fra/${fraId}`,
      },
      {
        sourceType: 'fire_logbook_entry',
        sourceId: entryId,
        ref: null,
        titleContains: 'alarm test',
        href: `/fire-safety/${buildingId}`,
      },
      {
        sourceType: 'fire_door_inspection',
        sourceId: inspectionId,
        ref: null,
        titleContains: 'FD-2-07',
        href: `/fire-safety/${buildingId}`,
      },
    ];
    for (const c of cases) {
      const actionId = await seedAction({ sourceType: c.sourceType, sourceId: c.sourceId });
      const detail = await caller.actions.get({ actionId });
      expect(detail.source?.type).toBe(c.sourceType);
      expect(detail.source?.referenceNumber).toBe(c.ref);
      expect(detail.source?.title ?? '').toContain(c.titleContains);
      expect(detail.source?.href).toBe(c.href);
    }
  });

  it('AC-E04: createFromIssue applies auto-due, accepts a type and enforces its questions (PF-13)', async () => {
    const caller = callerFor(adminId);
    const categoryId = newId();
    await db.insert(schema.issueCategories).values({
      id: categoryId,
      tenantId,
      name: 'Hazard',
      createdBy: adminId,
    });
    const issueId = newId();
    await db.insert(schema.issues).values({
      id: issueId,
      tenantId,
      categoryId,
      title: 'Wet floor',
      status: 'open',
      reportedByUserId: adminId,
      referenceNumber: 'OBS-000001',
      categorySnapshot: { categoryId, name: 'Hazard', customFields: [], customQuestions: [] },
      accessSnapshot: {
        groupIds: [],
        siteIds: [],
        permissions: [],
        snapshotAt: new Date().toISOString(),
      },
    });
    const questionId = newId();
    const typeId = newId();
    await db.insert(schema.actionTypes).values({
      id: typeId,
      tenantId,
      name: 'Corrective',
      customQuestions: [{ id: questionId, prompt: 'Root cause', type: 'text', required: true }],
      createdBy: adminId,
    });

    // Required question missing → refused (parity with createStandalone).
    await expect(
      caller.actions.createFromIssue({
        issueId,
        title: 'Mop and sign',
        priority: 'medium',
        actionTypeId: typeId,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const created = await caller.actions.createFromIssue({
      issueId,
      title: 'Mop and sign',
      priority: 'medium',
      actionTypeId: typeId,
      customQuestionResponses: { [questionId]: 'Leaking chiller' },
    });
    const detail = await caller.actions.get({ actionId: created.actionId });
    // medium → +7 days from the tenant default table.
    const days = Math.round(((detail.action.dueAt?.getTime() ?? 0) - Date.now()) / DAY_MS);
    expect(days).toBe(7);
    expect(detail.action.actionTypeId).toBe(typeId);
  });

  it('AC-E05: assignment emails on create + reassign, never on self-assign (PF-4)', async () => {
    const caller = callerFor(adminId);

    // Self-assignment → silent.
    await caller.actions.createStandalone({ title: 'Mine', assigneeUserId: adminId });
    expect(sentEmails).toHaveLength(0);

    // Assigning a colleague → one email with the action link.
    const { actionId } = await caller.actions.createStandalone({
      title: 'Replace guard',
      assigneeUserId: colleagueId,
      priority: 'high',
    });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.templateKey).toBe('action-assigned');
    expect(sentEmails[0]?.to).toBe(`carl-${tenantId}@acme.test`);
    expect(sentEmails[0]?.variables['viewUrl']).toBe(`https://freehs.test/en/actions/${actionId}`);

    // Reassigning back to me (actor=admin, assignee=admin) → silent;
    // reassigning to the colleague again → email.
    await caller.actions.update({ actionId, assigneeUserId: adminId });
    expect(sentEmails).toHaveLength(1);
    await caller.actions.update({ actionId, assigneeUserId: colleagueId });
    expect(sentEmails).toHaveLength(2);
  });

  it('AC-E06: moving a due date clears both reminder stamps (PF-4)', async () => {
    const caller = callerFor(adminId);
    const actionId = await seedAction({
      assigneeUserId: colleagueId,
      dueAt: new Date(Date.now() - DAY_MS),
      dueSoonRemindedAt: new Date(),
      overdueRemindedAt: new Date(),
    });
    await caller.actions.update({
      actionId,
      dueAt: new Date(Date.now() + 5 * DAY_MS).toISOString(),
    });
    const row = await db
      .select({
        dueSoonRemindedAt: schema.actions.dueSoonRemindedAt,
        overdueRemindedAt: schema.actions.overdueRemindedAt,
      })
      .from(schema.actions)
      .where(eq(schema.actions.id, actionId));
    expect(row[0]?.dueSoonRemindedAt).toBeNull();
    expect(row[0]?.overdueRemindedAt).toBeNull();
  });
});

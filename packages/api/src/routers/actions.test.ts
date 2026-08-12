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

  it('NP-AC1: action_assigned prefs — muted email keeps the bell row; muted inapp keeps the email', async () => {
    const caller = callerFor(adminId);

    // Email muted: no send, bell row still written.
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'email:action_assigned': false } })
      .where(eq(schema.user.id, colleagueId));
    await caller.actions.createStandalone({ title: 'Muted email', assigneeUserId: colleagueId });
    expect(sentEmails).toHaveLength(0);
    let bells = await db.select().from(schema.notifications);
    expect(bells.map((r) => r.kind)).toEqual(['action_assigned']);
    expect(bells[0]?.userId).toBe(colleagueId);

    // Inapp muted: email sent, no new bell row.
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'inapp:action_assigned': false } })
      .where(eq(schema.user.id, colleagueId));
    await caller.actions.createStandalone({ title: 'Muted bell', assigneeUserId: colleagueId });
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]?.templateKey).toBe('action-assigned');
    bells = await db.select().from(schema.notifications);
    expect(bells).toHaveLength(1);
  });

  it('AT-E01: attachment create → list carries uploader name, isMine, signed URL; activity logs it', async () => {
    setActionsRouterDeps({
      sendEmail: null,
      appUrl: 'https://freehs.test',
      signDownloadUrl: (key) => Promise.resolve(`stub://signed/${key}`),
    });
    const caller = callerFor(adminId);
    const actionId = await seedAction({ title: 'Fix ladder' });
    const key = `${tenantId}/actions/${actionId}/photo.jpg`;
    const { attachmentId } = await caller.actions.attachments.create({
      actionId,
      storageKey: key,
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
    });

    const mine = await caller.actions.attachments.list({ actionId });
    expect(mine).toHaveLength(1);
    expect(mine[0]?.id).toBe(attachmentId);
    expect(mine[0]?.uploadedByName).toBe('Alice Admin');
    expect(mine[0]?.isMine).toBe(true);
    expect(mine[0]?.signedUrl).toBe(`stub://signed/${key}`);

    // The colleague sees the same row but not as theirs.
    const theirs = await callerFor(colleagueId).actions.attachments.list({ actionId });
    expect(theirs[0]?.isMine).toBe(false);

    const activity = await caller.actions.activity.list({ actionId });
    expect(activity.map((a) => a.kind)).toContain('attachment_added');
  });

  it('AT-E02: a storage key outside the tenant prefix is refused', async () => {
    const caller = callerFor(adminId);
    const actionId = await seedAction({});
    await expect(
      caller.actions.attachments.create({
        actionId,
        storageKey: `${newId()}/actions/${actionId}/stolen.jpg`,
        filename: 'stolen.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('AT-E03: attachments on another tenant\'s action are unreachable', async () => {
    // Second tenant with its own action + attachment.
    const otherTenant = newId();
    await db
      .insert(schema.tenants)
      .values({ id: otherTenant, name: 'Rival', slug: `r-${otherTenant}` });
    const otherAction = newId();
    await db.insert(schema.actions).values({
      id: otherAction,
      tenantId: otherTenant,
      sourceType: 'standalone',
      title: 'Secret task',
      status: 'open',
      createdBy: 'usr_ghost',
    });

    const caller = callerFor(adminId);
    await expect(caller.actions.attachments.list({ actionId: otherAction })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    await expect(
      caller.actions.attachments.create({
        actionId: otherAction,
        storageKey: `${tenantId}/actions/${otherAction}/x.pdf`,
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 5,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('AT-E04: remove is author-or-manager; activity logs the removal', async () => {
    // A standard user holds actions.view but NOT actions.manage.
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    const standardId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: standardId,
      name: 'Stan Standard',
      email: `stan-${tenantId}@acme.test`,
      tenantId,
      permissionSetId: sets.standard,
    });

    const actionId = await seedAction({});
    const admin = callerFor(adminId);
    const { attachmentId } = await admin.actions.attachments.create({
      actionId,
      storageKey: `${tenantId}/actions/${actionId}/doc.pdf`,
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 99,
    });

    // Not the author, no manage → refused.
    await expect(
      callerFor(standardId).actions.attachments.remove({ attachmentId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // The standard user CAN remove their own upload.
    const own = await callerFor(standardId).actions.attachments.create({
      actionId,
      storageKey: `${tenantId}/actions/${actionId}/mine.pdf`,
      filename: 'mine.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 42,
    });
    await callerFor(standardId).actions.attachments.remove({ attachmentId: own.attachmentId });

    // A manager (not the author) can remove anyone's.
    await callerFor(colleagueId).actions.attachments.remove({ attachmentId });
    expect(await admin.actions.attachments.list({ actionId })).toHaveLength(0);
    const activity = await admin.actions.activity.list({ actionId });
    expect(activity.filter((a) => a.kind === 'attachment_removed')).toHaveLength(2);

    // Gone means gone: a second remove is NOT_FOUND.
    await expect(
      callerFor(colleagueId).actions.attachments.remove({ attachmentId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
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

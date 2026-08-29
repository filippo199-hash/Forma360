/**
 * Integration tests for the incidents router (FreeHS module B5 — Incident
 * & Accident Management).
 *
 * Edge cases (IN-E01..E06 are the pure-helper cases in
 * packages/shared/src/incidents.test.ts; IN-J01..J04 are the worker cases
 * in packages/jobs/src/workers/*.test.ts):
 *   - IN-E02 (router half): `occurredAt` in the future refused; the late
 *     report flag surfaces on the register
 *   - IN-E03 (router half): per-kind details validated at create/update
 *   - IN-E05 (router half): recording absence past 7 days against a
 *     not-reportable determination flags re-screening + logs it
 *   - IN-E10: closure blocked while RIDDOR is unscreened / re-screen
 *     pending / reportable-but-unsubmitted / linked actions still open;
 *     a clean close schedules the effectiveness review
 *   - IN-E11: finding→action generation is once-only (source unique
 *     index adopted on race)
 *   - IN-E12: the approver may be neither the lead investigator nor the
 *     submitter
 *   - IN-E13: an approved investigation is frozen; reopening creates
 *     revision 2 pre-filled from revision 1, which stays readable
 *   - IN-E14: confidential incidents are counted-not-readable — minimal
 *     register rows, `get` refused without team membership or the key
 *   - IN-E15: every loader scopes by tenant
 *   - IN-E16: evidence + witness statements are append-only
 *   - IN-E17: observation promotion links both ways and carries photos
 *   - IN-E18: review prompts pull RA / COSHH / FRA nextReviewAt to now
 *     citing the incident; skipping needs a reason
 *   - IN-E19: reference numbering continues past IN-999999
 *   - IN-E20: a not-effective verdict prompts the reopen path
 *
 * Plus: brand gating, permission tiers, the RIDDOR screen/submit flow,
 * the actions-hub integration (source resolution + list filter) and the
 * immediate-alert enqueue.
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
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
import { appRouter } from '../router';
import { createIncidentsRouter } from './incidents';
import { createCallerFactory, router } from '../trpc';

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
  createLogger({ service: 'incidents-test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);

const DAY = 86_400_000;
const HOUR = 3_600_000;

describe('incidents router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let managerId: string;
  let standardId: string;
  let standard2Id: string;
  let siteA: string;
  let siteB: string;

  function callerFor(userId: string) {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'incidents@x.test', tenantId: tenantId as never },
      }),
    );
  }

  /** Yesterday, so late-report and deadline arithmetic stay deterministic. */
  function occurredYesterday(): Date {
    return new Date(Date.now() - 20 * HOUR);
  }

  async function reportIncident(overrides?: {
    kind?:
      | 'injury'
      | 'dangerous_occurrence'
      | 'sharps_exposure'
      | 'violence_aggression'
      | 'near_miss';
    title?: string;
    details?: Record<string, unknown>;
    reporter?: string;
    occurredAt?: Date;
  }): Promise<string> {
    const caller = callerFor(overrides?.reporter ?? standardId);
    const created = await caller.incidents.create({
      title: overrides?.title ?? 'Hand caught in nip point',
      description: 'Machinist injured on line 2.',
      kind: overrides?.kind ?? 'injury',
      occurredAt: overrides?.occurredAt ?? occurredYesterday(),
      siteId: siteA,
      locationText: 'Machine shop',
      details: overrides?.details ?? {},
      persons: [
        {
          name: 'Priya Patel',
          category: 'employee',
          injury: { bodyParts: ['hand'], injuryKinds: ['laceration'], firstAidGiven: true },
          ohFollowUpRequired: false,
        },
      ],
    });
    return created.incidentId;
  }

  /** report → triage (manager as lead investigator). */
  async function triagedIncident(overrides?: {
    severity?: 'minor' | 'moderate' | 'serious';
    level?: 'basic' | 'full';
  }): Promise<string> {
    const id = await reportIncident();
    await callerFor(adminId).incidents.triage({
      incidentId: id,
      severity: overrides?.severity ?? 'moderate',
      investigationLevel: overrides?.level ?? 'basic',
      leadInvestigatorUserId: managerId,
    });
    return id;
  }

  /** …→ investigating with a saved basic investigation ready to submit. */
  async function investigatedIncident(): Promise<string> {
    const id = await triagedIncident();
    const manager = callerFor(managerId);
    await manager.incidents.startInvestigation({ incidentId: id });
    await manager.incidents.saveInvestigation({
      incidentId: id,
      immediateCause: 'Guard interlock defeated',
      underlyingCause: 'No PUWER inspection regime',
      conclusionSummary: 'Guarding failure compounded by missing inspections.',
    });
    return id;
  }

  /** …→ submitted → approved by admin, one action-generating finding. */
  async function approvedIncident(assignee?: string): Promise<{
    incidentId: string;
    findingId: string;
    actionId: string;
  }> {
    const id = await investigatedIncident();
    const manager = callerFor(managerId);
    const finding = await manager.incidents.addFinding({
      incidentId: id,
      category: 'equipment_guarding',
      priority: 'high',
      description: 'Fit fixed guard with interlock monitoring',
      requiresAction: true,
    });
    await manager.incidents.submitInvestigation({ incidentId: id });
    // IN-A6: every action-bearing finding needs an owner at approval.
    const result = await callerFor(adminId).incidents.approveInvestigation({
      incidentId: id,
      assignments: [{ findingId: finding.findingId, assigneeUserId: assignee ?? standardId }],
    });
    const actionId = result.generatedActionIds[0];
    if (actionId === undefined) throw new Error('no action generated');
    return { incidentId: id, findingId: finding.findingId, actionId };
  }

  async function screenNotReportable(incidentId: string): Promise<void> {
    await callerFor(adminId).incidents.riddorScreen({
      incidentId,
      category: 'not_reportable',
      determinationNote: 'Under 7 days lost; no specified injury.',
    });
  }

  async function completeActions(incidentId: string): Promise<void> {
    await db
      .update(schema.actions)
      .set({ status: 'completed' })
      .where(
        and(
          eq(schema.actions.tenantId, tenantId),
          eq(schema.actions.sourceType, 'incident'),
          eq(schema.actions.sourceId, incidentId),
        ),
      );
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db
      .insert(schema.tenants)
      .values({ id: tenantId, name: 'Acme', slug: `acme-${tenantId}` });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    adminId = `usr_${newId()}`;
    managerId = `usr_${newId()}`;
    standardId = `usr_${newId()}`;
    standard2Id = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminId,
        name: 'Alice Admin',
        email: `alice-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: managerId,
        name: 'Mark Manager',
        email: `mark-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.manager,
      },
      {
        id: standardId,
        name: 'Stan Standard',
        email: `stan-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.standard,
      },
      {
        id: standard2Id,
        name: 'Nina Nights',
        email: `nina-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.standard,
      },
    ]);
    siteA = newId();
    siteB = newId();
    await db.insert(schema.sites).values([
      { id: siteA, tenantId, name: 'Refinery' },
      { id: siteB, tenantId, name: 'Depot' },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it('brand gating: a disabled module refuses every call', async () => {
    const disabled = router({ incidents: createIncidentsRouter({ enabled: false }) });
    const caller = createCallerFactory(disabled)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: adminId, email: 'x@x.test', tenantId: tenantId as never },
      }),
    );
    await expect(caller.incidents.list()).rejects.toMatchObject({ message: 'module-disabled' });
    await expect(
      caller.incidents.create({
        title: 'X',
        kind: 'injury',
        occurredAt: occurredYesterday(),
      }),
    ).rejects.toMatchObject({ message: 'module-disabled' });
  });

  it('IN-E02: future occurredAt refused; late reports flagged on the register', async () => {
    const standard = callerFor(standardId);
    await expect(
      standard.incidents.create({
        title: 'Time traveller',
        kind: 'injury',
        occurredAt: new Date(Date.now() + HOUR),
      }),
    ).rejects.toMatchObject({ message: 'occurred-in-future' });

    await reportIncident({ occurredAt: new Date(Date.now() - 3 * DAY), title: 'Old news' });
    await reportIncident({ title: 'Fresh report' });
    const rows = await standard.incidents.list();
    const old = rows.find((r) => r.title === 'Old news');
    const fresh = rows.find((r) => r.title === 'Fresh report');
    expect(old?.lateReport).toBe(true);
    expect(fresh?.lateReport).toBe(false);
  });

  it('IN-E03: per-kind details are validated at the boundary', async () => {
    const standard = callerFor(standardId);
    await expect(
      standard.incidents.create({
        title: 'Needlestick',
        kind: 'sharps_exposure',
        occurredAt: occurredYesterday(),
        details: {}, // device is required
      }),
    ).rejects.toMatchObject({ message: 'invalid-details' });

    const created = await standard.incidents.create({
      title: 'Needlestick',
      kind: 'sharps_exposure',
      occurredAt: occurredYesterday(),
      details: { device: 'Used cannula', contaminationStatus: 'high' },
    });
    const detail = await callerFor(adminId).incidents.get({ incidentId: created.incidentId });
    expect(detail.incident.details).toMatchObject({
      device: 'Used cannula',
      ohFollowUpRequired: true,
    });
    // Sharps records default to confidential (Aisha's condition).
    expect(detail.incident.confidential).toBe(true);
  });

  it('IN-E05: absence past 7 days against not-reportable flags re-screening', async () => {
    const id = await reportIncident({ occurredAt: new Date(Date.now() - 12 * DAY) });
    await screenNotReportable(id);
    const admin = callerFor(adminId);
    const detail = await admin.incidents.get({ incidentId: id });
    const person = detail.persons[0];
    if (person === undefined) throw new Error('missing person');

    const from = new Date(Date.now() - 11 * DAY).toISOString().slice(0, 10);
    const to = new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10); // 9 days
    await admin.incidents.addAbsence({
      incidentId: id,
      personId: person.id,
      fromDate: from,
      toDate: to,
    });

    const after = await admin.incidents.get({ incidentId: id });
    expect(after.incident.riddorRescreenRequired).toBe(true);
    expect(after.daysLost).toBeGreaterThan(7);
    expect(after.events.some((e) => e.kind === 'riddor_rescreen_flagged')).toBe(true);

    // Re-screening clears the flag and restarts the ladder.
    await admin.incidents.riddorScreen({
      incidentId: id,
      category: 'over_7_day',
      determinationNote: 'Absence crossed seven days.',
    });
    const rescreened = await admin.incidents.get({ incidentId: id });
    expect(rescreened.incident.riddorRescreenRequired).toBe(false);
    expect(rescreened.incident.riddorDeadlineAt).not.toBeNull();
  });

  it('RIDDOR: deadline computed per category; submission recorded once', async () => {
    const occurred = new Date(Date.now() - 2 * DAY);
    const id = await reportIncident({ occurredAt: occurred });
    const admin = callerFor(adminId);
    const screened = await admin.incidents.riddorScreen({
      incidentId: id,
      category: 'over_7_day',
      determinationNote: 'Expected to exceed seven days.',
    });
    expect(screened.deadlineAt?.getTime()).toBe(occurred.getTime() + 15 * DAY);

    await expect(
      callerFor(standardId).incidents.riddorScreen({
        incidentId: id,
        category: 'death',
        determinationNote: 'nope',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await admin.incidents.riddorRecordSubmission({
      incidentId: id,
      route: 'online',
      hseReference: 'F2508-1',
    });
    await expect(
      admin.incidents.riddorRecordSubmission({ incidentId: id, route: 'online' }),
    ).rejects.toMatchObject({ message: 'riddor-already-submitted' });
    // Determination is frozen once submitted.
    await expect(
      admin.incidents.riddorScreen({ incidentId: id, category: 'death', determinationNote: 'x' }),
    ).rejects.toMatchObject({ message: 'riddor-already-submitted' });
  });

  it('IN-E10: closure blocked until RIDDOR discharged and actions terminal', async () => {
    const { incidentId } = await approvedIncident();
    const admin = callerFor(adminId);

    await expect(admin.incidents.close({ incidentId })).rejects.toMatchObject({
      message: 'riddor-unscreened',
    });
    await admin.incidents.riddorScreen({
      incidentId,
      category: 'over_7_day',
      determinationNote: 'Reportable.',
    });
    await expect(admin.incidents.close({ incidentId })).rejects.toMatchObject({
      message: 'riddor-not-submitted',
    });
    await admin.incidents.riddorRecordSubmission({ incidentId, route: 'online' });
    await expect(admin.incidents.close({ incidentId })).rejects.toMatchObject({
      message: 'actions-open',
    });
    await completeActions(incidentId);
    const closed = await admin.incidents.close({ incidentId });
    // Actions were generated → the effectiveness review is scheduled.
    expect(closed.effectivenessDueAt).not.toBeNull();
    const detail = await admin.incidents.get({ incidentId });
    expect(detail.incident.status).toBe('closed');
  });

  it('IN-E11: finding→action generation is once-only, adopting the raced row', async () => {
    const id = await investigatedIncident();
    const manager = callerFor(managerId);
    const finding = await manager.incidents.addFinding({
      incidentId: id,
      category: 'procedure',
      priority: 'medium',
      description: 'Rewrite the isolation procedure',
      requiresAction: true,
    });
    await manager.incidents.submitInvestigation({ incidentId: id });

    // Simulate the race: an action for this finding already exists.
    const racedActionId = newId();
    await db.insert(schema.actions).values({
      id: racedActionId,
      tenantId,
      sourceType: 'incident',
      sourceId: id,
      sourceItemId: finding.findingId,
      referenceNumber: 'AC-999999',
      title: 'Pre-existing action',
      status: 'open',
      createdBy: adminId,
    });

    await callerFor(adminId).incidents.approveInvestigation({
      incidentId: id,
      assignments: [{ findingId: finding.findingId, assigneeUserId: standardId }],
    });
    const rows = await db
      .select({ id: schema.actions.id })
      .from(schema.actions)
      .where(
        and(
          eq(schema.actions.tenantId, tenantId),
          eq(schema.actions.sourceType, 'incident'),
          eq(schema.actions.sourceId, id),
        ),
      );
    expect(rows).toHaveLength(1);
    const detail = await callerFor(adminId).incidents.get({ incidentId: id });
    expect(detail.findings[0]?.actionId).toBe(racedActionId);
  });

  it('IN-E12: the approver may not be the lead investigator or submitter', async () => {
    const id = await investigatedIncident();
    const manager = callerFor(managerId);
    await manager.incidents.submitInvestigation({ incidentId: id });
    await expect(
      manager.incidents.approveInvestigation({ incidentId: id, assignments: [] }),
    ).rejects.toMatchObject({ message: 'approver-is-investigator' });
    // A different manage-holder can approve.
    await callerFor(adminId).incidents.approveInvestigation({ incidentId: id, assignments: [] });
  });

  it('IN-C06: a confidential finding never becomes a readable action title', async () => {
    // On a violence or sharps case the finding IS the special-category
    // content, and the generated action carried it verbatim into a module
    // with no idea it was protected. The assignee below holds
    // `actions.view` and nothing whatsoever from incidents.
    const SENTINEL = 'Named ward assistant repeatedly threatened by patient X';
    const reporter = callerFor(adminId);
    const incidentId = await reportIncident({
      kind: 'violence_aggression',
      title: 'Assault at handover',
      details: { nature: 'physical', perpetratorType: 'patient_or_service_user' },
    });
    await reporter.incidents.triage({
      incidentId,
      // `basic` deliberately: confidentiality is orthogonal to the
      // investigation level, and a full RCA needs a method recorded.
      severity: 'moderate',
      investigationLevel: 'basic',
      leadInvestigatorUserId: managerId,
    });
    const manager = callerFor(managerId);
    await manager.incidents.startInvestigation({ incidentId });
    await manager.incidents.saveInvestigation({
      incidentId,
      immediateCause: 'Lone working at handover',
      conclusionSummary: 'Staffing model leaves handover uncovered.',
    });
    const finding = await manager.incidents.addFinding({
      incidentId,
      category: 'supervision',
      priority: 'high',
      description: SENTINEL,
      requiresAction: true,
    });
    await manager.incidents.submitInvestigation({ incidentId });
    const approved = await reporter.incidents.approveInvestigation({
      incidentId,
      assignments: [{ findingId: finding.findingId, assigneeUserId: standardId }],
    });
    const actionId = approved.generatedActionIds[0];
    if (actionId === undefined) throw new Error('no action generated');

    // Control: the finding really is stored and readable by an authorised
    // caller, so this cannot pass on an empty fixture.
    const detail = await reporter.incidents.get({ incidentId });
    expect(JSON.stringify(detail)).toContain(SENTINEL);

    const [action] = await db
      .select({ title: schema.actions.title, description: schema.actions.description })
      .from(schema.actions)
      .where(eq(schema.actions.id, actionId));
    expect(action?.title).not.toContain(SENTINEL);
    // Navigable without being readable: category + reference, exactly what
    // the source card already does.
    expect(action?.title).toContain('supervision');
    expect(action?.description ?? '').not.toContain(SENTINEL);

    // IN-C06: the actions hub, to somebody with no incidents access at all.
    const hub = await callerFor(standardId).actions.list({});
    expect(JSON.stringify(hub)).not.toContain(SENTINEL);

    // IN-C07: and global search, which matches `actions.title` with no
    // confidentiality consideration of its own — so the sentence the
    // incidents module refuses to put in its own results was reachable
    // from Cmd-K by typing it.
    const hits = await callerFor(standardId).search.global({ query: 'threatened by patient' });
    expect(JSON.stringify(hits)).not.toContain(SENTINEL);
  });

  it('IN-C06: an ordinary incident keeps its descriptive action title', async () => {
    // The redaction is conditional — degrading every action title in the
    // hub to a reference number would be a real usability cost, and only
    // incidents carry special-category data.
    const { actionId } = await approvedIncident();
    const [action] = await db
      .select({ title: schema.actions.title })
      .from(schema.actions)
      .where(eq(schema.actions.id, actionId));
    expect(action?.title).toContain('Fit fixed guard with interlock monitoring');
  });

  it('IN-A6: approval refuses action-bearing findings without an owner or due date', async () => {
    const id = await investigatedIncident();
    const manager = callerFor(managerId);
    const finding = await manager.incidents.addFinding({
      incidentId: id,
      category: 'procedure',
      priority: 'medium',
      description: 'Rewrite the isolation procedure',
      requiresAction: true,
    });
    await manager.incidents.submitInvestigation({ incidentId: id });
    // Untouched findings (scrolled past in the dialog) refuse the whole
    // approval — no orphan actions the chase digest can never chase.
    await expect(
      callerFor(adminId).incidents.approveInvestigation({ incidentId: id, assignments: [] }),
    ).rejects.toMatchObject({ message: 'finding-assignee-required' });
    await expect(
      callerFor(adminId).incidents.approveInvestigation({
        incidentId: id,
        assignments: [{ findingId: finding.findingId }],
      }),
    ).rejects.toMatchObject({ message: 'finding-assignee-required' });
    // Complete assignment goes through and the action carries both.
    const approved = await callerFor(adminId).incidents.approveInvestigation({
      incidentId: id,
      assignments: [{ findingId: finding.findingId, assigneeUserId: standardId }],
    });
    expect(approved.generatedActionIds).toHaveLength(1);
    const action = await callerFor(adminId).actions.get({
      actionId: approved.generatedActionIds[0] ?? '',
    });
    expect(action.action.assigneeUserId).toBe(standardId);
    expect(action.action.dueAt).not.toBeNull();
  });

  it('IN-A8: a sole-manager tenant approves with a logged justification', async () => {
    const id = await investigatedIncident();
    const manager = callerFor(managerId);
    const finding = await manager.incidents.addFinding({
      incidentId: id,
      category: 'equipment_guarding',
      priority: 'high',
      description: 'Fit interlock monitoring',
      requiresAction: true,
    });
    await manager.incidents.submitInvestigation({ incidentId: id });
    const assignments = [{ findingId: finding.findingId, assigneeUserId: standardId }];
    // While an independent manage-holder exists (the admin), the
    // conflicted manager stays refused — justification or not.
    await expect(
      manager.incidents.approveInvestigation({
        incidentId: id,
        assignments,
        soleManagerJustification: 'Only manager on site.',
      }),
    ).rejects.toMatchObject({ message: 'approver-is-investigator' });
    // Remove the alternative: deactivate the admin → manager is the
    // tenant's only active incidents.manage holder.
    await db
      .update(schema.user)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.user.id, adminId));
    // The override demands a justification…
    await expect(
      manager.incidents.approveInvestigation({ incidentId: id, assignments }),
    ).rejects.toMatchObject({ message: 'sole-manager-justification-required' });
    // …and with one, the approval completes and the record shows it.
    await manager.incidents.approveInvestigation({
      incidentId: id,
      assignments,
      soleManagerJustification:
        'Sole incidents manager in this firm; no independent approver exists.',
    });
    const detail = await manager.incidents.get({ incidentId: id });
    expect(detail.incident.status).toBe('actions_outstanding');
    const approval = detail.events.find((e) => e.kind === 'investigation_approved');
    expect(approval?.detail).toMatchObject({ soleManagerOverride: true });
  });

  it('IN-E12b: only the lead investigator submits', async () => {
    const id = await investigatedIncident();
    await expect(
      callerFor(standardId).incidents.submitInvestigation({ incidentId: id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('IN-E13: approved investigations freeze; reopen starts revision 2 pre-filled', async () => {
    const { incidentId } = await approvedIncident();
    const manager = callerFor(managerId);
    await expect(
      manager.incidents.saveInvestigation({ incidentId, immediateCause: 'rewrite history' }),
    ).rejects.toMatchObject({ message: 'investigation-frozen' });
    await expect(
      manager.incidents.addFinding({
        incidentId,
        category: 'procedure',
        description: 'late finding',
      }),
    ).rejects.toMatchObject({ message: 'investigation-frozen' });

    const admin = callerFor(adminId);
    await admin.incidents.riddorScreen({
      incidentId,
      category: 'not_reportable',
      determinationNote: 'Not reportable.',
    });
    await completeActions(incidentId);
    await admin.incidents.close({ incidentId });
    await admin.incidents.reopen({ incidentId, reason: 'It recurred on night shift' });
    await manager.incidents.startInvestigation({ incidentId });

    const detail = await admin.incidents.get({ incidentId });
    expect(detail.investigations).toHaveLength(2);
    const rev1 = detail.investigations.find((i) => i.revision === 1);
    const rev2 = detail.investigations.find((i) => i.revision === 2);
    expect(rev1?.status).toBe('approved');
    expect(rev1?.immediateCause).toBe('Guard interlock defeated');
    expect(rev2?.status).toBe('draft');
    // Pre-filled from revision 1, signatures reset.
    expect(rev2?.immediateCause).toBe('Guard interlock defeated');
    expect(rev2?.submittedByUserId).toBeNull();
    expect(detail.incident.status).toBe('investigating');
  });

  it('IN-E14: confidential incidents are counted, not readable', async () => {
    const id = await reportIncident({
      kind: 'sharps_exposure',
      title: 'Needlestick in ward 3',
      details: { device: 'Cannula' },
      reporter: standardId,
    });
    // Another standard user: register row is minimal, detail refused.
    const other = callerFor(standard2Id);
    const rows = await other.incidents.list();
    const row = rows.find((r) => r.id === id);
    expect(row).toBeDefined();
    expect(row?.title).toBeNull();
    expect(row?.restricted).toBe(true);
    await expect(other.incidents.get({ incidentId: id })).rejects.toMatchObject({
      message: 'confidential',
    });
    // The reporter and a confidential.view holder (manager) read it fine.
    const own = await callerFor(standardId).incidents.get({ incidentId: id });
    expect(own.incident.title).toBe('Needlestick in ward 3');
    const managerView = await callerFor(managerId).incidents.list();
    expect(managerView.find((r) => r.id === id)?.title).toBe('Needlestick in ward 3');
  });

  it('IN-E15: loaders scope by tenant', async () => {
    // Foreign tenant with its own site + incident.
    const otherTenant = newId();
    await db
      .insert(schema.tenants)
      .values({ id: otherTenant, name: 'Rival', slug: `rival-${otherTenant}` });
    const foreignSite = newId();
    await db
      .insert(schema.sites)
      .values({ id: foreignSite, tenantId: otherTenant, name: 'Elsewhere' });

    const standard = callerFor(standardId);
    await expect(
      standard.incidents.create({
        title: 'Cross-tenant site',
        kind: 'injury',
        occurredAt: occurredYesterday(),
        siteId: foreignSite,
      }),
    ).rejects.toMatchObject({ message: 'site-not-found' });

    const foreignIncident = newId();
    await db.insert(schema.incidents).values({
      id: foreignIncident,
      tenantId: otherTenant,
      referenceNumber: 'IN-000001',
      title: 'Foreign',
      kind: 'injury',
      occurredAt: occurredYesterday(),
      reportedByUserId: 'usr_foreign',
    });
    await expect(standard.incidents.get({ incidentId: foreignIncident })).rejects.toMatchObject({
      message: 'incident-not-found',
    });
    await expect(
      standard.incidents.createFromObservation({ observationId: foreignIncident }),
    ).rejects.toMatchObject({ message: 'observation-not-found' });
  });

  it('IN-E16: evidence and witness statements append only — corrections are new rows', async () => {
    const id = await triagedIncident();
    const manager = callerFor(managerId);
    await manager.incidents.addEvidence({
      incidentId: id,
      kind: 'cctv_ref',
      caption: 'Camera 4, 14:02–14:07, retained until 30 Aug',
    });
    await expect(
      manager.incidents.addEvidence({
        incidentId: id,
        kind: 'photo',
        storageKey: `${tenantId}/permits/xyz/photo.jpg`,
      }),
    ).rejects.toMatchObject({ message: 'invalid-storage-key' });

    await manager.incidents.addWitnessStatement({
      incidentId: id,
      witnessName: 'Bob Fitter',
      statement: 'The guard was already off when the shift started.',
    });
    await manager.incidents.addWitnessStatement({
      incidentId: id,
      witnessName: 'Bob Fitter',
      statement: 'Correction: the guard was removed at 09:30, not before shift.',
    });
    const detail = await manager.incidents.get({ incidentId: id });
    expect(detail.evidence).toHaveLength(1);
    expect(detail.witnesses).toHaveLength(2);
  });

  it('IN-E17: observation promotion links both ways and carries photos', async () => {
    // Minimal observation with one attachment.
    const categoryId = newId();
    await db.insert(schema.issueCategories).values({
      id: categoryId,
      tenantId,
      name: 'Near miss',
      createdBy: adminId,
    });
    const issueId = newId();
    await db.insert(schema.issues).values({
      id: issueId,
      tenantId,
      categoryId,
      title: 'Pallet nearly dropped from rack',
      description: 'Fork truck clipped racking.',
      status: 'open',
      reportedByUserId: standardId,
      siteId: siteA,
      dateOccurred: occurredYesterday(),
      referenceNumber: 'OBS-000042',
      accessSnapshot: {
        groupIds: [],
        siteIds: [],
        permissions: [],
        snapshotAt: new Date().toISOString(),
      },
      categorySnapshot: { categoryId, name: 'Near miss', customFields: [], customQuestions: [] },
    });
    await db.insert(schema.issueAttachments).values({
      id: newId(),
      tenantId,
      issueId,
      storageKey: `${tenantId}/issues/${issueId}/rack.jpg`,
      filename: 'rack.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
      uploadedByUserId: standardId,
    });

    const created = await callerFor(standardId).incidents.createFromObservation({
      observationId: issueId,
    });
    const detail = await callerFor(adminId).incidents.get({ incidentId: created.incidentId });
    expect(detail.incident.observationId).toBe(issueId);
    expect(detail.observation?.referenceNumber).toBe('OBS-000042');
    expect(detail.evidence).toHaveLength(1);
    expect(detail.evidence[0]?.storageKey).toBe(`${tenantId}/issues/${issueId}/rack.jpg`);
    expect(detail.events.some((e) => e.kind === 'promoted_from_observation')).toBe(true);

    // Reverse links: observation activity row + forObservation lookup.
    const activity = await db
      .select()
      .from(schema.issueActivity)
      .where(
        and(eq(schema.issueActivity.tenantId, tenantId), eq(schema.issueActivity.issueId, issueId)),
      );
    expect(activity.some((a) => a.kind === 'escalated_to_incident')).toBe(true);
    const linked = await callerFor(standardId).incidents.forObservation({ observationId: issueId });
    expect(linked).toHaveLength(1);
    expect(linked[0]?.referenceNumber).toBe(created.referenceNumber);
  });

  it('IN-E18: review prompts pull RA/COSHH/FRA due dates to now, citing the incident', async () => {
    const id = await triagedIncident();
    const future = new Date(Date.now() + 90 * DAY);
    const raId = newId();
    await db.insert(schema.riskAssessments).values({
      id: raId,
      tenantId,
      title: 'Machine shop RA',
      status: 'active',
      nextReviewAt: future,
      createdBy: adminId,
    });
    const substanceId = newId();
    await db.insert(schema.coshhSubstances).values({
      id: substanceId,
      tenantId,
      name: 'Degreaser X',
      createdBy: adminId,
    });
    const coshhId = newId();
    await db.insert(schema.coshhAssessments).values({
      id: coshhId,
      tenantId,
      substanceId,
      taskDescription: 'Parts cleaning',
      status: 'active',
      nextReviewAt: future,
      createdBy: adminId,
    });
    const fraId = newId();
    await db.insert(schema.fireRiskAssessments).values({
      id: fraId,
      tenantId,
      title: 'Main works FRA',
      status: 'active',
      nextReviewAt: future,
      createdBy: adminId,
    });

    const admin = callerFor(adminId);
    // Unknown / inactive records refuse.
    await expect(
      admin.incidents.promptReviews({ incidentId: id, riskAssessmentIds: [newId()] }),
    ).rejects.toMatchObject({ message: 'risk-assessment-not-found' });
    await expect(admin.incidents.promptReviews({ incidentId: id })).rejects.toMatchObject({
      message: 'nothing-selected',
    });

    const result = await admin.incidents.promptReviews({
      incidentId: id,
      riskAssessmentIds: [raId],
      coshhAssessmentIds: [coshhId],
      fraIds: [fraId],
    });
    expect(result.prompted).toBe(3);

    const now = Date.now();
    const ra = await db
      .select()
      .from(schema.riskAssessments)
      .where(eq(schema.riskAssessments.id, raId));
    const coshh = await db
      .select()
      .from(schema.coshhAssessments)
      .where(eq(schema.coshhAssessments.id, coshhId));
    const fra = await db
      .select()
      .from(schema.fireRiskAssessments)
      .where(eq(schema.fireRiskAssessments.id, fraId));
    expect(ra[0]?.nextReviewAt?.getTime()).toBeLessThanOrEqual(now);
    expect(coshh[0]?.nextReviewAt?.getTime()).toBeLessThanOrEqual(now);
    expect(fra[0]?.nextReviewAt?.getTime()).toBeLessThanOrEqual(now);

    const raEvents = await db
      .select()
      .from(schema.riskAssessmentEvents)
      .where(eq(schema.riskAssessmentEvents.assessmentId, raId));
    expect(raEvents.some((e) => e.kind === 'review_prompted' && e.detail.includes('IN-'))).toBe(
      true,
    );
    const fireEvents = await db
      .select()
      .from(schema.fireEvents)
      .where(and(eq(schema.fireEvents.tenantId, tenantId), eq(schema.fireEvents.entityId, fraId)));
    expect(fireEvents.some((e) => e.kind === 'review_prompted')).toBe(true);

    const detail = await admin.incidents.get({ incidentId: id });
    expect(detail.incident.reviewPromptAt).not.toBeNull();

    // Skipping requires a reason.
    const id2 = await triagedIncident();
    await expect(admin.incidents.skipReviews({ incidentId: id2, reason: 'x' })).rejects.toThrow();
    await admin.incidents.skipReviews({
      incidentId: id2,
      reason: 'No assessments cover this area',
    });
    const detail2 = await admin.incidents.get({ incidentId: id2 });
    expect(detail2.incident.reviewPromptSkippedReason).toBe('No assessments cover this area');
  });

  it('IN-E19: reference numbering continues past IN-999999', async () => {
    await db
      .insert(schema.referenceCounters)
      .values({ tenantId, series: 'incident', value: 999_999 });
    const id = await reportIncident({ title: 'Millionth' });
    const detail = await callerFor(adminId).incidents.get({ incidentId: id });
    expect(detail.incident.referenceNumber).toBe('IN-1000000');
  });

  it('IN-E20: a not-effective verdict prompts the reopen path', async () => {
    const { incidentId } = await approvedIncident();
    const admin = callerFor(adminId);
    await screenNotReportable(incidentId);
    await completeActions(incidentId);
    await admin.incidents.close({ incidentId });

    const verdict = await admin.incidents.recordEffectiveness({
      incidentId,
      verdict: 'not_effective',
      note: 'Guard removed again within a month.',
    });
    expect(verdict.promptReopen).toBe(true);
    await admin.incidents.reopen({ incidentId, reason: 'Controls did not hold' });
    const detail = await admin.incidents.get({ incidentId });
    expect(detail.incident.status).toBe('reopened');
    expect(detail.incident.effectivenessVerdict).toBe('not_effective');
  });

  it('lifecycle: invalid transitions refuse; cancel needs a reason and authority', async () => {
    const id = await reportIncident();
    const admin = callerFor(adminId);
    // reported → closed is not a legal move.
    await expect(admin.incidents.close({ incidentId: id })).rejects.toMatchObject({
      message: 'invalid-transition',
    });
    // A bystander cannot cancel someone else's report.
    await expect(
      callerFor(standard2Id).incidents.cancel({ incidentId: id, reason: 'duplicate report' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // The reporter can cancel their own while still `reported`.
    await callerFor(standardId).incidents.cancel({
      incidentId: id,
      reason: 'duplicate of IN-000001',
    });
    const rows = await admin.incidents.list({ includeCancelled: true });
    expect(rows.find((r) => r.id === id)?.status).toBe('cancelled');
    // Terminal: nothing moves out of cancelled.
    await expect(
      admin.incidents.triage({
        incidentId: id,
        severity: 'minor',
        investigationLevel: 'basic',
        leadInvestigatorUserId: managerId,
      }),
    ).rejects.toMatchObject({ message: 'invalid-transition' });
  });

  it('permissions: standard users report but never triage, screen or approve', async () => {
    const id = await reportIncident();
    const standard = callerFor(standardId);
    await expect(
      standard.incidents.triage({
        incidentId: id,
        severity: 'minor',
        investigationLevel: 'basic',
        leadInvestigatorUserId: managerId,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      standard.incidents.riddorScreen({
        incidentId: id,
        category: 'death',
        determinationNote: 'x',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      standard.incidents.addWitnessStatement({
        incidentId: id,
        witnessName: 'W',
        statement: 'S',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('severity freezes once an investigation is approved', async () => {
    const { incidentId } = await approvedIncident();
    await expect(
      callerFor(adminId).incidents.setSeverity({ incidentId, severity: 'major' }),
    ).rejects.toMatchObject({ message: 'severity-frozen' });
  });

  it('IN-A3: triage refuses a basic level below the severity floor', async () => {
    const id = await reportIncident();
    await expect(
      callerFor(adminId).incidents.triage({
        incidentId: id,
        severity: 'serious',
        investigationLevel: 'basic',
        leadInvestigatorUserId: managerId,
      }),
    ).rejects.toMatchObject({ message: 'investigation-level-below-floor' });
    // Same judgement with the mandated level goes through.
    await callerFor(adminId).incidents.triage({
      incidentId: id,
      severity: 'serious',
      investigationLevel: 'full',
      leadInvestigatorUserId: managerId,
    });
  });

  /** The stub appRouter deps carry no sendEmail, so the notification-
   *  preference tests build the router with a capturing fake. */
  function incidentsCallerWithMailbox(
    userId: string,
    emails: Array<{ to: string; templateKey: string; variables: Record<string, string> }>,
  ) {
    const custom = router({
      incidents: createIncidentsRouter({
        enabled: true,
        appUrl: 'http://localhost:3000',
        sendEmail: async (mail) => {
          emails.push(mail);
        },
      }),
    });
    return createCallerFactory(custom)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'incidents@x.test', tenantId: tenantId as never },
      }),
    );
  }

  /** Bell rows for the investigator-assigned kind, one user. */
  async function investigatorBells(userId: string) {
    return db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.kind, 'incident_investigator_assigned'),
        ),
      );
  }

  it('prefs: triage emails the new lead and writes their bell row by default', async () => {
    const emails: Array<{ to: string; templateKey: string; variables: Record<string, string> }> =
      [];
    const id = await reportIncident();
    await incidentsCallerWithMailbox(adminId, emails).incidents.triage({
      incidentId: id,
      severity: 'moderate',
      investigationLevel: 'basic',
      leadInvestigatorUserId: managerId,
    });
    expect(emails).toHaveLength(1);
    expect(emails[0]?.templateKey).toBe('incident-investigator-assigned');
    expect(emails[0]?.to).toBe(`mark-${tenantId}@acme.test`);
    const bells = await investigatorBells(managerId);
    expect(bells).toHaveLength(1);
    expect(bells[0]?.title).toBe('Hand caught in nip point');
    expect(bells[0]?.href).toBe(`/incidents/${id}`);
  });

  it('prefs: an email-muted lead gets no triage email; the bell row still lands', async () => {
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'email:incident_investigator_assigned': false } })
      .where(eq(schema.user.id, managerId));
    const emails: Array<{ to: string; templateKey: string; variables: Record<string, string> }> =
      [];
    const id = await reportIncident();
    await incidentsCallerWithMailbox(adminId, emails).incidents.triage({
      incidentId: id,
      severity: 'moderate',
      investigationLevel: 'basic',
      leadInvestigatorUserId: managerId,
    });
    expect(emails).toHaveLength(0);
    expect(await investigatorBells(managerId)).toHaveLength(1);
  });

  it('prefs: assignInvestigator honours each channel toggle per recipient', async () => {
    const emails: Array<{ to: string; templateKey: string; variables: Record<string, string> }> =
      [];
    const id = await triagedIncident();
    const admin = incidentsCallerWithMailbox(adminId, emails);
    // Default prefs: both channels fire.
    await admin.incidents.assignInvestigator({ incidentId: id, userId: standard2Id });
    expect(emails.map((m) => m.to)).toEqual([`nina-${tenantId}@acme.test`]);
    expect(await investigatorBells(standard2Id)).toHaveLength(1);
    // Bell muted: the email still goes, no new row.
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'inapp:incident_investigator_assigned': false } })
      .where(eq(schema.user.id, standard2Id));
    await admin.incidents.assignInvestigator({ incidentId: id, userId: standard2Id });
    expect(emails).toHaveLength(2);
    expect(await investigatorBells(standard2Id)).toHaveLength(1);
    // Email muted: no send, the bell returns.
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'email:incident_investigator_assigned': false } })
      .where(eq(schema.user.id, standard2Id));
    await admin.incidents.assignInvestigator({ incidentId: id, userId: standard2Id });
    expect(emails).toHaveLength(2);
    expect(await investigatorBells(standard2Id)).toHaveLength(2);
  });

  it('IN-A3b: raising severity or a reportable screening auto-raises a basic level', async () => {
    const admin = callerFor(adminId);
    // Severity path.
    const bySeverity = await triagedIncident({ severity: 'minor', level: 'basic' });
    await admin.incidents.setSeverity({ incidentId: bySeverity, severity: 'major' });
    const afterSeverity = await admin.incidents.get({ incidentId: bySeverity });
    expect(afterSeverity.incident.investigationLevel).toBe('full');
    // RIDDOR path.
    const byRiddor = await triagedIncident({ severity: 'minor', level: 'basic' });
    await admin.incidents.riddorScreen({
      incidentId: byRiddor,
      category: 'over_7_day',
      determinationNote: 'Nine days lost — reportable.',
    });
    const afterScreen = await admin.incidents.get({ incidentId: byRiddor });
    expect(afterScreen.incident.investigationLevel).toBe('full');
    // The level-change events are on the record.
    const kinds = afterScreen.events.map((e) => e.kind);
    expect(kinds).toContain('investigation_level_changed');
  });

  it('IN-A3b: explicit level change — upgrade freely, downgrade only clean and above floor', async () => {
    const admin = callerFor(adminId);
    const id = await triagedIncident({ severity: 'minor', level: 'basic' });
    // Upgrade any time.
    await admin.incidents.setInvestigationLevel({ incidentId: id, level: 'full' });
    // Downgrade while nothing has been written and the floor allows it.
    await admin.incidents.setInvestigationLevel({ incidentId: id, level: 'basic' });
    // Once investigation content exists, no downgrade.
    await admin.incidents.setInvestigationLevel({ incidentId: id, level: 'full' });
    await callerFor(managerId).incidents.startInvestigation({ incidentId: id });
    await expect(
      admin.incidents.setInvestigationLevel({ incidentId: id, level: 'basic' }),
    ).rejects.toMatchObject({ message: 'investigation-content-exists' });
    // And never below the floor: a serious incident refuses basic outright.
    const serious = await triagedIncident({ severity: 'serious', level: 'full' });
    await expect(
      admin.incidents.setInvestigationLevel({ incidentId: serious, level: 'basic' }),
    ).rejects.toMatchObject({ message: 'investigation-level-below-floor' });
  });

  it('full-level investigations demand an RCA method and root cause at submit', async () => {
    const id = await triagedIncident({ severity: 'serious', level: 'full' });
    const manager = callerFor(managerId);
    await manager.incidents.startInvestigation({ incidentId: id });
    await manager.incidents.saveInvestigation({
      incidentId: id,
      immediateCause: 'Cause',
      conclusionSummary: 'Summary',
    });
    await expect(manager.incidents.submitInvestigation({ incidentId: id })).rejects.toMatchObject({
      message: 'rca-method-required',
    });
    await manager.incidents.saveInvestigation({
      incidentId: id,
      method: 'five_whys',
      whyChain: [
        { text: 'Why did the hand reach the nip point?' },
        { text: 'The interlock was defeated', isRootCause: true },
      ],
      rootCauseStatement: 'Interlock defeat culture + no inspection.',
    });
    await manager.incidents.submitInvestigation({ incidentId: id });
  });

  it('actions hub: generated actions resolve their incident source and filter', async () => {
    const { incidentId, actionId } = await approvedIncident(standardId);
    const admin = callerFor(adminId);
    const action = await admin.actions.get({ actionId });
    expect(action.action.sourceType).toBe('incident');
    expect(action.source?.type).toBe('incident');
    expect(action.source?.referenceNumber).toMatch(/^IN-/);
    expect(action.action.assigneeUserId).toBe(standardId);
    expect(action.action.dueAt).not.toBeNull(); // priority high → tenant default days
    expect(action.action.siteId).toBe(siteA);

    const filtered = await admin.actions.list({ sourceType: 'incident', sourceId: incidentId });
    expect(filtered.rows.length).toBeGreaterThan(0);
    expect(filtered.rows.every((row) => row.sourceType === 'incident')).toBe(true);
  });

  it('immediate alerts enqueue for alert kinds and serious severity', async () => {
    const enqueued: Array<{ tenantId: string; incidentId: string }> = [];
    const spied = router({
      incidents: createIncidentsRouter({
        enabled: true,
        enqueueIncidentAlert: async (payload) => {
          enqueued.push(payload);
        },
      }),
    });
    const caller = createCallerFactory(spied)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: adminId, email: 'x@x.test', tenantId: tenantId as never },
      }),
    );
    // Dangerous occurrence → alert on create, regardless of severity.
    await caller.incidents.create({
      title: 'Scaffold collapse, no injuries',
      kind: 'dangerous_occurrence',
      occurredAt: occurredYesterday(),
      details: { category: 'scaffold_collapse' },
    });
    expect(enqueued).toHaveLength(1);
    // Minor injury → nothing at create; serious at triage → enqueued.
    const created = await caller.incidents.create({
      title: 'Cut finger',
      kind: 'injury',
      occurredAt: occurredYesterday(),
    });
    expect(enqueued).toHaveLength(1);
    await caller.incidents.triage({
      incidentId: created.incidentId,
      severity: 'serious',
      investigationLevel: 'full',
      leadInvestigatorUserId: managerId,
    });
    expect(enqueued).toHaveLength(2);

    // IN-A2: a hospital admission on the report floors the provisional
    // severity at serious → the alert fires at create, before triage.
    const admitted = await caller.incidents.create({
      title: 'Fall from ladder',
      kind: 'injury',
      occurredAt: occurredYesterday(),
      persons: [
        {
          name: 'Paul Painter',
          category: 'employee',
          injury: { bodyParts: ['head'], injuryKinds: ['fracture'], hospitalisation: 'admitted' },
        },
      ],
    });
    expect(enqueued).toHaveLength(3);
    const admittedRow = await caller.incidents.get({ incidentId: admitted.incidentId });
    expect(admittedRow.incident.severity).toBe('serious');

    // Reporter's explicit judgement also arms the alert.
    await caller.incidents.create({
      title: 'Amputation at press',
      kind: 'injury',
      occurredAt: occurredYesterday(),
      severity: 'major',
    });
    expect(enqueued).toHaveLength(4);

    // A&E floors moderate — visible, but not alert-worthy on its own.
    const ae = await caller.incidents.create({
      title: 'Sprained wrist',
      kind: 'injury',
      occurredAt: occurredYesterday(),
      persons: [{ name: 'Wes Worker', category: 'employee', injury: { hospitalisation: 'ae' } }],
    });
    expect(enqueued).toHaveLength(4);
    const aeRow = await caller.incidents.get({ incidentId: ae.incidentId });
    expect(aeRow.incident.severity).toBe('moderate');
  });

  it('IN-A2: overview counts untriaged reports separately', async () => {
    await reportIncident({ title: 'Untriaged one' });
    await reportIncident({ title: 'Untriaged two' });
    const triaged = await reportIncident({ title: 'Triaged' });
    await callerFor(adminId).incidents.triage({
      incidentId: triaged,
      severity: 'minor',
      investigationLevel: 'basic',
      leadInvestigatorUserId: managerId,
    });
    const overview = await callerFor(adminId).incidents.overview();
    expect(overview.untriaged).toBe(2);
    expect(overview.open).toBe(3);
  });

  it('csv export redacts confidential rows and counts days lost', async () => {
    await reportIncident({ title: 'Open incident' });
    await reportIncident({
      kind: 'sharps_exposure',
      title: 'Secret sharps',
      details: { device: 'Cannula' },
      reporter: standardId,
    });
    const csvResult = await callerFor(standard2Id).incidents.exportCsv();
    expect(csvResult.rowCount).toBe(2);
    expect(csvResult.csv).toContain('Open incident');
    expect(csvResult.csv).not.toContain('Secret sharps');
    expect(csvResult.csv).toContain('Confidential');
  });

  it('renderPdf refuses when the renderer is not wired', async () => {
    const id = await reportIncident();
    await expect(callerFor(adminId).incidents.renderPdf({ incidentId: id })).rejects.toMatchObject({
      message: 'render-unavailable',
    });
  });

  /**
   * IN-P01..P14 — the per-investigation visibility circle (migration
   * 0086). The circle composes with, never replaces, the confidential-
   * incident doctrine: outsiders are counted-not-readable, implicit
   * access stays with administrators and the incident's lead
   * investigator ONLY — `incidents.confidential.view` deliberately does
   * not bypass the circle, so the seeded Manager set is bound by it too
   * (IN-P14, PR #84) — and every workspace write requires membership on
   * top of the existing authority checks.
   */
  describe('IN-P: per-investigation visibility circle', () => {
    /** Outsider holding `incidents.view` / `investigate` / `manage`. */
    let outsiderId: string;
    /** A second seeded-Manager-set user (never the lead) — IN-P14. */
    let manager2Id: string;

    beforeEach(async () => {
      const setId = newId();
      await db.insert(schema.permissionSets).values({
        id: setId,
        tenantId,
        name: 'Investigator without confidential key',
        permissions: [
          'incidents.view',
          'incidents.report',
          'incidents.investigate',
          'incidents.manage',
        ],
        isSystem: false,
      });
      outsiderId = `usr_${newId()}`;
      const managerSet = await db.query.permissionSets.findFirst({
        where: (ps, { and, eq }) =>
          and(eq(ps.tenantId, tenantId), eq(ps.isSystem, true), eq(ps.name, 'Manager')),
      });
      if (managerSet === undefined) throw new Error('Manager set not seeded');
      manager2Id = `usr_${newId()}`;
      await db.insert(schema.user).values([
        {
          id: outsiderId,
          name: 'Olly Outsider',
          email: `olly-${tenantId}@acme.test`,
          tenantId,
          permissionSetId: setId,
        },
        {
          id: manager2Id,
          name: 'Marta Manager',
          email: `marta-${tenantId}@acme.test`,
          tenantId,
          permissionSetId: managerSet.id,
        },
      ]);
    });

    /** triaged (lead = manager) → started with a circle of [standard]. */
    async function restrictedIncident(): Promise<string> {
      const id = await triagedIncident();
      await callerFor(managerId).incidents.startInvestigation({
        incidentId: id,
        participantUserIds: [standardId],
      });
      return id;
    }

    it('IN-P01: starting with a circle folds the lead in; empty list means unrestricted', async () => {
      const id = await restrictedIncident();
      const detail = await callerFor(managerId).incidents.get({ incidentId: id });
      expect(detail.investigationRestricted).toBe(false);
      expect(detail.investigations[0]?.participantUserIds).toEqual(
        expect.arrayContaining([standardId, managerId]),
      );

      const openId = await triagedIncident();
      await callerFor(managerId).incidents.startInvestigation({
        incidentId: openId,
        participantUserIds: [],
      });
      const openDetail = await callerFor(outsiderId).incidents.get({ incidentId: openId });
      expect(openDetail.investigationRestricted).toBe(false);
      expect(openDetail.investigations[0]?.participantUserIds).toBeNull();
    });

    it('IN-P02: unknown or deactivated participants are refused, never dropped', async () => {
      const id = await triagedIncident();
      await expect(
        callerFor(managerId).incidents.startInvestigation({
          incidentId: id,
          participantUserIds: [newId()],
        }),
      ).rejects.toMatchObject({ message: 'unknown-participant' });
      await db
        .update(schema.user)
        .set({ deactivatedAt: new Date() })
        .where(eq(schema.user.id, standard2Id));
      await expect(
        callerFor(managerId).incidents.startInvestigation({
          incidentId: id,
          participantUserIds: [standard2Id],
        }),
      ).rejects.toMatchObject({ message: 'unknown-participant' });
    });

    it('IN-P03: get is counted-not-readable for outsiders — content gone, existence kept', async () => {
      const id = await restrictedIncident();
      await callerFor(managerId).incidents.saveInvestigation({
        incidentId: id,
        immediateCause: 'Secret cause',
        conclusionSummary: 'Secret conclusion',
      });
      await callerFor(managerId).incidents.addFinding({
        incidentId: id,
        category: 'equipment_guarding',
        priority: 'high',
        description: 'Secret finding',
        requiresAction: false,
      });

      const outsider = await callerFor(outsiderId).incidents.get({ incidentId: id });
      expect(outsider.investigationRestricted).toBe(true);
      expect(outsider.investigations).toHaveLength(0);
      expect(outsider.findings).toHaveLength(0);
      // The timeline keeps the row (the audit trail is existence) but
      // blanks investigation event payloads.
      const started = outsider.events.find((e) => e.kind === 'investigation_started');
      expect(started).toBeDefined();
      expect(started?.detail).toEqual({});

      // A plain viewer outside the circle is equally blind.
      const viewer = await callerFor(standard2Id).incidents.get({ incidentId: id });
      expect(viewer.investigationRestricted).toBe(true);
      expect(viewer.investigations).toHaveLength(0);

      // Participant, lead and admin all read normally.
      for (const allowed of [standardId, managerId, adminId]) {
        const detail = await callerFor(allowed).incidents.get({ incidentId: id });
        expect(detail.investigationRestricted).toBe(false);
        expect(detail.investigations).toHaveLength(1);
        expect(detail.findings).toHaveLength(1);
      }
    });

    it('IN-P04: workspace writes require circle membership on top of authority', async () => {
      const id = await restrictedIncident();
      const outsider = callerFor(outsiderId);
      await expect(
        outsider.incidents.saveInvestigation({ incidentId: id, immediateCause: 'x' }),
      ).rejects.toMatchObject({ message: 'investigation-restricted' });
      await expect(
        outsider.incidents.addFinding({
          incidentId: id,
          category: 'equipment_guarding',
          priority: 'low',
          description: 'x',
          requiresAction: false,
        }),
      ).rejects.toMatchObject({ message: 'investigation-restricted' });
      await expect(
        outsider.incidents.setInvestigationLevel({ incidentId: id, level: 'full' }),
      ).rejects.toMatchObject({ message: 'investigation-restricted' });
    });

    it('IN-P05: approval of a restricted thread needs membership; admins still approve', async () => {
      const id = await restrictedIncident();
      const manager = callerFor(managerId);
      await manager.incidents.saveInvestigation({
        incidentId: id,
        immediateCause: 'Guard defeated',
        conclusionSummary: 'Guarding failure.',
      });
      await manager.incidents.submitInvestigation({ incidentId: id });
      await expect(
        callerFor(outsiderId).incidents.approveInvestigation({ incidentId: id, assignments: [] }),
      ).rejects.toMatchObject({ message: 'investigation-restricted' });
      await expect(
        callerFor(outsiderId).incidents.rejectInvestigation({ incidentId: id, note: 'no' }),
      ).rejects.toMatchObject({ message: 'investigation-restricted' });
      // Admin approval is the implicit-access path working as designed.
      const approved = await callerFor(adminId).incidents.approveInvestigation({
        incidentId: id,
        assignments: [],
      });
      expect(approved.generatedActionIds).toEqual([]);
      const detail = await callerFor(adminId).incidents.get({ incidentId: id });
      expect(detail.investigations[0]?.status).toBe('approved');
    });

    it('IN-P06: only the lead or an admin edits the circle; changes bite immediately', async () => {
      const id = await restrictedIncident();
      // A participant who is not the lead cannot edit the circle (the
      // Standard set fails at requirePermission('incidents.investigate'),
      // one gate earlier — still FORBIDDEN, still no edit).
      await expect(
        callerFor(standardId).incidents.setInvestigationParticipants({
          incidentId: id,
          participantUserIds: [standardId, standard2Id],
        }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        callerFor(outsiderId).incidents.setInvestigationParticipants({
          incidentId: id,
          participantUserIds: null,
        }),
      ).rejects.toMatchObject({ message: 'not-lead-investigator' });

      // The lead swaps standard out for standard2 — standard loses access.
      await callerFor(managerId).incidents.setInvestigationParticipants({
        incidentId: id,
        participantUserIds: [standard2Id],
      });
      const dropped = await callerFor(standardId).incidents.get({ incidentId: id });
      expect(dropped.investigationRestricted).toBe(true);

      // Unknown ids are refused on edit exactly as on start.
      await expect(
        callerFor(managerId).incidents.setInvestigationParticipants({
          incidentId: id,
          participantUserIds: [newId()],
        }),
      ).rejects.toMatchObject({ message: 'unknown-participant' });

      // Null clears the restriction for everyone; the event log records it.
      await callerFor(adminId).incidents.setInvestigationParticipants({
        incidentId: id,
        participantUserIds: null,
      });
      const reopened = await callerFor(outsiderId).incidents.get({ incidentId: id });
      expect(reopened.investigationRestricted).toBe(false);
      expect(
        reopened.events.filter((e) => e.kind === 'investigation_participants_changed'),
      ).toHaveLength(2);
    });

    it('IN-P07: reopen copies the circle forward; outsiders cannot reopen', async () => {
      const id = await restrictedIncident();
      const manager = callerFor(managerId);
      await manager.incidents.saveInvestigation({
        incidentId: id,
        immediateCause: 'Guard defeated',
        conclusionSummary: 'Guarding failure.',
      });
      await manager.incidents.submitInvestigation({ incidentId: id });
      await callerFor(adminId).incidents.approveInvestigation({ incidentId: id, assignments: [] });
      // Reach the reopenable state the ordinary way (IN-E13's path).
      await screenNotReportable(id);
      await callerFor(adminId).incidents.close({ incidentId: id });
      await callerFor(adminId).incidents.reopen({ incidentId: id, reason: 'Recurred on nights' });

      await expect(
        callerFor(outsiderId).incidents.startInvestigation({ incidentId: id }),
      ).rejects.toMatchObject({ message: 'investigation-restricted' });

      await manager.incidents.startInvestigation({ incidentId: id });
      const detail = await manager.incidents.get({ incidentId: id });
      expect(detail.investigations).toHaveLength(2);
      expect(detail.investigations[1]?.participantUserIds).toEqual(
        detail.investigations[0]?.participantUserIds,
      );
    });

    it('IN-P08: listInvestigations lists what the viewer may open and counts the rest', async () => {
      const openId = await investigatedIncident();
      const restrictedId = await restrictedIncident();

      const outsider = await callerFor(outsiderId).incidents.listInvestigations();
      expect(outsider.rows.map((r) => r.incidentId)).toEqual([openId]);
      expect(outsider.restrictedCount).toBe(1);

      const admin = await callerFor(adminId).incidents.listInvestigations();
      expect(admin.rows).toHaveLength(2);
      expect(admin.restrictedCount).toBe(0);
      expect(admin.rows.find((r) => r.incidentId === restrictedId)?.restrictedCircle).toBe(true);
      expect(admin.rows.find((r) => r.incidentId === openId)?.restrictedCircle).toBe(false);

      const participant = await callerFor(standardId).incidents.listInvestigations();
      expect(participant.rows).toHaveLength(2);
      expect(participant.restrictedCount).toBe(0);
    });

    it('IN-P09: the incident PDF is refused outright for outsiders', async () => {
      const id = await restrictedIncident();
      await expect(
        callerFor(outsiderId).incidents.renderPdf({ incidentId: id }),
      ).rejects.toMatchObject({ message: 'investigation-restricted' });
      // A participant clears the gate and hits the next guard (no
      // renderer wired in tests), proving the refusal above was the
      // circle and nothing else.
      await expect(
        callerFor(standardId).incidents.renderPdf({ incidentId: id }),
      ).rejects.toMatchObject({ message: 'render-unavailable' });
    });

    /** save → submit → approve → screen → close → reopen, by the book. */
    async function reopenedIncident(incidentId: string): Promise<void> {
      const manager = callerFor(managerId);
      await manager.incidents.saveInvestigation({
        incidentId,
        immediateCause: 'Guard defeated',
        conclusionSummary: 'Guarding failure.',
      });
      await manager.incidents.submitInvestigation({ incidentId });
      await callerFor(adminId).incidents.approveInvestigation({ incidentId, assignments: [] });
      await screenNotReportable(incidentId);
      await callerFor(adminId).incidents.close({ incidentId });
      await callerFor(adminId).incidents.reopen({ incidentId, reason: 'Recurred on nights' });
    }

    it('IN-P11: a non-lead insider may reopen with the inherited circle, never a changed one', async () => {
      const id = await triagedIncident();
      await callerFor(managerId).incidents.startInvestigation({
        incidentId: id,
        participantUserIds: [outsiderId],
      });
      await reopenedIncident(id);

      // Changing the circle at reopen is lead-or-admin only — the
      // reopen path must not be an end-run around
      // setInvestigationParticipants.
      await expect(
        callerFor(outsiderId).incidents.startInvestigation({
          incidentId: id,
          participantUserIds: [outsiderId, standard2Id],
        }),
      ).rejects.toMatchObject({ message: 'not-lead-investigator' });
      await expect(
        callerFor(outsiderId).incidents.startInvestigation({
          incidentId: id,
          participantUserIds: [],
        }),
      ).rejects.toMatchObject({ message: 'not-lead-investigator' });

      // Re-sending the inherited circle (what the UI pre-fills) passes.
      await callerFor(outsiderId).incidents.startInvestigation({
        incidentId: id,
        participantUserIds: [outsiderId, managerId],
      });
      const detail = await callerFor(managerId).incidents.get({ incidentId: id });
      expect(detail.investigations).toHaveLength(2);
      expect([...(detail.investigations[1]?.participantUserIds ?? [])].sort()).toEqual(
        [...(detail.investigations[0]?.participantUserIds ?? [])].sort(),
      );
      // An unchanged circle logs no participants event.
      expect(
        detail.events.filter((e) => e.kind === 'investigation_participants_changed'),
      ).toHaveLength(0);
    });

    it('IN-P12: the lead may change the circle at reopen, and the change is logged', async () => {
      const id = await restrictedIncident();
      await reopenedIncident(id);
      await callerFor(managerId).incidents.startInvestigation({
        incidentId: id,
        participantUserIds: [standard2Id],
      });
      const detail = await callerFor(managerId).incidents.get({ incidentId: id });
      expect(detail.investigations[1]?.participantUserIds).toEqual(
        expect.arrayContaining([standard2Id, managerId]),
      );
      expect(detail.events.some((e) => e.kind === 'investigation_participants_changed')).toBe(true);
    });

    it('IN-P13: no lead-grab from outside the circle; a deactivated member round-trips', async () => {
      const id = await restrictedIncident();
      // assignInvestigator would hand the caller implicit access — the
      // one-call dissolution of the restriction — so it is gated too.
      await expect(
        callerFor(outsiderId).incidents.assignInvestigator({ incidentId: id, userId: outsiderId }),
      ).rejects.toMatchObject({ message: 'investigation-restricted' });

      // A member who has since been deactivated stays storable when the
      // editor round-trips the current circle; new additions are still
      // validated as active.
      await db
        .update(schema.user)
        .set({ deactivatedAt: new Date() })
        .where(eq(schema.user.id, standardId));
      await callerFor(managerId).incidents.setInvestigationParticipants({
        incidentId: id,
        participantUserIds: [standardId, managerId, standard2Id],
      });
      const detail = await callerFor(adminId).incidents.get({ incidentId: id });
      expect(detail.investigations[0]?.participantUserIds).toEqual(
        expect.arrayContaining([standardId, standard2Id]),
      );
    });

    it('IN-P14: the seeded Manager set is bound by the circle — confidential.view is no bypass', async () => {
      const id = await restrictedIncident();
      // Marta holds the full seeded Manager set, incidents.confidential.view
      // included, and is neither the lead nor in the circle: she must be
      // counted-not-readable like anyone else (the product decision this
      // pins — "managers by default should not see the investigation").
      const detail = await callerFor(manager2Id).incidents.get({ incidentId: id });
      expect(detail.investigationRestricted).toBe(true);
      expect(detail.investigations).toHaveLength(0);
      expect(detail.findings).toHaveLength(0);

      await expect(
        callerFor(manager2Id).incidents.saveInvestigation({ incidentId: id, immediateCause: 'x' }),
      ).rejects.toMatchObject({ message: 'investigation-restricted' });
      await expect(
        callerFor(manager2Id).incidents.renderPdf({ incidentId: id }),
      ).rejects.toMatchObject({ message: 'investigation-restricted' });
      await expect(
        callerFor(manager2Id).incidents.assignInvestigator({ incidentId: id, userId: manager2Id }),
      ).rejects.toMatchObject({ message: 'investigation-restricted' });

      const register = await callerFor(manager2Id).incidents.listInvestigations();
      expect(register.rows).toHaveLength(0);
      expect(register.restrictedCount).toBe(1);

      // Added to the circle, she reads normally — selection is the gate.
      await callerFor(managerId).incidents.setInvestigationParticipants({
        incidentId: id,
        participantUserIds: [standardId, manager2Id],
      });
      const after = await callerFor(manager2Id).incidents.get({ incidentId: id });
      expect(after.investigationRestricted).toBe(false);
      expect(after.investigations).toHaveLength(1);
    });

    it('IN-P10: listInvestigations also hides confidential incidents the viewer is outside', async () => {
      // Confidential incident (sharps) with an unrestricted investigation:
      // the register must not leak it to non-holders via the new tab.
      const sharpsId = await reportIncident({
        kind: 'sharps_exposure',
        title: 'Needlestick in theatre',
        details: { device: 'Cannula' },
      });
      await callerFor(adminId).incidents.triage({
        incidentId: sharpsId,
        severity: 'moderate',
        investigationLevel: 'basic',
        leadInvestigatorUserId: managerId,
      });
      await callerFor(managerId).incidents.startInvestigation({ incidentId: sharpsId });

      const outsider = await callerFor(outsiderId).incidents.listInvestigations();
      expect(outsider.rows).toHaveLength(0);
      expect(outsider.restrictedCount).toBe(1);
      const admin = await callerFor(adminId).incidents.listInvestigations();
      expect(admin.rows.map((r) => r.incidentId)).toEqual([sharpsId]);
    });
  });
});

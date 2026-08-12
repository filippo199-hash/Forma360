/**
 * Integration tests for the fireSafety router (FreeHS module B3).
 *
 * Edge cases (FS-E01..E07 are the pure-helper cases in
 * packages/shared/src/fire-safety.test.ts):
 *   - FS-E10: buildings.create seeds exactly the profile-applicable
 *     checks; setupChecks is idempotent; high-rise residential gets the
 *     2022 Regulations duties
 *   - FS-E11: tenant isolation on buildings.get / fras.get
 *   - FS-E12: a disabled module (wrong brand) refuses every call
 *   - FS-E13: standard users can view and record checks but cannot
 *     create buildings or publish FRAs
 *   - FS-E14: fras.create stamps sequential FRA-XXXX refs
 *   - FS-E15: publish guards (risk rating, responsible person, findings
 *     or explicit confirmation) and creates one action per
 *     requires-action finding, exactly once across republishes
 *   - FS-E16: recordReview appends to the review log and computes the
 *     next review date; a draft FRA cannot be reviewed
 *   - FS-E17: an archived FRA refuses update / review / publish
 *   - FS-E18: logbook.recordEntry advances the schedule, never
 *     backwards; a failed check with raiseAction creates one action
 *   - FS-E19: logbook.due surfaces overdue checks; overview counts them
 *   - FS-E20: door cadence follows the >11 m residential regime
 *     (quarterly common parts); defect inspections raise actions and
 *     advance the due date
 *   - FS-E21: drills.record satisfies the fire_drill schedule and
 *     rejects a roll exceeding those present
 *   - FS-E22: PEEPs review on cadence and end-not-delete
 *   - FS-E23: marshal coverage flags buildings with nobody in date;
 *     double-adding an active marshal conflicts
 *   - FS-E24: profile changes re-seed the calendar — new duties appear,
 *     no-longer-applicable auto checks deactivate
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
import { createFireSafetyRouter } from './fireSafety';
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
  createLogger({ service: 'fire-safety-test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);

const DAY_MS = 24 * 60 * 60 * 1000;

describe('fireSafety router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let standardId: string;
  let siteA: string;

  function callerFor(userId: string) {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'fire@x.test', tenantId: tenantId as never },
      }),
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
    standardId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminId,
        name: 'Alice Admin',
        email: `alice-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: standardId,
        name: 'Stan Standard',
        email: `stan-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.standard,
      },
    ]);
    siteA = newId();
    await db.insert(schema.sites).values([{ id: siteA, tenantId, name: 'HQ Campus' }]);
  });

  afterEach(async () => {
    await client.close();
  });

  /** Satisfy the FS-4 content gate: a publishable assessment has an
   *  assessment in it — people at risk, the fire triangle, evaluation. */
  async function fillFraContent(caller: ReturnType<typeof callerFor>, fraId: string) {
    await caller.fireSafety.fras.update({
      fraId,
      personsAtRisk: ['employees', 'visitors'],
      ignitionSources: 'Kitchen equipment; electrical intake',
      fuelSources: 'Packaging store; furniture',
      oxygenSources: 'Natural ventilation',
      evaluationNotes: 'Evaluated per PAS 79; controls adequate save the findings recorded.',
    });
  }

  async function createOffice(caller: ReturnType<typeof callerFor>) {
    return caller.fireSafety.buildings.create({
      name: 'Unit 4 Office',
      siteId: siteA,
      address: '1 Works Lane',
      useDescription: 'Offices',
      isResidential: false,
      hasFireAlarm: true,
      hasEmergencyLighting: true,
      hasSprinklers: false,
      hasDampers: false,
      hasRisers: false,
      externalWallSystem: '',
      compartmentationNotes: '',
      meansOfEscapeNotes: '',
      serviceRisersNotes: '',
      secureInfoBoxLocation: '',
      infoDocuments: [],
    });
  }

  async function createTower(caller: ReturnType<typeof callerFor>) {
    return caller.fireSafety.buildings.create({
      name: 'Riverside Tower',
      siteId: siteA,
      address: '2 Riverside Walk',
      useDescription: 'Residential flats',
      isResidential: true,
      heightMetres: 24,
      storeys: 9,
      hasFireAlarm: true,
      hasEmergencyLighting: true,
      hasSprinklers: true,
      hasDampers: false,
      hasRisers: true,
      externalWallSystem: 'ACM removed 2021; EWS1 A2',
      compartmentationNotes: '',
      meansOfEscapeNotes: 'Single stair',
      serviceRisersNotes: 'Dry riser east core',
      secureInfoBoxLocation: 'Ground floor lobby',
      infoDocuments: [],
    });
  }

  it('FS-E10: create seeds the profile-applicable checks; setupChecks is idempotent', async () => {
    const caller = callerFor(adminId);
    const office = await createOffice(caller);
    const officeChecks = await caller.fireSafety.logbook.checks({ buildingId: office.id });
    const officeTypes = officeChecks.map((c) => c.checkType).sort();
    expect(officeTypes).toContain('alarm_test');
    expect(officeTypes).toContain('extinguisher_visual');
    expect(officeTypes).toContain('fire_drill');
    expect(officeTypes).not.toContain('sprinkler_check');
    expect(officeTypes).not.toContain('secure_info_box_check');

    const tower = await createTower(caller);
    const towerChecks = await caller.fireSafety.logbook.checks({ buildingId: tower.id });
    const towerTypes = towerChecks.map((c) => c.checkType);
    expect(towerTypes).toContain('sprinkler_check');
    expect(towerTypes).toContain('riser_service');
    expect(towerTypes).toContain('lift_firefighting_check');
    expect(towerTypes).toContain('secure_info_box_check');
    expect(towerTypes).toContain('wayfinding_signage_check');
    // Weekly alarm test carries the statutory default frequency.
    expect(towerChecks.find((c) => c.checkType === 'alarm_test')?.frequency).toBe('weekly');

    // Idempotent: nothing to add or remove on a second run.
    const again = await caller.fireSafety.buildings.setupChecks({ buildingId: tower.id });
    expect(again).toEqual({ added: 0, deactivated: 0 });
    const after = await caller.fireSafety.logbook.checks({ buildingId: tower.id });
    expect(after.length).toBe(towerChecks.length);
  });

  it('FS-E11: tenant isolation on buildings.get and fras.get', async () => {
    const caller = callerFor(adminId);
    const building = await createOffice(caller);
    const fra = await caller.fireSafety.fras.create({ title: 'Office FRA' });

    const otherTenant = newId();
    await db
      .insert(schema.tenants)
      .values({ id: otherTenant, name: 'Rival', slug: `rival-${otherTenant}` });
    const otherSets = await seedDefaultPermissionSets(db as never, otherTenant);
    const outsiderId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: outsiderId,
      name: 'Oscar Outsider',
      email: `oscar-${otherTenant}@rival.test`,
      tenantId: otherTenant,
      permissionSetId: otherSets.administrator,
    });
    const outsider = createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: outsiderId, email: 'o@x.test', tenantId: otherTenant as never },
      }),
    );
    await expect(
      outsider.fireSafety.buildings.get({ buildingId: building.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(outsider.fireSafety.fras.get({ fraId: fra.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('FS-E12: a disabled module refuses every call', async () => {
    const disabledRouter = router({ fireSafety: createFireSafetyRouter({ enabled: false }) });
    const disabledCaller = createCallerFactory(disabledRouter)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: adminId, email: 'a@x.test', tenantId: tenantId as never },
      }),
    );
    await expect(disabledCaller.fireSafety.buildings.list({})).rejects.toMatchObject({
      message: 'module-disabled',
    });
    await expect(disabledCaller.fireSafety.fras.create({ title: 'Nope' })).rejects.toMatchObject({
      message: 'module-disabled',
    });
    await expect(disabledCaller.fireSafety.overview()).rejects.toMatchObject({
      message: 'module-disabled',
    });
  });

  it('FS-E13: standard users view and record but cannot create or publish', async () => {
    const admin = callerFor(adminId);
    const standard = callerFor(standardId);
    const building = await createOffice(admin);

    await expect(standard.fireSafety.buildings.list({})).resolves.toHaveLength(1);
    const entry = await standard.fireSafety.logbook.recordEntry({
      buildingId: building.id,
      checkType: 'alarm_test',
      result: 'pass',
      callPointRef: 'MCP-1 lobby',
      notes: '',
      defectsSummary: '',
      raiseAction: false,
    });
    expect(entry.id).toBeTruthy();

    await expect(createOffice(standard)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const fra = await admin.fireSafety.fras.create({ title: 'Office FRA' });
    await expect(
      standard.fireSafety.fras.publish({ fraId: fra.id, confirmNoSignificantFindings: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('FS-E14: fras.create stamps sequential FRA-XXXX references', async () => {
    const caller = callerFor(adminId);
    const first = await caller.fireSafety.fras.create({ title: 'First' });
    const second = await caller.fireSafety.fras.create({ title: 'Second' });
    const firstRow = await caller.fireSafety.fras.get({ fraId: first.id });
    const secondRow = await caller.fireSafety.fras.get({ fraId: second.id });
    expect(firstRow.referenceNumber).toBe('FRA-0001');
    expect(secondRow.referenceNumber).toBe('FRA-0002');
  });

  it('FS-E15: publish guards, then one action per requires-action finding, exactly once', async () => {
    const caller = callerFor(adminId);
    const building = await createTower(caller);
    const fra = await caller.fireSafety.fras.create({
      title: 'Tower FRA',
      buildingId: building.id,
    });

    // Guard chain (FS-4): rating → responsible person → the assessment
    // content itself (persons at risk, fire triangle, evaluation) →
    // findings. A hollow attestation must not be signable.
    await expect(caller.fireSafety.fras.publish({ fraId: fra.id })).rejects.toMatchObject({
      message: 'no-risk-rating',
    });
    await caller.fireSafety.fras.update({ fraId: fra.id, riskRating: 'moderate' });
    await expect(caller.fireSafety.fras.publish({ fraId: fra.id })).rejects.toMatchObject({
      message: 'no-responsible-person',
    });
    await caller.fireSafety.fras.update({ fraId: fra.id, responsiblePersonName: 'Pat Owner' });
    await expect(caller.fireSafety.fras.publish({ fraId: fra.id })).rejects.toMatchObject({
      message: 'no-persons-at-risk',
    });
    await caller.fireSafety.fras.update({ fraId: fra.id, personsAtRisk: ['residents'] });
    await expect(caller.fireSafety.fras.publish({ fraId: fra.id })).rejects.toMatchObject({
      message: 'no-ignition-sources',
    });
    await caller.fireSafety.fras.update({ fraId: fra.id, ignitionSources: 'Smoking; bin store' });
    await expect(caller.fireSafety.fras.publish({ fraId: fra.id })).rejects.toMatchObject({
      message: 'no-fuel-sources',
    });
    await caller.fireSafety.fras.update({ fraId: fra.id, fuelSources: 'Communal storage' });
    await expect(caller.fireSafety.fras.publish({ fraId: fra.id })).rejects.toMatchObject({
      message: 'no-oxygen-sources',
    });
    await caller.fireSafety.fras.update({ fraId: fra.id, oxygenSources: 'Stairwell venting' });
    await expect(caller.fireSafety.fras.publish({ fraId: fra.id })).rejects.toMatchObject({
      message: 'no-evaluation',
    });
    await caller.fireSafety.fras.update({
      fraId: fra.id,
      evaluationNotes: 'Five-step evaluation recorded.',
    });
    await expect(caller.fireSafety.fras.publish({ fraId: fra.id })).rejects.toMatchObject({
      message: 'no-findings',
    });

    await caller.fireSafety.fras.addFinding({
      fraId: fra.id,
      category: 'fire_doors',
      priority: 'high',
      description: 'Flat entrance doors on floor 3 missing self-closers',
      requiresAction: true,
    });
    await caller.fireSafety.fras.addFinding({
      fraId: fra.id,
      category: 'management',
      priority: 'low',
      description: 'Logbook kept on paper only',
      requiresAction: false,
    });

    const published = await caller.fireSafety.fras.publish({ fraId: fra.id });
    expect(published.actionsCreated).toBe(1);

    const actionRows = await db
      .select()
      .from(schema.actions)
      .where(
        and(
          eq(schema.actions.tenantId, tenantId),
          eq(schema.actions.sourceType, 'fire_risk_assessment'),
        ),
      );
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0]?.sourceId).toBe(fra.id);
    expect(actionRows[0]?.priority).toBe('high');
    expect(actionRows[0]?.siteId).toBe(siteA);

    // Republish must not duplicate the action.
    const republished = await caller.fireSafety.fras.publish({ fraId: fra.id });
    expect(republished.actionsCreated).toBe(0);

    const after = await caller.fireSafety.fras.get({ fraId: fra.id });
    expect(after.status).toBe('active');
    expect(after.publishedBy).toBe(adminId);
    expect(after.nextReviewAt).not.toBeNull();
  });

  it('FS-E16: recordReview appends to the log and schedules the next review', async () => {
    const caller = callerFor(adminId);
    const fra = await caller.fireSafety.fras.create({ title: 'Warehouse FRA' });
    await expect(
      caller.fireSafety.fras.recordReview({
        fraId: fra.id,
        trigger: 'scheduled',
        outcome: 'confirmed',
        note: '',
      }),
    ).rejects.toMatchObject({ message: 'not-active' });

    await caller.fireSafety.fras.update({
      fraId: fra.id,
      riskRating: 'tolerable',
      responsiblePersonName: 'Pat Owner',
    });
    await fillFraContent(caller, fra.id);
    await caller.fireSafety.fras.publish({
      fraId: fra.id,
      confirmNoSignificantFindings: true,
    });

    await caller.fireSafety.fras.recordReview({
      fraId: fra.id,
      trigger: 'post_incident',
      outcome: 'updated',
      note: 'Small bin fire in the yard — housekeeping tightened.',
    });
    const after = await caller.fireSafety.fras.get({ fraId: fra.id });
    expect(after.reviews).toHaveLength(1);
    expect(after.reviews[0]?.trigger).toBe('post_incident');
    expect(after.lastReviewedBy).toBe(adminId);
    // Tolerable rating → 12-month cadence from the review.
    const expected = new Date();
    expected.setUTCMonth(expected.getUTCMonth() + 12);
    const diffDays = Math.abs((after.nextReviewAt?.getTime() ?? 0) - expected.getTime()) / DAY_MS;
    expect(diffDays).toBeLessThan(2);
  });

  it('FS-E17: an archived FRA refuses update, review and publish', async () => {
    const caller = callerFor(adminId);
    const fra = await caller.fireSafety.fras.create({ title: 'Old FRA' });
    await caller.fireSafety.fras.archive({ fraId: fra.id });
    await expect(
      caller.fireSafety.fras.update({ fraId: fra.id, title: 'Rewrite attempt' }),
    ).rejects.toMatchObject({ message: 'archived' });
    await expect(
      caller.fireSafety.fras.recordReview({
        fraId: fra.id,
        trigger: 'manual',
        outcome: 'confirmed',
        note: '',
      }),
    ).rejects.toMatchObject({ message: 'archived' });
    await expect(
      caller.fireSafety.fras.publish({ fraId: fra.id, confirmNoSignificantFindings: true }),
    ).rejects.toMatchObject({ message: 'archived' });
  });

  it('FS-E18: recordEntry advances the schedule forward only; failures raise one action', async () => {
    const caller = callerFor(adminId);
    const building = await createOffice(caller);

    const performedAt = new Date(Date.now() - 14 * DAY_MS);
    const entry = await caller.fireSafety.logbook.recordEntry({
      buildingId: building.id,
      checkType: 'alarm_test',
      result: 'fail',
      performedAt,
      callPointRef: 'MCP-3 stairwell',
      notes: '',
      defectsSummary: 'Sounder dead on floor 2',
      raiseAction: true,
    });
    expect(entry.actionId).not.toBeNull();

    const checks = await caller.fireSafety.logbook.checks({ buildingId: building.id });
    const alarm = checks.find((c) => c.checkType === 'alarm_test');
    expect(alarm?.lastDoneAt?.getTime()).toBe(performedAt.getTime());
    // Weekly: due 7 days after the (backdated) test. The clock says
    // overdue, but FS-1 says a fail is its own louder state.
    expect(alarm?.nextDueAt.getTime()).toBe(performedAt.getTime() + 7 * DAY_MS);
    expect(alarm?.dueStatus).toBe('failed');

    const actionRows = await db
      .select()
      .from(schema.actions)
      .where(
        and(
          eq(schema.actions.tenantId, tenantId),
          eq(schema.actions.sourceType, 'fire_logbook_entry'),
        ),
      );
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0]?.priority).toBe('high');

    // An older backfilled record must not move the schedule backwards.
    const older = new Date(Date.now() - 60 * DAY_MS);
    await caller.fireSafety.logbook.recordEntry({
      buildingId: building.id,
      checkType: 'alarm_test',
      result: 'pass',
      performedAt: older,
      callPointRef: 'MCP-1 lobby',
      notes: 'Backfilled paper record',
      defectsSummary: '',
      raiseAction: false,
    });
    const checksAfter = await caller.fireSafety.logbook.checks({ buildingId: building.id });
    const alarmAfter = checksAfter.find((c) => c.checkType === 'alarm_test');
    expect(alarmAfter?.lastDoneAt?.getTime()).toBe(performedAt.getTime());
    // The backdated pass is OLDER than the fail — it must not clear the
    // failed state either.
    expect(alarmAfter?.dueStatus).toBe('failed');

    const entries = await caller.fireSafety.logbook.entries({ buildingId: building.id });
    expect(entries).toHaveLength(2);
  });

  it('FS-E19: due list and overview surface overdue checks', async () => {
    const caller = callerFor(adminId);
    const building = await createOffice(caller);
    // Freshly seeded calendars are all 'ok' — nothing due yet.
    expect(await caller.fireSafety.logbook.due()).toHaveLength(0);

    await caller.fireSafety.logbook.recordEntry({
      buildingId: building.id,
      checkType: 'alarm_test',
      result: 'pass',
      performedAt: new Date(Date.now() - 30 * DAY_MS),
      callPointRef: '',
      notes: '',
      defectsSummary: '',
      raiseAction: false,
    });
    const due = await caller.fireSafety.logbook.due();
    expect(due.some((c) => c.checkType === 'alarm_test' && c.dueStatus === 'overdue')).toBe(true);
    expect(due[0]?.buildingName).toBe('Unit 4 Office');

    const overview = await caller.fireSafety.overview();
    expect(overview.checksOverdue).toBeGreaterThanOrEqual(1);
    // No FRA yet — the draft count stays zero, review count zero.
    expect(overview.frasReviewDue).toBe(0);
  });

  it('FS-E20: door cadence follows the regime; defects raise actions and advance the date', async () => {
    const caller = callerFor(adminId);
    // 14 m residential — above 11 m, not high-rise.
    const building = await caller.fireSafety.buildings.create({
      name: 'Maple Court',
      siteId: siteA,
      address: '3 Maple Way',
      useDescription: 'Flats',
      isResidential: true,
      heightMetres: 14,
      storeys: 5,
      hasFireAlarm: true,
      hasEmergencyLighting: true,
      hasSprinklers: false,
      hasDampers: false,
      hasRisers: false,
      externalWallSystem: '',
      compartmentationNotes: '',
      meansOfEscapeNotes: '',
      serviceRisersNotes: '',
      secureInfoBoxLocation: '',
      infoDocuments: [],
    });
    const door = await caller.fireSafety.doors.create({
      buildingId: building.id,
      doorRef: 'FD-G-01',
      locationKind: 'common_parts',
      floor: 'G',
      description: 'Stair core door',
      selfClosing: true,
    });
    const doors = await caller.fireSafety.doors.list({ buildingId: building.id });
    expect(doors[0]?.intervalMonths).toBe(3);

    const inspectedAt = new Date(Date.now() - 10 * DAY_MS);
    const inspection = await caller.fireSafety.doors.recordInspection({
      doorId: door.id,
      outcome: 'defects_found',
      inspectedAt,
      checklist: {
        gapsOk: false,
        sealsOk: true,
        closerOk: true,
        glazingOk: null,
        hingesOk: true,
        signageOk: true,
      },
      defectsSummary: 'Gap over 4 mm on latch side',
      raiseAction: true,
    });
    expect(inspection.actionId).not.toBeNull();

    const after = await caller.fireSafety.doors.list({ buildingId: building.id });
    expect(after[0]?.lastInspectedAt?.getTime()).toBe(inspectedAt.getTime());
    // Quarterly: next due three months after the inspection.
    const expected = new Date(inspectedAt);
    expected.setUTCMonth(expected.getUTCMonth() + 3);
    expect(after[0]?.nextInspectionDueAt.getTime()).toBe(expected.getTime());

    const history = await caller.fireSafety.doors.inspections({ doorId: door.id });
    expect(history).toHaveLength(1);
    expect(history[0]?.checklist?.gapsOk).toBe(false);
  });

  it('FS-E21: drills satisfy the drill schedule and reject an impossible roll', async () => {
    const caller = callerFor(adminId);
    const building = await createOffice(caller);
    await expect(
      caller.fireSafety.drills.record({
        buildingId: building.id,
        peoplePresent: 10,
        peopleAccountedFor: 12,
        rollComplete: true,
        notes: '',
        lessonsLearned: '',
      }),
    ).rejects.toMatchObject({ message: 'roll-exceeds-present' });

    const conductedAt = new Date(Date.now() - 2 * DAY_MS);
    await caller.fireSafety.drills.record({
      buildingId: building.id,
      conductedAt,
      evacuationSeconds: 260,
      peoplePresent: 42,
      peopleAccountedFor: 42,
      rollComplete: true,
      notes: 'Alarm raised from MCP-2.',
      lessonsLearned: 'Marshal sweep of floor 2 slow — assign deputy.',
    });
    const checks = await caller.fireSafety.logbook.checks({ buildingId: building.id });
    const drillCheck = checks.find((c) => c.checkType === 'fire_drill');
    expect(drillCheck?.lastDoneAt?.getTime()).toBe(conductedAt.getTime());

    const drills = await caller.fireSafety.drills.list({});
    expect(drills).toHaveLength(1);
    expect(drills[0]?.evacuationSeconds).toBe(260);
    expect(drills[0]?.buildingName).toBe('Unit 4 Office');
  });

  it('FS-E22: PEEPs review on cadence and end rather than delete', async () => {
    const caller = callerFor(adminId);
    const building = await createOffice(caller);
    const peep = await caller.fireSafety.peeps.create({
      buildingId: building.id,
      personName: 'Jo Field',
      assistanceNeeds: 'Wheelchair user — level 2 office',
      planSummary: 'Buddy assists to refuge; evac chair via east stair.',
      buddyName: 'Sam Peer',
      equipmentNeeded: 'Evac chair (east stair landing)',
      reviewFrequencyMonths: 6,
    });
    await caller.fireSafety.peeps.recordReview({ peepId: peep.id });
    let rows = await caller.fireSafety.peeps.list({});
    expect(rows[0]?.lastReviewedAt).not.toBeNull();
    expect(rows[0]?.reviewDue).toBe(false);

    await caller.fireSafety.peeps.end({ peepId: peep.id });
    rows = await caller.fireSafety.peeps.list({});
    expect(rows).toHaveLength(0);
    rows = await caller.fireSafety.peeps.list({ includeEnded: true });
    expect(rows).toHaveLength(1);
    await expect(
      caller.fireSafety.peeps.update({ peepId: peep.id, personName: 'Renamed' }),
    ).rejects.toMatchObject({ message: 'ended' });
  });

  it('FS-E23: marshal coverage flags gaps; double-adding conflicts', async () => {
    const caller = callerFor(adminId);
    const building = await createOffice(caller);
    let coverage = await caller.fireSafety.marshals.coverage();
    expect(coverage).toHaveLength(1);
    expect(coverage[0]?.gap).toBe(true);

    await caller.fireSafety.marshals.add({
      buildingId: building.id,
      userId: standardId,
      role: 'marshal',
      area: 'Floor 1',
      trainedAt: new Date(Date.now() - 100 * DAY_MS),
      trainingExpiresAt: new Date(Date.now() + 300 * DAY_MS),
      notes: '',
    });
    coverage = await caller.fireSafety.marshals.coverage();
    expect(coverage[0]?.gap).toBe(false);
    expect(coverage[0]?.inDateCount).toBe(1);

    await expect(
      caller.fireSafety.marshals.add({
        buildingId: building.id,
        userId: standardId,
        role: 'deputy',
        area: '',
        notes: '',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const marshals = await caller.fireSafety.marshals.list({ buildingId: building.id });
    expect(marshals[0]?.trainingStatus).toBe('in_date');
    expect(marshals[0]?.userName).toBe('Stan Standard');
  });

  it('FS-E24: profile changes re-seed the calendar both ways', async () => {
    const caller = callerFor(adminId);
    const tower = await createTower(caller);
    const before = await caller.fireSafety.logbook.checks({ buildingId: tower.id });
    expect(before.some((c) => c.checkType === 'sprinkler_check' && c.active)).toBe(true);

    // Sprinklers decommissioned; the building also drops below high-rise.
    const result = await caller.fireSafety.buildings.update({
      buildingId: tower.id,
      hasSprinklers: false,
      heightMetres: 16,
      storeys: 5,
    });
    expect(result.checksDeactivated).toBeGreaterThanOrEqual(4);
    const after = await caller.fireSafety.logbook.checks({ buildingId: tower.id });
    expect(after.find((c) => c.checkType === 'sprinkler_check')?.active).toBe(false);
    expect(after.find((c) => c.checkType === 'secure_info_box_check')?.active).toBe(false);

    // And back again: re-activation, not duplication.
    await caller.fireSafety.buildings.update({ buildingId: tower.id, hasSprinklers: true });
    const restored = await caller.fireSafety.logbook.checks({ buildingId: tower.id });
    const sprinklers = restored.filter((c) => c.checkType === 'sprinkler_check');
    expect(sprinklers).toHaveLength(1);
    expect(sprinklers[0]?.active).toBe(true);
  });

  it('FS-E25: a failed check stays red everywhere until a subsequent pass clears it (HSE FS-1)', async () => {
    const caller = callerFor(adminId);
    const building = await createOffice(caller);

    // Fail TODAY: the schedule advances a week (clock would say ok) but
    // the display state must be 'failed' — on the building checks, the
    // tenant due list, the building register row and the overview.
    await caller.fireSafety.logbook.recordEntry({
      buildingId: building.id,
      checkType: 'alarm_test',
      result: 'fail',
      callPointRef: 'CP-2',
      notes: '',
      defectsSummary: 'Panel shows fault; sounders silent',
    });
    const checks = await caller.fireSafety.logbook.checks({ buildingId: building.id });
    const alarm = checks.find((c) => c.checkType === 'alarm_test');
    expect(alarm?.dueStatus).toBe('failed');
    expect(alarm?.nextDueAt.getTime()).toBeGreaterThan(Date.now());

    const due = await caller.fireSafety.logbook.due();
    expect(due.some((c) => c.checkType === 'alarm_test' && c.dueStatus === 'failed')).toBe(true);

    const list = await caller.fireSafety.buildings.list({ status: 'active', search: '' });
    expect(list[0]?.checksFailed).toBe(1);
    expect(list[0]?.checksOverdue).toBe(0);

    const overview = await caller.fireSafety.overview();
    expect(overview.checksFailed).toBe(1);

    // Re-test passes → the failure clears and the clock takes over.
    await caller.fireSafety.logbook.recordEntry({
      buildingId: building.id,
      checkType: 'alarm_test',
      result: 'pass',
      callPointRef: 'CP-2',
      notes: 'Sounder replaced, retest clean',
      defectsSummary: '',
    });
    const after = await caller.fireSafety.logbook.checks({ buildingId: building.id });
    expect(after.find((c) => c.checkType === 'alarm_test')?.dueStatus).toBe('ok');
    expect((await caller.fireSafety.overview()).checksFailed).toBe(0);
  });

  it('FS-E26: a failed door inspection stays red until a passing re-inspection (HSE FS-1)', async () => {
    const caller = callerFor(adminId);
    const tower = await createTower(caller);
    const door = await caller.fireSafety.doors.create({
      buildingId: tower.id,
      doorRef: 'FD-3-01',
      locationKind: 'flat_entrance',
      floor: '3',
      description: '',
      selfClosing: true,
    });

    await caller.fireSafety.doors.recordInspection({
      doorId: door.id,
      outcome: 'fail',
      defectsSummary: 'Self-closer removed by resident',
    });
    let detail = await caller.fireSafety.buildings.get({ buildingId: tower.id });
    expect(detail.doors.find((d) => d.id === door.id)?.dueStatus).toBe('failed');
    expect((await caller.fireSafety.overview()).doorsFailed).toBe(1);
    const list = await caller.fireSafety.buildings.list({ status: 'active', search: '' });
    expect(list[0]?.doorsFailed).toBe(1);

    await caller.fireSafety.doors.recordInspection({
      doorId: door.id,
      outcome: 'pass',
      defectsSummary: '',
    });
    detail = await caller.fireSafety.buildings.get({ buildingId: tower.id });
    expect(detail.doors.find((d) => d.id === door.id)?.dueStatus).toBe('ok');
    expect((await caller.fireSafety.overview()).doorsFailed).toBe(0);
  });

  it('FS-E27: failed checks raise an action by default; opting out is explicit (HSE FS-2)', async () => {
    const caller = callerFor(adminId);
    const building = await createOffice(caller);

    // No raiseAction field at all → default ON for a non-pass result.
    const failed = await caller.fireSafety.logbook.recordEntry({
      buildingId: building.id,
      checkType: 'emergency_lighting_function',
      result: 'defects_found',
      callPointRef: '',
      notes: '',
      defectsSummary: 'Two luminaires dark in stair core',
    });
    expect(failed.actionId).not.toBeNull();

    // Explicit opt-out is respected (a duplicate action may already exist).
    const optedOut = await caller.fireSafety.logbook.recordEntry({
      buildingId: building.id,
      checkType: 'extinguisher_visual',
      result: 'fail',
      callPointRef: '',
      notes: '',
      defectsSummary: 'CO2 by loading bay missing',
      raiseAction: false,
    });
    expect(optedOut.actionId).toBeNull();

    // A pass never raises one, whatever the flag says.
    const passed = await caller.fireSafety.logbook.recordEntry({
      buildingId: building.id,
      checkType: 'alarm_test',
      result: 'pass',
      callPointRef: 'CP-1',
      notes: '',
      defectsSummary: '',
      raiseAction: true,
    });
    expect(passed.actionId).toBeNull();

    // Doors: same default-on contract.
    const door = await caller.fireSafety.doors.create({
      buildingId: building.id,
      doorRef: 'FD-G-01',
      locationKind: 'other',
      floor: 'G',
      description: '',
      selfClosing: true,
    });
    const doorFail = await caller.fireSafety.doors.recordInspection({
      doorId: door.id,
      outcome: 'fail',
      defectsSummary: 'Gaps over 8 mm at threshold',
    });
    expect(doorFail.actionId).not.toBeNull();
  });

  it('FS-E28: an intolerable FRA needs an actionable finding and alerts the managers (HSE FS-6)', async () => {
    const emails: Array<{ to: string; templateKey: string; variables: Record<string, string> }> =
      [];
    const custom = router({
      fireSafety: createFireSafetyRouter({
        enabled: true,
        appUrl: 'https://freehs.test',
        sendAlertEmail: async (input) => {
          emails.push(input);
        },
      }),
    });
    const caller = createCallerFactory(custom)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: adminId, email: 'fire@x.test', tenantId: tenantId as never },
      }),
    );

    const fra = await caller.fireSafety.fras.create({ title: 'Hostel FRA' });
    await caller.fireSafety.fras.update({
      fraId: fra.id,
      riskRating: 'intolerable',
      responsiblePersonName: 'Pat Owner',
      personsAtRisk: ['sleeping_occupants'],
      ignitionSources: 'Portable heaters in rooms',
      fuelSources: 'Hoarded storage in escape corridor',
      oxygenSources: 'Natural ventilation',
      evaluationNotes: 'Escape route compromised; occupation should cease until cleared.',
    });

    // Intolerable + "no significant findings" is a contradiction — refused.
    await expect(
      caller.fireSafety.fras.publish({ fraId: fra.id, confirmNoSignificantFindings: true }),
    ).rejects.toMatchObject({ message: 'intolerable-needs-action' });

    // A resolved-only or no-action finding set is refused too.
    const finding = await caller.fireSafety.fras.addFinding({
      fraId: fra.id,
      category: 'means_of_escape',
      priority: 'high',
      description: 'Escape corridor blocked by stored furniture',
      requiresAction: false,
    });
    await expect(caller.fireSafety.fras.publish({ fraId: fra.id })).rejects.toMatchObject({
      message: 'intolerable-needs-action',
    });

    await caller.fireSafety.fras.updateFinding({ findingId: finding.id, requiresAction: true });
    const published = await caller.fireSafety.fras.publish({ fraId: fra.id });
    expect(published.actionsCreated).toBe(1);

    // Alert went to the fireSafety.manage holders (admin via org.settings;
    // the standard user holds only view/record).
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.every((e) => e.templateKey === 'fra-intolerable-alert')).toBe(true);
    const recipients = emails.map((e) => e.to);
    expect(recipients).toContain(`alice-${tenantId}@acme.test`);
    expect(recipients).not.toContain(`stan-${tenantId}@acme.test`);
    expect(emails[0]?.variables['viewUrl']).toBe(
      `https://freehs.test/en/fire-safety/fra/${fra.id}`,
    );

    // Every holder also gets a bell row (kind fra_intolerable).
    const bells = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.kind, 'fra_intolerable'));
    expect(bells.map((b) => b.userId)).toContain(adminId);
    expect(bells[0]?.href).toBe(`/fire-safety/fra/${fra.id}`);

    // The intolerable state is a first-class needs-attention item.
    expect((await caller.fireSafety.overview()).frasIntolerable).toBe(1);
  });

  it('fra_intolerable prefs: each holder mutes email and bell independently', async () => {
    // A second fireSafety.manage holder via the Manager system set
    // (seedDefaultPermissionSets is idempotent — this returns the ids).
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    const managerId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: managerId,
      name: 'Mo Manager',
      email: `mo-${tenantId}@acme.test`,
      tenantId,
      permissionSetId: sets.manager,
    });
    // The admin mutes the email (bell stays); the manager mutes the bell.
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'email:fra_intolerable': false } })
      .where(eq(schema.user.id, adminId));
    await db
      .update(schema.user)
      .set({ notificationPrefs: { 'inapp:fra_intolerable': false } })
      .where(eq(schema.user.id, managerId));

    const emails: Array<{ to: string; templateKey: string; variables: Record<string, string> }> =
      [];
    const custom = router({
      fireSafety: createFireSafetyRouter({
        enabled: true,
        appUrl: 'https://freehs.test',
        sendAlertEmail: async (input) => {
          emails.push(input);
        },
      }),
    });
    const caller = createCallerFactory(custom)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: adminId, email: 'fire@x.test', tenantId: tenantId as never },
      }),
    );

    const fra = await caller.fireSafety.fras.create({ title: 'Hostel FRA' });
    await caller.fireSafety.fras.update({
      fraId: fra.id,
      riskRating: 'intolerable',
      responsiblePersonName: 'Pat Owner',
      personsAtRisk: ['sleeping_occupants'],
      ignitionSources: 'Portable heaters in rooms',
      fuelSources: 'Hoarded storage in escape corridor',
      oxygenSources: 'Natural ventilation',
      evaluationNotes: 'Escape route compromised; occupation should cease until cleared.',
    });
    await caller.fireSafety.fras.addFinding({
      fraId: fra.id,
      category: 'means_of_escape',
      priority: 'high',
      description: 'Escape corridor blocked by stored furniture',
      requiresAction: true,
    });
    await caller.fireSafety.fras.publish({ fraId: fra.id });

    // Only the manager (email unmuted) is mailed — one holder's mute
    // never silences another.
    expect(emails.map((e) => e.to)).toEqual([`mo-${tenantId}@acme.test`]);
    // Bells: the admin's row lands, the manager's is muted.
    const bells = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.kind, 'fra_intolerable'));
    expect(bells.map((b) => b.userId)).toEqual([adminId]);
  });

  it('FS-E29: editing an active FRA marks the attestation stale; re-publishing re-signs it (HSE FS-7)', async () => {
    const caller = callerFor(adminId);
    const fra = await caller.fireSafety.fras.create({ title: 'Depot FRA' });
    await caller.fireSafety.fras.update({
      fraId: fra.id,
      riskRating: 'moderate',
      responsiblePersonName: 'Pat Owner',
    });
    await fillFraContent(caller, fra.id);
    await caller.fireSafety.fras.addFinding({
      fraId: fra.id,
      category: 'management',
      priority: 'medium',
      description: 'No recorded evacuation drill in the last 12 months',
      requiresAction: true,
    });
    await caller.fireSafety.fras.publish({ fraId: fra.id });

    const signed = await caller.fireSafety.fras.get({ fraId: fra.id });
    expect(signed.attestationStale).toBe(false);
    expect(signed.publishedByName).toBe('Alice Admin');
    const firstSignedAt = signed.publishedAt?.getTime() ?? 0;

    // Resolving a finding is remediation, not a content change.
    const findingId = signed.findings[0]?.id ?? '';
    await caller.fireSafety.fras.resolveFinding({ findingId });
    expect((await caller.fireSafety.fras.get({ fraId: fra.id })).attestationStale).toBe(false);

    // Changing the assessment content under a live signature IS.
    await caller.fireSafety.fras.update({ fraId: fra.id, evaluationNotes: 'Rewritten.' });
    expect((await caller.fireSafety.fras.get({ fraId: fra.id })).attestationStale).toBe(true);

    await new Promise((r) => setTimeout(r, 5));
    await caller.fireSafety.fras.publish({ fraId: fra.id });
    const resigned = await caller.fireSafety.fras.get({ fraId: fra.id });
    expect(resigned.attestationStale).toBe(false);
    expect(resigned.publishedAt?.getTime() ?? 0).toBeGreaterThan(firstSignedAt);
    expect(resigned.events.some((e) => e.kind === 'reattested')).toBe(true);
  });

  it('FS-G05: publishing freezes a signed copy that a later edit cannot touch', async () => {
    // `publish` used to flip a status flag on a mutable row, and four
    // procedures could then rewrite that row — including its risk rating,
    // and including hard-deleting a significant finding — under a LOWER
    // permission tier than could publish it. The Responsible Person who
    // attested "suitable and sufficient" under Article 9 could not
    // afterwards demonstrate what they attested: no copy existed.
    const caller = callerFor(adminId);
    const fra = await caller.fireSafety.fras.create({ title: 'Tower FRA' });
    await caller.fireSafety.fras.update({
      fraId: fra.id,
      riskRating: 'substantial',
      responsiblePersonName: 'Pat Owner',
    });
    await fillFraContent(caller, fra.id);
    // After fillFraContent, which sets its own evaluation text.
    await caller.fireSafety.fras.update({
      fraId: fra.id,
      evaluationNotes: 'Single stair, no AOV, evacuation strategy unresolved.',
    });
    await caller.fireSafety.fras.addFinding({
      fraId: fra.id,
      category: 'means_of_escape',
      priority: 'high',
      description: 'Single stair with no smoke control',
      requiresAction: true,
    });
    await caller.fireSafety.fras.publish({ fraId: fra.id });

    const [v1] = await db
      .select()
      .from(schema.fireFraVersions)
      .where(eq(schema.fireFraVersions.fraId, fra.id));
    expect(v1).toBeDefined();
    expect(v1?.versionNumber).toBe(1);
    expect(v1?.supersededAt).toBeNull();
    expect(v1?.content.riskRating).toBe('substantial');
    expect(v1?.content.evaluationNotes).toContain('evacuation strategy unresolved');
    expect(v1?.content.findings).toHaveLength(1);
    expect(v1?.signedOffByName).toBe('Alice Admin');

    // The working row stays editable — that is deliberate, ADR 0011 §1, and
    // FS-E29 asserts it. What changed is that the edit no longer destroys
    // the evidence.
    await caller.fireSafety.fras.update({
      fraId: fra.id,
      riskRating: 'tolerable',
      evaluationNotes: 'EDITED AFTER PUBLISH',
    });
    const [stillV1] = await db
      .select()
      .from(schema.fireFraVersions)
      .where(eq(schema.fireFraVersions.fraId, fra.id));
    expect(stillV1?.content.riskRating).toBe('substantial');
    expect(stillV1?.content.evaluationNotes).toContain('evacuation strategy unresolved');

    // Re-attesting cuts version 2 and supersedes version 1 — the partial
    // unique index means only one can be current at a time.
    await caller.fireSafety.fras.publish({ fraId: fra.id });
    const versions = await db
      .select()
      .from(schema.fireFraVersions)
      .where(eq(schema.fireFraVersions.fraId, fra.id));
    expect(versions).toHaveLength(2);
    expect(versions.filter((v) => v.supersededAt === null)).toHaveLength(1);
    const current = versions.find((v) => v.supersededAt === null);
    expect(current?.versionNumber).toBe(2);
    expect(current?.content.riskRating).toBe('tolerable');
    // …and version 1 still says what was actually signed the first time.
    expect(versions.find((v) => v.versionNumber === 1)?.content.riskRating).toBe('substantial');
  });

  it('FS-G05: a significant finding cannot be deleted off a signed FRA without a snapshot', async () => {
    // `removeFinding` never loaded the FRA at all — neither a status check
    // nor an archived one. Any finding with `requiresAction: false` (every
    // observation noted but not remediated) could be HARD-DELETED off a
    // live signed assessment, and the event carries only the category, not
    // the text. The words were simply gone.
    const caller = callerFor(adminId);
    const fra = await caller.fireSafety.fras.create({ title: 'Depot FRA' });
    await caller.fireSafety.fras.update({
      fraId: fra.id,
      riskRating: 'moderate',
      responsiblePersonName: 'Pat Owner',
    });
    await fillFraContent(caller, fra.id);
    const observation = await caller.fireSafety.fras.addFinding({
      fraId: fra.id,
      category: 'management',
      priority: 'low',
      description: 'Extinguisher signage faded on level 2',
      requiresAction: false,
    });
    await caller.fireSafety.fras.addFinding({
      fraId: fra.id,
      category: 'means_of_escape',
      priority: 'high',
      description: 'Fire door held open with a wedge',
      requiresAction: true,
    });
    await caller.fireSafety.fras.publish({ fraId: fra.id });

    // Deleting it is still permitted — the signed copy survives it, which
    // is exactly what makes the deletion safe.
    await caller.fireSafety.fras.removeFinding({ findingId: observation.id });
    const [signed] = await db
      .select()
      .from(schema.fireFraVersions)
      .where(eq(schema.fireFraVersions.fraId, fra.id));
    expect(signed?.content.findings.map((f) => f.description)).toContain(
      'Extinguisher signage faded on level 2',
    );
  });

  it('FS-G05: an FRA signed before versioning refuses a content edit until re-attested', async () => {
    // The one case a frozen copy cannot rescue: a sign-off stamp from
    // before this migration, with `currentVersion` 0 and no snapshot to
    // fall back on. Editing those kept silently destroying the only copy.
    const caller = callerFor(adminId);
    const fra = await caller.fireSafety.fras.create({ title: 'Legacy FRA' });
    await caller.fireSafety.fras.update({
      fraId: fra.id,
      riskRating: 'moderate',
      responsiblePersonName: 'Pat Owner',
    });
    await fillFraContent(caller, fra.id);
    await caller.fireSafety.fras.addFinding({
      fraId: fra.id,
      category: 'management',
      priority: 'medium',
      description: 'Drill overdue',
      requiresAction: true,
    });
    await caller.fireSafety.fras.publish({ fraId: fra.id });

    // Reproduce the pre-migration shape: signed, but no frozen copy.
    await db.delete(schema.fireFraVersions).where(eq(schema.fireFraVersions.fraId, fra.id));
    await db
      .update(schema.fireRiskAssessments)
      .set({ currentVersion: 0 })
      .where(eq(schema.fireRiskAssessments.id, fra.id));

    await expect(
      caller.fireSafety.fras.update({ fraId: fra.id, evaluationNotes: 'Rewritten.' }),
    ).rejects.toThrow(/signed-without-snapshot/);
    await expect(
      caller.fireSafety.fras.addFinding({
        fraId: fra.id,
        category: 'management',
        priority: 'low',
        description: 'Another',
        requiresAction: false,
      }),
    ).rejects.toThrow(/signed-without-snapshot/);
    // Re-attesting cuts version 1 and unblocks it.
    await caller.fireSafety.fras.publish({ fraId: fra.id });
    await expect(
      caller.fireSafety.fras.update({ fraId: fra.id, evaluationNotes: 'Now fine.' }),
    ).resolves.toBeDefined();
  });

  it('FS-X01: the training matrix governs marshal competence once designated', async () => {
    // `fire_marshals` carried its own dates and the fire register read only
    // that row, so a marshal who renewed their ticket stayed `expired`,
    // counted as no cover, and kept being chased — while the training
    // matrix, holding the actual certificate, said otherwise.
    const caller = callerFor(adminId);
    const building = await createOffice(caller);
    const marshalUserId = adminId;

    // A lapsed date in the fire register.
    const lapsed = new Date(Date.now() - 400 * 86_400_000);
    const { id: marshalId } = await caller.fireSafety.marshals.add({
      buildingId: building.id,
      userId: marshalUserId,
      trainedAt: new Date(Date.now() - 800 * 86_400_000),
      trainingExpiresAt: lapsed,
    });
    expect(
      (await caller.fireSafety.marshals.list({ buildingId: building.id })).find(
        (m) => m.id === marshalId,
      )?.trainingStatus,
    ).toBe('expired');

    // A current fire-marshal ticket in the training matrix.
    const requirementId = newId();
    await db.insert(schema.trainingRequirements).values({
      id: requirementId,
      tenantId,
      name: 'Fire marshal',
      validityMonths: 36,
    });
    await db.insert(schema.trainingRecords).values({
      id: newId(),
      tenantId,
      requirementId,
      userId: marshalUserId,
      personName: 'Alice Admin',
      achievedAt: new Date(Date.now() - 30 * 86_400_000),
      expiresAt: new Date(Date.now() + 700 * 86_400_000),
    });

    // Until an administrator says which requirement is the ticket, nothing
    // changes — the fix ships inert.
    expect(
      (await caller.fireSafety.marshals.list({ buildingId: building.id })).find(
        (m) => m.id === marshalId,
      )?.trainingStatus,
    ).toBe('expired');

    await caller.fireSafety.settings.setMarshalRequirements({ requirementIds: [requirementId] });
    const reconciled = (await caller.fireSafety.marshals.list({ buildingId: building.id })).find(
      (m) => m.id === marshalId,
    );
    expect(reconciled?.trainingStatus).toBe('in_date');
    expect(reconciled?.competenceSource).toBe('training');
    expect(reconciled?.conflictsWithLocal).toBe(true);
  });

  it('FS-X01: a hand-typed date with no record behind it reads as unbacked', async () => {
    // The worse direction. Anybody could type a future date into the fire
    // register and the marshal read competent — satisfying the building's
    // marshal target and closing the coverage gap that exists to force the
    // training — with no record, no certificate and no verification behind
    // it, and nothing in the product to contradict it.
    const caller = callerFor(adminId);
    const building = await createOffice(caller);
    await caller.fireSafety.marshals.add({
      buildingId: building.id,
      userId: adminId,
      trainedAt: new Date(Date.now() - 30 * 86_400_000),
      trainingExpiresAt: new Date(Date.now() + 700 * 86_400_000),
    });

    const requirementId = newId();
    await db.insert(schema.trainingRequirements).values({
      id: requirementId,
      tenantId,
      name: 'Fire marshal',
      validityMonths: 36,
    });
    await caller.fireSafety.settings.setMarshalRequirements({ requirementIds: [requirementId] });

    const listed = (await caller.fireSafety.marshals.list({ buildingId: building.id }))[0];
    expect(listed?.competenceSource).toBe('local');
    expect(listed?.unbacked).toBe(true);
    // It still counts toward cover — silently discounting it would flip
    // live registers red overnight — but the coverage roll-up now says how
    // many of the "in date" marshals nobody can corroborate.
    const coverage = (await caller.fireSafety.marshals.coverage()).find(
      (c) => c.buildingId === building.id,
    );
    expect(coverage?.inDateCount).toBe(1);
    expect(coverage?.unbackedCount).toBe(1);

    // And a NEW hand-typed date is refused outright — a value the system
    // will immediately label unbacked is a lie with a footnote.
    await expect(
      caller.fireSafety.marshals.add({
        buildingId: building.id,
        userId: standardId,
        trainingExpiresAt: new Date(Date.now() + 700 * 86_400_000),
      }),
    ).rejects.toThrow(/training-matrix-is-source/);
    // Adding them without a date is fine — the matrix is where it goes now.
    await expect(
      caller.fireSafety.marshals.add({ buildingId: building.id, userId: standardId }),
    ).resolves.toBeDefined();
  });

  it('FS-X01: a requirement from another tenant cannot be designated', async () => {
    const caller = callerFor(adminId);
    await expect(
      caller.fireSafety.settings.setMarshalRequirements({ requirementIds: [newId()] }),
    ).rejects.toThrow(/training-requirement-not-found/);
  });

  it('FS-E30: fras.renderPdf refuses unwired and renders via the injected dep (HSE FS-5)', async () => {
    const caller = callerFor(adminId);
    const fra = await caller.fireSafety.fras.create({ title: 'Yard FRA' });
    await expect(caller.fireSafety.fras.renderPdf({ fraId: fra.id })).rejects.toMatchObject({
      message: 'render-unavailable',
    });

    const rendered: string[] = [];
    const custom = router({
      fireSafety: createFireSafetyRouter({
        enabled: true,
        renderPdf: async (input) => {
          rendered.push(input.fraId);
          return { key: `k/${input.fraId}.pdf`, bytes: 1234, cached: false, stub: true };
        },
      }),
    });
    const customCaller = createCallerFactory(custom)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: adminId, email: 'fire@x.test', tenantId: tenantId as never },
      }),
    );
    const out = await customCaller.fireSafety.fras.renderPdf({ fraId: fra.id });
    expect(rendered).toEqual([fra.id]);
    expect(out.filename).toBe('FRA-0001.pdf');
    expect(out.storageKey).toBe(`k/${fra.id}.pdf`);
  });

  it('FS-E31: bulk door import creates in one call and reports duplicates (HSE FS-12)', async () => {
    const caller = callerFor(adminId);
    const tower = await createTower(caller);
    await caller.fireSafety.doors.create({
      buildingId: tower.id,
      doorRef: 'FD-1-01',
      locationKind: 'flat_entrance',
      floor: '1',
      description: '',
      selfClosing: true,
    });

    const result = await caller.fireSafety.doors.bulkCreate({
      buildingId: tower.id,
      doors: [
        { doorRef: 'fd-1-01', floor: '1', locationKind: 'flat_entrance' }, // dup of live door
        { doorRef: 'FD-1-02', floor: '1', locationKind: 'flat_entrance' },
        { doorRef: 'FD-1-03', floor: '1', locationKind: 'flat_entrance' },
        { doorRef: 'FD-1-03', floor: '1', locationKind: 'flat_entrance' }, // dup in payload
        { doorRef: 'ST-0-01', floor: 'G', locationKind: 'common_parts' },
      ],
    });
    expect(result.created).toBe(3);
    expect(result.skipped).toEqual(['fd-1-01', 'FD-1-03']);

    const detail = await caller.fireSafety.buildings.get({ buildingId: tower.id });
    expect(detail.doors).toHaveLength(4);
    // Regime-derived cadence applies to imported doors too: common parts
    // quarterly in an 11m+ residential building.
    const stair = detail.doors.find((d) => d.doorRef === 'ST-0-01');
    expect(stair?.intervalMonths).toBe(3);

    // Tenant isolation: a foreign building id is NOT_FOUND.
    const other = callerFor(standardId);
    await expect(
      other.fireSafety.doors.bulkCreate({
        buildingId: tower.id,
        doors: [{ doorRef: 'X-1' }],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('FS-E32: marshal gaps respect the per-building cover flag and minimum (HSE FS-8)', async () => {
    const caller = callerFor(adminId);
    const office = await createOffice(caller);
    const tower = await createTower(caller);

    // Both buildings default to requiring one marshal → two gaps.
    expect((await caller.fireSafety.overview()).marshalGaps).toBe(2);

    // The substation-style building opts out — its gap disappears.
    await caller.fireSafety.buildings.update({
      buildingId: office.id,
      requiresMarshalCover: false,
    });
    expect((await caller.fireSafety.overview()).marshalGaps).toBe(1);

    // The tower needs TWO in-date marshals; one is not enough.
    await caller.fireSafety.buildings.update({ buildingId: tower.id, marshalTarget: 2 });
    const in12mo = new Date(Date.now() + 365 * DAY_MS);
    await caller.fireSafety.marshals.add({
      buildingId: tower.id,
      userId: adminId,
      role: 'marshal',
      area: 'Floors 1-4',
      trainedAt: new Date(),
      trainingExpiresAt: in12mo,
    });
    expect((await caller.fireSafety.overview()).marshalGaps).toBe(1);

    const coverage = await caller.fireSafety.marshals.coverage();
    const towerRow = coverage.find((c) => c.buildingId === tower.id);
    expect(towerRow?.gap).toBe(true);
    expect(towerRow?.marshalTarget).toBe(2);
    const officeRow = coverage.find((c) => c.buildingId === office.id);
    expect(officeRow?.gap).toBe(false);
    expect(officeRow?.requiresMarshalCover).toBe(false);

    // Second marshal in date → the tower's gap closes.
    await caller.fireSafety.marshals.add({
      buildingId: tower.id,
      userId: standardId,
      role: 'deputy',
      area: 'Floors 5-9',
      trainedAt: new Date(),
      trainingExpiresAt: in12mo,
    });
    expect((await caller.fireSafety.overview()).marshalGaps).toBe(0);
  });

  it('FS-E33: FRA references do not overflow at 10,000 (HSE FS-10)', async () => {
    const caller = callerFor(adminId);
    await db.insert(schema.referenceCounters).values({
      tenantId,
      series: 'fireRiskAssessment',
      value: 9999,
    });
    const fra = await caller.fireSafety.fras.create({ title: 'Ten thousandth premises' });
    const loaded = await caller.fireSafety.fras.get({ fraId: fra.id });
    expect(loaded.referenceNumber).toBe('FRA-10000');
  });

  it('FS-E30: a check links to an asset and assetHistory joins the service history (PF-17)', async () => {
    const caller = callerFor(adminId);
    const { id: buildingId } = await createOffice(caller);
    const assetId = newId();
    await db.insert(schema.assets).values({ id: assetId, tenantId, name: 'Extinguisher #12' });

    await caller.fireSafety.logbook.upsertCheck({
      buildingId,
      checkType: 'extinguisher_visual',
      assetId,
    });
    await caller.fireSafety.logbook.recordEntry({
      buildingId,
      checkType: 'extinguisher_visual',
      result: 'pass',
      notes: 'Gauge green, pin intact',
    });

    const history = await caller.fireSafety.logbook.assetHistory({ assetId });
    expect(history.checks).toHaveLength(1);
    expect(history.checks[0]?.checkType).toBe('extinguisher_visual');
    expect(history.checks[0]?.buildingName).toBe('Unit 4 Office');
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]?.notes).toMatch(/Gauge green/);

    // Unlinking clears the join.
    await caller.fireSafety.logbook.upsertCheck({
      buildingId,
      checkType: 'extinguisher_visual',
      assetId: null,
    });
    const cleared = await caller.fireSafety.logbook.assetHistory({ assetId });
    expect(cleared.checks).toHaveLength(0);

    // Cross-tenant / unknown asset refused on link.
    await expect(
      caller.fireSafety.logbook.upsertCheck({
        buildingId,
        checkType: 'alarm_test',
        assetId: newId(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('FS-E31: recordEntry with a clientRequestId is idempotent (PF-10)', async () => {
    const caller = callerFor(adminId);
    const { id: buildingId } = await createOffice(caller);
    const clientRequestId = newId();

    const first = await caller.fireSafety.logbook.recordEntry({
      buildingId,
      checkType: 'alarm_test',
      result: 'pass',
      clientRequestId,
    });
    const retry = await caller.fireSafety.logbook.recordEntry({
      buildingId,
      checkType: 'alarm_test',
      result: 'pass',
      clientRequestId,
    });
    expect(retry.id).toBe(first.id);
    expect((retry as { deduped?: boolean }).deduped).toBe(true);

    const rows = await db
      .select()
      .from(schema.fireLogbookEntries)
      .where(eq(schema.fireLogbookEntries.clientRequestId, clientRequestId));
    expect(rows).toHaveLength(1);
  });
});

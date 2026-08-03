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

    // Guard chain: rating → responsible person → findings.
    await expect(caller.fireSafety.fras.publish({ fraId: fra.id })).rejects.toMatchObject({
      message: 'no-risk-rating',
    });
    await caller.fireSafety.fras.update({ fraId: fra.id, riskRating: 'moderate' });
    await expect(caller.fireSafety.fras.publish({ fraId: fra.id })).rejects.toMatchObject({
      message: 'no-responsible-person',
    });
    await caller.fireSafety.fras.update({ fraId: fra.id, responsiblePersonName: 'Pat Owner' });
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
    // Weekly: due 7 days after the (backdated) test — i.e. already overdue.
    expect(alarm?.nextDueAt.getTime()).toBe(performedAt.getTime() + 7 * DAY_MS);
    expect(alarm?.dueStatus).toBe('overdue');

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
    expect(checksAfter.find((c) => c.checkType === 'alarm_test')?.lastDoneAt?.getTime()).toBe(
      performedAt.getTime(),
    );

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
});

/**
 * Integration tests for the coshh router (FreeHS module B2).
 *
 * Edge cases (CO-E01..E05 are the pure-helper cases in
 * packages/shared/src/coshh.test.ts):
 *   - CO-E10: substances.create stamps sequential CS-XXXX refs; a
 *     case-insensitive duplicate name is refused unless allowDuplicate
 *   - CO-E11: tenant isolation on substances.get
 *   - CO-E12: a disabled module (wrong brand) refuses every call
 *   - CO-E13: standard users can view but not create
 *   - CO-E14: sds.attach versions sequentially, keeps one current sheet,
 *     and computes reviewByDate from issueDate + sdsReviewMonths; the list
 *     surfaces missing / review_due / current
 *   - CO-E15: sds.confirmCurrent pushes reviewByDate forward from today
 *   - CO-E16: create with an extraction infers regime flags from
 *     H statements (H350 → carcinogen) and snapshots WELs
 *   - CO-E17: storage conflicts are reported per site for incompatible
 *     classes and not across different sites
 *   - CO-E18: publish guards — no routes, no controls, RPE/PPE-only
 *     without justification
 *   - CO-E19: a CMR substance cannot publish while substitution is
 *     not_assessed; recording the decision unblocks it
 *   - CO-E20: publish creates one action per planned control, exactly once
 *   - CO-E21: monitoring.record snapshots the WEL comparison (true /
 *     false / null on unit mismatch)
 *   - CO-E22: LEV units default to the statutory 14-month interval;
 *     recordTest computes the next due date and a failed test takes the
 *     unit out of service
 *   - CO-E23: assessments.recordReview computes the next due date from
 *     the review frequency
 *   - CO-E24: archiving a substance hides it from the default list and
 *     blocks new assessments
 *   - CO-E25: supplierSuggestions returns distinct tenant suppliers
 *   - CO-E26: health surveillance — enrolment, recall computation, due
 *     flags, end-not-delete (Reg 11)
 *   - CO-E27: publish stamps publishedBy; controls carry RPE detail
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
import { createCoshhRouter } from './coshh';
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

const silentLogger = () => createLogger({ service: 'coshh-test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);

describe('coshh router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let standardId: string;
  let siteA: string;
  let siteB: string;

  function callerFor(userId: string) {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'coshh@x.test', tenantId: tenantId as never },
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
    siteB = newId();
    await db.insert(schema.sites).values([
      { id: siteA, tenantId, name: 'Warehouse' },
      { id: siteB, tenantId, name: 'Workshop' },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it('CO-E10: stamps sequential CS-XXXX refs and guards duplicate names', async () => {
    const caller = callerFor(adminId);
    const first = await caller.coshh.substances.create({ name: 'Acetone' });
    const second = await caller.coshh.substances.create({ name: 'Isopropanol' });
    expect(first.referenceNumber).toBe('CS-0001');
    expect(second.referenceNumber).toBe('CS-0002');

    await expect(caller.coshh.substances.create({ name: '  acetone ' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const dup = await caller.coshh.substances.create({ name: 'acetone', allowDuplicate: true });
    expect(dup.referenceNumber).toBe('CS-0003');

    const list = await caller.coshh.substances.list({});
    expect(list).toHaveLength(3);
    expect(list.every((s) => s.sdsStatus === 'missing')).toBe(true);
  });

  it('CO-E11: substances.get is tenant-isolated', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({ name: 'Acetone' });

    const otherTenant = newId();
    await db
      .insert(schema.tenants)
      .values({ id: otherTenant, name: 'Rival', slug: `rival-${otherTenant}` });
    const otherSets = await seedDefaultPermissionSets(db as never, otherTenant);
    const otherUser = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: otherUser,
      name: 'Eve',
      email: `eve-${otherTenant}@rival.test`,
      tenantId: otherTenant,
      permissionSetId: otherSets.administrator,
    });
    const otherCaller = createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: otherUser, email: 'eve@rival.test', tenantId: otherTenant as never },
      }),
    );
    await expect(otherCaller.coshh.substances.get({ substanceId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('CO-E12: a disabled module refuses every call', async () => {
    const disabledRouter = router({ coshh: createCoshhRouter({ enabled: false }) });
    const disabledCaller = createCallerFactory(disabledRouter)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: adminId, email: 'a@x.test', tenantId: tenantId as never },
      }),
    );
    await expect(disabledCaller.coshh.substances.list({})).rejects.toMatchObject({
      message: 'module-disabled',
    });
    await expect(disabledCaller.coshh.substances.create({ name: 'X' })).rejects.toMatchObject({
      message: 'module-disabled',
    });
  });

  it('CO-E13: standard users can view but not create', async () => {
    const admin = callerFor(adminId);
    await admin.coshh.substances.create({ name: 'Acetone' });
    const standard = callerFor(standardId);
    const list = await standard.coshh.substances.list({});
    expect(list).toHaveLength(1);
    await expect(standard.coshh.substances.create({ name: 'Y' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('CO-E14: sds.attach versions sequentially and drives the review-age status', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({ name: 'Acetone' });

    const fresh = new Date();
    fresh.setMonth(fresh.getMonth() - 1);
    await caller.coshh.sds.attach({
      substanceId,
      storageKey: `${tenantId}/coshh/${substanceId}/sds-v1.pdf`,
      filename: 'sds-v1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      issueDate: fresh,
    });
    let detail = await caller.coshh.substances.get({ substanceId });
    expect(detail.sdsDocuments).toHaveLength(1);
    expect(detail.sdsDocuments[0]?.version).toBe(1);
    expect(detail.sdsStatus).toBe('current');

    // A sheet issued 4 years ago is past the 36-month default review age.
    const stale = new Date();
    stale.setFullYear(stale.getFullYear() - 4);
    await caller.coshh.sds.attach({
      substanceId,
      storageKey: `${tenantId}/coshh/${substanceId}/sds-v2.pdf`,
      filename: 'sds-v2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      issueDate: stale,
    });
    detail = await caller.coshh.substances.get({ substanceId });
    expect(detail.sdsDocuments).toHaveLength(2);
    const current = detail.sdsDocuments.find((d) => d.isCurrent);
    expect(current?.version).toBe(2);
    expect(detail.sdsDocuments.filter((d) => d.isCurrent)).toHaveLength(1);
    expect(detail.sdsStatus).toBe('review_due');

    const list = await caller.coshh.substances.list({});
    expect(list[0]?.sdsStatus).toBe('review_due');
  });

  it('CO-E15: sds.confirmCurrent pushes the review date forward', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({ name: 'Acetone' });
    const stale = new Date();
    stale.setFullYear(stale.getFullYear() - 4);
    await caller.coshh.sds.attach({
      substanceId,
      storageKey: `${tenantId}/coshh/${substanceId}/sds.pdf`,
      filename: 'sds.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      issueDate: stale,
    });
    expect((await caller.coshh.substances.get({ substanceId })).sdsStatus).toBe('review_due');

    await caller.coshh.sds.confirmCurrent({ substanceId });
    const detail = await caller.coshh.substances.get({ substanceId });
    expect(detail.sdsStatus).toBe('current');
    // The confirmation is logged as evidence.
    expect(detail.events.some((e) => e.kind === 'sds_confirmed_current')).toBe(true);
  });

  it('CO-E16: create with an extraction infers regime flags and stores WELs', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({
      name: 'Chromic acid mist',
      supplier: 'PlateCo',
      physicalForm: 'mist',
      signalWord: 'danger',
      hazardClassification: ['Carc. 1A'],
      hStatements: [
        { code: 'H350', text: 'May cause cancer.' },
        { code: 'H334', text: 'May cause asthma symptoms.' },
      ],
      pictograms: ['GHS08'],
      workplaceExposureLimits: [
        {
          agent: 'chromium (VI)',
          twa8h: { value: 0.01, unit: 'mg/m3' },
          stel15min: null,
          source: 'EH40',
        },
      ],
    });
    const detail = await caller.coshh.substances.get({ substanceId });
    expect(detail.substance.isCarcinogen).toBe(true);
    expect(detail.substance.isAsthmagen).toBe(true);
    expect(detail.substance.isMutagen).toBe(false);
    expect(detail.substance.workplaceExposureLimits).toHaveLength(1);
    expect(detail.substitutionPriority).toBe('required');
  });

  it('CO-E17: storage conflicts are reported per site only', async () => {
    const caller = callerFor(adminId);
    const flam = await caller.coshh.substances.create({
      name: 'Acetone',
      initialLocation: { siteId: siteA, storageClass: 'flammable', quantity: 5, unit: 'l' },
    });
    await caller.coshh.substances.create({
      name: 'Hydrogen peroxide 30%',
      initialLocation: { siteId: siteA, storageClass: 'oxidiser', quantity: 2, unit: 'l' },
    });
    await caller.coshh.substances.create({
      name: 'Nitric acid',
      initialLocation: { siteId: siteB, storageClass: 'corrosive_acid', quantity: 1, unit: 'l' },
    });

    const detail = await caller.coshh.substances.get({ substanceId: flam.substanceId });
    expect(detail.storageConflicts).toHaveLength(1);
    expect(detail.storageConflicts[0]?.siteId).toBe(siteA);
    expect(detail.storageConflicts[0]?.otherSubstanceName).toBe('Hydrogen peroxide 30%');

    const overview = await caller.coshh.overview();
    expect(overview.storageConflicts).toBe(1);
  });

  it('CO-E18: publish guards routes, controls and PPE-only reliance', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({ name: 'Acetone' });
    const { assessmentId } = await caller.coshh.assessments.create({
      substanceId,
      taskDescription: 'Degreasing parts',
    });

    await expect(caller.coshh.assessments.publish({ assessmentId })).rejects.toMatchObject({
      message: 'no-routes',
    });

    await caller.coshh.assessments.update({
      assessmentId,
      routesOfExposure: ['inhalation', 'skin'],
      personsExposed: ['employees'],
    });
    await expect(caller.coshh.assessments.publish({ assessmentId })).rejects.toMatchObject({
      message: 'no-controls',
    });

    const { controlId } = await caller.coshh.assessments.addControl({
      assessmentId,
      tier: 'rpe',
      description: 'Half-mask with A2 filter',
    });
    await expect(caller.coshh.assessments.publish({ assessmentId })).rejects.toMatchObject({
      message: 'ppe-only-needs-justification',
    });

    await caller.coshh.assessments.updateControl({
      controlId,
      ppeJustification: 'LEV not reasonably practicable at this workstation; task under 10 min.',
    });
    const res = await caller.coshh.assessments.publish({ assessmentId });
    expect(res.ok).toBe(true);
    const detail = await caller.coshh.substances.get({ substanceId });
    expect(detail.assessments[0]?.status).toBe('active');
  });

  it('CO-E19: a CMR substance cannot publish while substitution is not assessed', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({
      name: 'Dichloromethane stripper',
      hStatements: [{ code: 'H350', text: 'May cause cancer.' }],
    });
    const { assessmentId } = await caller.coshh.assessments.create({
      substanceId,
      taskDescription: 'Paint stripping',
    });
    await caller.coshh.assessments.update({
      assessmentId,
      routesOfExposure: ['inhalation'],
      personsExposed: ['employees'],
    });
    await caller.coshh.assessments.addControl({
      assessmentId,
      tier: 'engineering',
      description: 'LEV at the stripping tank',
    });

    await expect(caller.coshh.assessments.publish({ assessmentId })).rejects.toMatchObject({
      message: 'substitution-not-considered',
    });

    await caller.coshh.substances.setSubstitution({
      substanceId,
      status: 'considered_rejected',
      notes: 'No effective water-based alternative for this substrate; trial failed 2025-06.',
    });
    const res = await caller.coshh.assessments.publish({ assessmentId });
    expect(res.ok).toBe(true);
  });

  it('CO-E20: publish creates one action per planned control, exactly once', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({ name: 'Acetone' });
    const { assessmentId } = await caller.coshh.assessments.create({
      substanceId,
      taskDescription: 'Degreasing',
    });
    await caller.coshh.assessments.update({
      assessmentId,
      routesOfExposure: ['inhalation'],
      personsExposed: ['employees'],
    });
    await caller.coshh.assessments.addControl({
      assessmentId,
      tier: 'engineering',
      description: 'Install LEV arm',
      status: 'planned',
    });
    await caller.coshh.assessments.addControl({
      assessmentId,
      tier: 'administrative',
      description: 'Limit task to 30 minutes',
    });

    const first = await caller.coshh.assessments.publish({ assessmentId });
    expect(first.actionsCreated).toBe(1);
    const again = await caller.coshh.assessments.publish({ assessmentId });
    expect(again.actionsCreated).toBe(0);

    const actionRows = await db
      .select()
      .from(schema.actions)
      .where(
        and(
          eq(schema.actions.tenantId, tenantId),
          eq(schema.actions.sourceType, 'coshh_assessment'),
        ),
      );
    expect(actionRows).toHaveLength(1);
    expect(actionRows[0]?.sourceId).toBe(assessmentId);
  });

  it('CO-E21: monitoring.record snapshots the WEL comparison', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({
      name: 'Toluene',
      workplaceExposureLimits: [
        {
          agent: 'toluene',
          twa8h: { value: 50, unit: 'ppm' },
          stel15min: { value: 100, unit: 'ppm' },
          source: 'EH40',
        },
      ],
    });

    const over = await caller.coshh.monitoring.record({
      substanceId,
      agent: 'Toluene',
      sampledAt: new Date(),
      sampleType: 'personal',
      period: 'twa8h',
      resultValue: 62,
      resultUnit: 'ppm',
    });
    expect(over.exceedsWel).toBe(true);

    const under = await caller.coshh.monitoring.record({
      substanceId,
      agent: 'toluene',
      sampledAt: new Date(),
      sampleType: 'personal',
      period: 'twa8h',
      resultValue: 12,
      resultUnit: 'ppm',
    });
    expect(under.exceedsWel).toBe(false);

    const mismatch = await caller.coshh.monitoring.record({
      substanceId,
      agent: 'toluene',
      sampledAt: new Date(),
      sampleType: 'personal',
      period: 'twa8h',
      resultValue: 100,
      resultUnit: 'mg/m3',
    });
    expect(mismatch.exceedsWel).toBeNull();

    const overview = await caller.coshh.overview();
    expect(overview.welExceedances).toBe(1);
  });

  it('CO-E22: LEV register — 14-month default, next-due computation, fail takes the unit out of service', async () => {
    const caller = callerFor(adminId);
    const { levUnitId } = await caller.coshh.lev.create({
      name: 'Welding bay extraction',
      siteId: siteA,
    });
    let list = await caller.coshh.lev.list({});
    expect(list[0]?.testIntervalMonths).toBe(14);
    expect(list[0]?.overdue).toBe(false);

    const tested = new Date();
    tested.setMonth(tested.getMonth() - 2);
    await caller.coshh.lev.recordTest({
      levUnitId,
      testedAt: tested,
      result: 'pass',
      examiner: 'VentCheck Ltd',
    });
    list = await caller.coshh.lev.list({});
    const expected = new Date(tested);
    expected.setMonth(expected.getMonth() + 14);
    expect(list[0]?.nextTestDueAt?.getTime()).toBe(expected.getTime());
    expect(list[0]?.overdue).toBe(false);

    await caller.coshh.lev.recordTest({
      levUnitId,
      testedAt: new Date(),
      result: 'fail',
      examiner: 'VentCheck Ltd',
      defectsSummary: 'Face velocity below design at slot 2.',
    });
    list = await caller.coshh.lev.list({});
    expect(list[0]?.status).toBe('out_of_service');

    // An overdue unit: last tested 20 months ago.
    const { levUnitId: oldUnit } = await caller.coshh.lev.create({ name: 'Solder tip extract' });
    const longAgo = new Date();
    longAgo.setMonth(longAgo.getMonth() - 20);
    await caller.coshh.lev.recordTest({
      levUnitId: oldUnit,
      testedAt: longAgo,
      result: 'pass',
      examiner: 'VentCheck Ltd',
    });
    list = await caller.coshh.lev.list({});
    expect(list.find((u) => u.id === oldUnit)?.overdue).toBe(true);
    const overview = await caller.coshh.overview();
    expect(overview.levDue).toBeGreaterThanOrEqual(1);
  });

  it('CO-E23: recordReview computes the next due date from the frequency', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({ name: 'Acetone' });
    const { assessmentId } = await caller.coshh.assessments.create({
      substanceId,
      taskDescription: 'Degreasing',
    });
    const res = await caller.coshh.assessments.recordReview({
      assessmentId,
      note: 'No change in use.',
    });
    expect(res.nextReviewAt).not.toBeNull();
    const detail = await caller.coshh.substances.get({ substanceId });
    const assessment = detail.assessments.find((a) => a.id === assessmentId);
    expect(assessment?.lastReviewedAt).not.toBeNull();
    expect(detail.events.some((e) => e.kind === 'review_recorded')).toBe(true);
  });

  it('CO-E24: archiving hides the substance and blocks new assessments', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({ name: 'Legacy degreaser' });
    await caller.coshh.substances.archive({ substanceId });

    const list = await caller.coshh.substances.list({});
    expect(list).toHaveLength(0);
    const all = await caller.coshh.substances.list({ status: 'all' });
    expect(all).toHaveLength(1);

    await expect(
      caller.coshh.assessments.create({ substanceId, taskDescription: 'X' }),
    ).rejects.toMatchObject({ message: 'archived' });
  });

  it('CO-E25: supplierSuggestions returns distinct tenant suppliers, most-used first', async () => {
    const caller = callerFor(adminId);
    await caller.coshh.substances.create({ name: 'Acetone', supplier: 'ReAgent Chemicals' });
    await caller.coshh.substances.create({ name: 'IPA', supplier: 'ReAgent Chemicals' });
    await caller.coshh.substances.create({ name: 'White spirit', supplier: 'Bartoline' });
    await caller.coshh.substances.create({ name: 'No supplier yet' });

    const suggestions = await caller.coshh.substances.supplierSuggestions();
    expect(suggestions).toEqual(['ReAgent Chemicals', 'Bartoline']);

    // Tenant isolation: a second tenant sees only its own suppliers.
    const otherTenant = newId();
    await db
      .insert(schema.tenants)
      .values({ id: otherTenant, name: 'Rival', slug: `rival-${otherTenant}` });
    const otherSets = await seedDefaultPermissionSets(db as never, otherTenant);
    const otherAdmin = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: otherAdmin,
      name: 'Oda Other',
      email: `oda-${otherTenant}@rival.test`,
      tenantId: otherTenant,
      permissionSetId: otherSets.administrator,
    });
    const otherCaller = createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: otherAdmin, email: 'other@x.test', tenantId: otherTenant as never },
      }),
    );
    await expect(otherCaller.coshh.substances.supplierSuggestions()).resolves.toEqual([]);
  });

  it('CO-E26: health surveillance enrolment, recall computation, and end-not-delete', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({ name: 'Glutaraldehyde' });

    const { enrolmentId } = await caller.coshh.surveillance.enroll({
      substanceId,
      userId: standardId,
      intervalMonths: 6,
    });
    // Duplicate live enrolment is refused.
    await expect(
      caller.coshh.surveillance.enroll({ substanceId, userId: standardId }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    let rows = await caller.coshh.surveillance.list({ substanceId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userName).toBe('Stan Standard');
    expect(rows[0]?.due).toBe(false);

    // Recording a check moves the recall on by the interval.
    const checkedAt = new Date('2026-01-10T00:00:00.000Z');
    const { nextDueAt } = await caller.coshh.surveillance.recordCheck({
      enrolmentId,
      checkedAt,
    });
    expect(nextDueAt.toISOString().slice(0, 10)).toBe('2026-07-10');

    // A past due date surfaces as due — on the register and on the list row.
    await db
      .update(schema.coshhHealthSurveillance)
      .set({ nextDueAt: new Date('2020-01-01T00:00:00.000Z') })
      .where(eq(schema.coshhHealthSurveillance.id, enrolmentId));
    rows = await caller.coshh.surveillance.list({ substanceId });
    expect(rows[0]?.due).toBe(true);
    const list = await caller.coshh.substances.list({});
    expect(list.find((s) => s.id === substanceId)?.surveillanceDue).toBe(true);

    // Ending keeps the record (40-year retention) and clears the due flag.
    await caller.coshh.surveillance.end({ enrolmentId });
    rows = await caller.coshh.surveillance.list({ substanceId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endedAt).not.toBeNull();
    expect(rows[0]?.due).toBe(false);
    await expect(caller.coshh.surveillance.recordCheck({ enrolmentId })).rejects.toMatchObject({
      message: 'ended',
    });

    const events = await db
      .select()
      .from(schema.coshhEvents)
      .where(eq(schema.coshhEvents.entityId, substanceId));
    const kinds = events.map((e) => e.kind);
    for (const k of ['surveillance_enrolled', 'surveillance_check_recorded', 'surveillance_ended'])
      expect(kinds).toContain(k);
  });

  it('CO-E27: publish stamps the assessor sign-off and controls carry RPE detail', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({ name: 'Silica dust' });
    const { assessmentId } = await caller.coshh.assessments.create({
      substanceId,
      taskDescription: 'Cutting blockwork',
    });
    await caller.coshh.assessments.update({
      assessmentId,
      routesOfExposure: ['inhalation'],
      personsExposed: ['employees'],
    });
    await caller.coshh.assessments.addControl({
      assessmentId,
      tier: 'engineering',
      description: 'On-tool extraction',
    });
    const { controlId } = await caller.coshh.assessments.addControl({
      assessmentId,
      tier: 'rpe',
      description: 'FFP3 respirator for residual dust',
      rpeType: 'FFP3 disposable',
      rpeApf: 20,
      faceFitConfirmedAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    await caller.coshh.assessments.publish({ assessmentId });
    const detail = await caller.coshh.substances.get({ substanceId });
    const assessment = detail.assessments.find((a) => a.id === assessmentId);
    expect(assessment?.publishedBy).toBe(adminId);

    const controls = await db
      .select()
      .from(schema.coshhAssessmentControls)
      .where(eq(schema.coshhAssessmentControls.id, controlId));
    expect(controls[0]?.rpeType).toBe('FFP3 disposable');
    expect(controls[0]?.rpeApf).toBe(20);
    expect(controls[0]?.faceFitConfirmedAt?.toISOString().slice(0, 10)).toBe('2026-03-01');
  });

  it('CO-E28: point-of-work assessments carry their kind through the same guards', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({ name: 'Expanding foam' });
    const { assessmentId } = await caller.coshh.assessments.create({
      substanceId,
      taskDescription: 'Sealing frames, plot 4',
      kind: 'point_of_work',
    });
    await caller.coshh.assessments.update({
      assessmentId,
      routesOfExposure: ['inhalation', 'skin'],
    });
    await caller.coshh.assessments.addControl({
      assessmentId,
      tier: 'engineering',
      description: 'Ventilate the room while curing',
    });
    await caller.coshh.assessments.publish({ assessmentId });

    const detail = await caller.coshh.substances.get({ substanceId });
    const assessment = detail.assessments.find((a) => a.id === assessmentId);
    expect(assessment?.kind).toBe('point_of_work');
    expect(assessment?.status).toBe('active');
    // Default stays standing for the desktop flow.
    const { assessmentId: standingId } = await caller.coshh.assessments.create({
      substanceId,
      taskDescription: 'Standing assessment',
    });
    const detail2 = await caller.coshh.substances.get({ substanceId });
    expect(detail2.assessments.find((a) => a.id === standingId)?.kind).toBe('standing');
  });

  it('CO-E29: editing an active assessment flags it stale until republished', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({ name: 'White spirit' });
    const { assessmentId } = await caller.coshh.assessments.create({
      substanceId,
      taskDescription: 'Brush cleaning',
    });
    await caller.coshh.assessments.update({ assessmentId, routesOfExposure: ['skin'] });
    await caller.coshh.assessments.addControl({
      assessmentId,
      tier: 'administrative',
      description: 'Lidded wash container',
    });
    await caller.coshh.assessments.publish({ assessmentId });

    const fresh = (await caller.coshh.substances.get({ substanceId })).assessments[0];
    expect(fresh?.lastPublishedAt).not.toBeNull();
    // Just published: not stale.
    expect(
      fresh !== undefined &&
        fresh.lastPublishedAt !== null &&
        fresh.updatedAt > fresh.lastPublishedAt,
    ).toBe(false);

    // A control change on the ACTIVE assessment moves updatedAt forward.
    await caller.coshh.assessments.addControl({
      assessmentId,
      tier: 'ppe',
      description: 'Nitrile gloves',
    });
    const stale = (await caller.coshh.substances.get({ substanceId })).assessments[0];
    expect(
      stale !== undefined &&
        stale.lastPublishedAt !== null &&
        stale.updatedAt > stale.lastPublishedAt,
    ).toBe(true);

    // Republish clears it (lastPublishedAt catches up; publishedAt keeps first).
    await caller.coshh.assessments.publish({ assessmentId });
    const cleared = (await caller.coshh.substances.get({ substanceId })).assessments[0];
    expect(
      cleared !== undefined &&
        cleared.lastPublishedAt !== null &&
        cleared.updatedAt > cleared.lastPublishedAt,
    ).toBe(false);
    expect(cleared?.publishedAt?.getTime()).toBe(fresh?.publishedAt?.getTime());
  });

  it('CO-E25: assessments.create with a clientRequestId is idempotent (PF-10)', async () => {
    const caller = callerFor(adminId);
    const { substanceId } = await caller.coshh.substances.create({ name: 'Acetone' });
    const clientRequestId = newId();
    const first = await caller.coshh.assessments.create({
      substanceId,
      taskDescription: 'Point-of-work: degreasing parts',
      kind: 'point_of_work',
      clientRequestId,
    });
    const retry = await caller.coshh.assessments.create({
      substanceId,
      taskDescription: 'Point-of-work: degreasing parts',
      kind: 'point_of_work',
      clientRequestId,
    });
    expect(retry.assessmentId).toBe(first.assessmentId);
    expect(retry.referenceNumber).toBe(first.referenceNumber);
    expect((retry as { deduped?: boolean }).deduped).toBe(true);
    const rows = await db
      .select()
      .from(schema.coshhAssessments)
      .where(eq(schema.coshhAssessments.clientRequestId, clientRequestId));
    expect(rows).toHaveLength(1);
  });
});

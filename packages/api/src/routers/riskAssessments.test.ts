/**
 * Integration tests for the riskAssessments router (FreeHS module B1).
 *
 * Edge cases:
 *   - RA-E01: create stamps sequential RA-XXXX references
 *   - RA-E02: publish refuses an assessment with no hazards
 *   - RA-E03: publish refuses unscored hazards (initial + residual required)
 *   - RA-E04: a PPE-only hazard needs a justification to publish
 *   - RA-E05: publish creates one action per planned control, exactly once
 *     (republish does not duplicate)
 *   - RA-E06: distribute requires active; acknowledgement lifecycle incl.
 *     re-distribution reset
 *   - RA-E07: acknowledging without being a recipient → NOT_FOUND
 *   - RA-E08: recordReview logs the trigger and computes the next due date
 *     from the review frequency
 *   - RA-E09: person-specific variant copies hazards + controls as a linked
 *     draft with action links cleared
 *   - RA-E10: tenant isolation on get
 *   - RA-E11: a disabled module (wrong brand) refuses every call
 *   - RA-E12: standard users can view but not create
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
import { createTestContext } from '../context';
import { appRouter } from '../router';
import { createRiskAssessmentsRouter } from './riskAssessments';
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

const silentLogger = () => createLogger({ service: 'ra-test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);

describe('riskAssessments router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let standardId: string;

  function callerFor(userId: string) {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'ra@x.test', tenantId: tenantId as never },
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
  });

  afterEach(async () => {
    await client.close();
  });

  async function createScoredAssessment(caller: ReturnType<typeof callerFor>) {
    const { assessmentId } = await caller.riskAssessments.create({
      title: 'Manual handling',
      activity: 'Moving stock',
      type: 'standing',
    });
    const { hazardId } = await caller.riskAssessments.addHazard({
      assessmentId,
      hazard: 'Heavy lifting',
      harmDescription: 'Back injury',
      affectedGroups: ['employees', 'contractors'],
      existingControls: 'Team lifting',
      initialLikelihood: 4,
      initialSeverity: 4,
      residualLikelihood: 2,
      residualSeverity: 3,
    });
    return { assessmentId, hazardId };
  }

  it('RA-E01: stamps sequential RA-XXXX reference numbers', async () => {
    const caller = callerFor(adminId);
    const first = await caller.riskAssessments.create({ title: 'One', activity: '' });
    const second = await caller.riskAssessments.create({ title: 'Two', activity: '' });
    expect(first.referenceNumber).toBe('RA-0001');
    expect(second.referenceNumber).toBe('RA-0002');
    const list = await caller.riskAssessments.list({ status: 'all', type: 'all' });
    expect(list).toHaveLength(2);
    expect(list.every((a) => a.status === 'draft')).toBe(true);
  });

  it('RA-E02: publish refuses an assessment without hazards', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await caller.riskAssessments.create({ title: 'Empty', activity: '' });
    await expect(caller.riskAssessments.publish({ assessmentId })).rejects.toMatchObject({
      message: 'no-hazards',
    });
  });

  it('RA-E03: publish refuses unscored hazards', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await caller.riskAssessments.create({ title: 'Part', activity: '' });
    await caller.riskAssessments.addHazard({
      assessmentId,
      hazard: 'Slips',
      harmDescription: '',
      affectedGroups: [],
      existingControls: '',
      initialLikelihood: 3,
      initialSeverity: 3,
      // residual missing
    });
    await expect(caller.riskAssessments.publish({ assessmentId })).rejects.toMatchObject({
      message: 'unscored-hazards',
    });
  });

  it('RA-E04: PPE-only hazard needs a justification to publish', async () => {
    const caller = callerFor(adminId);
    const { assessmentId, hazardId } = await createScoredAssessment(caller);
    const { controlId } = await caller.riskAssessments.addControl({
      hazardId,
      description: 'Gloves',
      tier: 'ppe',
      status: 'in_place',
    });
    await expect(caller.riskAssessments.publish({ assessmentId })).rejects.toMatchObject({
      message: 'ppe-only-needs-justification',
    });
    await caller.riskAssessments.updateControl({
      controlId,
      ppeJustification:
        'Higher-order controls not reasonably practicable for residual splash risk.',
    });
    const res = await caller.riskAssessments.publish({ assessmentId });
    expect(res.ok).toBe(true);
  });

  it('RA-E05: publish creates one action per planned control, exactly once', async () => {
    const caller = callerFor(adminId);
    const { assessmentId, hazardId } = await createScoredAssessment(caller);
    await caller.riskAssessments.addControl({
      hazardId,
      description: 'Install lifting hoist',
      tier: 'engineering',
      status: 'planned',
    });
    await caller.riskAssessments.addControl({
      hazardId,
      description: 'Team lift SOP',
      tier: 'administrative',
      status: 'in_place',
    });
    const first = await caller.riskAssessments.publish({ assessmentId });
    expect(first.actionsCreated).toBe(1);

    const actionRows = await db
      .select()
      .from(schema.actions)
      .where(eq(schema.actions.tenantId, tenantId));
    expect(actionRows).toHaveLength(1);
    const action = actionRows[0];
    expect(action?.sourceType).toBe('risk_assessment');
    expect(action?.sourceId).toBe(assessmentId);
    expect(action?.title).toContain('Install lifting hoist');
    expect(action?.referenceNumber).toMatch(/^AC-\d{6}$/);

    const detail = await caller.riskAssessments.get({ assessmentId });
    const planned = detail.hazards[0]?.controls.find((c) => c.status === 'planned');
    expect(planned?.actionId).toBe(action?.id);

    // Republish must not duplicate the action.
    const second = await caller.riskAssessments.publish({ assessmentId });
    expect(second.actionsCreated).toBe(0);
    const actionRows2 = await db
      .select()
      .from(schema.actions)
      .where(eq(schema.actions.tenantId, tenantId));
    expect(actionRows2).toHaveLength(1);
  });

  it('RA-E06: distribution + acknowledgement lifecycle', async () => {
    const admin = callerFor(adminId);
    const standard = callerFor(standardId);
    const { assessmentId } = await createScoredAssessment(admin);

    // Draft assessments cannot be distributed.
    await expect(
      admin.riskAssessments.distribute({ assessmentId, userIds: [standardId] }),
    ).rejects.toMatchObject({ message: 'not-active' });

    await admin.riskAssessments.publish({ assessmentId });
    await admin.riskAssessments.distribute({ assessmentId, userIds: [standardId] });

    const pending = await standard.riskAssessments.listMyPending();
    expect(pending).toHaveLength(1);

    await standard.riskAssessments.acknowledge({ assessmentId });
    const afterAck = await standard.riskAssessments.listMyPending();
    expect(afterAck).toHaveLength(0);

    const detail = await admin.riskAssessments.get({ assessmentId });
    const ack = detail.acknowledgements.find((a) => a.userId === standardId);
    expect(ack?.acknowledgedAt).not.toBeNull();

    // Re-distribution resets the acknowledgement.
    await admin.riskAssessments.distribute({ assessmentId, userIds: [standardId] });
    const detail2 = await admin.riskAssessments.get({ assessmentId });
    const ack2 = detail2.acknowledgements.find((a) => a.userId === standardId);
    expect(ack2?.acknowledgedAt).toBeNull();
    const rawRow = await db
      .select()
      .from(schema.riskAssessmentAcknowledgements)
      .where(eq(schema.riskAssessmentAcknowledgements.userId, standardId));
    expect(rawRow[0]?.redistributed).toBe(true);
  });

  it('RA-E07: acknowledging without being a recipient → NOT_FOUND', async () => {
    const admin = callerFor(adminId);
    const standard = callerFor(standardId);
    const { assessmentId } = await createScoredAssessment(admin);
    await admin.riskAssessments.publish({ assessmentId });
    await expect(standard.riskAssessments.acknowledge({ assessmentId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('RA-E08: recordReview logs the trigger and computes the next due date', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await createScoredAssessment(caller);
    await caller.riskAssessments.update({ assessmentId, reviewFrequencyMonths: 12 });
    const res = await caller.riskAssessments.recordReview({
      assessmentId,
      trigger: 'incident',
      outcome: 'updated',
      note: 'Near miss on 14/07.',
    });
    expect(res.nextReviewAt).not.toBeNull();
    const inAYear = new Date();
    inAYear.setMonth(inAYear.getMonth() + 12);
    expect(Math.abs((res.nextReviewAt as Date).getTime() - inAYear.getTime())).toBeLessThan(
      1000 * 60 * 60 * 24 * 3,
    );
    const detail = await caller.riskAssessments.get({ assessmentId });
    expect(detail.reviews).toHaveLength(1);
    expect(detail.reviews[0]?.trigger).toBe('incident');
    expect(detail.assessment.lastReviewedBy).toBe(adminId);
  });

  it('RA-E09: person-specific variant copies hazards + controls as a linked draft', async () => {
    const caller = callerFor(adminId);
    const { assessmentId, hazardId } = await createScoredAssessment(caller);
    await caller.riskAssessments.addControl({
      hazardId,
      description: 'Hoist',
      tier: 'engineering',
      status: 'planned',
    });
    await caller.riskAssessments.publish({ assessmentId });

    const variant = await caller.riskAssessments.createPersonSpecific({
      assessmentId,
      kind: 'young_person',
    });
    const detail = await caller.riskAssessments.get({ assessmentId: variant.assessmentId });
    expect(detail.assessment.status).toBe('draft');
    expect(detail.assessment.personSpecificFor).toBe('young_person');
    expect(detail.assessment.parentAssessmentId).toBe(assessmentId);
    expect(detail.hazards).toHaveLength(1);
    expect(detail.hazards[0]?.controls).toHaveLength(1);
    // Copied planned control must NOT inherit the parent's action link.
    expect(detail.hazards[0]?.controls[0]?.actionId).toBeNull();

    const parent = await caller.riskAssessments.get({ assessmentId });
    expect(parent.linkedVariants).toHaveLength(1);
  });

  it('RA-E10: tenant isolation on get', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await createScoredAssessment(caller);

    const otherTenantId = newId();
    await db
      .insert(schema.tenants)
      .values({ id: otherTenantId, name: 'Other', slug: `other-${otherTenantId}` });
    const otherSets = await seedDefaultPermissionSets(db as never, otherTenantId);
    const otherAdmin = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: otherAdmin,
      name: 'Eve',
      email: `eve-${otherTenantId}@other.test`,
      tenantId: otherTenantId,
      permissionSetId: otherSets.administrator,
    });
    const otherCaller = createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: otherAdmin, email: 'eve@x', tenantId: otherTenantId as never },
      }),
    );
    await expect(otherCaller.riskAssessments.get({ assessmentId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('RA-E11: a disabled module refuses every call (brand gating)', async () => {
    const disabledRouter = router({
      riskAssessments: createRiskAssessmentsRouter({ enabled: false }),
    });
    const disabledCaller = createCallerFactory(disabledRouter)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: adminId, email: 'ra@x.test', tenantId: tenantId as never },
      }),
    );
    await expect(
      disabledCaller.riskAssessments.list({ status: 'all', type: 'all' }),
    ).rejects.toMatchObject({ message: 'module-disabled' });
    await expect(
      disabledCaller.riskAssessments.create({ title: 'X', activity: '' }),
    ).rejects.toMatchObject({ message: 'module-disabled' });
  });

  it('RA-E12: standard users can view but not create', async () => {
    const admin = callerFor(adminId);
    const standard = callerFor(standardId);
    await createScoredAssessment(admin);
    const list = await standard.riskAssessments.list({ status: 'all', type: 'all' });
    expect(list).toHaveLength(1);
    await expect(
      standard.riskAssessments.create({ title: 'Nope', activity: '' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('RA-E13: create seeds the 12-month review schedule and get exposes creator + linked actions', async () => {
    const caller = callerFor(adminId);
    const { assessmentId, hazardId } = await createScoredAssessment(caller);
    const detail = await caller.riskAssessments.get({ assessmentId });
    expect(detail.createdByName).toBe('Alice Admin');
    expect(detail.assessment.reviewFrequencyMonths).toBe(12);
    const due = detail.assessment.nextReviewAt;
    expect(due).not.toBeNull();
    const expected = new Date();
    expected.setMonth(expected.getMonth() + 12);
    expect(Math.abs((due as Date).getTime() - expected.getTime())).toBeLessThan(
      1000 * 60 * 60 * 24 * 3,
    );

    await caller.riskAssessments.addControl({
      hazardId,
      description: 'Install hoist',
      tier: 'engineering',
      status: 'planned',
    });
    await caller.riskAssessments.publish({ assessmentId });
    const after = await caller.riskAssessments.get({ assessmentId });
    expect(after.linkedActions).toHaveLength(1);
    expect(after.linkedActions[0]?.title).toContain('Install hoist');
  });

  it('RA-E14: generated actions default to publisher / medium / due in 7 days', async () => {
    const caller = callerFor(adminId);
    const { assessmentId, hazardId } = await createScoredAssessment(caller);
    await caller.riskAssessments.addControl({
      hazardId,
      description: 'Guard rail',
      tier: 'engineering',
      status: 'planned',
    });
    await caller.riskAssessments.publish({ assessmentId });
    const rows = await db
      .select()
      .from(schema.actions)
      .where(eq(schema.actions.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    const action = rows[0];
    expect(action?.assigneeUserId).toBe(adminId);
    expect(action?.priority).toBe('medium');
    const dueIn = (action?.dueAt as Date).getTime() - Date.now();
    expect(dueIn).toBeGreaterThan(1000 * 60 * 60 * 24 * 6);
    expect(dueIn).toBeLessThan(1000 * 60 * 60 * 24 * 8);
  });

  it('RA-E15: moveToDraft returns an active or archived assessment to draft', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await createScoredAssessment(caller);
    await caller.riskAssessments.publish({ assessmentId });
    await caller.riskAssessments.moveToDraft({ assessmentId });
    let detail = await caller.riskAssessments.get({ assessmentId });
    expect(detail.assessment.status).toBe('draft');

    await caller.riskAssessments.archive({ assessmentId });
    await caller.riskAssessments.moveToDraft({ assessmentId });
    detail = await caller.riskAssessments.get({ assessmentId });
    expect(detail.assessment.status).toBe('draft');
    expect(detail.assessment.archivedAt).toBeNull();
  });

  it('RA-E16: the last hazard cannot be removed', async () => {
    const caller = callerFor(adminId);
    const { assessmentId, hazardId } = await createScoredAssessment(caller);
    await expect(caller.riskAssessments.removeHazard({ hazardId })).rejects.toMatchObject({
      message: 'last-hazard',
    });
    const { hazardId: second } = await caller.riskAssessments.addHazard({
      assessmentId,
      hazard: 'Second hazard',
      harmDescription: '',
      affectedGroups: [],
      existingControls: '',
    });
    await expect(caller.riskAssessments.removeHazard({ hazardId: second })).resolves.toMatchObject({
      ok: true,
    });
  });

  it('RA-E17: the change log records mutations immutably with actor names', async () => {
    const caller = callerFor(adminId);
    const { assessmentId, hazardId } = await createScoredAssessment(caller);
    await caller.riskAssessments.addControl({
      hazardId,
      description: 'Guard',
      tier: 'engineering',
      status: 'in_place',
    });
    await caller.riskAssessments.publish({ assessmentId });
    await caller.riskAssessments.moveToDraft({ assessmentId });
    const detail = await caller.riskAssessments.get({ assessmentId });
    const kinds = detail.events.map((e) => e.kind);
    for (const expected of [
      'created',
      'hazard_added',
      'control_added',
      'published',
      'moved_to_draft',
    ]) {
      expect(kinds).toContain(expected);
    }
    expect(detail.events.every((e) => e.actorName === 'Alice Admin')).toBe(true);
    // Immutability: the router exposes no mutation surface for events.
    const surface = Object.keys(caller.riskAssessments);
    expect(surface.some((k) => /event/i.test(k) && /update|delete|remove/i.test(k))).toBe(false);
  });

  it('RA-E18: site link is tenant-checked, surfaced in list/get, and logged', async () => {
    const caller = callerFor(adminId);
    const siteId = newId();
    await db.insert(schema.sites).values({ id: siteId, tenantId, name: 'Warehouse A' });

    const { assessmentId } = await caller.riskAssessments.create({
      title: 'Forklifts',
      activity: '',
    });
    await caller.riskAssessments.update({ assessmentId, siteId });

    const detail = await caller.riskAssessments.get({ assessmentId });
    expect(detail.assessment.siteId).toBe(siteId);
    expect(detail.siteName).toBe('Warehouse A');
    expect(detail.events.map((e) => e.kind)).toContain('site_changed');
    expect(detail.events.find((e) => e.kind === 'site_changed')?.detail).toBe('Warehouse A');

    const list = await caller.riskAssessments.list({ status: 'all', type: 'all' });
    expect(list.find((a) => a.id === assessmentId)?.siteName).toBe('Warehouse A');

    // Clearing the site works and logs with an empty detail.
    await caller.riskAssessments.update({ assessmentId, siteId: null });
    const cleared = await caller.riskAssessments.get({ assessmentId });
    expect(cleared.assessment.siteId).toBeNull();
    expect(cleared.siteName).toBeNull();

    // Another tenant's site is rejected — the FK alone would accept it.
    const otherTenantId = newId();
    await db
      .insert(schema.tenants)
      .values({ id: otherTenantId, name: 'Rival', slug: `rival-${otherTenantId}` });
    const foreignSiteId = newId();
    await db
      .insert(schema.sites)
      .values({ id: foreignSiteId, tenantId: otherTenantId, name: 'Foreign yard' });
    await expect(
      caller.riskAssessments.update({ assessmentId, siteId: foreignSiteId }),
    ).rejects.toMatchObject({ message: 'unknown-site' });
    await expect(
      caller.riskAssessments.create({ title: 'X', activity: '', siteId: foreignSiteId }),
    ).rejects.toMatchObject({ message: 'unknown-site' });
  });

  it('RA-E19: prepareHeadsUpAttachment renders via the injected dep; refuses without it', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await createScoredAssessment(caller);

    // Default appRouter carries no renderPdf dep → explicit refusal.
    await expect(
      caller.riskAssessments.prepareHeadsUpAttachment({ assessmentId }),
    ).rejects.toMatchObject({ message: 'render-unavailable' });

    // With an injected renderer the procedure returns the attachment
    // descriptor the Heads Up composer expects.
    const seen: Array<{ tenantId: string; assessmentId: string }> = [];
    const renderRouter = router({
      riskAssessments: createRiskAssessmentsRouter({
        enabled: true,
        renderPdf: (input) => {
          seen.push(input);
          return Promise.resolve({
            key: `${input.tenantId}/risk-assessments/${input.assessmentId}/pdf-abc.pdf`,
            bytes: 12_345,
            stub: false,
          });
        },
      }),
    });
    const renderCaller = createCallerFactory(renderRouter)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: adminId, email: 'ra@x.test', tenantId: tenantId as never },
      }),
    );
    const att = await renderCaller.riskAssessments.prepareHeadsUpAttachment({ assessmentId });
    expect(seen).toEqual([{ tenantId, assessmentId }]);
    expect(att.storageKey).toBe(`${tenantId}/risk-assessments/${assessmentId}/pdf-abc.pdf`);
    expect(att.filename).toMatch(/^RA-\d{4}\.pdf$/);
    expect(att.mimeType).toBe('application/pdf');
    expect(att.sizeBytes).toBe(12_345);
    // Cross-tenant isolation of the underlying load is covered by RA-E10;
    // prepareHeadsUpAttachment goes through the same loadAssessment guard.
  });
});

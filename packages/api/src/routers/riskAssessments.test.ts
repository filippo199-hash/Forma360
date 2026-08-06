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
 *   - RA-E13: create seeds the 12-month frequency but NOT a review date;
 *     get exposes creator + linked actions
 *   - RA-E14: generated actions carry the chosen assignee + due date and a
 *     band-derived priority (P-3)
 *   - RA-E15: moveToDraft returns an active or archived assessment to draft
 *   - RA-E16: the last hazard cannot be removed
 *   - RA-E17: the change log records mutations immutably with actor names
 *   - RA-E18: site link is tenant-checked, surfaced in list/get, and logged
 *   - RA-E19: renderPdf/prepareHeadsUpAttachment render via the injected
 *     dep; refuse without it; the Heads Up path refuses drafts (T-4)
 *   - RA-E20: publish refuses residual risk above initial risk (P-1)
 *   - RA-E21: publish refuses a scored residual with no controls (P-2)
 *   - RA-E22: high/critical residual needs a tolerability note or a
 *     planned control (P-2)
 *   - RA-E23: every planned control needs a valid assignee + due date;
 *     foreign/unknown assignees and past due dates are rejected (P-3)
 *   - RA-E24: publish is a signed act — sign-off captured on the version
 *     row with the signer's name (M-2)
 *   - RA-E25: publish freezes a version; content edits flag unpublished
 *     changes; republish bumps the version and re-opens acknowledgements;
 *     an unchanged republish does neither (A-1 / M-3)
 *   - RA-E26: the review clock anchors to publish, not creation; drafts
 *     never show review-due (M-1)
 *   - RA-E27: tenant matrix settings — thresholds + severity floors apply
 *     to new assessments (and drafts on request), admin-only (P-4)
 *   - RA-E28: distributeFromHeadsUp records acknowledgement rows for the
 *     heads-up recipients without resetting existing ones (A-2)
 *   - RA-E29: distribute stores the deadline and emails every recipient
 *     (A-3)
 *   - RA-E30: variant drift is flagged on both sides once the parent's
 *     content changes after the fork (A-4)
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
import { appRouter, __authStubMailbox } from '../router';
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

const IN_A_WEEK = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    __authStubMailbox.length = 0;
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

  /** Publish with the sign-off confirmed and optional action assignments. */
  function publishOk(
    caller: ReturnType<typeof callerFor>,
    assessmentId: string,
    actionAssignments: Array<{ controlId: string; assigneeUserId: string; dueAt: Date }> = [],
  ) {
    return caller.riskAssessments.publish({
      assessmentId,
      confirmSignOff: true,
      actionAssignments,
    });
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
    await expect(publishOk(caller, assessmentId)).rejects.toMatchObject({
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
    await expect(publishOk(caller, assessmentId)).rejects.toMatchObject({
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
    await expect(publishOk(caller, assessmentId)).rejects.toMatchObject({
      message: 'ppe-only-needs-justification',
    });
    await caller.riskAssessments.updateControl({
      controlId,
      ppeJustification:
        'Higher-order controls not reasonably practicable for residual splash risk.',
    });
    const res = await publishOk(caller, assessmentId);
    expect(res.ok).toBe(true);
  });

  it('RA-E05: publish creates one action per planned control, exactly once', async () => {
    const caller = callerFor(adminId);
    const { assessmentId, hazardId } = await createScoredAssessment(caller);
    const { controlId } = await caller.riskAssessments.addControl({
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
    const first = await publishOk(caller, assessmentId, [
      { controlId, assigneeUserId: standardId, dueAt: IN_A_WEEK() },
    ]);
    expect(first.actionsCreated).toBe(1);
    expect(first.version).toBe(1);

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

    // Republish must not duplicate the action (and, unchanged, must not
    // cut a new version either).
    const second = await publishOk(caller, assessmentId);
    expect(second.actionsCreated).toBe(0);
    expect(second.version).toBe(1);
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

    await publishOk(admin, assessmentId);
    await admin.riskAssessments.distribute({ assessmentId, userIds: [standardId] });

    const pending = await standard.riskAssessments.listMyPending();
    expect(pending).toHaveLength(1);

    await standard.riskAssessments.acknowledge({ assessmentId });
    const afterAck = await standard.riskAssessments.listMyPending();
    expect(afterAck).toHaveLength(0);

    const detail = await admin.riskAssessments.get({ assessmentId });
    const ack = detail.acknowledgements.find((a) => a.userId === standardId);
    expect(ack?.acknowledgedAt).not.toBeNull();
    expect(ack?.acknowledgedVersion).toBe(1);

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
    await publishOk(admin, assessmentId);
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
    const { controlId } = await caller.riskAssessments.addControl({
      hazardId,
      description: 'Hoist',
      tier: 'engineering',
      status: 'planned',
    });
    await publishOk(caller, assessmentId, [
      { controlId, assigneeUserId: adminId, dueAt: IN_A_WEEK() },
    ]);

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

  it('RA-E13: create seeds the 12-month frequency (no review date yet) and get exposes creator + linked actions', async () => {
    const caller = callerFor(adminId);
    const { assessmentId, hazardId } = await createScoredAssessment(caller);
    const detail = await caller.riskAssessments.get({ assessmentId });
    expect(detail.createdByName).toBe('Alice Admin');
    expect(detail.assessment.reviewFrequencyMonths).toBe(12);
    // M-1: the clock has not started — the assessment has never been live.
    expect(detail.assessment.nextReviewAt).toBeNull();

    const { controlId } = await caller.riskAssessments.addControl({
      hazardId,
      description: 'Install hoist',
      tier: 'engineering',
      status: 'planned',
    });
    await publishOk(caller, assessmentId, [
      { controlId, assigneeUserId: adminId, dueAt: IN_A_WEEK() },
    ]);
    const after = await caller.riskAssessments.get({ assessmentId });
    expect(after.linkedActions).toHaveLength(1);
    expect(after.linkedActions[0]?.title).toContain('Install hoist');
  });

  it('RA-E14: generated actions carry the chosen assignee + due date and band-derived priority', async () => {
    const caller = callerFor(adminId);
    const { assessmentId, hazardId } = await createScoredAssessment(caller);
    const { controlId } = await caller.riskAssessments.addControl({
      hazardId,
      description: 'Guard rail',
      tier: 'engineering',
      status: 'planned',
    });
    const dueAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await publishOk(caller, assessmentId, [{ controlId, assigneeUserId: standardId, dueAt }]);
    const rows = await db
      .select()
      .from(schema.actions)
      .where(eq(schema.actions.tenantId, tenantId));
    expect(rows).toHaveLength(1);
    const action = rows[0];
    // P-3: the owner + deadline are the ones chosen at publish, not
    // "publisher / 7 days".
    expect(action?.assigneeUserId).toBe(standardId);
    expect(Math.abs((action?.dueAt as Date).getTime() - dueAt.getTime())).toBeLessThan(1000);
    // Residual 2×3 = 6 → medium band → medium priority.
    expect(action?.priority).toBe('medium');
  });

  it('RA-E15: moveToDraft returns an active or archived assessment to draft', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await createScoredAssessment(caller);
    await publishOk(caller, assessmentId);
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
    await publishOk(caller, assessmentId);
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

  it('RA-E19: PDF rendering uses the injected dep; Heads Up path refuses drafts (T-4)', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await createScoredAssessment(caller);

    // Default appRouter carries no renderPdf dep → explicit refusal.
    await expect(
      caller.riskAssessments.prepareHeadsUpAttachment({ assessmentId }),
    ).rejects.toMatchObject({ message: 'render-unavailable' });
    await expect(caller.riskAssessments.renderPdf({ assessmentId })).rejects.toMatchObject({
      message: 'render-unavailable',
    });

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

    // T-4: the Heads Up attachment path REFUSES drafts — sharing must
    // never publish as a side effect.
    await expect(
      renderCaller.riskAssessments.prepareHeadsUpAttachment({ assessmentId }),
    ).rejects.toMatchObject({ message: 'not-active' });

    // The plain download (M-4) works for drafts and active alike.
    const dl = await renderCaller.riskAssessments.renderPdf({ assessmentId });
    expect(dl.storageKey).toBe(`${tenantId}/risk-assessments/${assessmentId}/pdf-abc.pdf`);
    expect(dl.filename).toMatch(/^RA-\d{4}\.pdf$/);

    await publishOk(caller, assessmentId);
    const att = await renderCaller.riskAssessments.prepareHeadsUpAttachment({ assessmentId });
    expect(seen.length).toBe(2);
    expect(att.storageKey).toBe(`${tenantId}/risk-assessments/${assessmentId}/pdf-abc.pdf`);
    expect(att.mimeType).toBe('application/pdf');
    expect(att.sizeBytes).toBe(12_345);
  });

  it('RA-E20: publish refuses residual risk above initial risk (P-1)', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await caller.riskAssessments.create({
      title: 'Backwards',
      activity: '',
    });
    await caller.riskAssessments.addHazard({
      assessmentId,
      hazard: 'Trip hazard',
      harmDescription: '',
      affectedGroups: [],
      existingControls: 'Signage',
      initialLikelihood: 2,
      initialSeverity: 3, // initial 6
      residualLikelihood: 4,
      residualSeverity: 5, // residual 20 — impossible
    });
    await expect(publishOk(caller, assessmentId)).rejects.toMatchObject({
      message: 'residual-above-initial',
    });
  });

  it('RA-E21: publish refuses a scored residual with no controls at all (P-2)', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await caller.riskAssessments.create({
      title: 'No controls',
      activity: '',
    });
    const { hazardId } = await caller.riskAssessments.addHazard({
      assessmentId,
      hazard: 'Working at height',
      harmDescription: 'Falls',
      affectedGroups: [],
      existingControls: '', // nothing structured, nothing free-text
      initialLikelihood: 4,
      initialSeverity: 5,
      residualLikelihood: 2,
      residualSeverity: 5,
    });
    await expect(publishOk(caller, assessmentId)).rejects.toMatchObject({
      message: 'residual-needs-controls',
    });
    // Adding a real control clears the block (residual 2×5=10 is High, so
    // the tolerability rule then applies — satisfied by a planned control).
    const { controlId } = await caller.riskAssessments.addControl({
      hazardId,
      description: 'Install guard rail',
      tier: 'engineering',
      status: 'planned',
    });
    const res = await publishOk(caller, assessmentId, [
      { controlId, assigneeUserId: adminId, dueAt: IN_A_WEEK() },
    ]);
    expect(res.ok).toBe(true);
  });

  it('RA-E22: high/critical residual needs a tolerability note or planned control (P-2)', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await caller.riskAssessments.create({
      title: 'Hot works',
      activity: '',
    });
    const { hazardId } = await caller.riskAssessments.addHazard({
      assessmentId,
      hazard: 'Welding near stores',
      harmDescription: 'Fire',
      affectedGroups: [],
      existingControls: 'Permit to work',
      initialLikelihood: 4,
      initialSeverity: 5, // 20 critical
      residualLikelihood: 3,
      residualSeverity: 4, // 12 high — stays high with controls
    });
    await expect(publishOk(caller, assessmentId)).rejects.toMatchObject({
      message: 'high-residual-needs-justification',
    });
    await caller.riskAssessments.updateHazard({
      hazardId,
      residualJustification:
        'Fire watch in place; risk tolerable for short-duration permitted works.',
    });
    const res = await publishOk(caller, assessmentId);
    expect(res.ok).toBe(true);
  });

  it('RA-E23: planned controls need a valid assignee + due date (P-3)', async () => {
    const caller = callerFor(adminId);
    const { assessmentId, hazardId } = await createScoredAssessment(caller);
    const { controlId } = await caller.riskAssessments.addControl({
      hazardId,
      description: 'Order hoist',
      tier: 'engineering',
      status: 'planned',
    });
    // No assignment at all → refused.
    await expect(publishOk(caller, assessmentId)).rejects.toMatchObject({
      message: 'actions-need-assignees',
    });
    // Unknown / foreign assignee → refused.
    await expect(
      publishOk(caller, assessmentId, [
        { controlId, assigneeUserId: `usr_${newId()}`, dueAt: IN_A_WEEK() },
      ]),
    ).rejects.toMatchObject({ message: 'invalid-assignee' });
    // Due date in the past → refused.
    await expect(
      publishOk(caller, assessmentId, [
        {
          controlId,
          assigneeUserId: standardId,
          dueAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        },
      ]),
    ).rejects.toMatchObject({ message: 'invalid-due-date' });
    // Valid assignment → accepted.
    const res = await publishOk(caller, assessmentId, [
      { controlId, assigneeUserId: standardId, dueAt: IN_A_WEEK() },
    ]);
    expect(res.actionsCreated).toBe(1);
  });

  it('RA-E24: publish is a signed act — sign-off captured on the version row (M-2)', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await createScoredAssessment(caller);
    // The Zod contract itself refuses an unconfirmed publish.
    await expect(
      caller.riskAssessments.publish({
        assessmentId,
        // @ts-expect-error — confirmSignOff must be literally true; this asserts the runtime guard too
        confirmSignOff: false,
        actionAssignments: [],
      }),
    ).rejects.toThrow();

    await publishOk(caller, assessmentId);
    const detail = await caller.riskAssessments.get({ assessmentId });
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0]?.signedOffBy).toBe(adminId);
    expect(detail.versions[0]?.signedOffByName).toBe('Alice Admin');
    expect(detail.versions[0]?.signedOffAt).not.toBeNull();
  });

  it('RA-E25: versioning — snapshot, unpublished-changes flag, re-opened acknowledgements (A-1/M-3)', async () => {
    const admin = callerFor(adminId);
    const standard = callerFor(standardId);
    const { assessmentId, hazardId } = await createScoredAssessment(admin);
    await publishOk(admin, assessmentId);
    await admin.riskAssessments.distribute({ assessmentId, userIds: [standardId] });
    await standard.riskAssessments.acknowledge({ assessmentId });

    let detail = await admin.riskAssessments.get({ assessmentId });
    expect(detail.assessment.currentVersion).toBe(1);
    expect(detail.hasUnpublishedChanges).toBe(false);

    // The frozen snapshot holds the signed content.
    const v1 = await admin.riskAssessments.getVersion({ assessmentId, versionNumber: 1 });
    expect(v1.version.content.title).toBe('Manual handling');
    expect(v1.version.content.hazards).toHaveLength(1);
    expect(v1.version.content.hazards[0]?.hazard).toBe('Heavy lifting');

    // Editing a live assessment flags unpublished changes but does NOT
    // silently invalidate the published record.
    await sleep(10);
    await admin.riskAssessments.updateHazard({ hazardId, hazard: 'Very heavy lifting' });
    detail = await admin.riskAssessments.get({ assessmentId });
    expect(detail.hasUnpublishedChanges).toBe(true);
    expect(detail.assessment.currentVersion).toBe(1);

    // Republish → version 2, everyone re-acknowledges, previous
    // acknowledgement stays on record against v1.
    const res = await publishOk(admin, assessmentId);
    expect(res.version).toBe(2);
    expect(res.reacknowledgementRequested).toBe(true);

    detail = await admin.riskAssessments.get({ assessmentId });
    expect(detail.assessment.currentVersion).toBe(2);
    expect(detail.hasUnpublishedChanges).toBe(false);
    const ack = detail.acknowledgements.find((a) => a.userId === standardId);
    expect(ack?.versionNumber).toBe(2);
    expect(ack?.acknowledgedVersion).toBe(1);

    const pendingAgain = await standard.riskAssessments.listMyPending();
    expect(pendingAgain).toHaveLength(1);

    // v1 stays retrievable with the ORIGINAL content.
    const v1After = await admin.riskAssessments.getVersion({ assessmentId, versionNumber: 1 });
    expect(v1After.version.content.hazards[0]?.hazard).toBe('Heavy lifting');
    const v2 = await admin.riskAssessments.getVersion({ assessmentId, versionNumber: 2 });
    expect(v2.version.content.hazards[0]?.hazard).toBe('Very heavy lifting');
  });

  it('RA-E26: the review clock anchors to publish, not creation (M-1)', async () => {
    const caller = callerFor(adminId);
    const { assessmentId } = await createScoredAssessment(caller);

    // Draft: no review date, and the list never flags a draft as due.
    let list = await caller.riskAssessments.list({ status: 'all', type: 'all' });
    expect(list[0]?.nextReviewAt).toBeNull();
    expect(list[0]?.reviewDue).toBe(false);

    await publishOk(caller, assessmentId);
    const detail = await caller.riskAssessments.get({ assessmentId });
    const due = detail.assessment.nextReviewAt;
    expect(due).not.toBeNull();
    const expected = new Date();
    expected.setMonth(expected.getMonth() + 12);
    expect(Math.abs((due as Date).getTime() - expected.getTime())).toBeLessThan(
      1000 * 60 * 60 * 24 * 3,
    );
    expect(detail.assessment.publishedAt).not.toBeNull();

    // A draft with a manually-set overdue date still never shows as due;
    // an overdue ACTIVE assessment does.
    await caller.riskAssessments.update({
      assessmentId,
      nextReviewAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    list = await caller.riskAssessments.list({ status: 'all', type: 'all' });
    expect(list[0]?.reviewDue).toBe(true);
    await caller.riskAssessments.moveToDraft({ assessmentId });
    list = await caller.riskAssessments.list({ status: 'all', type: 'all' });
    expect(list[0]?.reviewDue).toBe(false);
  });

  it('RA-E27: tenant matrix settings with severity floors (P-4)', async () => {
    const admin = callerFor(adminId);
    const standard = callerFor(standardId);

    // Defaults come back before any row exists.
    const defaults = await admin.riskAssessments.getMatrixSettings();
    expect(defaults).toMatchObject({ lowMax: 4, mediumMax: 9, highMax: 15 });

    // Draft created under the default matrix.
    const { assessmentId } = await admin.riskAssessments.create({
      title: 'Asbestos survey',
      activity: '',
    });
    await admin.riskAssessments.addHazard({
      assessmentId,
      hazard: 'Asbestos exposure',
      harmDescription: 'Fatal disease',
      affectedGroups: [],
      existingControls: 'Sealed + surveyed',
      initialLikelihood: 3,
      initialSeverity: 5,
      residualLikelihood: 1,
      residualSeverity: 5, // 1×5 = 5 — "Medium" under the default bands
    });

    // Non-admins cannot edit the tenant matrix.
    await expect(
      standard.riskAssessments.updateMatrixSettings({
        lowMax: 4,
        mediumMax: 9,
        highMax: 15,
        severityFloors: {},
        applyToDrafts: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Invalid thresholds are rejected.
    await expect(
      admin.riskAssessments.updateMatrixSettings({
        lowMax: 9,
        mediumMax: 9,
        highMax: 15,
        severityFloors: {},
        applyToDrafts: false,
      }),
    ).rejects.toMatchObject({ message: 'invalid-matrix' });

    // Corporate standard: any severity-5 hazard is at least High.
    const updated = await admin.riskAssessments.updateMatrixSettings({
      lowMax: 4,
      mediumMax: 9,
      highMax: 15,
      severityFloors: { '5': 'high' },
      applyToDrafts: true,
    });
    expect(updated.draftsUpdated).toBe(1);

    // The draft now bands 1×5 as High in the list summary.
    const list = await admin.riskAssessments.list({ status: 'all', type: 'all' });
    const row = list.find((a) => a.id === assessmentId);
    expect(row?.maxResidualBand).toBe('high');
    expect(row?.matrix.severityFloors).toEqual({ '5': 'high' });

    // New assessments snapshot the tenant matrix.
    const fresh = await admin.riskAssessments.create({ title: 'New one', activity: '' });
    const freshDetail = await admin.riskAssessments.get({ assessmentId: fresh.assessmentId });
    expect(freshDetail.assessment.matrix.severityFloors).toEqual({ '5': 'high' });

    // The high-floored residual now also demands the tolerability note at
    // publish — the banding logic and the publish rules stay in lock-step.
    await expect(publishOk(admin, assessmentId)).rejects.toMatchObject({
      message: 'high-residual-needs-justification',
    });
  });

  it('RA-E28: distributeFromHeadsUp records acknowledgement rows for heads-up recipients (A-2)', async () => {
    const admin = callerFor(adminId);
    const standard = callerFor(standardId);
    const { assessmentId } = await createScoredAssessment(admin);

    // Refuses while draft (T-4 — the share path never touches drafts).
    await expect(
      admin.riskAssessments.distributeFromHeadsUp({ assessmentId, headsUpId: newId() }),
    ).rejects.toMatchObject({ message: 'not-active' });

    await publishOk(admin, assessmentId);

    // Distribute to standard first and let them acknowledge — the heads-up
    // sync must NOT reset that.
    await admin.riskAssessments.distribute({ assessmentId, userIds: [standardId] });
    await standard.riskAssessments.acknowledge({ assessmentId });

    // A published heads-up with materialised recipients (admin + standard).
    const headsUpId = newId();
    await db.insert(schema.headsUps).values({
      id: headsUpId,
      tenantId,
      title: 'RA share',
      status: 'published',
      createdByUserId: adminId,
    });
    await db.insert(schema.headsUpRecipients).values([
      { id: newId(), tenantId, headsUpId, userId: adminId },
      { id: newId(), tenantId, headsUpId, userId: standardId },
    ]);

    const res = await admin.riskAssessments.distributeFromHeadsUp({ assessmentId, headsUpId });
    expect(res.recipients).toBe(2);
    expect(res.added).toBe(1); // standard already had a row

    const detail = await admin.riskAssessments.get({ assessmentId });
    expect(detail.acknowledgements).toHaveLength(2);
    const stanAck = detail.acknowledgements.find((a) => a.userId === standardId);
    // Untouched — still acknowledged.
    expect(stanAck?.acknowledgedAt).not.toBeNull();
    const adminAck = detail.acknowledgements.find((a) => a.userId === adminId);
    expect(adminAck?.acknowledgedAt).toBeNull();
  });

  it('RA-E29: distribute stores the deadline and emails every recipient (A-3)', async () => {
    const admin = callerFor(adminId);
    const { assessmentId } = await createScoredAssessment(admin);
    await publishOk(admin, assessmentId);

    const dueAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await admin.riskAssessments.distribute({
      assessmentId,
      userIds: [standardId],
      dueAt,
    });

    const detail = await admin.riskAssessments.get({ assessmentId });
    const ack = detail.acknowledgements.find((a) => a.userId === standardId);
    expect(ack?.dueAt).not.toBeNull();

    const mails = __authStubMailbox.filter((m) => m.templateKey === 'risk-assessment-distributed');
    expect(mails).toHaveLength(1);
    expect(mails[0]?.to).toBe(`stan-${tenantId}@acme.test`);
    expect(mails[0]?.variables['title']).toBe('Manual handling');
    expect(mails[0]?.variables['viewUrl']).toContain(`/risk-assessments/${assessmentId}`);
    expect(mails[0]?.variables['dueDate']).toBe(dueAt.toISOString().slice(0, 10));

    const pending = await callerFor(standardId).riskAssessments.listMyPending();
    expect(pending[0]?.dueAt).not.toBeNull();
  });

  it('RA-E30: variant drift is flagged once the parent changes after the fork (A-4)', async () => {
    const caller = callerFor(adminId);
    const { assessmentId, hazardId } = await createScoredAssessment(caller);
    const variant = await caller.riskAssessments.createPersonSpecific({
      assessmentId,
      kind: 'new_expectant_mother',
    });

    // Fresh fork: no drift on either side.
    let child = await caller.riskAssessments.get({ assessmentId: variant.assessmentId });
    expect(child.parentInfo?.changedSinceFork).toBe(false);
    let parent = await caller.riskAssessments.get({ assessmentId });
    expect(parent.linkedVariants[0]?.driftsFromParent).toBe(false);

    // Parent content changes → both sides flag it.
    await sleep(10);
    await caller.riskAssessments.updateHazard({ hazardId, hazard: 'Heavier lifting' });
    child = await caller.riskAssessments.get({ assessmentId: variant.assessmentId });
    expect(child.parentInfo?.changedSinceFork).toBe(true);
    parent = await caller.riskAssessments.get({ assessmentId });
    expect(parent.linkedVariants[0]?.driftsFromParent).toBe(true);
  });
});

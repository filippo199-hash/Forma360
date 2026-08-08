/**
 * Risk Assessments module — the audit suite (FreeHS).
 *
 * The ninth module through the testing runbook, and the one the whole
 * product is built around. Every other HSE module here either feeds it or
 * reads it: RAMS binds risk-assessment *versions*, Permits gates on a
 * linked RA, Incidents pulls its `nextReviewAt` forward after an event,
 * COSHH is a specialised assessment of its own. If the versioning model in
 * this module is wrong, it is wrong everywhere downstream too.
 *
 * That makes the questions different from the eight modules before it. The
 * gate here is not "did we fill the form in" — it is whether the product
 * refuses to record an assessment that is not suitable and sufficient, and
 * whether the thing a worker signed stays the thing they signed.
 *
 * Three properties carry the module:
 *
 * **The publish gate is an opinion about competence.** Controls cannot
 * increase risk (P-1). A residual score with no controls behind it is
 * aspirational data entry (P-2). A residual that stays high needs either a
 * further planned control or an explicit tolerability note. PPE cannot be
 * the whole answer. Those are reg 3 of the Management Regs expressed as
 * code, and a defect in them is a defect in the advice the product gives.
 *
 * **The version is the record.** ADR 0011 makes published versions
 * immutable and first-class: what an assessor signed off, and what each
 * worker acknowledged, are tied to a version number. The tenant can edit
 * its own risk matrix, and historic bands must not move underneath signed
 * content.
 *
 * **Acknowledgement is version-aware.** "Read and understood" against
 * version 1 is not "read and understood" against version 3.
 *
 * Seven axes: RA-P (permissions), RA-G (the publish gate), RA-V
 * (versioning & sign-off), RA-M (the matrix), RA-D (distribution &
 * acknowledgement), RA-X (cross-module), RA-T (tenancy).
 *
 * Every test describes CORRECT behaviour. Those that name a live defect
 * fail today and are the acceptance criteria for the fix pass.
 */
import type { PGlite } from '@electric-sql/pglite';
import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@forma360/db/schema';
import { and, eq } from 'drizzle-orm';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import type { TemplatedEmail } from '@forma360/shared/email';
import { appRouter } from '../router';
import { createCallerFactory, router as trpcRouter } from '../trpc';
import { createRiskAssessmentsRouter } from './riskAssessments';
import { bootWorld, type World } from './__fixtures__/world';

const createCaller = createCallerFactory(appRouter);
type Caller = ReturnType<typeof createCaller>;

/**
 * A second risk-assessments router wired to a `sendEmail` that captures
 * the WHOLE `TemplatedEmail`, including `locale`. The shared
 * `__authStubMailbox` records only `{to, templateKey, variables}`, so
 * asserting on `locale` against it would be asserting on the stub's shape
 * rather than on what the router actually passes — a test that could
 * never fail honestly.
 */
const outbox: TemplatedEmail[] = [];
const createMailCaller = createCallerFactory(
  trpcRouter({
    riskAssessments: createRiskAssessmentsRouter({
      enabled: true,
      appUrl: 'http://localhost:3000',
      sendEmail: async (mail) => {
        outbox.push(mail);
        return { delivery: 'console' };
      },
    }),
  }),
);

function raProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter((k) => k.startsWith('riskAssessments.'))
    .sort();
}

function resolve(caller: Caller, path: string): (input?: unknown) => Promise<unknown> {
  return path
    .split('.')
    .reduce<
      Record<string, unknown>
    >((acc, part) => acc[part] as Record<string, unknown>, caller as unknown as Record<string, unknown>) as unknown as (
    input?: unknown,
  ) => Promise<unknown>;
}

async function callFor(
  caller: Caller,
  path: string,
  input?: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; code: string; message: string }> {
  try {
    return { ok: true, value: await resolve(caller, path)(input) };
  } catch (err) {
    return {
      ok: false,
      code: err instanceof TRPCError ? err.code : 'NON_TRPC_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

describe('riskAssessments — audit suite', () => {
  let world: World;
  let client: PGlite;
  /** `riskAssessments.view` + `.create` — drafts, cannot sign off. */
  let draughtsmanId: string;
  /** `riskAssessments.view` only — the crew member who acknowledges. */
  let readerId: string;
  /** A reader whose preferred language is Polish (PF-20). */
  let polishReaderId: string;

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  const asDraughtsman = () => createCaller(world.ctxFor(world.a.tenantId, draughtsmanId));
  const asReader = () => createCaller(world.ctxFor(world.a.tenantId, readerId));

  /** A draft assessment with one fully-scored, controlled hazard. */
  async function makeAssessment(opts?: {
    /** Residual scores. Default 1×2 → low, publishable. */
    residual?: [number, number];
    /** Initial scores. Default 4×4. */
    initial?: [number, number];
    /** Skip adding a control, to exercise P-2. */
    noControl?: boolean;
    /** Free-text tolerability note for a high residual. */
    justification?: string;
    /** Tier of the single control added. Default `engineering`. */
    tier?: 'eliminate' | 'substitute' | 'engineering' | 'administrative' | 'ppe';
    controlStatus?: 'in_place' | 'planned';
  }): Promise<{ assessmentId: string; hazardId: string; controlId: string | null }> {
    const admin = asAdmin();
    const { assessmentId } = await admin.riskAssessments.create({
      title: `Bench grinding ${newId().slice(-6)}`,
      activity: 'Grinding weld spatter off fabricated frames at the pedestal grinder.',
    });
    const [il, is] = opts?.initial ?? [4, 4];
    const [rl, rs] = opts?.residual ?? [1, 2];
    const { hazardId } = await admin.riskAssessments.addHazard({
      assessmentId,
      hazard: 'Ejected particles / abrasive wheel burst',
      harmDescription: 'Eye injury, laceration, wheel disintegration.',
      affectedGroups: ['employees'],
      initialLikelihood: il,
      initialSeverity: is,
      residualLikelihood: rl,
      residualSeverity: rs,
      ...(opts?.justification !== undefined ? { residualJustification: opts.justification } : {}),
    });
    let controlId: string | null = null;
    if (opts?.noControl !== true) {
      const res = await admin.riskAssessments.addControl({
        hazardId,
        description: 'Correctly adjusted tool rest and transparent screen guard.',
        tier: opts?.tier ?? 'engineering',
        status: opts?.controlStatus ?? 'in_place',
      });
      controlId = res.controlId;
    }
    return { assessmentId, hazardId, controlId };
  }

  /** Publish with sign-off, assigning any planned controls to the admin. */
  async function publish(
    assessmentId: string,
    assignments: Array<{ controlId: string; assigneeUserId: string; dueAt: Date }> = [],
  ) {
    return asAdmin().riskAssessments.publish({
      assessmentId,
      confirmSignOff: true,
      actionAssignments: assignments,
    });
  }

  beforeAll(async () => {
    resetDependentsRegistryForTests();
    world = await bootWorld();
    client = world.client;

    const draughtsmanSet = newId();
    await world.db.insert(schema.permissionSets).values({
      id: draughtsmanSet,
      tenantId: world.a.tenantId,
      name: 'RA draughtsman',
      permissions: ['riskAssessments.view', 'riskAssessments.create'] as never,
    });
    const readerSet = newId();
    await world.db.insert(schema.permissionSets).values({
      id: readerSet,
      tenantId: world.a.tenantId,
      name: 'RA reader',
      permissions: ['riskAssessments.view'] as never,
    });

    draughtsmanId = newId();
    readerId = newId();
    polishReaderId = newId();
    await world.db.insert(schema.user).values([
      {
        id: draughtsmanId,
        tenantId: world.a.tenantId,
        name: 'Dee Draughtsman',
        email: 'ra-draughtsman@northgate.test',
        permissionSetId: draughtsmanSet,
      },
      {
        id: readerId,
        tenantId: world.a.tenantId,
        name: 'Rob Reader',
        email: 'ra-reader@northgate.test',
        permissionSetId: readerSet,
      },
      {
        id: polishReaderId,
        tenantId: world.a.tenantId,
        name: 'Piotr Czytelnik',
        email: 'ra-reader-pl@northgate.test',
        permissionSetId: readerSet,
        locale: 'pl',
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    await client.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RA-P — permissions
  // ═══════════════════════════════════════════════════════════════════════
  describe('RA-P · permissions', () => {
    it('RA-P00 · the matrix covers every riskAssessments procedure the router exposes', () => {
      const procs = raProcedures();
      expect(procs.length).toBeGreaterThanOrEqual(20);
      expect(procs).toContain('riskAssessments.publish');
      expect(procs).toContain('riskAssessments.acknowledge');
      expect(procs).toContain('riskAssessments.updateMatrixSettings');
    });

    it('RA-P01 · every procedure refuses a user holding no riskAssessments key', async () => {
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.nobody));
      const leaked: Array<{ path: string; outcome: string }> = [];
      for (const path of raProcedures()) {
        const res = await callFor(caller, path, undefined);
        if (res.ok) leaked.push({ path, outcome: 'RESOLVED without permission' });
        else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }
      expect(leaked).toEqual([]);
    });

    it('RA-P02 · a draughtsman can author an assessment and cannot sign it off', async () => {
      // Authoring and signing are different competences. Publishing is the
      // act that puts an assessment into force and stamps a named assessor
      // against a frozen version — `riskAssessments.manage` is that
      // authority, and `.create` must not be a way round it.
      const caller = asDraughtsman();
      const created = await callFor(caller, 'riskAssessments.create', {
        title: 'Draughtsman probe',
      });
      expect({ step: 'create', ok: created.ok }).toEqual({ step: 'create', ok: true });

      const { assessmentId } = await makeAssessment();
      for (const [path, input] of [
        ['riskAssessments.publish', { assessmentId, confirmSignOff: true }],
        ['riskAssessments.addHazard', { assessmentId, hazard: 'Injected hazard' }],
        ['riskAssessments.archive', { assessmentId }],
        ['riskAssessments.distribute', { assessmentId, userIds: [readerId] }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(caller, path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });

    it('RA-P03 · editing the tenant risk matrix needs org.settings, not riskAssessments.manage', async () => {
      // The matrix decides what counts as "high" for every assessment in
      // the tenant. That is an organisational policy decision, not an
      // assessor's — and the catalogue agrees: `updateMatrixSettings` is
      // the only procedure in this module gated on `org.settings`.
      const manager = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.manager));
      const canRead = await callFor(manager, 'riskAssessments.getMatrixSettings', undefined);
      expect({ readsMatrix: canRead.ok }).toEqual({ readsMatrix: true });

      const res = await callFor(asDraughtsman(), 'riskAssessments.updateMatrixSettings', {
        lowMax: 6,
        mediumMax: 12,
        highMax: 20,
      });
      expect({ draughtsmanEditedMatrix: res.ok }).toEqual({ draughtsmanEditedMatrix: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RA-G — the publish gate
  // ═══════════════════════════════════════════════════════════════════════
  describe('RA-G · the publish gate', () => {
    it('RA-G01 · an assessment with no hazards cannot be published', async () => {
      const { assessmentId } = await asAdmin().riskAssessments.create({ title: 'Empty probe' });
      const res = await callFor(asAdmin(), 'riskAssessments.publish', {
        assessmentId,
        confirmSignOff: true,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toBe('no-hazards');
    });

    it('RA-G02 · a hazard missing any of its four scores cannot be published', async () => {
      const admin = asAdmin();
      const { assessmentId } = await admin.riskAssessments.create({ title: 'Unscored probe' });
      const { hazardId } = await admin.riskAssessments.addHazard({
        assessmentId,
        hazard: 'Unscored hazard',
        initialLikelihood: 4,
        initialSeverity: 4,
      });
      await admin.riskAssessments.addControl({
        hazardId,
        description: 'Some control',
        tier: 'engineering',
      });
      const res = await callFor(admin, 'riskAssessments.publish', {
        assessmentId,
        confirmSignOff: true,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toBe('unscored-hazards');
    });

    it('RA-G03 · P-1 · a residual risk above the initial risk is refused', async () => {
      // Controls reduce risk. A residual above initial is a transposition
      // error or a misunderstanding of what the second column means, and
      // it is the single most common defect in a paper RA.
      const { assessmentId } = await makeAssessment({ initial: [2, 2], residual: [4, 4] });
      const res = await callFor(asAdmin(), 'riskAssessments.publish', {
        assessmentId,
        confirmSignOff: true,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toBe('residual-above-initial');
    });

    it('RA-G04 · P-2 · a residual score with no controls behind it is refused', async () => {
      const { assessmentId } = await makeAssessment({ noControl: true });
      const res = await callFor(asAdmin(), 'riskAssessments.publish', {
        assessmentId,
        confirmSignOff: true,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toBe('residual-needs-controls');
    });

    it('RA-G05 · a residual that stays high needs a further action or a tolerability note', async () => {
      // The honest case: sometimes the residual really does stay high. The
      // gate does not forbid that — it forbids leaving it unexplained and
      // with nothing further planned.
      const bare = await makeAssessment({ initial: [5, 5], residual: [4, 5] });
      const refused = await callFor(asAdmin(), 'riskAssessments.publish', {
        assessmentId: bare.assessmentId,
        confirmSignOff: true,
      });
      expect({ publishedUnexplainedHighResidual: refused.ok }).toEqual({
        publishedUnexplainedHighResidual: false,
      });
      if (!refused.ok) expect(refused.message).toBe('high-residual-needs-justification');

      const explained = await makeAssessment({
        initial: [5, 5],
        residual: [4, 5],
        justification:
          'Residual remains high; work is permit-controlled and limited to two trained operators.',
      });
      const accepted = await callFor(asAdmin(), 'riskAssessments.publish', {
        assessmentId: explained.assessmentId,
        confirmSignOff: true,
      });
      expect({ publishedWithNote: accepted.ok }).toEqual({ publishedWithNote: true });
    });

    it('RA-G06 · PPE cannot be the whole answer without a justification', async () => {
      const ppeOnly = await makeAssessment({ tier: 'ppe' });
      const refused = await callFor(asAdmin(), 'riskAssessments.publish', {
        assessmentId: ppeOnly.assessmentId,
        confirmSignOff: true,
      });
      expect({ publishedPpeOnly: refused.ok }).toEqual({ publishedPpeOnly: false });
    });

    it('RA-G07 · M-2 · publishing without confirming sign-off is refused', async () => {
      // `confirmSignOff: z.literal(true)`. The signer's name is stamped
      // onto the frozen version as the record of who attested it, so
      // letting it default would make that record a fiction.
      const { assessmentId } = await makeAssessment();
      const res = await callFor(asAdmin(), 'riskAssessments.publish', { assessmentId });
      expect({ publishedWithoutSignOff: res.ok }).toEqual({ publishedWithoutSignOff: false });
    });

    it('RA-G08 · P-3 · a planned control becomes an action only with a real owner and due date', async () => {
      const admin = asAdmin();
      const planned = await makeAssessment({ controlStatus: 'planned' });
      const controlId = planned.controlId ?? '';

      const unassigned = await callFor(admin, 'riskAssessments.publish', {
        assessmentId: planned.assessmentId,
        confirmSignOff: true,
      });
      expect({ publishedWithOrphanAction: unassigned.ok }).toEqual({
        publishedWithOrphanAction: false,
      });
      if (!unassigned.ok) expect(unassigned.message).toBe('actions-need-assignees');

      // A deactivated user cannot be handed the action either — a leaver
      // owning an open control action is an action nobody is doing.
      const toLeaver = await callFor(admin, 'riskAssessments.publish', {
        assessmentId: planned.assessmentId,
        confirmSignOff: true,
        actionAssignments: [{ controlId, assigneeUserId: world.a.actors.leaver, dueAt: world.now }],
      });
      expect({ assignedToLeaver: toLeaver.ok }).toEqual({ assignedToLeaver: false });

      const ok = await publish(planned.assessmentId, [
        {
          controlId,
          assigneeUserId: world.a.actors.standard,
          dueAt: new Date(world.now.getTime() + 14 * 86_400_000),
        },
      ]);
      expect({ actionsCreated: ok.actionsCreated }).toEqual({ actionsCreated: 1 });

      const raised = await world.db
        .select({ assignee: schema.actions.assigneeUserId, status: schema.actions.status })
        .from(schema.actions)
        .where(
          and(
            eq(schema.actions.sourceType, 'risk_assessment'),
            eq(schema.actions.sourceId, planned.assessmentId),
          ),
        );
      expect(raised).toEqual([{ assignee: world.a.actors.standard, status: 'open' }]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RA-V — versioning and sign-off (ADR 0011)
  // ═══════════════════════════════════════════════════════════════════════
  describe('RA-V · versioning and sign-off', () => {
    it('RA-V01 · publishing freezes the content and stamps who signed it', async () => {
      const { assessmentId } = await makeAssessment();
      const res = await publish(assessmentId);
      expect({ version: res.version }).toEqual({ version: 1 });

      const { version } = await asAdmin().riskAssessments.getVersion({
        assessmentId,
        versionNumber: 1,
      });
      expect({
        signedOffBy: version.signedOffBy,
        signerNamed: (version.signedOffByName ?? '').length > 0,
        signedAtStamped: version.signedOffAt !== null,
        hazardsFrozen: version.content.hazards.length,
      }).toEqual({
        signedOffBy: world.a.actors.admin,
        signerNamed: true,
        signedAtStamped: true,
        hazardsFrozen: 1,
      });
    });

    it('RA-V02 · editing after publish never rewrites the signed version', async () => {
      // The immutability contract. RAMS binds this module by version
      // number and freezes a snapshot of it; if version 1's content could
      // be rewritten, every issued RAMS pack that cites it would change
      // meaning without being re-issued.
      const admin = asAdmin();
      const { assessmentId, hazardId } = await makeAssessment();
      await publish(assessmentId);
      const before = await admin.riskAssessments.getVersion({ assessmentId, versionNumber: 1 });

      await admin.riskAssessments.updateHazard({
        hazardId,
        hazard: 'REWRITTEN AFTER SIGN-OFF',
      });
      const after = await admin.riskAssessments.getVersion({ assessmentId, versionNumber: 1 });

      expect({
        v1Unchanged:
          JSON.stringify(after.version.content) === JSON.stringify(before.version.content),
        v1MentionsTheRewrite: JSON.stringify(after.version.content).includes(
          'REWRITTEN AFTER SIGN-OFF',
        ),
      }).toEqual({ v1Unchanged: true, v1MentionsTheRewrite: false });
    });

    it('RA-V03 · a changed republish cuts version n+1 and leaves version n readable', async () => {
      const admin = asAdmin();
      const { assessmentId, hazardId } = await makeAssessment();
      await publish(assessmentId);
      await admin.riskAssessments.updateHazard({
        hazardId,
        hazard: 'Ejected particles — revised wording',
      });
      const second = await publish(assessmentId);

      const v1 = await callFor(admin, 'riskAssessments.getVersion', {
        assessmentId,
        versionNumber: 1,
      });
      expect({
        newVersion: second.version,
        reacknowledgementRequested: second.reacknowledgementRequested,
        v1StillReadable: v1.ok,
      }).toEqual({ newVersion: 2, reacknowledgementRequested: true, v1StillReadable: true });
    });

    it('RA-V04 · A-1 · an unchanged draft round-trip does not cut a version or reopen acknowledgements', async () => {
      // The counterpart to RA-V03, and the harder half. Pulling an
      // assessment back to draft to fix a typo in the title, then
      // re-activating it, must not ask an entire workforce to re-read
      // something that did not change — that is how acknowledgement
      // becomes noise people click through.
      const admin = asAdmin();
      const { assessmentId } = await makeAssessment();
      await publish(assessmentId);
      await admin.riskAssessments.distribute({ assessmentId, userIds: [readerId] });
      await asReader().riskAssessments.acknowledge({ assessmentId });

      await admin.riskAssessments.moveToDraft({ assessmentId });
      const again = await publish(assessmentId);

      const [ack] = await world.db
        .select({
          acknowledgedAt: schema.riskAssessmentAcknowledgements.acknowledgedAt,
          redistributed: schema.riskAssessmentAcknowledgements.redistributed,
        })
        .from(schema.riskAssessmentAcknowledgements)
        .where(
          and(
            eq(schema.riskAssessmentAcknowledgements.assessmentId, assessmentId),
            eq(schema.riskAssessmentAcknowledgements.userId, readerId),
          ),
        );

      expect({
        version: again.version,
        reacknowledgementRequested: again.reacknowledgementRequested,
        acknowledgementSurvived: ack?.acknowledgedAt !== null,
      }).toEqual({
        version: 1,
        reacknowledgementRequested: false,
        acknowledgementSurvived: true,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RA-M — the risk matrix
  // ═══════════════════════════════════════════════════════════════════════
  describe('RA-M · the risk matrix', () => {
    it('RA-M01 · an internally inconsistent matrix is refused', async () => {
      const res = await callFor(asAdmin(), 'riskAssessments.updateMatrixSettings', {
        lowMax: 12,
        mediumMax: 8,
        highMax: 20,
      });
      expect({ acceptedOverlappingBands: res.ok }).toEqual({ acceptedOverlappingBands: false });
    });

    it('RA-M02 · P-4 · editing the tenant matrix does not re-band a signed version', async () => {
      // A published version carries the matrix it was signed against. If
      // a tenant later decides 12 is "high" rather than "medium", last
      // year's signed assessments must not silently re-band — the whole
      // point of the snapshot is that a historic document keeps saying
      // what it said.
      const admin = asAdmin();
      const { assessmentId } = await makeAssessment({ initial: [4, 4], residual: [2, 2] });
      await publish(assessmentId);
      const before = await admin.riskAssessments.getVersion({ assessmentId, versionNumber: 1 });

      await admin.riskAssessments.updateMatrixSettings({
        lowMax: 2,
        mediumMax: 3,
        highMax: 4,
        applyToDrafts: false,
      });
      const after = await admin.riskAssessments.getVersion({ assessmentId, versionNumber: 1 });

      // Restore the default so later tests are unaffected.
      await admin.riskAssessments.updateMatrixSettings({
        lowMax: 4,
        mediumMax: 9,
        highMax: 15,
        applyToDrafts: false,
      });

      expect({
        snapshotMatrixMoved:
          JSON.stringify(after.version.content.matrix) !==
          JSON.stringify(before.version.content.matrix),
      }).toEqual({ snapshotMatrixMoved: false });
    });

    it('RA-M03 · a severity floor stops a fatality-potential hazard reading Medium', async () => {
      // 1 × 5 scores 5, which lands in "medium" on the default thresholds.
      // A hazard that can kill somebody, labelled Medium because it is
      // unlikely, is the classic matrix failure — severity floors exist
      // exactly for it, and the gate must act on the floored band.
      const admin = asAdmin();
      await admin.riskAssessments.updateMatrixSettings({
        lowMax: 4,
        mediumMax: 9,
        highMax: 15,
        severityFloors: { '5': 'high' },
        applyToDrafts: false,
      });

      // Under the floor this residual is HIGH, so publishing it with no
      // planned control and no tolerability note must be refused.
      const { assessmentId } = await makeAssessment({ initial: [3, 5], residual: [1, 5] });
      const res = await callFor(admin, 'riskAssessments.publish', {
        assessmentId,
        confirmSignOff: true,
      });

      await admin.riskAssessments.updateMatrixSettings({
        lowMax: 4,
        mediumMax: 9,
        highMax: 15,
        applyToDrafts: false,
      });

      expect({
        publishedFatalityHazardAsMedium: res.ok,
        refusalReason: res.ok ? null : res.message,
      }).toEqual({
        publishedFatalityHazardAsMedium: false,
        refusalReason: 'high-residual-needs-justification',
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RA-D — distribution and acknowledgement
  // ═══════════════════════════════════════════════════════════════════════
  describe('RA-D · distribution and acknowledgement', () => {
    it('RA-D01 · a draft cannot be distributed', async () => {
      const { assessmentId } = await makeAssessment();
      const res = await callFor(asAdmin(), 'riskAssessments.distribute', {
        assessmentId,
        userIds: [readerId],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toBe('not-active');
    });

    it('RA-D02 · only the people it was distributed to can acknowledge it', async () => {
      const admin = asAdmin();
      const { assessmentId } = await makeAssessment();
      await publish(assessmentId);
      await admin.riskAssessments.distribute({ assessmentId, userIds: [readerId] });

      const stranger = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.standard));
      const res = await callFor(stranger, 'riskAssessments.acknowledge', { assessmentId });
      expect({ acknowledgedWithoutBeingAsked: res.ok }).toEqual({
        acknowledgedWithoutBeingAsked: false,
      });

      const proper = await callFor(asReader(), 'riskAssessments.acknowledge', { assessmentId });
      expect({ recipientAcknowledged: proper.ok }).toEqual({ recipientAcknowledged: true });
    });

    it('RA-D03 · A-1 · an acknowledgement of v1 does not count as an acknowledgement of v2', async () => {
      // The property the whole acknowledgement model exists for. If a
      // signature against version 1 satisfied version 2, "read and
      // understood" would mean nothing after the first revision.
      const admin = asAdmin();
      const { assessmentId, hazardId } = await makeAssessment();
      await publish(assessmentId);
      await admin.riskAssessments.distribute({ assessmentId, userIds: [readerId] });
      await asReader().riskAssessments.acknowledge({ assessmentId });

      await admin.riskAssessments.updateHazard({
        hazardId,
        hazard: 'Ejected particles — now includes wheel-change procedure',
      });
      await publish(assessmentId);

      const rows = await asAdmin().riskAssessments.list({});
      const row = rows.find((r) => r.id === assessmentId);
      const pending = await asReader().riskAssessments.listMyPending();

      expect({
        ackDone: row?.ackDone,
        ackTotal: row?.ackTotal,
        backInReadersPendingList: pending.some((p) => p.assessmentId === assessmentId),
      }).toEqual({ ackDone: 0, ackTotal: 1, backInReadersPendingList: true });
    });

    it('RA-D04 · PF-20 · the distribution email links into the recipient language', async () => {
      // `packages/shared/src/app-link.ts` is the platform fix for exactly
      // this, and this module's OWN reminder worker uses it — it reads
      // `user.locale` and builds the link with `appLink`. The router's
      // `distribute` does neither: it hardcodes `/en/` into `viewUrl` and
      // never sets `TemplatedEmail.locale`, so the first mail a worker
      // gets — the one asking them to read and acknowledge a legal
      // document — is English and lands them on an English page, while
      // the chase-up mail that follows is correctly translated.
      const { assessmentId } = await makeAssessment();
      await publish(assessmentId);

      outbox.length = 0;
      const mailAdmin = createMailCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
      await mailAdmin.riskAssessments.distribute({ assessmentId, userIds: [polishReaderId] });
      const mail = outbox.find((m) => m.templateKey === 'risk-assessment-distributed');

      expect({
        mailSent: mail !== undefined,
        localeOnEmail: mail?.locale ?? null,
        linkLocaleSegment: (mail?.variables.viewUrl ?? '').split('/')[3] ?? null,
      }).toEqual({ mailSent: true, localeOnEmail: 'pl', linkLocaleSegment: 'pl' });
    });

    it('RA-D05 · a leaver is not counted as an outstanding acknowledgement', async () => {
      // The two halves of this feature disagree about who counts. The
      // reminder worker filters `isNull(user.deactivatedAt)`, so a leaver
      // is never chased — correct. But `list` counts every
      // acknowledgement row, so the leaver stays in `ackTotal` forever:
      // the assessment reads "1 of 2 acknowledged" permanently, nobody is
      // ever nudged about the missing one, and the compliance figure a
      // manager is judged on can never reach 100%.
      const admin = asAdmin();
      const { assessmentId } = await makeAssessment();
      await publish(assessmentId);
      await admin.riskAssessments.distribute({
        assessmentId,
        userIds: [readerId, world.a.actors.leaver],
      });
      await asReader().riskAssessments.acknowledge({ assessmentId });

      const rows = await admin.riskAssessments.list({});
      const row = rows.find((r) => r.id === assessmentId);

      expect({ ackDone: row?.ackDone, ackTotal: row?.ackTotal }).toEqual({
        ackDone: 1,
        ackTotal: 1,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RA-X — cross-module
  // ═══════════════════════════════════════════════════════════════════════
  describe('RA-X · cross-module', () => {
    it('RA-X01 · a person-specific variant forks the content and tracks drift from its parent', async () => {
      // A-4. A young-person or new/expectant-mother assessment is a fork,
      // not a link: it must carry its own hazards so it can diverge. But
      // once the parent moves on, the fork has to say so — a variant
      // silently frozen against an obsolete parent is the failure mode.
      const admin = asAdmin();
      const { assessmentId, hazardId } = await makeAssessment();
      await publish(assessmentId);

      const { assessmentId: variantId } = await admin.riskAssessments.createPersonSpecific({
        assessmentId,
        kind: 'new_expectant_mother',
      });
      const fresh = await admin.riskAssessments.get({ assessmentId });
      const beforeDrift = fresh.linkedVariants.find((v) => v.id === variantId);

      await admin.riskAssessments.updateHazard({
        hazardId,
        hazard: 'Ejected particles — parent revised after the fork',
      });
      const moved = await admin.riskAssessments.get({ assessmentId });
      const afterDrift = moved.linkedVariants.find((v) => v.id === variantId);

      const variant = await admin.riskAssessments.get({ assessmentId: variantId });

      expect({
        variantHazardsCopied: variant.hazards.length,
        variantStartsAsDraft: variant.assessment.status,
        driftsBeforeParentEdit: beforeDrift?.driftsFromParent,
        driftsAfterParentEdit: afterDrift?.driftsFromParent,
        variantKind: beforeDrift?.personSpecificFor,
      }).toEqual({
        variantHazardsCopied: 1,
        variantStartsAsDraft: 'draft',
        driftsBeforeParentEdit: false,
        driftsAfterParentEdit: true,
        variantKind: 'new_expectant_mother',
      });
    });

    it('RA-X03 · a permit that requires a risk assessment will not accept a draft or archived one', async () => {
      // The series' recurring pattern, in the place it costs most. Permits
      // reads this module's records and applies only its own rule:
      // `if (type.requiresRiskAssessment && permit.riskAssessmentId === null)`
      // — presence, never status. `loadRiskAssessmentInTenant` even
      // SELECTs `status`, and no caller looks at it.
      //
      // So a hot-works permit can be issued citing an assessment that was
      // never signed off, or one that was deliberately withdrawn, and the
      // permit prints a reference number next to it as if it were in
      // force. The RAMS half of the very same gate gets this right —
      // `ramsPackGateError` demands an issued version or an in-date
      // accepted review — which is what makes this a gap rather than a
      // deliberate policy.
      const admin = asAdmin();
      const { typeId } = await admin.permits.types.create({
        category: 'hot_work',
        name: `RA-gated hot works ${newId().slice(-6)}`,
        requiresRiskAssessment: true,
        maxDurationHours: 8,
      });

      const draft = await makeAssessment();
      const withdrawn = await makeAssessment();
      await publish(withdrawn.assessmentId);
      await admin.riskAssessments.archive({ assessmentId: withdrawn.assessmentId });

      const outcomes: Array<{ cited: string; issued: boolean }> = [];
      for (const [label, assessmentId] of [
        ['draft', draft.assessmentId],
        ['archived', withdrawn.assessmentId],
      ] as Array<[string, string]>) {
        const { permitId } = await admin.permits.create({
          permitTypeId: typeId,
          title: `Welding on the mezzanine — cites ${label} RA`,
          workDescription: 'Hot works on structural steel.',
          validFrom: world.now,
          validTo: new Date(world.now.getTime() + 4 * 3_600_000),
          acceptorUserId: world.a.actors.standard,
          riskAssessmentId: assessmentId,
        });
        const res = await callFor(admin, 'permits.issue', { permitId });
        outcomes.push({ cited: label, issued: res.ok });
      }

      expect(outcomes).toEqual([
        { cited: 'draft', issued: false },
        { cited: 'archived', issued: false },
      ]);
    });

    it('RA-X02 · the Heads-Up share path records the same acknowledgement rows as Distribute', async () => {
      // A-2. Sharing an assessment through Heads-Up must not be a silent
      // gap in the acknowledgement record — otherwise the fastest way to
      // circulate an RA is also the way that leaves no evidence anyone
      // read it.
      const admin = asAdmin();
      const { assessmentId } = await makeAssessment();
      await publish(assessmentId);

      const { headsUpId } = await admin.headsUps.create({
        title: 'New grinding RA in force',
        description: 'Please read and acknowledge the revised bench-grinding assessment.',
      });
      // Recipients are resolved at publish, not create — an empty publish
      // would fan out to the whole 200-user tenant.
      await admin.headsUps.publish({ headsUpId, userIds: [readerId] });
      const res = await admin.riskAssessments.distributeFromHeadsUp({ assessmentId, headsUpId });

      const acks = await world.db
        .select({ userId: schema.riskAssessmentAcknowledgements.userId })
        .from(schema.riskAssessmentAcknowledgements)
        .where(eq(schema.riskAssessmentAcknowledgements.assessmentId, assessmentId));

      expect({
        recipients: res.recipients,
        ackRowsFor: acks.map((a) => a.userId),
      }).toEqual({ recipients: 1, ackRowsFor: [readerId] });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // RA-T — tenancy
  // ═══════════════════════════════════════════════════════════════════════
  describe('RA-T · tenancy', () => {
    it('RA-T01 · another tenant assessment is unreadable and unmutatable', async () => {
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const { assessmentId: foreignId } = await otherAdmin.riskAssessments.create({
        title: 'Foreign assessment',
        activity: 'Foreign activity',
      });

      for (const [path, input] of [
        ['riskAssessments.get', { assessmentId: foreignId }],
        ['riskAssessments.update', { assessmentId: foreignId, title: 'Cross-tenant rename' }],
        ['riskAssessments.archive', { assessmentId: foreignId }],
        ['riskAssessments.addHazard', { assessmentId: foreignId, hazard: 'Injected' }],
        ['riskAssessments.publish', { assessmentId: foreignId, confirmSignOff: true }],
        ['riskAssessments.getVersion', { assessmentId: foreignId, versionNumber: 1 }],
        ['riskAssessments.createPersonSpecific', { assessmentId: foreignId, kind: 'young_person' }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(asAdmin(), path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }

      const [row] = await world.db
        .select({
          title: schema.riskAssessments.title,
          archivedAt: schema.riskAssessments.archivedAt,
        })
        .from(schema.riskAssessments)
        .where(eq(schema.riskAssessments.id, foreignId));
      expect(row?.title).toBe('Foreign assessment');
      expect(row?.archivedAt).toBeNull();
    });

    it('RA-T02 · an assessment cannot be sited at, or distributed to, another tenant', async () => {
      const admin = asAdmin();
      const sited = await callFor(admin, 'riskAssessments.create', {
        title: 'Cross-tenant siting probe',
        siteId: world.b.sites.primary,
      });
      expect({ sitedAtForeignSite: sited.ok }).toEqual({ sitedAtForeignSite: false });

      const { assessmentId } = await makeAssessment();
      await publish(assessmentId);
      const distributed = await callFor(admin, 'riskAssessments.distribute', {
        assessmentId,
        userIds: [world.b.actors.standard],
      });
      expect({ distributedToForeignUser: distributed.ok }).toEqual({
        distributedToForeignUser: false,
      });
    });

    it('RA-T03 · the register never contains another tenant assessments', async () => {
      const res = await asAdmin().riskAssessments.list({});
      const foreign = await world.db
        .select({ id: schema.riskAssessments.id })
        .from(schema.riskAssessments)
        .where(eq(schema.riskAssessments.tenantId, world.b.tenantId));
      const foreignIds = new Set(foreign.map((f) => f.id));
      expect(res.filter((r) => foreignIds.has(r.id))).toEqual([]);
    });
  });
});

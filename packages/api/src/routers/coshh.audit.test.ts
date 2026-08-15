/**
 * COSHH module — the audit suite (FreeHS).
 *
 * The eighth module through the testing runbook, and the last brand-only
 * module without one.
 *
 * Two things make it different from the seven before it.
 *
 * **It encodes regulation, not workflow.** Most modules here model a process
 * — raise, review, approve, close. COSHH's publish gate models the Control of
 * Substances Hazardous to Health Regulations themselves: routes of exposure
 * must be identified, controls must exist, a control set that is PPE-only
 * must be justified (because PPE is the bottom of the hierarchy), and a
 * carcinogen cannot go active while substitution has not even been
 * considered. Those are not product opinions; they are reg 6, reg 7(1) and
 * the hierarchy of control. A defect here is a defect in the advice the
 * product gives, which is worse than a defect in its bookkeeping.
 *
 * **It has an AI boundary.** The SDS import sends a supplier's safety data
 * sheet to a model and turns the answer into the substance record — hazard
 * statements, pictograms, workplace exposure limits. Ground rule 2 says every
 * external API response is validated before we trust it, and a model is the
 * most external response there is. The route validates; the question this
 * suite asks is whether the tRPC procedure behind it does too, because the
 * route is not the only way in.
 *
 * Seven axes: CO-P (permissions), CO-R (the regulatory gate), CO-A (the AI
 * boundary), CO-S (statutory intervals — LEV thorough examination, exposure
 * monitoring, health surveillance), CO-X (cross-module), CO-T (tenancy),
 * CO-V (inventory hygiene).
 *
 * Every test describes CORRECT behaviour. Those that name a live defect fail
 * today and are the acceptance criteria for the fix pass.
 */
import type { PGlite } from '@electric-sql/pglite';
import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';
import { bootWorld, type World } from './__fixtures__/world';

const createCaller = createCallerFactory(appRouter);
type Caller = ReturnType<typeof createCaller>;

function coshhProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter((k) => k.startsWith('coshh.'))
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

describe('coshh — audit suite', () => {
  let world: World;
  let client: PGlite;
  /** `coshh.view` + `coshh.create` — can add a substance, cannot publish. */
  let assessorId: string;

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  const asAssessor = () => createCaller(world.ctxFor(world.a.tenantId, assessorId));

  /** A substance, optionally a carcinogen with substitution unconsidered. */
  async function makeSubstance(opts?: { name?: string; carcinogen?: boolean }): Promise<string> {
    const { substanceId } = (await asAdmin().coshh.substances.create({
      name: opts?.name ?? `Solvent ${newId().slice(-6)}`,
      supplier: 'Acme Chemicals',
      hazardClassification: ['Flam. Liq. 2'],
      signalWord: 'danger',
    })) as { substanceId: string };
    if (opts?.carcinogen === true) {
      await world.db
        .update(schema.coshhSubstances)
        .set({ isCarcinogen: true, substitutionStatus: 'not_assessed' })
        .where(eq(schema.coshhSubstances.id, substanceId));
    }
    return substanceId;
  }

  /** An assessment with routes of exposure set — one step from publishable. */
  async function makeAssessment(substanceId: string): Promise<string> {
    const admin = asAdmin();
    const { assessmentId } = (await admin.coshh.assessments.create({
      substanceId,
      taskDescription: 'Degreasing brake components at the bench.',
    })) as { assessmentId: string };
    await admin.coshh.assessments.update({
      assessmentId,
      routesOfExposure: ['inhalation', 'skin'],
      personsExposed: ['maintenance technicians'],
    });
    return assessmentId;
  }

  beforeAll(async () => {
    resetDependentsRegistryForTests();
    world = await bootWorld();
    client = world.client;

    const setId = newId();
    await world.db.insert(schema.permissionSets).values({
      id: setId,
      tenantId: world.a.tenantId,
      name: 'COSHH assessor',
      permissions: ['coshh.view', 'coshh.create'] as never,
    });
    assessorId = newId();
    await world.db.insert(schema.user).values({
      id: assessorId,
      tenantId: world.a.tenantId,
      name: 'Cass Assessor',
      email: 'coshh-assessor@northgate.test',
      permissionSetId: setId,
    });
  }, 180_000);

  afterAll(async () => {
    await client.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CO-P — permissions
  // ═══════════════════════════════════════════════════════════════════════
  describe('CO-P · permissions', () => {
    it('CO-P00 · the matrix covers every coshh procedure the router exposes', () => {
      const procs = coshhProcedures();
      expect(procs.length).toBeGreaterThanOrEqual(25);
      expect(procs).toContain('coshh.assessments.publish');
      expect(procs).toContain('coshh.sds.attach');
    });

    it('CO-P01 · every procedure refuses a user holding no coshh key', async () => {
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.nobody));
      const leaked: Array<{ path: string; outcome: string }> = [];
      for (const path of coshhProcedures()) {
        const res = await callFor(caller, path, undefined);
        if (res.ok) leaked.push({ path, outcome: 'RESOLVED without permission' });
        else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }
      expect(leaked).toEqual([]);
    });

    it('CO-P02 · coshh.create adds substances and assessments but cannot publish one', async () => {
      // Publishing is the act that makes an assessment the control regime a
      // crew works to. Drafting it and signing it off are different
      // authorities, and `coshh.manage` is the second one.
      const caller = asAssessor();
      const created = await callFor(caller, 'coshh.substances.create', {
        name: `Assessor solvent ${newId().slice(-6)}`,
      });
      expect({ step: 'create', ok: created.ok }).toEqual({ step: 'create', ok: true });

      const substanceId = await makeSubstance();
      const assessmentId = await makeAssessment(substanceId);
      for (const [path, input] of [
        ['coshh.assessments.publish', { assessmentId }],
        ['coshh.substances.archive', { substanceId }],
        ['coshh.substances.update', { substanceId, supplier: 'Renamed by assessor' }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(caller, path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CO-R — the regulatory gate
  // ═══════════════════════════════════════════════════════════════════════
  describe('CO-R · the regulatory gate', () => {
    it('CO-R01 · an assessment with no routes of exposure cannot be published', async () => {
      const admin = asAdmin();
      const substanceId = await makeSubstance();
      const { assessmentId } = (await admin.coshh.assessments.create({
        substanceId,
        taskDescription: 'Unassessed task.',
      })) as { assessmentId: string };
      const res = await callFor(admin, 'coshh.assessments.publish', { assessmentId });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toBe('no-routes');
    });

    it('CO-R02 · an assessment with no controls cannot be published', async () => {
      const substanceId = await makeSubstance();
      const assessmentId = await makeAssessment(substanceId);
      const res = await callFor(asAdmin(), 'coshh.assessments.publish', { assessmentId });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.message).toBe('no-controls');
    });

    it('CO-V01 · publishing freezes a signed version an edit cannot reach', async () => {
      // BUG-03. Risk assessments and fire risk assessments both freeze an
      // immutable version on publish; COSHH did not, so an edit to an
      // Active, signed assessment overwrote the only record of what an
      // assessor had attested. An HSE evaluation found it by opening a
      // signed assessment and typing into it.
      const admin = asAdmin();
      const substanceId = await makeSubstance();
      const assessmentId = await makeAssessment(substanceId);
      await admin.coshh.assessments.addControl({
        assessmentId,
        tier: 'engineering',
        description: 'Bench LEV on at the task.',
      });
      await admin.coshh.assessments.update({
        assessmentId,
        plainSummary: 'AS SIGNED.',
      });
      await admin.coshh.assessments.publish({ assessmentId });

      const signed = await world.db
        .select()
        .from(schema.coshhAssessmentVersions)
        .where(eq(schema.coshhAssessmentVersions.assessmentId, assessmentId));
      expect({ versionsAfterPublish: signed.length }).toEqual({ versionsAfterPublish: 1 });

      // Edit the live assessment — legal, and the reason the "changed since
      // publish" banner exists.
      await admin.coshh.assessments.update({
        assessmentId,
        plainSummary: 'EDITED AFTER SIGN-OFF.',
      });

      const version = await admin.coshh.assessments.getVersion({
        versionId: signed[0]?.id ?? '',
      });
      const [live] = await world.db
        .select({ summary: schema.coshhAssessments.plainSummary })
        .from(schema.coshhAssessments)
        .where(eq(schema.coshhAssessments.id, assessmentId));

      expect({
        signedCopySays: version.content.plainSummary,
        liveRowSays: live?.summary,
        controlsSnapshotted: version.content.controls.length,
      }).toEqual({
        signedCopySays: 'AS SIGNED.',
        liveRowSays: 'EDITED AFTER SIGN-OFF.',
        controlsSnapshotted: 1,
      });
    });

    it('CO-V02 · re-publishing supersedes the previous version, never rewrites it', async () => {
      const admin = asAdmin();
      const substanceId = await makeSubstance();
      const assessmentId = await makeAssessment(substanceId);
      await admin.coshh.assessments.addControl({
        assessmentId,
        tier: 'engineering',
        description: 'Bench LEV on at the task.',
      });
      await admin.coshh.assessments.update({ assessmentId, plainSummary: 'FIRST.' });
      await admin.coshh.assessments.publish({ assessmentId });
      await admin.coshh.assessments.update({ assessmentId, plainSummary: 'SECOND.' });
      await admin.coshh.assessments.publish({ assessmentId });

      const versions = await world.db
        .select()
        .from(schema.coshhAssessmentVersions)
        .where(eq(schema.coshhAssessmentVersions.assessmentId, assessmentId))
        .orderBy(schema.coshhAssessmentVersions.versionNumber);

      // Exactly one current version is a database fact (partial unique
      // index), not a router convention — so this cannot drift.
      const current = versions.filter((v) => v.supersededAt === null);
      expect({
        versionCount: versions.length,
        currentCount: current.length,
        v1Text: versions[0]?.content.plainSummary,
        v2Text: versions[1]?.content.plainSummary,
        currentIsV2: current[0]?.versionNumber,
      }).toEqual({
        versionCount: 2,
        currentCount: 1,
        v1Text: 'FIRST.',
        v2Text: 'SECOND.',
        currentIsV2: 2,
      });
    });

    it('CO-R03 · a PPE-only control set needs a written justification', async () => {
      // The hierarchy of control puts PPE last. An assessment whose entire
      // answer is "wear gloves" is the single most common way a COSHH
      // assessment is wrong in the field, and the regulations expect the
      // higher tiers to have been tried first. Requiring a justification is
      // the product refusing to rubber-stamp that.
      const admin = asAdmin();
      const substanceId = await makeSubstance();
      const assessmentId = await makeAssessment(substanceId);
      await admin.coshh.assessments.addControl({
        assessmentId,
        tier: 'ppe',
        description: 'Nitrile gloves and goggles.',
      });

      const refused = await callFor(admin, 'coshh.assessments.publish', { assessmentId });
      expect({ publishedPpeOnly: refused.ok }).toEqual({ publishedPpeOnly: false });
      if (!refused.ok) expect(refused.message).toBe('ppe-only-needs-justification');
    });

    it('CO-R04 · the same assessment publishes once a higher tier is added', async () => {
      const admin = asAdmin();
      const substanceId = await makeSubstance();
      const assessmentId = await makeAssessment(substanceId);
      await admin.coshh.assessments.addControl({
        assessmentId,
        tier: 'ppe',
        description: 'Nitrile gloves and goggles.',
      });
      await admin.coshh.assessments.addControl({
        assessmentId,
        tier: 'engineering',
        description: 'Bench-mounted LEV at the point of work.',
      });
      const res = await callFor(admin, 'coshh.assessments.publish', { assessmentId });
      expect({ published: res.ok }).toEqual({ published: true });
    });

    it('CO-R05 · a carcinogen cannot go live while substitution is unconsidered', async () => {
      // Regulation 7(1): substitution first. An assessment for a carcinogen
      // that has never even been asked "could we use something else?" is
      // not an assessment, and the gate says so.
      const admin = asAdmin();
      const substanceId = await makeSubstance({ carcinogen: true });
      const assessmentId = await makeAssessment(substanceId);
      await admin.coshh.assessments.addControl({
        assessmentId,
        tier: 'engineering',
        description: 'Fully enclosed process with LEV.',
      });

      const res = await callFor(admin, 'coshh.assessments.publish', { assessmentId });
      expect({ publishedCarcinogenUnsubstituted: res.ok }).toEqual({
        publishedCarcinogenUnsubstituted: false,
      });
      if (!res.ok) expect(res.message).toBe('substitution-not-considered');
    });

    it('CO-R06 · recording the substitution decision unblocks it', async () => {
      const admin = asAdmin();
      const substanceId = await makeSubstance({ carcinogen: true });
      const assessmentId = await makeAssessment(substanceId);
      await admin.coshh.assessments.addControl({
        assessmentId,
        tier: 'engineering',
        description: 'Fully enclosed process with LEV.',
      });
      await admin.coshh.substances.setSubstitution({
        substanceId,
        status: 'considered_rejected',
        notes: 'No compliant alternative available for this process.',
      });
      const res = await callFor(admin, 'coshh.assessments.publish', { assessmentId });
      expect({ published: res.ok }).toEqual({ published: true });
    });

    it('CO-R07 · editing a live assessment leaves a record of the edit', async () => {
      // Note what this test does NOT claim. Unlike RAMS and the FRA, a COSHH
      // assessment here is deliberately a living document: `update` on an
      // active assessment is allowed, and `updatedAt > lastPublishedAt` drives
      // a "changed since publish" prompt in the UI (C-15). That is a
      // defensible design — nobody holds a countersigned copy of a COSHH
      // assessment the way a crew holds a briefed RAMS pack.
      //
      // The defect is the trail, not the edit. Every other mutation in this
      // module writes to `coshh_events` — control added, control removed,
      // substitution updated, SDS attached, review recorded, published.
      // `assessments.update` writes none. So the fields that decide the
      // control regime — routes of exposure, persons exposed, how many of
      // them — can be rewritten on a live assessment with no record of who
      // did it or what it said before.
      //
      // And the "changed since publish" prompt is not a substitute, because
      // republishing clears it: after a republish `updatedAt` is no longer
      // ahead of `lastPublishedAt`, and the event log holds only "published".
      // The second half of this test asserts exactly that residue is gone.
      const admin = asAdmin();
      const substanceId = await makeSubstance();
      const assessmentId = await makeAssessment(substanceId);
      await admin.coshh.assessments.addControl({
        assessmentId,
        tier: 'engineering',
        description: 'LEV at the bench.',
      });
      await admin.coshh.assessments.publish({ assessmentId });

      const eventsFor = async (): Promise<string[]> =>
        (
          await world.db
            .select({ kind: schema.coshhEvents.kind })
            .from(schema.coshhEvents)
            .where(eq(schema.coshhEvents.entityId, assessmentId))
        ).map((e) => e.kind);

      const before = await eventsFor();
      await admin.coshh.assessments.update({
        assessmentId,
        taskDescription: 'Degreasing brake components — now inside the booth.',
        personsCount: 4,
        routesOfExposure: ['inhalation'],
      });
      const after = await eventsFor();

      // Republish, then look for any surviving trace of the edit.
      await admin.coshh.assessments.publish({ assessmentId });
      const [row] = await world.db
        .select({
          updatedAt: schema.coshhAssessments.updatedAt,
          lastPublishedAt: schema.coshhAssessments.lastPublishedAt,
        })
        .from(schema.coshhAssessments)
        .where(eq(schema.coshhAssessments.id, assessmentId));
      const changedSincePublishFlag =
        row?.lastPublishedAt != null && row.updatedAt > row.lastPublishedAt;

      expect({
        editRecordedInEventLog: after.length > before.length,
        traceableAfterRepublish: after.length > before.length || changedSincePublishFlag,
      }).toEqual({ editRecordedInEventLog: true, traceableAfterRepublish: true });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CO-A — the AI boundary
  // ═══════════════════════════════════════════════════════════════════════
  describe('CO-A · the AI boundary', () => {
    it('CO-A01 · an SDS extraction is validated at the tRPC boundary, not only at the route', async () => {
      // `sdsFileInput.extraction` is `z.unknown()`, carrying the comment
      // "already validated by sdsExtractionSchema shape". The HTTP route
      // does validate the model's answer — but the route is not the only
      // way in. A client posting straight to the procedure can store any
      // JSON at all as an "AI extraction", and it then renders in the
      // substance record as if the supplier's safety data sheet said it.
      //
      // Ground rule 2 is "Zod at EVERY boundary", and a comment asserting
      // that somebody else validated is exactly what that rule exists to
      // prevent.
      const substanceId = await makeSubstance();
      const res = await callFor(asAdmin(), 'coshh.sds.attach', {
        substanceId,
        storageKey: `${world.a.tenantId}/coshh/${substanceId}/sds.pdf`,
        filename: 'sds.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        extraction: { totallyMadeUp: true, hStatements: 'not even an array' },
      });
      expect({ acceptedArbitraryExtraction: res.ok }).toEqual({
        acceptedArbitraryExtraction: false,
      });
    });

    it('CO-A02 · an SDS cannot be attached against a storage key from another tenant', async () => {
      // `storageKey` is a free string. `assertStorageKeyInTenant` exists in
      // this codebase and is used by the contractors upload path; it is not
      // used here. Reading the file is still blocked by /api/files, so this
      // is a data-integrity hole rather than a disclosure — the SDS row
      // points somewhere it will never resolve from.
      const substanceId = await makeSubstance();
      const res = await callFor(asAdmin(), 'coshh.sds.attach', {
        substanceId,
        storageKey: `${world.b.tenantId}/coshh/whatever/sds.pdf`,
        filename: 'sds.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      });
      expect({ acceptedForeignKey: res.ok }).toEqual({ acceptedForeignKey: false });
    });

    it('CO-A03 · a well-formed SDS attaches and becomes the current sheet', async () => {
      const admin = asAdmin();
      const substanceId = await makeSubstance();
      const res = await callFor(admin, 'coshh.sds.attach', {
        substanceId,
        storageKey: `${world.a.tenantId}/coshh/${substanceId}/sds.pdf`,
        filename: 'sds.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        issueDate: new Date(world.now.getTime() - 30 * 86_400_000),
      });
      expect({ attached: res.ok }).toEqual({ attached: true });

      const rows = await world.db
        .select({ id: schema.coshhSdsDocuments.id })
        .from(schema.coshhSdsDocuments)
        .where(eq(schema.coshhSdsDocuments.substanceId, substanceId));
      expect(rows.length).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CO-S — statutory intervals: LEV, monitoring, health surveillance
  // ═══════════════════════════════════════════════════════════════════════
  describe('CO-S · statutory intervals', () => {
    async function makeLevUnit(name?: string): Promise<string> {
      const { levUnitId } = (await asAdmin().coshh.lev.create({
        name: name ?? `Booth ${newId().slice(-6)}`,
        locationText: 'Paint shop',
      })) as { levUnitId: string };
      return levUnitId;
    }

    const monthsAgo = (n: number): Date => {
      const d = new Date(world.now);
      d.setMonth(d.getMonth() - n);
      return d;
    };

    it('CO-S01 · a LEV test interval longer than the statutory 14 months is refused', async () => {
      // COSHH reg 9 / HSG258: thorough examination and test at least every
      // 14 months. A product that lets you type 24 is a product that will
      // report a unit as compliant while it is ten months out of test.
      const res = await callFor(asAdmin(), 'coshh.lev.create', {
        name: `Over-interval booth ${newId().slice(-6)}`,
        testIntervalMonths: 24,
      });
      expect({ acceptedOverStatutoryInterval: res.ok }).toEqual({
        acceptedOverStatutoryInterval: false,
      });
    });

    it('CO-S02 · a back-dated historical test does not push the next due date backwards', async () => {
      // Entering last year's examination report after this year's is normal
      // catch-up data entry. It must not move the schedule backwards and
      // make an in-date unit read overdue.
      const admin = asAdmin();
      const levUnitId = await makeLevUnit();
      await admin.coshh.lev.recordTest({
        levUnitId,
        testedAt: monthsAgo(2),
        result: 'pass',
        examiner: 'A. Examiner',
      });
      const [afterRecent] = await world.db
        .select({ due: schema.coshhLevUnits.nextTestDueAt })
        .from(schema.coshhLevUnits)
        .where(eq(schema.coshhLevUnits.id, levUnitId));

      await admin.coshh.lev.recordTest({
        levUnitId,
        testedAt: monthsAgo(20),
        result: 'pass',
        examiner: 'A. Historical Examiner',
      });
      const [afterHistorical] = await world.db
        .select({ due: schema.coshhLevUnits.nextTestDueAt })
        .from(schema.coshhLevUnits)
        .where(eq(schema.coshhLevUnits.id, levUnitId));

      expect({
        dueDateMovedBackwards:
          afterHistorical?.due != null &&
          afterRecent?.due != null &&
          afterHistorical.due < afterRecent.due,
      }).toEqual({ dueDateMovedBackwards: false });
    });

    it('CO-S03 · a failed examination takes the unit out of service and a pass is what returns it', async () => {
      // This is the FS-1 rule, in the module next door. Fire Safety holds a
      // failed check red until a pass clears it, precisely so advancing the
      // schedule cannot make a failure read green. LEV has the same shape:
      // a unit that failed its thorough examination is not fit for use, and
      // the thing that makes it fit again is a passing examination — not
      // somebody setting a dropdown back to "in service".
      const admin = asAdmin();
      const levUnitId = await makeLevUnit();
      await admin.coshh.lev.recordTest({
        levUnitId,
        testedAt: monthsAgo(1),
        result: 'fail',
        examiner: 'A. Examiner',
        defectsSummary: 'Face velocity below design across the whole slot.',
      });
      const [afterFail] = await world.db
        .select({ status: schema.coshhLevUnits.status })
        .from(schema.coshhLevUnits)
        .where(eq(schema.coshhLevUnits.id, levUnitId));

      const returned = await callFor(admin, 'coshh.lev.update', {
        levUnitId,
        status: 'in_service',
      });
      const [afterReturn] = await world.db
        .select({ status: schema.coshhLevUnits.status })
        .from(schema.coshhLevUnits)
        .where(eq(schema.coshhLevUnits.id, levUnitId));

      expect({
        outOfServiceOnFail: afterFail?.status,
        returnedToServiceWithoutAPass: returned.ok && afterReturn?.status === 'in_service',
      }).toEqual({
        outOfServiceOnFail: 'out_of_service',
        returnedToServiceWithoutAPass: false,
      });
    });

    it('CO-S04 · a monitoring result is compared to the WEL, and a non-matching agent is not a silent pass', async () => {
      // CO-E21. The dangerous outcome is not "we could not compare" — it is
      // "we could not compare, so we showed a green tick". `exceedsWel`
      // returns null when there is no limit for that period or the units
      // differ, and the record must carry that null through rather than
      // collapsing it to false.
      const admin = asAdmin();
      const { substanceId } = (await admin.coshh.substances.create({
        name: `Toluene blend ${newId().slice(-6)}`,
        workplaceExposureLimits: [
          {
            agent: 'toluene',
            twa8h: { value: 191, unit: 'mg/m3' },
            stel15min: null,
            source: 'EH40/2005',
          },
        ],
      })) as { substanceId: string };

      const over = (await admin.coshh.monitoring.record({
        substanceId,
        agent: 'Toluene',
        sampledAt: world.now,
        period: 'twa8h',
        resultValue: 400,
        resultUnit: 'mg/m3',
      })) as { exceedsWel: boolean | null };

      const under = (await admin.coshh.monitoring.record({
        substanceId,
        agent: 'toluene',
        sampledAt: world.now,
        period: 'twa8h',
        resultValue: 10,
        resultUnit: 'mg/m3',
      })) as { exceedsWel: boolean | null };

      // No STEL on record for this agent — not comparable, not "under".
      const noLimit = (await admin.coshh.monitoring.record({
        substanceId,
        agent: 'toluene',
        sampledAt: world.now,
        period: 'stel15min',
        resultValue: 999,
        resultUnit: 'mg/m3',
      })) as { exceedsWel: boolean | null };

      // An agent the substance has no limit for at all.
      const unknownAgent = (await admin.coshh.monitoring.record({
        substanceId,
        agent: 'xylene',
        sampledAt: world.now,
        period: 'twa8h',
        resultValue: 999,
        resultUnit: 'mg/m3',
      })) as { exceedsWel: boolean | null };

      expect({
        over: over.exceedsWel,
        under: under.exceedsWel,
        noStelOnRecord: noLimit.exceedsWel,
        unknownAgent: unknownAgent.exceedsWel,
      }).toEqual({
        over: true,
        under: false,
        noStelOnRecord: null,
        unknownAgent: null,
      });
    });

    it('CO-S05 · health surveillance cannot enrol a person from another tenant', async () => {
      // `enroll` takes `userId: z.string().min(1)` and never checks it is a
      // user of this tenant — `assertUsersInTenant` exists in this codebase
      // and `coshh.ts` imports nothing from `tenant-guards`. The disclosure
      // is in `surveillance.list`, which left-joins `user` for the display
      // name with no tenant predicate of its own, so the foreign person's
      // name comes back on the register.
      const admin = asAdmin();
      const substanceId = await makeSubstance();
      const foreignUserId = world.b.actors.admin;

      const res = await callFor(admin, 'coshh.surveillance.enroll', {
        substanceId,
        userId: foreignUserId,
        intervalMonths: 12,
      });

      const register = (await admin.coshh.surveillance.list({ substanceId })) as Array<{
        userId: string;
        userName: string | null;
      }>;
      const leaked = register.filter((r) => r.userId === foreignUserId);

      expect({
        enrolAccepted: res.ok,
        foreignNamesOnRegister: leaked.map((r) => r.userName),
      }).toEqual({ enrolAccepted: false, foreignNamesOnRegister: [] });
    });

    it('CO-S06 · a person is enrolled once per substance, and a check moves the recall date', async () => {
      const admin = asAdmin();
      const substanceId = await makeSubstance();
      const { enrolmentId } = (await admin.coshh.surveillance.enroll({
        substanceId,
        userId: world.a.actors.standard,
        intervalMonths: 12,
      })) as { enrolmentId: string };

      const dupe = await callFor(admin, 'coshh.surveillance.enroll', {
        substanceId,
        userId: world.a.actors.standard,
        intervalMonths: 6,
      });
      expect({ doubleEnrolled: dupe.ok }).toEqual({ doubleEnrolled: false });

      const checked = (await admin.coshh.surveillance.recordCheck({
        enrolmentId,
        checkedAt: world.now,
      })) as { nextDueAt: Date };
      const expected = new Date(world.now);
      expected.setMonth(expected.getMonth() + 12);
      expect({
        recallMonthsAhead: Math.round(
          (checked.nextDueAt.getTime() - world.now.getTime()) / (30 * 86_400_000),
        ),
      }).toMatchObject({ recallMonthsAhead: 12 });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CO-X — cross-module
  // ═══════════════════════════════════════════════════════════════════════
  describe('CO-X · cross-module', () => {
    it('CO-X01 · a RAMS pack cannot bind a COSHH assessment from another tenant', async () => {
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const { substanceId } = (await otherAdmin.coshh.substances.create({
        name: 'Foreign solvent',
      })) as { substanceId: string };
      const { assessmentId: foreignAssessment } = (await otherAdmin.coshh.assessments.create({
        substanceId,
        taskDescription: 'Foreign task.',
      })) as { assessmentId: string };

      const { packId } = await asAdmin().rams.packs.create({
        title: 'Cross-tenant COSHH binding probe',
        clientName: 'Nobody',
      });
      const res = await callFor(asAdmin(), 'rams.packs.bindCoshh', {
        packId,
        coshhAssessmentId: foreignAssessment,
      });
      expect({ boundForeignAssessment: res.ok }).toEqual({ boundForeignAssessment: false });
    });

    it('CO-X02 · a substance cannot be located at another tenant site', async () => {
      const substanceId = await makeSubstance();
      const res = await callFor(asAdmin(), 'coshh.locations.add', {
        substanceId,
        siteId: world.b.sites.primary,
        locationText: 'Cross-tenant store',
      });
      expect({ accepted: res.ok }).toEqual({ accepted: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CO-T — tenancy
  // ═══════════════════════════════════════════════════════════════════════
  describe('CO-T · tenancy', () => {
    it('CO-T01 · another tenant substance is unreadable and unmutatable', async () => {
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const { substanceId: foreignId } = (await otherAdmin.coshh.substances.create({
        name: 'Foreign hazardous substance',
        supplier: 'Foreign Supplier Ltd',
      })) as { substanceId: string };

      for (const [path, input] of [
        ['coshh.substances.get', { substanceId: foreignId }],
        ['coshh.substances.update', { substanceId: foreignId, supplier: 'Cross-tenant rename' }],
        ['coshh.substances.archive', { substanceId: foreignId }],
        ['coshh.substances.setSubstitution', { substanceId: foreignId, status: 'substituted' }],
        ['coshh.assessments.create', { substanceId: foreignId, taskDescription: 'Injected' }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(asAdmin(), path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }

      const [row] = await world.db
        .select({
          supplier: schema.coshhSubstances.supplier,
          archivedAt: schema.coshhSubstances.archivedAt,
        })
        .from(schema.coshhSubstances)
        .where(eq(schema.coshhSubstances.id, foreignId));
      expect(row?.supplier).toBe('Foreign Supplier Ltd');
      expect(row?.archivedAt).toBeNull();
    });

    it('CO-T02 · the inventory never contains another tenant substances', async () => {
      const res = (await asAdmin().coshh.substances.list({})) as
        | { substances?: Array<{ id: string }> }
        | Array<{ id: string }>;
      const rows = Array.isArray(res) ? res : (res.substances ?? []);
      const foreign = await world.db
        .select({ id: schema.coshhSubstances.id })
        .from(schema.coshhSubstances)
        .where(eq(schema.coshhSubstances.tenantId, world.b.tenantId));
      const foreignIds = new Set(foreign.map((f) => f.id));
      expect(rows.filter((s) => foreignIds.has(s.id))).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CO-V — inventory hygiene and volume
  // ═══════════════════════════════════════════════════════════════════════
  describe('CO-V · inventory hygiene', () => {
    it('CO-V01 · a duplicate substance name is refused unless explicitly allowed', async () => {
      // CO-E10. Two records for the same product is how an inventory stops
      // being an inventory: one gets the SDS, the other gets the
      // assessment, and neither is complete.
      const admin = asAdmin();
      const name = `Duplicate probe ${newId().slice(-6)}`;
      await admin.coshh.substances.create({ name });

      const dupe = await callFor(admin, 'coshh.substances.create', { name });
      expect({ silentDuplicate: dupe.ok }).toEqual({ silentDuplicate: false });

      const allowed = await callFor(admin, 'coshh.substances.create', {
        name,
        allowDuplicate: true,
      });
      expect({ explicitDuplicate: allowed.ok }).toEqual({ explicitDuplicate: true });
    });

    it('CO-V02 · the duplicate guard is case-insensitive', async () => {
      const admin = asAdmin();
      const name = `Case probe ${newId().slice(-6)}`;
      await admin.coshh.substances.create({ name });
      const res = await callFor(admin, 'coshh.substances.create', { name: name.toUpperCase() });
      expect({ caseVariantAccepted: res.ok }).toEqual({ caseVariantAccepted: false });
    });

    it('CO-V03 · the inventory holds its shape with substances present', async () => {
      const started = process.hrtime.bigint();
      const res = (await asAdmin().coshh.substances.list({})) as
        | { substances?: unknown[] }
        | unknown[];
      const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
      const rows = Array.isArray(res) ? res : (res.substances ?? []);
      expect(rows.length).toBeGreaterThan(0);
      expect({ overBudget: ms > 5_000, ms: Math.round(ms) }).toMatchObject({ overBudget: false });
    });
  });
});

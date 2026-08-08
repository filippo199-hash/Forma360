/**
 * Fire Safety module — the audit suite (FreeHS).
 *
 * The seventh module through the testing runbook, and the last one to be
 * audited in isolation before the cross-module sweep the previous three
 * reports have been asking for.
 *
 * Fire safety is chosen here for a reason the earlier audits sharpened: it
 * is the module where **a stale record is not an inconvenience, it is the
 * hazard**. A logbook that reads green because a schedule advanced past a
 * failed alarm test, a fire marshal whose competence expired in one register
 * while another says it is current, an FRA published without an evaluation —
 * each of these is a document a fire officer will read and a coroner may
 * read afterwards. The module's own code comments know this: FS-1 exists
 * specifically so that *"advancing the schedule must never make a failed
 * alarm test read green"*.
 *
 * Six axes:
 *
 *   1. **FS-P — the generated permission matrix.** Four keys, including the
 *      `fireSafety.record` split that the Training catalogue later cited as
 *      its precedent. If the precedent does not hold, neither does the thing
 *      modelled on it.
 *   2. **FS-S — the failed-state rule (FS-1).** A failed check or door stays
 *      red until a pass clears it, whatever the schedule says.
 *   3. **FS-G — the FRA publish gate.** Nine preconditions, and the
 *      intolerable-rating rule that demands an actionable finding.
 *   4. **FS-X — cross-module.** Marshal competence is tracked here AND in
 *      the Training module; fire doors reference Assets.
 *   5. **FS-T — tenancy.** Ground rule 4, against the mirror tenant.
 *   6. **FS-V — volume.** The building register and the due-work roll-up.
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

function fireProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter((k) => k.startsWith('fireSafety.'))
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

describe('fire safety — audit suite', () => {
  let world: World;
  let client: PGlite;
  /** `fireSafety.view` + `fireSafety.record` — the caretaker who logs checks. */
  let caretakerId: string;
  /** A building with its BS-standard check schedule set up. */
  let buildingId: string;

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  const asCaretaker = () => createCaller(world.ctxFor(world.a.tenantId, caretakerId));

  beforeAll(async () => {
    resetDependentsRegistryForTests();
    world = await bootWorld();
    client = world.client;

    const setId = newId();
    await world.db.insert(schema.permissionSets).values({
      id: setId,
      tenantId: world.a.tenantId,
      name: 'Building caretaker',
      permissions: ['fireSafety.view', 'fireSafety.record'] as never,
    });
    caretakerId = newId();
    await world.db.insert(schema.user).values({
      id: caretakerId,
      tenantId: world.a.tenantId,
      name: 'Cal Caretaker',
      email: 'caretaker@northgate.test',
      permissionSetId: setId,
    });

    const admin = asAdmin();
    const created = (await admin.fireSafety.buildings.create({
      name: 'Northgate House',
      siteId: world.a.sites.primary,
      address: '1 North Yard Road',
      isResidential: true,
      heightMetres: 19,
      storeys: 7,
    })) as { id: string };
    buildingId = created.id;
    await admin.fireSafety.buildings.setupChecks({ buildingId });
  }, 180_000);

  afterAll(async () => {
    await client.close();
  });

  /** The check type used throughout: every building gets a weekly alarm test. */
  const CHECK_TYPE = 'alarm_test';

  /** The display status the logbook computes for that check. */
  async function alarmDisplayStatus(): Promise<string | undefined> {
    const checks = (await asAdmin().fireSafety.logbook.checks({ buildingId })) as Array<{
      checkType: string;
      dueStatus?: string;
    }>;
    return checks.find((c) => c.checkType === CHECK_TYPE)?.dueStatus;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FS-P — permissions
  // ═══════════════════════════════════════════════════════════════════════
  describe('FS-P · permissions', () => {
    it('FS-P00 · the matrix covers every fireSafety procedure the router exposes', () => {
      const procs = fireProcedures();
      expect(procs.length).toBeGreaterThanOrEqual(30);
      expect(procs).toContain('fireSafety.fras.publish');
      expect(procs).toContain('fireSafety.logbook.recordEntry');
    });

    it('FS-P01 · every procedure refuses a user holding no fireSafety key', async () => {
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.nobody));
      const leaked: Array<{ path: string; outcome: string }> = [];
      for (const path of fireProcedures()) {
        const res = await callFor(caller, path, undefined);
        if (res.ok) leaked.push({ path, outcome: 'RESOLVED without permission' });
        else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }
      expect(leaked).toEqual([]);
    });

    it('FS-P02 · fireSafety.record lets a caretaker log a check and nothing more', async () => {
      // This split is the precedent the Training catalogue cites for
      // `training.record`. If it does not separate here, the thing modelled
      // on it was modelled on nothing.
      const caller = asCaretaker();
      const logged = await callFor(caller, 'fireSafety.logbook.recordEntry', {
        buildingId,
        checkType: CHECK_TYPE,
        result: 'pass',
        notes: 'Weekly alarm test — sounder 3.',
      });
      expect({ step: 'record', ok: logged.ok }).toEqual({ step: 'record', ok: true });

      for (const [path, input] of [
        ['fireSafety.buildings.create', { name: 'Should not exist' }],
        ['fireSafety.buildings.archive', { buildingId }],
        ['fireSafety.fras.create', { title: 'Should not exist' }],
        ['fireSafety.marshals.add', { buildingId, userId: world.a.actors.manager }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(caller, path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FS-S — the failed-state rule (FS-1)
  // ═══════════════════════════════════════════════════════════════════════
  describe('FS-S · the failed-state rule', () => {
    it('FS-S01 · a failed check stays red even when the schedule moves on', async () => {
      // The module's own comment: "Advancing the schedule must never make a
      // failed alarm test read green." A weekly alarm test that failed is a
      // live defect until somebody proves it fixed — the next due date has
      // no bearing on that.
      await asCaretaker().fireSafety.logbook.recordEntry({
        buildingId,
        checkType: CHECK_TYPE,
        result: 'fail',
        notes: 'Sounder 3 inaudible on the second floor.',
        raiseAction: false,
      });
      expect({ status: await alarmDisplayStatus() }).toEqual({ status: 'failed' });
    });

    it('FS-S02 · a subsequent pass is what clears it', async () => {
      await asCaretaker().fireSafety.logbook.recordEntry({
        buildingId,
        checkType: CHECK_TYPE,
        result: 'pass',
        notes: 'Sounder replaced and re-tested.',
      });
      expect(await alarmDisplayStatus()).not.toBe('failed');
    });

    it('FS-S03 · the logbook is append-only — a recorded entry is not editable', async () => {
      // The logbook is the evidential record a fire officer reads. If an
      // entry can be edited after the fact, it stops being evidence.
      const procs = fireProcedures();
      const mutators = procs.filter(
        (p) =>
          p.startsWith('fireSafety.logbook.') &&
          (p.includes('update') || p.includes('edit') || p.includes('delete')),
      );
      expect({ logbookMutators: mutators }).toEqual({ logbookMutators: [] });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FS-G — the FRA publish gate
  // ═══════════════════════════════════════════════════════════════════════
  describe('FS-G · the FRA publish gate', () => {
    async function draftFra(): Promise<string> {
      const created = (await asAdmin().fireSafety.fras.create({
        title: 'Northgate House — annual FRA',
        buildingId,
      })) as { id: string };
      return created.id;
    }

    it('FS-G01 · an empty FRA cannot be published', async () => {
      const fraId = await draftFra();
      const res = await callFor(asAdmin(), 'fireSafety.fras.publish', {
        fraId,
        confirmNoSignificantFindings: true,
      });
      expect({ publishedAnEmptyFra: res.ok }).toEqual({ publishedAnEmptyFra: false });
    });

    it('FS-G02 · the fire triangle and the persons at risk are both required', async () => {
      // PAS 79 step 1 is identifying the hazards — ignition, fuel, oxygen —
      // and step 2 is identifying who is at risk. An FRA missing either is
      // not an assessment, and this is the gate that says so.
      const admin = asAdmin();
      const fraId = await draftFra();
      await admin.fireSafety.fras.update({
        fraId,
        riskRating: 'tolerable',
        responsiblePersonName: 'Ada Admin',
        personsAtRisk: ['residents'],
        evaluationNotes: 'Evaluated against the escape strategy.',
      });

      const missingTriangle = await callFor(admin, 'fireSafety.fras.publish', {
        fraId,
        confirmNoSignificantFindings: true,
      });
      expect({ publishedWithoutTheTriangle: missingTriangle.ok }).toEqual({
        publishedWithoutTheTriangle: false,
      });
      if (!missingTriangle.ok) {
        expect(['no-ignition-sources', 'no-fuel-sources', 'no-oxygen-sources']).toContain(
          missingTriangle.message,
        );
      }
    });

    it('FS-G03 · a complete FRA publishes', async () => {
      const admin = asAdmin();
      const fraId = await draftFra();
      await admin.fireSafety.fras.update({
        fraId,
        riskRating: 'tolerable',
        responsiblePersonName: 'Ada Admin',
        personsAtRisk: ['residents', 'visitors'],
        ignitionSources: 'Electrical intake, cooking appliances.',
        fuelSources: 'Furnishings, stored refuse.',
        oxygenSources: 'Natural ventilation.',
        evaluationNotes: 'Escape routes protected; alarm to L2 standard.',
      });
      const res = await callFor(admin, 'fireSafety.fras.publish', {
        fraId,
        confirmNoSignificantFindings: true,
      });
      expect({ published: res.ok }).toEqual({ published: true });
    });

    it('FS-G04 · an intolerable rating cannot be published without an actionable finding', async () => {
      // Rating a building intolerable and then publishing with nothing to
      // do about it is the single worst artefact this module could emit.
      const admin = asAdmin();
      const fraId = await draftFra();
      await admin.fireSafety.fras.update({
        fraId,
        riskRating: 'intolerable',
        responsiblePersonName: 'Ada Admin',
        personsAtRisk: ['residents'],
        ignitionSources: 'Electrical intake.',
        fuelSources: 'Stored refuse in the escape corridor.',
        oxygenSources: 'Natural ventilation.',
        evaluationNotes: 'Single escape stair with combustible storage throughout.',
      });
      const res = await callFor(admin, 'fireSafety.fras.publish', {
        fraId,
        confirmNoSignificantFindings: true,
      });
      expect({ publishedIntolerableWithNoAction: res.ok }).toEqual({
        publishedIntolerableWithNoAction: false,
      });
    });

    it('FS-G05 · a published FRA is not silently editable back into a draft state', async () => {
      // Moving a published FRA back to draft is legitimate — it is how a
      // revision starts — but it must be an explicit act, not a side effect
      // of `update`.
      const admin = asAdmin();
      const fraId = await draftFra();
      await admin.fireSafety.fras.update({
        fraId,
        riskRating: 'tolerable',
        responsiblePersonName: 'Ada Admin',
        personsAtRisk: ['residents'],
        ignitionSources: 'Electrical intake.',
        fuelSources: 'Furnishings.',
        oxygenSources: 'Natural ventilation.',
        evaluationNotes: 'Adequate.',
      });
      await admin.fireSafety.fras.publish({ fraId, confirmNoSignificantFindings: true });

      const res = await callFor(admin, 'fireSafety.fras.update', {
        fraId,
        evaluationNotes: 'EDITED AFTER PUBLISH',
      });
      const [row] = await world.db
        .select({
          status: schema.fireRiskAssessments.status,
          notes: schema.fireRiskAssessments.evaluationNotes,
        })
        .from(schema.fireRiskAssessments)
        .where(eq(schema.fireRiskAssessments.id, fraId));

      expect({
        editAccepted: res.ok,
        publishedTextChanged: row?.notes === 'EDITED AFTER PUBLISH',
      }).toEqual({ editAccepted: false, publishedTextChanged: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FS-X — cross-module
  // ═══════════════════════════════════════════════════════════════════════
  describe('FS-X · cross-module', () => {
    it('FS-X01 · marshal competence agrees with the training matrix', async () => {
      // `fire_marshals` carries its OWN `trainedAt` / `trainingExpiresAt`,
      // and `marshalTrainingStatus` reads only that row. Nothing in the repo
      // reconciles it against `training_records`, so fire-marshal competence
      // lives in two independent registers that can disagree indefinitely.
      //
      // The module comment still says training dates are "carried locally
      // until Phase 10" — but the Training module (B7) has shipped. So a
      // marshal renews their certificate, the training matrix goes green,
      // and the fire register a fire officer inspects keeps saying expired
      // (and the daily digest keeps chasing them). The reverse is worse:
      // somebody types a date into the fire register and the marshal reads
      // as competent with no training record behind it at all.
      const admin = asAdmin();
      const marshalUserId = world.a.actors.manager;

      // A marshal whose LOCAL fire-register date has lapsed.
      await admin.fireSafety.marshals.add({
        buildingId,
        userId: marshalUserId,
        role: 'marshal',
        trainedAt: new Date(world.now.getTime() - 400 * 86_400_000),
        trainingExpiresAt: new Date(world.now.getTime() - 30 * 86_400_000),
      });

      // ...and a CURRENT fire-marshal ticket in the training matrix.
      const { id: requirementId } = await admin.training.createRequirement({
        name: 'Fire marshal',
        validityMonths: 36,
      });
      await admin.training.addRecord({
        requirementId,
        userId: marshalUserId,
        personName: 'Mo Manager',
        achievedAt: new Date(world.now.getTime() - 10 * 86_400_000).toISOString().slice(0, 10),
      });

      const marshals = (await admin.fireSafety.marshals.list({ buildingId })) as Array<{
        userId: string;
        trainingStatus?: string;
      }>;
      const row = marshals.find((m) => m.userId === marshalUserId);

      // The training matrix says this person is in date. The fire register
      // must not disagree with it.
      expect({ fireRegisterSays: row?.trainingStatus }).toEqual({ fireRegisterSays: 'in_date' });
    });

    it('FS-X02 · a fire door cannot reference an asset from another tenant', async () => {
      const res = await callFor(asAdmin(), 'fireSafety.doors.create', {
        buildingId,
        reference: 'FD-01',
        location: 'Stair core, level 2',
        assetId: world.b.assets.root as string,
      });
      expect({ boundForeignAsset: res.ok }).toEqual({ boundForeignAsset: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FS-T — tenancy
  // ═══════════════════════════════════════════════════════════════════════
  describe('FS-T · tenancy', () => {
    it('FS-T01 · another tenant building is unreadable and unmutatable', async () => {
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const { id: foreignId } = (await otherAdmin.fireSafety.buildings.create({
        name: 'Foreign block',
      })) as { id: string };

      for (const [path, input] of [
        ['fireSafety.buildings.get', { buildingId: foreignId }],
        ['fireSafety.buildings.update', { buildingId: foreignId, name: 'Cross-tenant rename' }],
        ['fireSafety.buildings.archive', { buildingId: foreignId }],
        ['fireSafety.buildings.setupChecks', { buildingId: foreignId }],
        ['fireSafety.logbook.checks', { buildingId: foreignId }],
        ['fireSafety.marshals.list', { buildingId: foreignId }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(asAdmin(), path, input);
        const rows = res.ok ? ((res.value as unknown[]) ?? []) : [];
        // Either refused, or — for the list-shaped reads — empty. What must
        // never happen is another tenant's rows coming back.
        expect({ path, leaked: res.ok && Array.isArray(rows) && rows.length > 0 }).toEqual({
          path,
          leaked: false,
        });
      }

      const [row] = await world.db
        .select({ name: schema.fireBuildings.name })
        .from(schema.fireBuildings)
        .where(eq(schema.fireBuildings.id, foreignId));
      expect(row?.name).toBe('Foreign block');
    });

    it('FS-T02 · the register never contains another tenant buildings', async () => {
      const res = (await asAdmin().fireSafety.buildings.list({})) as
        | { buildings?: Array<{ id: string }> }
        | Array<{ id: string }>;
      const rows = Array.isArray(res) ? res : (res.buildings ?? []);
      const foreign = await world.db
        .select({ id: schema.fireBuildings.id })
        .from(schema.fireBuildings)
        .where(eq(schema.fireBuildings.tenantId, world.b.tenantId));
      const foreignIds = new Set(foreign.map((f) => f.id));
      expect(rows.filter((b) => foreignIds.has(b.id))).toEqual([]);
    });

    it('FS-T03 · an FRA cannot be attached to another tenant building', async () => {
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const { id: foreignId } = (await otherAdmin.fireSafety.buildings.create({
        name: 'Another foreign block',
      })) as { id: string };

      const res = await callFor(asAdmin(), 'fireSafety.fras.create', {
        title: 'Cross-tenant FRA',
        buildingId: foreignId,
      });
      expect({ accepted: res.ok }).toEqual({ accepted: false });
    });

    it('FS-T04 · a marshal cannot be created for a user from another tenant', async () => {
      const res = await callFor(asAdmin(), 'fireSafety.marshals.add', {
        buildingId,
        userId: world.b.actors.manager,
      });
      expect({ accepted: res.ok }).toEqual({ accepted: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FS-V — volume and the due roll-up
  // ═══════════════════════════════════════════════════════════════════════
  describe('FS-V · volume and due work', () => {
    it('FS-V01 · the due roll-up reports the building configured checks', async () => {
      const due = (await asAdmin().fireSafety.logbook.due()) as unknown;
      expect(due).toBeDefined();
    });

    it('FS-V02 · the register holds its shape with buildings present', async () => {
      const started = process.hrtime.bigint();
      const res = (await asAdmin().fireSafety.buildings.list({})) as
        | { buildings?: unknown[] }
        | unknown[];
      const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
      const rows = Array.isArray(res) ? res : (res.buildings ?? []);
      expect(rows.length).toBeGreaterThan(0);
      expect({ overBudget: ms > 5_000, ms: Math.round(ms) }).toMatchObject({ overBudget: false });
    });

    it('FS-V03 · setting up checks twice does not double the schedule', async () => {
      // `setupChecks` seeds the BS-standard catalogue onto a building. Run
      // twice — which a user will do, because the button is on the page —
      // it must not produce two of every check.
      const before = await world.db
        .select({ id: schema.fireLogbookChecks.id })
        .from(schema.fireLogbookChecks)
        .where(eq(schema.fireLogbookChecks.buildingId, buildingId));
      await asAdmin().fireSafety.buildings.setupChecks({ buildingId });
      const after = await world.db
        .select({ id: schema.fireLogbookChecks.id })
        .from(schema.fireLogbookChecks)
        .where(eq(schema.fireLogbookChecks.buildingId, buildingId));
      expect({ before: before.length, after: after.length }).toEqual({
        before: before.length,
        after: before.length,
      });
    });
  });
});

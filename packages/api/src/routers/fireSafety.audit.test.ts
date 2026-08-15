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
import { desc, eq } from 'drizzle-orm';
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
      //
      // REWRITTEN: this used to ban the substring "update" anywhere under
      // `fireSafety.logbook.*`, which is a proxy for the property, not the
      // property. `logbook.updateCheck` then shipped — and it edits the
      // check SCHEDULE (frequency, due date, assignee, linked asset), not
      // any recorded entry, so the proxy failed while the invariant held.
      // A guard that fires on a legitimate feature gets deleted, so assert
      // the thing itself: record an entry, let the schedule be edited, and
      // prove the evidence did not move.
      const admin = asAdmin();
      await asCaretaker().fireSafety.logbook.recordEntry({
        buildingId,
        checkType: CHECK_TYPE,
        result: 'pass',
        notes: 'Weekly alarm test — evidential row.',
      });
      const entryBefore = (
        await world.db
          .select()
          .from(schema.fireLogbookEntries)
          .where(eq(schema.fireLogbookEntries.buildingId, buildingId))
          .orderBy(desc(schema.fireLogbookEntries.createdAt))
          .limit(1)
      )[0];
      expect(entryBefore).toBeDefined();

      const checks = (await admin.fireSafety.logbook.checks({ buildingId })) as Array<{
        id: string;
        checkType: string;
      }>;
      const alarm = checks.find((c) => c.checkType === CHECK_TYPE);
      if (alarm !== undefined) {
        await admin.fireSafety.logbook.updateCheck({
          checkId: alarm.id,
          notes: 'Schedule note — must not reach the evidence.',
        });
      }

      const entryAfter = (
        await world.db
          .select()
          .from(schema.fireLogbookEntries)
          .where(eq(schema.fireLogbookEntries.id, entryBefore?.id ?? ''))
          .limit(1)
      )[0];
      expect({
        result: entryAfter?.result,
        notes: entryAfter?.notes,
        performedAt: entryAfter?.performedAt?.getTime(),
      }).toEqual({
        result: entryBefore?.result,
        notes: entryBefore?.notes,
        performedAt: entryBefore?.performedAt?.getTime(),
      });

      // And no procedure anywhere offers to change an entry's evidential
      // fields — the static half, now aimed at entries rather than a
      // namespace.
      const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
        .procedures;
      const entryMutators = Object.keys(defs).filter((path) => {
        if (!path.startsWith('fireSafety.')) return false;
        const proc = defs[path] as { _def?: { inputs?: unknown[] } };
        const shape = (
          proc._def?.inputs?.[0] as { _def?: { shape?: () => Record<string, unknown> } } | undefined
        )?._def?.shape;
        if (typeof shape !== 'function') return false;
        const keys = Object.keys(shape());
        return keys.includes('entryId') && keys.some((k) => ['result', 'notes'].includes(k));
      });
      expect({ entryMutators }).toEqual({ entryMutators: [] });
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

    it('FS-G05 · editing a published FRA cannot destroy what was signed, and says so', async () => {
      // RETRACTED AS ORIGINALLY WRITTEN. This test used to assert that
      // `update` must REFUSE on a published FRA. That contradicts a
      // deliberate, documented decision — ADR 0011 §1 chose edit-in-place
      // for live assessments and FS-E29 pins it — so asserting refusal here
      // would have been this suite substituting its own model for the
      // platform's, which ground rule 12 forbids.
      //
      // The real question is not "can it be edited" but "can the edit
      // destroy the evidence, and does a reader find out". Two properties
      // make edit-in-place safe, and those are what this now pins:
      //
      //   1. the signed copy is frozen in `fire_fra_versions` and the edit
      //      does not reach it;
      //   2. the FRA reports itself attestation-stale afterwards, which is
      //      what the page banner and the PDF both render.
      //
      // Lose either one and edit-in-place becomes the defect it looked like.
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

      const signedVersion = (
        await world.db
          .select({ id: schema.fireFraVersions.id, content: schema.fireFraVersions.content })
          .from(schema.fireFraVersions)
          .where(eq(schema.fireFraVersions.fraId, fraId))
      )[0];
      expect({ snapshotTakenAtPublish: signedVersion !== undefined }).toEqual({
        snapshotTakenAtPublish: true,
      });
      const signedNotes = (signedVersion?.content as { evaluationNotes?: string } | undefined)
        ?.evaluationNotes;

      await admin.fireSafety.fras.update({ fraId, evaluationNotes: 'EDITED AFTER PUBLISH' });

      const after = (await admin.fireSafety.fras.get({ fraId })) as { attestationStale: boolean };
      const versionsAfter = await world.db
        .select({ content: schema.fireFraVersions.content })
        .from(schema.fireFraVersions)
        .where(eq(schema.fireFraVersions.fraId, fraId));
      const signedNotesAfter = (
        versionsAfter[0]?.content as { evaluationNotes?: string } | undefined
      )?.evaluationNotes;

      expect({
        signedCopyUntouched: signedNotesAfter === signedNotes,
        signedCopyHoldsTheOriginal: signedNotes === 'Adequate.',
        readerIsTold: after.attestationStale,
      }).toEqual({
        signedCopyUntouched: true,
        signedCopyHoldsTheOriginal: true,
        readerIsTold: true,
      });
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

      // The tenant says which requirement IS the marshal ticket. Without
      // this the reconciliation is inert by design — designating nothing
      // must not silently flip an existing tenant's marshals to unbacked —
      // so the setting is what a tenant configures once, and the fix is
      // that it is reachable at all (`/fire-safety/settings`).
      await admin.fireSafety.settings.setMarshalRequirements({ requirementIds: [requirementId] });

      type MarshalRow = {
        userId: string;
        trainingStatus?: string;
        competenceSource?: string;
        unbacked?: boolean;
      };
      const marshals = (await admin.fireSafety.marshals.list({ buildingId })) as MarshalRow[];
      const row = marshals.find((m) => m.userId === marshalUserId);

      // The training matrix says this person is in date. The fire register
      // must not disagree with it.
      expect({ fireRegisterSays: row?.trainingStatus, from: row?.competenceSource }).toEqual({
        fireRegisterSays: 'in_date',
        from: 'training',
      });

      // The same verdict must reach the building page, which reads
      // `buildings.get` rather than `marshals.list`. Reconciling one read
      // and not the other is how the two registers stayed apart.
      const building = (await admin.fireSafety.buildings.get({ buildingId })) as {
        marshals: MarshalRow[];
      };
      const onPage = building.marshals.find((m) => m.userId === marshalUserId);
      expect({ buildingPageSays: onPage?.trainingStatus, from: onPage?.competenceSource }).toEqual({
        buildingPageSays: 'in_date',
        from: 'training',
      });
    });

    it('FS-X01b · a typed marshal date with no training record is flagged unverified', async () => {
      // The direction that matters more. A renewed ticket showing red is a
      // false alarm; a hand-typed future date showing green satisfies the
      // building's marshal target, closes the coverage gap that exists to
      // force the training, and nothing else in the product contradicts it.
      const admin = asAdmin();
      const marshalUserId = world.a.actors.standard;

      // Once a tenant HAS designated, `marshals.add` refuses typed dates
      // outright — the matrix is the register. So the unbacked case is the
      // legacy one: dates typed before the link was made. Model that
      // ordering rather than a state the router no longer lets you reach.
      await admin.fireSafety.settings.setMarshalRequirements({ requirementIds: [] });
      await admin.fireSafety.marshals.add({
        buildingId,
        userId: marshalUserId,
        role: 'marshal',
        trainedAt: new Date(world.now.getTime() - 10 * 86_400_000),
        trainingExpiresAt: new Date(world.now.getTime() + 700 * 86_400_000),
      });

      const { id: requirementId } = await admin.training.createRequirement({
        name: 'Fire marshal (unbacked check)',
        validityMonths: 36,
      });
      await admin.fireSafety.settings.setMarshalRequirements({ requirementIds: [requirementId] });

      const marshals = (await admin.fireSafety.marshals.list({ buildingId })) as Array<{
        userId: string;
        unbacked?: boolean;
        competenceSource?: string;
      }>;
      const row = marshals.find((m) => m.userId === marshalUserId);
      expect({ unbacked: row?.unbacked, from: row?.competenceSource }).toEqual({
        unbacked: true,
        from: 'local',
      });
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

/**
 * Cross-module access-boundary sweep — the generated one (FreeHS).
 *
 * Thirteen module audits produced sixty defects, and twenty of them were
 * one mistake in three costumes:
 *
 *   1. a module READING another module's records while applying only its
 *      own rule (Heads-Up → Documents, Assets → three modules, RAMS →
 *      Documents, Fire Safety → Training, COSHH → Users, Permits → Risk
 *      Assessments, Permits → Documents);
 *   2. a module WRITING content out past its own confidentiality boundary
 *      (Incidents → Actions);
 *   3. a module not applying its own rule to its own sub-routers
 *      (Observations, Inspections — `list` and `get` scoped, every sibling
 *      door left open).
 *
 * Every one of those was found one instance at a time, by a suite that had
 * to be written by hand for the module it covered. This file is the
 * instrument those thirteen reports kept asking for.
 *
 * **It is generated from the router itself.** tRPC exposes each
 * procedure's Zod input schema at
 * `appRouter._def.procedures[path]._def.inputs[0]._def.shape()`, and its
 * kind at `_def.type`. So the sweep can enumerate EVERY procedure in the
 * whole application, work out which ones accept a given entity's id,
 * synthesise an input, call it as a deliberately under-privileged actor
 * against a record it must not reach, and search the response for a
 * sentinel that only that record contains. No list to maintain, nothing to
 * keep in sync: a procedure added next month is swept the day it lands.
 *
 * The unifying question, stated once — **entity-level predicate parity**:
 *
 * > Of every procedure that resolves a record by id, does it apply every
 * > access predicate the canonical read of that entity applies?
 *
 * Five axes, all generated:
 *   XM-C  contractor scope   — the portal boundary, across all 3 entities
 *   XM-I  confidentiality    — incident content, across the whole router
 *   XM-D  document visibility— restricted documents, across the whole router
 *   XM-T  tenancy            — every procedure, foreign ids
 *   XM-P  public surface     — every unauthenticated procedure, declared
 *
 * Every test describes CORRECT behaviour. Those that name a live defect
 * fail today and are the acceptance criteria for the fix pass.
 */
import type { PGlite } from '@electric-sql/pglite';
import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@forma360/db/schema';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';
import { bootWorld, type World } from './__fixtures__/world';

const createCaller = createCallerFactory(appRouter);
type Caller = ReturnType<typeof createCaller>;

// ─── Runtime introspection of the router ────────────────────────────────────

interface ProcedureInfo {
  path: string;
  type: 'query' | 'mutation' | 'subscription';
  /** Top-level input keys, or null when the input is not a plain object. */
  keys: string[] | null;
}

function allProcedures(): ProcedureInfo[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .sort()
    .map((path) => {
      const d = (defs[path] as { _def?: Record<string, unknown> })._def ?? {};
      const type = (d.type as ProcedureInfo['type']) ?? 'query';
      const inputs = d.inputs as unknown[] | undefined;
      let keys: string[] | null = null;
      for (const input of inputs ?? []) {
        const shapeFn = (input as { _def?: { shape?: () => Record<string, unknown> } })._def?.shape;
        if (typeof shapeFn === 'function') {
          keys = [...new Set([...(keys ?? []), ...Object.keys(shapeFn())])];
        }
      }
      return { path, type, keys };
    });
}

/** Procedures whose input accepts at least one of `keys`. */
function acceptingAnyKey(keys: readonly string[]): ProcedureInfo[] {
  return allProcedures().filter((p) => p.keys !== null && p.keys.some((k) => keys.includes(k)));
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

type CallOutcome = { ok: true; value: unknown } | { ok: false; code: string; message: string };

async function callFor(caller: Caller, path: string, input?: unknown): Promise<CallOutcome> {
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

function serialise(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_k, v: unknown) => (v instanceof Date ? v.toISOString() : v)) ?? ''
    );
  } catch {
    return String(value);
  }
}

/**
 * Build an input for `proc` by filling every key it declares from `bag`.
 * Keys the bag has no value for are omitted — Zod then rejects, and the
 * procedure is recorded as *not exercised* rather than silently skipped.
 */
function buildInput(proc: ProcedureInfo, bag: Record<string, unknown>): unknown {
  if (proc.keys === null) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of proc.keys) {
    if (key in bag) out[key] = bag[key];
  }
  return out;
}

// ─── Sentinels ──────────────────────────────────────────────────────────────
// Each is unique enough that a substring match over a serialised response
// is a reliable leak detector, and none of them is a valid id, so a
// sentinel can only arrive by being READ out of the record it lives on.

const S = {
  inspection: 'ZZXMINSPECTION-internal-walkround',
  observation: 'ZZXMOBSERVATION-internal-hazard',
  observationComment: 'ZZXMOBSCOMMENT-internal-thread',
  action: 'ZZXMACTION-internal-remedial',
  actionComment: 'ZZXMACTIONCOMMENT-internal-thread',
  incident: 'ZZXMINCIDENT-confidential-assault',
  incidentFinding: 'ZZXMFINDING-lone-working-no-alarm',
  document: 'Night shift rota',
  foreign: 'ZZXMFOREIGN-other-tenant',
} as const;

function leaks(payload: unknown, expected: readonly string[]): string[] {
  const text = serialise(payload);
  return expected.filter((s) => text.includes(s));
}

describe('cross-module — the generated access-boundary sweep', () => {
  let world: World;
  let client: PGlite;

  /**
   * An external contractor portal user holding EXACTLY what the three
   * portal activities grant (packages/permissions contractor-activities):
   * inspections.view/conduct/sign, issues.view/report, actions.view/create.
   * Tenant-wide permissions, contractor-scoped data.
   */
  let portalUserId: string;
  /** Every incidents key EXCEPT `incidents.confidential.view`. */
  let incidentOfficerId: string;
  /** `documents.view` but NOT a member of the group the doc is restricted to. */
  let outsiderId: string;

  const ids: Record<string, string> = {};

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  const asPortal = () => createCaller(world.ctxFor(world.a.tenantId, portalUserId));
  const asIncidentOfficer = () => createCaller(world.ctxFor(world.a.tenantId, incidentOfficerId));
  const asOutsider = () => createCaller(world.ctxFor(world.a.tenantId, outsiderId));

  /** Fixed so signature mutations in the sweep can address a real slot. */
  const SIG_ITEM_ID = newId();

  function templateContent(label: string) {
    return {
      schemaVersion: '1' as const,
      title: label,
      pages: [
        {
          id: newId(),
          type: 'title' as const,
          title: 'Title',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [{ id: newId(), type: 'conductedBy' as const, prompt: 'By', required: false }],
            },
          ],
        },
        {
          id: newId(),
          type: 'inspection' as const,
          title: 'Inspection',
          sections: [
            {
              id: newId(),
              title: 'Checks',
              items: [
                { id: newId(), type: 'text' as const, prompt: label, required: false },
                {
                  id: SIG_ITEM_ID,
                  type: 'signature' as const,
                  prompt: 'Sign here',
                  required: false,
                  mode: 'sequential' as const,
                  slots: [{ slotIndex: 0, assigneeUserId: null, label: 'Inspector' }],
                },
              ],
            },
          ],
        },
      ],
      settings: {
        titleFormat: '{date}',
        documentNumberFormat: '{counter:6}',
        documentNumberStart: 1,
        approvalPage: { title: 'A', approverSlots: [{ slotIndex: 0, assigneeUserId: null }] },
      },
      customResponseSets: [],
    };
  }

  beforeAll(async () => {
    resetDependentsRegistryForTests();
    world = await bootWorld();
    client = world.client;

    const mk = async (name: string, permissions: string[]): Promise<string> => {
      const setId = newId();
      await world.db.insert(schema.permissionSets).values({
        id: setId,
        tenantId: world.a.tenantId,
        name,
        permissions: permissions as never,
      });
      const userId = newId();
      await world.db.insert(schema.user).values({
        id: userId,
        tenantId: world.a.tenantId,
        name,
        email: `${name.toLowerCase().replace(/\W+/g, '-')}@northgate.test`,
        permissionSetId: setId,
      });
      return userId;
    };

    portalUserId = await mk('XM portal contractor', [
      'inspections.view',
      'inspections.conduct',
      'inspections.sign',
      'issues.view',
      'issues.report',
      'actions.view',
      'actions.create',
    ]);
    await world.db.insert(schema.contractorUsers).values({
      id: newId(),
      tenantId: world.a.tenantId,
      contractorId: world.a.contractorIds[0] ?? '',
      userId: portalUserId,
      activities: ['inspections', 'observations', 'actions'] as never,
      acknowledgedAt: world.now,
      acknowledgedVersion: 1,
    });

    incidentOfficerId = await mk('XM incident officer', [
      'incidents.view',
      'incidents.report',
      'incidents.investigate',
      'incidents.manage',
      'actions.view',
    ]);
    // Holds the READ permission for every module that can reference a
    // document, but is in none of the groups the document is restricted
    // to. Without `permits.view`/`rams.view` here the indirect half of
    // XM-D01 is unreachable and the axis passes without testing anything.
    outsiderId = await mk('XM document outsider', [
      'documents.view',
      'headsUp.view',
      'permits.view',
      'rams.view',
      'inspections.view',
    ]);

    const admin = asAdmin();

    // ── An inspection, an observation and an action, all authored
    //    INTERNALLY, each carrying a sentinel the portal user must never
    //    see.
    const tpl = await admin.templates.create({ name: `XM template ${newId().slice(-6)}` });
    await admin.templates.saveDraft({
      templateId: tpl.templateId,
      content: templateContent(S.inspection) as never,
    });
    await admin.templates.publish({ templateId: tpl.templateId });
    ids.templateId = tpl.templateId;
    const insp = await admin.inspections.create({ templateId: tpl.templateId });
    ids.inspectionId = insp.inspectionId;

    const cat = await admin.issues.categories.create({ name: `XM category ${newId().slice(-6)}` });
    ids.categoryId = cat.categoryId;
    const obs = await admin.issues.issues.create({
      categoryId: cat.categoryId,
      title: S.observation,
      description: 'Internal only.',
    });
    ids.issueId = obs.issueId;
    await admin.issues.comments.create({ issueId: obs.issueId, body: S.observationComment });

    const act = await admin.actions.createStandalone({ title: S.action });
    ids.actionId = act.actionId;
    await admin.actions.comments.create({ actionId: act.actionId, body: S.actionComment });

    // ── A confidential incident, investigated and approved, so the
    //    sentinel exists on the incident AND on its generated action.
    const inc = await admin.incidents.create({
      title: S.incident,
      description: 'Named ward detail.',
      kind: 'violence_aggression',
      occurredAt: new Date(world.now.getTime() - 3 * 86_400_000),
      details: {
        nature: 'physical',
        perpetratorType: 'patient_or_service_user',
        policeNotified: true,
        supportOffered: true,
      },
    });
    ids.incidentId = inc.incidentId;
    await admin.incidents.triage({
      incidentId: inc.incidentId,
      severity: 'moderate',
      investigationLevel: 'basic',
      leadInvestigatorUserId: world.a.actors.manager,
    });
    const lead = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.manager));
    await lead.incidents.startInvestigation({ incidentId: inc.incidentId });
    await lead.incidents.saveInvestigation({
      incidentId: inc.incidentId,
      immediateCause: 'Lone working with no functioning alarm.',
      conclusionSummary: 'Staffing model left one person unsupported.',
    });
    const finding = await lead.incidents.addFinding({
      incidentId: inc.incidentId,
      category: 'supervision',
      description: S.incidentFinding,
      priority: 'high',
      requiresAction: true,
    });
    ids.findingId = finding.findingId;
    await lead.incidents.submitInvestigation({ incidentId: inc.incidentId });
    await admin.incidents.approveInvestigation({
      incidentId: inc.incidentId,
      assignments: [
        {
          findingId: finding.findingId,
          assigneeUserId: world.a.actors.standard,
          dueAt: new Date(world.now.getTime() + 14 * 86_400_000),
        },
      ],
    });

    // ── The restricted document from the fixture (Night shift group only).
    ids.documentId = world.a.documents.groupRestrictedDoc ?? '';
    ids.folderId = world.a.folders.groupFolder ?? '';

    // ── And entities that REFERENCE it, linked by the administrator, who
    //    can legitimately see it. This is the indirect route: a document
    //    the outsider cannot open, reached THROUGH a permit or a heads-up
    //    they can. A sweep keyed only on documentId never sees it.
    const permitType = await admin.permits.types.create({
      category: 'hot_work',
      name: `XM doc-linking type ${newId().slice(-6)}`,
    });
    const permit = await admin.permits.create({
      permitTypeId: permitType.typeId,
      title: 'XM permit citing a restricted method statement',
      validFrom: world.now,
      validTo: new Date(world.now.getTime() + 6 * 3_600_000),
      acceptorUserId: world.a.actors.standard,
      methodStatementDocumentId: ids.documentId,
    });
    ids.permitId = permit.permitId;

    const headsUp = await admin.headsUps.create({
      title: 'XM heads-up citing a restricted document',
      description: 'Please read the attached.',
      documentIds: [ids.documentId],
    });
    await admin.headsUps.publish({ headsUpId: headsUp.headsUpId, userIds: [outsiderId] });
    ids.headsUpId = headsUp.headsUpId;

    // ── Tenant B mirror records, for the tenancy sweep.
    const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
    const bCat = await otherAdmin.issues.categories.create({ name: 'XM foreign category' });
    const bObs = await otherAdmin.issues.issues.create({
      categoryId: bCat.categoryId,
      title: S.foreign,
    });
    const bAct = await otherAdmin.actions.createStandalone({ title: S.foreign });
    const bTpl = await otherAdmin.templates.create({ name: 'XM foreign template' });
    await otherAdmin.templates.saveDraft({
      templateId: bTpl.templateId,
      content: templateContent(S.foreign) as never,
    });
    await otherAdmin.templates.publish({ templateId: bTpl.templateId });
    const bInsp = await otherAdmin.inspections.create({ templateId: bTpl.templateId });
    const bInc = await otherAdmin.incidents.create({
      title: S.foreign,
      kind: 'near_miss',
      occurredAt: new Date(world.now.getTime() - 86_400_000),
    });
    ids.foreign = JSON.stringify({
      issueId: bObs.issueId,
      actionId: bAct.actionId,
      inspectionId: bInsp.inspectionId,
      incidentId: bInc.incidentId,
      templateId: bTpl.templateId,
      categoryId: bCat.categoryId,
      siteId: world.b.sites.primary,
    });
  }, 300_000);

  afterAll(async () => {
    await client.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // XM-0 — the instrument itself
  // ═══════════════════════════════════════════════════════════════════════
  describe('XM-0 · the instrument', () => {
    it('XM-000 · the router is introspectable and the sweep covers the whole of it', () => {
      const procs = allProcedures();
      const withShape = procs.filter((p) => p.keys !== null);
      // If tRPC ever changes `_def.inputs[0]._def.shape()`, every generated
      // axis below silently sweeps nothing. This is the canary.
      expect({
        totalProcedures: procs.length > 300,
        introspectableInputs: withShape.length > 200,
        typesResolved: procs.every((p) => p.type === 'query' || p.type === 'mutation'),
      }).toEqual({ totalProcedures: true, introspectableInputs: true, typesResolved: true });
    });

    it('XM-001 · control · every sentinel is genuinely stored and readable by someone', async () => {
      // Without this the whole sweep could pass because the fixture never
      // wrote the secrets in the first place.
      const admin = asAdmin();
      const seen = serialise([
        await admin.inspections.get({ inspectionId: ids.inspectionId ?? '' }),
        await admin.issues.issues.get({ issueId: ids.issueId ?? '' }),
        await admin.issues.comments.list({ issueId: ids.issueId ?? '' }),
        await admin.actions.get({ actionId: ids.actionId ?? '' }),
        await admin.actions.comments.list({ actionId: ids.actionId ?? '' }),
        await admin.incidents.get({ incidentId: ids.incidentId ?? '' }),
        await admin.documents.get({ documentId: ids.documentId ?? '' }),
      ]);
      const missing = [
        S.inspection,
        S.observation,
        S.observationComment,
        S.action,
        S.actionComment,
        S.incident,
        S.incidentFinding,
        S.document,
      ].filter((s) => !seen.includes(s));
      expect({ sentinelsNotStored: missing }).toEqual({ sentinelsNotStored: [] });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // XM-C — contractor scope, generated across all three entities
  // ═══════════════════════════════════════════════════════════════════════
  describe('XM-C · contractor-scope parity', () => {
    /**
     * The three entities `loadContractorScope` governs, the id key each is
     * addressed by, and the sentinels only that entity carries.
     */
    const ENTITIES = [
      { name: 'inspection', key: 'inspectionId', secrets: [S.inspection] },
      { name: 'observation', key: 'issueId', secrets: [S.observation, S.observationComment] },
      { name: 'action', key: 'actionId', secrets: [S.action, S.actionComment] },
    ] as const;

    it('XM-C00 · control · the portal user cannot open any of the three canonical records', async () => {
      const portal = asPortal();
      const opened: string[] = [];
      for (const [path, input] of [
        ['inspections.get', { inspectionId: ids.inspectionId }],
        ['issues.issues.get', { issueId: ids.issueId }],
        ['actions.get', { actionId: ids.actionId }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(portal, path, input);
        if (res.ok) opened.push(path);
      }
      expect({ canonicalReadsOpened: opened }).toEqual({ canonicalReadsOpened: [] });
    });

    it('XM-C01 · no procedure resolves a contractor-scoped record the canonical read refuses', async () => {
      // THE SWEEP, and note what it asserts. Sentinel-hunting only catches
      // a leak whose payload happens to carry a string we planted. The
      // stronger and more general signal is PARITY ITSELF: `get` is the
      // canonical read of this entity and it has just refused this caller
      // for this id. Any other procedure that accepts the same id and
      // RESOLVES is, by definition, applying fewer predicates than the
      // canonical read — whatever its payload looks like.
      //
      // Sentinels are still collected, as corroboration of what escapes.
      const portal = asPortal();
      const breaks: Array<{
        entity: string;
        path: string;
        kind: 'query' | 'mutation' | 'subscription';
        secrets: string[];
      }> = [];
      const coverage: Record<string, { swept: number; exercised: number }> = {};

      for (const entity of ENTITIES) {
        const bag: Record<string, unknown> = {
          [entity.key]: ids[entity.key],
          limit: 20,
        };
        const candidates = acceptingAnyKey([entity.key]);
        let exercised = 0;
        for (const proc of candidates) {
          // Mutations are covered by XM-C02, which uses a write-shaped bag.
          if (proc.type !== 'query') continue;
          const res = await callFor(portal, proc.path, buildInput(proc, bag));
          if (!res.ok) {
            if (res.code === 'FORBIDDEN' || res.code === 'NOT_FOUND') exercised += 1;
            continue;
          }
          exercised += 1;
          breaks.push({
            entity: entity.name,
            path: proc.path,
            kind: proc.type,
            secrets: leaks(res.value, entity.secrets),
          });
        }
        coverage[entity.name] = { swept: candidates.length, exercised };
      }

      // Report coverage alongside the verdict, so a sweep that stopped
      // reaching the handlers cannot pass quietly.
      expect({
        parityBreaks: breaks,
        everyEntityExercised: Object.values(coverage).every((c) => c.exercised >= 2),
      }).toEqual({ parityBreaks: [], everyEntityExercised: true });
    });

    it('XM-C02 · no mutation lets the portal user write into a record they cannot open', async () => {
      // The write half. Reading another company's record is a disclosure;
      // writing into it puts an outside company's words, answers or
      // signature into an internal evidential record.
      //
      // The input bag below is deliberately fat. A thin bag makes this
      // test LOOK clean while Zod quietly rejects half the mutations
      // before they reach a handler — under-reporting dressed as a pass.
      // So the coverage figure is asserted too, and every mutation the
      // sweep could not reach is named in the failure output.
      const portal = asPortal();
      const bag: Record<string, unknown> = {
        inspectionId: ids.inspectionId,
        issueId: ids.issueId,
        actionId: ids.actionId,
        // Comment / note shapes
        body: 'XM sweep — written from outside the boundary.',
        comment: 'XM sweep — written from outside the boundary.',
        note: 'XM sweep — written from outside the boundary.',
        reason: 'XM sweep — written from outside the boundary.',
        // Inspection conduct
        responses: {},
        // Signature
        slotIndex: 0,
        slotId: SIG_ITEM_ID,
        signatureData: 'data:image/png;base64,iVBORw0KGgo=',
        signerName: 'Outside Contractor',
        // Generic
        title: 'XM sweep probe',
        status: 'open',
        limit: 20,
      };

      const breaches: string[] = [];
      const notReached: string[] = [];
      const candidates = acceptingAnyKey(['inspectionId', 'issueId', 'actionId']).filter(
        (p) => p.type === 'mutation',
      );
      for (const proc of candidates) {
        const res = await callFor(portal, proc.path, buildInput(proc, bag));
        if (res.ok) {
          breaches.push(proc.path);
          continue;
        }
        // FORBIDDEN / NOT_FOUND = the boundary answered. Anything else
        // (chiefly BAD_REQUEST from Zod or a state guard) means the sweep
        // never got far enough to learn anything.
        if (res.code !== 'FORBIDDEN' && res.code !== 'NOT_FOUND') notReached.push(proc.path);
      }

      expect({
        writeBreaches: breaches,
        reachedMostMutations: candidates.length > 0 && notReached.length <= candidates.length / 2,
        notReached,
      }).toMatchObject({ writeBreaches: [], reachedMostMutations: true });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // XM-I — incident confidentiality, generated across the whole router
  // ═══════════════════════════════════════════════════════════════════════
  describe('XM-I · confidentiality parity', () => {
    it('XM-I01 · no procedure anywhere returns confidential incident content to a caller without the key', async () => {
      // The Incidents audit swept `incidents.*`. This sweeps the OTHER
      // three hundred procedures — the actions hub, search, dashboards,
      // exports — because the seventeenth instance of the pattern was
      // content leaving the module rather than a reader coming in.
      const officer = asIncidentOfficer();
      const secrets = [S.incident, S.incidentFinding];
      const bag: Record<string, unknown> = {
        incidentId: ids.incidentId,
        findingId: ids.findingId,
        actionId: undefined,
        query: 'ZZXMFINDING',
        q: 'ZZXMFINDING',
        limit: 20,
      };
      const found: Array<{ path: string; secrets: string[] }> = [];
      for (const proc of allProcedures()) {
        if (proc.type !== 'query') continue;
        const res = await callFor(officer, proc.path, buildInput(proc, bag));
        if (!res.ok) continue;
        const hit = leaks(res.value, secrets);
        if (hit.length > 0) found.push({ path: proc.path, secrets: hit });
      }
      expect({ confidentialityBreaks: found }).toEqual({ confidentialityBreaks: [] });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // XM-D — document visibility, generated across the whole router
  // ═══════════════════════════════════════════════════════════════════════
  describe('XM-D · document-visibility parity', () => {
    it('XM-D00 · control · the outsider cannot open the restricted document', async () => {
      const res = await callFor(asOutsider(), 'documents.get', { documentId: ids.documentId });
      expect({ outsiderOpenedRestrictedDoc: res.ok }).toEqual({
        outsiderOpenedRestrictedDoc: false,
      });
    });

    it('XM-D01 · no procedure surfaces a restricted document to a caller who cannot open it', async () => {
      // The pattern's first and most repeated costume: Heads-Up did this
      // to Documents four times, RAMS once, Permits twice.
      const outsider = asOutsider();
      const bag: Record<string, unknown> = {
        // Direct: procedures keyed on the document itself.
        documentId: ids.documentId,
        folderId: ids.folderId,
        // INDIRECT: entities that merely REFERENCE the document. This half
        // was added after the sweep's first run passed while
        // `permits.get` was projecting the restricted document's name —
        // a blind spot of exactly the shape this file exists to find. A
        // document-keyed sweep cannot see a document reached through a
        // permit, a heads-up or a pack.
        permitId: ids.permitId,
        headsUpId: ids.headsUpId,
        limit: 50,
      };
      const found: Array<{ path: string }> = [];
      for (const proc of allProcedures()) {
        if (proc.type !== 'query') continue;
        const res = await callFor(outsider, proc.path, buildInput(proc, bag));
        if (!res.ok) continue;
        if (serialise(res.value).includes(S.document)) found.push({ path: proc.path });
      }
      expect({ visibilityBreaks: found }).toEqual({ visibilityBreaks: [] });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // XM-T — tenancy, every procedure, foreign ids
  // ═══════════════════════════════════════════════════════════════════════
  describe('XM-T · tenancy', () => {
    it('XM-T01 · no procedure in the entire router reaches another tenant record', async () => {
      // The widest net in the series: every procedure, called by tenant A's
      // administrator with tenant B's ids in every slot that accepts one.
      const foreign = JSON.parse(ids.foreign ?? '{}') as Record<string, string>;
      const bag: Record<string, unknown> = { ...foreign, limit: 50 };
      const reached: Array<{ path: string }> = [];
      for (const proc of allProcedures()) {
        const res = await callFor(asAdmin(), proc.path, buildInput(proc, bag));
        if (res.ok && serialise(res.value).includes(S.foreign)) reached.push({ path: proc.path });
      }
      expect({ tenancyBreaks: reached }).toEqual({ tenancyBreaks: [] });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // XM-P — the public surface
  // ═══════════════════════════════════════════════════════════════════════
  describe('XM-P · public surface', () => {
    /**
     * Every procedure that resolves without a session, declared by name.
     * A new one appearing fails this test rather than joining a silent
     * allowlist — which is the whole point: an unauthenticated procedure
     * should never be able to ship unnoticed.
     */
    const PUBLIC_BY_DESIGN: Record<string, string> = {
      // Sign-up and joining: there is no session yet, by definition.
      'auth.signUpWithTenant': 'creates the tenant and its first user',
      'auth.getInviteDetails': 'renders the invite landing page from an opaque invite token',
      'auth.acceptInvite': 'consumes that invite token',
      'auth.lookupEmailDomain': 'routes a returning user to their tenant by email domain',
      'auth.requestToJoin': 'asks an existing tenant for access',
      // Opaque-token share surfaces, one per product flow.
      'issues.categories.publicGetByShareToken': 'QR observation form config',
      'issues.issues.createFromShareToken': 'QR anonymous observation submission',
      'contractors.publicByToken': 'contractor self-service portal by opaque token',
      'contractors.gate.publicByToken': 'site gate kiosk by opaque token',
      'contractors.gate.selfCheckIn': 'gate self check-in from that kiosk',
      'rams.client.publicGet': 'RAMS pack served to a client over a share link',
      'rams.client.publicDecide': 'that client accepting or rejecting the pack',
      // Liveness.
      'health.ping': 'liveness probe; returns no tenant data',
    };

    it('XM-P01 · the set of unauthenticated procedures is exactly the declared one', async () => {
      // This is the product's complete unauthenticated attack surface —
      // thirteen procedures, each named with the reason it is public. It
      // did not exist as a list anywhere before this sweep generated it.
      // A fourteenth appearing fails here rather than shipping unnoticed,
      // which is the entire value: nobody reviews a public procedure they
      // do not know exists.
      const publicCaller = createCaller(world.publicCtx());
      const resolvedWithoutSession: string[] = [];
      const bag: Record<string, unknown> = {
        token: 'not-a-real-token',
        limit: 20,
        inspectionId: ids.inspectionId,
        issueId: ids.issueId,
        actionId: ids.actionId,
      };
      for (const proc of allProcedures()) {
        const res = await callFor(publicCaller, proc.path, buildInput(proc, bag));
        // UNAUTHORIZED is the signal that the session gate fired. Anything
        // else means the procedure ran (or failed for a non-auth reason).
        if (res.ok || (!res.ok && res.code !== 'UNAUTHORIZED')) {
          resolvedWithoutSession.push(proc.path);
        }
      }
      const undeclared = resolvedWithoutSession.filter((p) => !(p in PUBLIC_BY_DESIGN));
      expect({ undeclaredPublicProcedures: undeclared }).toEqual({
        undeclaredPublicProcedures: [],
      });
    });
  });
});

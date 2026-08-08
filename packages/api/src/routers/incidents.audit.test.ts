/**
 * Incidents & Investigations module — the audit suite (FreeHS).
 *
 * The eleventh module through the testing runbook, and the one carrying
 * the product's only special-category data. Two incident kinds —
 * `sharps_exposure` and `violence_aggression` — default to confidential at
 * creation, and the module's contract is unusually strong:
 *
 * > confidential records are **counted, not readable** — enforced on every
 * > read, including search, AI and CSV.
 *
 * That is a claim about *every* read path, and `incidents.ts` backs it with
 * 36 call sites of `assertDetailAccess` / `canViewConfidential` across 38
 * procedures. `incidents.test.ts` already checks a sample of them (IN-E14).
 *
 * A sample is the wrong instrument for a claim of that shape. This suite
 * makes the confidentiality axis **generated**: it stamps a unique sentinel
 * into a confidential incident's title, description and investigation
 * findings, then calls every `incidents.*` procedure as a caller with no
 * confidential access and greps every response for the sentinel. A read
 * path added next month is covered the day it lands, and one that forgets
 * the gate cannot hide behind a passing sample.
 *
 * The same sentinel is then chased OUT of the module — into the actions
 * hub and global search, which read incident-derived rows and apply their
 * own rules rather than this module's. Ten audits have found that mistake
 * sixteen times; the difference here is what leaks.
 *
 * Five axes: IN-P (permissions), IN-C (confidentiality — the generated
 * sweep), IN-D (separation of duties), IN-X (cross-module), IN-T
 * (tenancy).
 *
 * Deliberately not re-run: the RIDDOR deadline engine, the lifecycle state
 * machine, finding→action idempotency and reference numbering are covered
 * by IN-E10..E20 and IN-A2..A8 in `incidents.test.ts`.
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
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';
import { bootWorld, type World } from './__fixtures__/world';

const createCaller = createCallerFactory(appRouter);
type Caller = ReturnType<typeof createCaller>;

/**
 * Strings that must never reach a caller without confidential access. Each
 * is unique enough that a substring match over a serialised response is a
 * reliable leak detector.
 */
const SECRET_TITLE = 'ZZSENTINELTITLE-assault-in-bay-4';
const SECRET_DESCRIPTION = 'ZZSENTINELDESC-named-patient-and-ward-detail';
const SECRET_FINDING = 'ZZSENTINELFINDING-lone-working-after-2200-no-panic-alarm';

function incidentProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter((k) => k.startsWith('incidents.'))
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

/** Serialise anything (incl. Dates) so a sentinel substring search is total. */
function serialise(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_k, v: unknown) => (v instanceof Date ? v.toISOString() : v)) ?? ''
    );
  } catch {
    return String(value);
  }
}

function leakedSecrets(payload: unknown): string[] {
  const text = serialise(payload);
  return [SECRET_TITLE, SECRET_DESCRIPTION, SECRET_FINDING].filter((s) => text.includes(s));
}

describe('incidents — audit suite', () => {
  let world: World;
  let client: PGlite;
  /** Every incidents key EXCEPT `incidents.confidential.view`, + actions.view. */
  let officerId: string;
  /** `incidents.report` only — reports incidents, reads nothing else. */
  let reporterId: string;
  /** Holds `incidents.confidential.view` — the occupational-health reader. */
  let ohNurseId: string;
  /** `actions.view` and nothing from incidents at all — the maintenance lead. */
  let actionOnlyId: string;

  /** The confidential (violence & aggression) incident, investigated and approved. */
  let secretIncidentId: string;
  let secretFindingId: string;

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  const asOfficer = () => createCaller(world.ctxFor(world.a.tenantId, officerId));
  const asReporter = () => createCaller(world.ctxFor(world.a.tenantId, reporterId));
  const asOhNurse = () => createCaller(world.ctxFor(world.a.tenantId, ohNurseId));
  const asActionOnly = () => createCaller(world.ctxFor(world.a.tenantId, actionOnlyId));

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

    // The critical actor: a full safety officer who can do everything with
    // incidents EXCEPT read confidential ones. If the gate is real, the
    // sentinel is invisible to this caller everywhere.
    officerId = await mk('Incident officer', [
      'incidents.view',
      'incidents.report',
      'incidents.investigate',
      'incidents.manage',
      'actions.view',
    ]);
    reporterId = await mk('Incident reporter', ['incidents.report']);
    ohNurseId = await mk('OH nurse', ['incidents.view', 'incidents.confidential.view']);
    actionOnlyId = await mk('Maintenance lead', ['actions.view']);

    // ── Build the confidential incident, all the way to an approved
    //    investigation carrying a finding, so the sentinel exists on the
    //    incident row, its details AND its generated action.
    const admin = asAdmin();
    const { incidentId } = await admin.incidents.create({
      title: SECRET_TITLE,
      description: SECRET_DESCRIPTION,
      kind: 'violence_aggression',
      occurredAt: new Date(world.now.getTime() - 3 * 86_400_000),
      locationText: 'Bay 4',
      details: {
        nature: 'physical',
        perpetratorType: 'patient_or_service_user',
        policeNotified: true,
        supportOffered: true,
      },
    });
    secretIncidentId = incidentId;

    await admin.incidents.triage({
      incidentId,
      severity: 'moderate',
      investigationLevel: 'basic',
      leadInvestigatorUserId: world.a.actors.manager,
    });
    const lead = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.manager));
    await lead.incidents.startInvestigation({ incidentId });
    await lead.incidents.saveInvestigation({
      incidentId,
      immediateCause: 'Lone working on the late shift with no functioning panic alarm.',
      conclusionSummary: 'Staffing model left one nurse unsupported after 22:00.',
    });
    const { findingId } = await lead.incidents.addFinding({
      incidentId,
      category: 'supervision',
      description: SECRET_FINDING,
      priority: 'high',
      requiresAction: true,
    });
    secretFindingId = findingId;
    await lead.incidents.submitInvestigation({ incidentId });
    await admin.incidents.approveInvestigation({
      incidentId,
      assignments: [
        {
          findingId,
          assigneeUserId: actionOnlyId,
          dueAt: new Date(world.now.getTime() + 14 * 86_400_000),
        },
      ],
    });
  }, 240_000);

  afterAll(async () => {
    await client.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // IN-P — permissions
  // ═══════════════════════════════════════════════════════════════════════
  describe('IN-P · permissions', () => {
    it('IN-P00 · the matrix covers every incidents procedure the router exposes', () => {
      const procs = incidentProcedures();
      expect(procs.length).toBeGreaterThanOrEqual(30);
      expect(procs).toContain('incidents.approveInvestigation');
      expect(procs).toContain('incidents.exportCsv');
    });

    it('IN-P01 · every procedure refuses a user holding no incidents key', async () => {
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.nobody));
      const leaked: Array<{ path: string; outcome: string }> = [];
      for (const path of incidentProcedures()) {
        const res = await callFor(caller, path, undefined);
        if (res.ok) leaked.push({ path, outcome: 'RESOLVED without permission' });
        else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }
      expect(leaked).toEqual([]);
    });

    it('IN-P02 · incidents.report files an incident and reads nothing back', async () => {
      // The shop-floor key. Anyone can report; almost nobody should be able
      // to browse the register, because the register is a list of other
      // people's injuries.
      const reporter = asReporter();
      const filed = await callFor(reporter, 'incidents.create', {
        title: 'Trip on trailing cable',
        kind: 'near_miss',
        occurredAt: new Date(world.now.getTime() - 3_600_000),
      });
      expect({ filed: filed.ok }).toEqual({ filed: true });

      for (const path of ['incidents.list', 'incidents.overview', 'incidents.exportCsv']) {
        const res = await callFor(reporter, path, {});
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // IN-C — confidentiality, generated over every read path
  // ═══════════════════════════════════════════════════════════════════════
  describe('IN-C · confidentiality', () => {
    it('IN-C00 · control · the sentinel really is stored and readable by an authorised caller', async () => {
      // Without this the whole sweep could pass because the fixture never
      // wrote the secret in the first place.
      const seen = await asOhNurse().incidents.get({ incidentId: secretIncidentId });
      const found = leakedSecrets(seen);
      expect({
        confidentialByDefault: seen.incident.confidential,
        authorisedReaderSeesTitle: found.includes(SECRET_TITLE),
        authorisedReaderSeesDescription: found.includes(SECRET_DESCRIPTION),
      }).toEqual({
        confidentialByDefault: true,
        authorisedReaderSeesTitle: true,
        authorisedReaderSeesDescription: true,
      });
    });

    it('IN-C01 · no incidents procedure returns confidential content to a caller without the key', async () => {
      // The generated sweep. Every `incidents.*` procedure is called by a
      // caller holding view + report + investigate + manage — everything
      // except `incidents.confidential.view` — against the confidential
      // incident, and every response is searched for the sentinels.
      //
      // A mutation that refuses on a state guard cannot leak, so those are
      // not findings. But "it refused, therefore it is safe" is exactly how
      // a sweep rots into a test that proves nothing, so READ_PATHS below
      // names the query procedures that MUST be genuinely exercised — each
      // has to either resolve cleanly or refuse with `confidential`. A read
      // path that merely rejects the probe input is a coverage hole and
      // fails this test rather than passing it quietly.
      const READ_PATHS = [
        'incidents.list',
        'incidents.get',
        'incidents.overview',
        'incidents.exportCsv',
        'incidents.renderPdf',
        'incidents.reviewPromptCandidates',
      ];

      const officer = asOfficer();
      const leaks: Array<{ path: string; secrets: string[] }> = [];
      const exercised = new Set<string>();

      for (const path of incidentProcedures()) {
        const res = await callFor(officer, path, {
          incidentId: secretIncidentId,
          findingId: secretFindingId,
        });
        if (!res.ok) {
          if (res.code === 'FORBIDDEN') exercised.add(path);
          continue;
        }
        exercised.add(path);
        const secrets = leakedSecrets(res.value);
        if (secrets.length > 0) leaks.push({ path, secrets });
      }

      expect({
        leaks,
        readPathsNotExercised: READ_PATHS.filter((p) => !exercised.has(p)),
      }).toEqual({ leaks: [], readPathsNotExercised: [] });
    });

    it('IN-C02 · the register counts the incident without naming it', async () => {
      const rows = await asOfficer().incidents.list({});
      const row = rows.find((r) => r.id === secretIncidentId);
      expect({
        present: row !== undefined,
        restricted: row?.restricted,
        title: row?.title,
      }).toEqual({ present: true, restricted: true, title: null });
    });

    it('IN-C03 · the CSV export redacts the title rather than omitting the row', async () => {
      const { csv } = await asOfficer().incidents.exportCsv({});
      expect({
        containsSecret: csv.includes(SECRET_TITLE),
        containsRedaction: csv.includes('Confidential'),
      }).toEqual({ containsSecret: false, containsRedaction: true });
    });

    it('IN-C04 · global search does not surface a confidential incident', async () => {
      const results = await asOfficer().search.global({ query: 'ZZSENTINELTITLE' });
      expect(leakedSecrets(results)).toEqual([]);
    });

    it('IN-C05 · the reporter and the lead investigator keep access to their own case', async () => {
      // The gate has to be a gate, not a wall. If the two people who
      // actually handle the case are locked out, the confidential kinds
      // become unusable and somebody files them as `injury` instead —
      // which is how a confidentiality feature makes things worse.
      const lead = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.manager));
      const seen = await lead.incidents.get({ incidentId: secretIncidentId });
      expect({ leadInvestigatorCanRead: leakedSecrets(seen).includes(SECRET_TITLE) }).toEqual({
        leadInvestigatorCanRead: true,
      });
    });

    it('IN-C06 · a finding from a confidential incident does not become a readable action title', async () => {
      // `approveInvestigation` builds the action as
      //   `Incident finding: ${finding.description.slice(0, 200)}`
      // and the finding IS the sensitive content — on a violence or sharps
      // case it names the ward, the shift, sometimes the person.
      //
      // The action's *description* was written carefully: it cites
      // `incident.referenceNumber`, not the title. The actions hub was
      // written carefully too — it blanks the source card's title for a
      // confidential incident, with a comment saying so. The action's own
      // title was not, and it is the field every one of those surfaces
      // shows first.
      //
      // The assignee here holds `actions.view` and NOTHING from incidents.
      const { rows } = await asActionOnly().actions.list({});
      const leaked = rows.filter((a) => serialise(a).includes(SECRET_FINDING));
      expect({ actionsLeakingTheFinding: leaked.length }).toEqual({
        actionsLeakingTheFinding: 0,
      });
    });

    it('IN-C07 · that finding is not full-text searchable through the actions index either', async () => {
      // `search.global` matches `actions.title` for any `actions.view`
      // holder with no confidentiality consideration at all. So the
      // sentence the incidents module refuses to put in its own search
      // results is reachable from Cmd-K by typing it.
      const results = await asActionOnly().search.global({ query: 'ZZSENTINELFINDING' });
      expect(leakedSecrets(results)).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // IN-D — separation of duties
  // ═══════════════════════════════════════════════════════════════════════
  describe('IN-D · separation of duties', () => {
    /** A fresh non-confidential incident with a submitted investigation. */
    async function makeSubmitted(leadUserId: string): Promise<string> {
      const admin = asAdmin();
      const { incidentId } = await admin.incidents.create({
        title: `Guard removed from bench saw ${newId().slice(-6)}`,
        description: 'Fixed guard found removed during a walk-round.',
        kind: 'near_miss',
        occurredAt: new Date(world.now.getTime() - 86_400_000),
      });
      await admin.incidents.triage({
        incidentId,
        severity: 'moderate',
        investigationLevel: 'basic',
        leadInvestigatorUserId: leadUserId,
      });
      const lead = createCaller(world.ctxFor(world.a.tenantId, leadUserId));
      await lead.incidents.startInvestigation({ incidentId });
      await lead.incidents.saveInvestigation({
        incidentId,
        immediateCause: 'Fixed guard was removed to clear a jam and not refitted.',
        conclusionSummary: 'Guard removal was routine and unchallenged on this bench.',
      });
      await lead.incidents.addFinding({
        incidentId,
        category: 'supervision',
        description: 'Guard removal was not challenged at the time.',
        priority: 'medium',
        requiresAction: false,
      });
      await lead.incidents.submitInvestigation({ incidentId });
      return incidentId;
    }

    it('IN-D01 · the lead investigator cannot approve their own investigation', async () => {
      // The single most important rule in the module. An investigation
      // signed off by the person who wrote it is not an investigation, it
      // is a statement — and the whole evidential value of the record is
      // that somebody independent accepted it.
      const incidentId = await makeSubmitted(officerId);
      const res = await callFor(asOfficer(), 'incidents.approveInvestigation', {
        incidentId,
        assignments: [],
      });
      expect({ leadApprovedOwnWork: res.ok }).toEqual({ leadApprovedOwnWork: false });

      const independent = await callFor(asAdmin(), 'incidents.approveInvestigation', {
        incidentId,
        assignments: [],
      });
      expect({ independentApproverAccepted: independent.ok }).toEqual({
        independentApproverAccepted: true,
      });
    });

    it('IN-D02 · an approved investigation is frozen, and is not reopenable before closure', async () => {
      const incidentId = await makeSubmitted(officerId);
      await asAdmin().incidents.approveInvestigation({ incidentId, assignments: [] });

      const frozen = await callFor(asOfficer(), 'incidents.addFinding', {
        incidentId,
        category: 'procedure',
        description: 'Slipped in after approval.',
      });
      expect({ editedApprovedRecord: frozen.ok }).toEqual({ editedApprovedRecord: false });

      // Reopening is reserved for a CLOSED incident — an approved
      // investigation with actions still outstanding is not reopenable,
      // because the way back in at that point is to finish the actions.
      const early = await callFor(asAdmin(), 'incidents.reopen', {
        incidentId,
        reason: 'New witness came forward.',
      });
      expect({ reopenedBeforeClosure: early.ok }).toEqual({ reopenedBeforeClosure: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // IN-X — cross-module
  // ═══════════════════════════════════════════════════════════════════════
  describe('IN-X · cross-module', () => {
    it('IN-X01 · an incident-generated action carries the incident as its source', async () => {
      // The link the actions hub relies on. Without it the action is an
      // orphan and the incident cannot show what it caused.
      const rows = await world.db
        .select({
          sourceType: schema.actions.sourceType,
          sourceId: schema.actions.sourceId,
          sourceItemId: schema.actions.sourceItemId,
        })
        .from(schema.actions)
        .where(
          and(
            eq(schema.actions.sourceType, 'incident'),
            eq(schema.actions.sourceId, secretIncidentId),
          ),
        );
      expect(rows).toEqual([
        {
          sourceType: 'incident',
          sourceId: secretIncidentId,
          sourceItemId: secretFindingId,
        },
      ]);
    });

    it('IN-X02 · the actions hub blanks the source card of a confidential incident', async () => {
      // The half that was done right — kept as a passing regression guard
      // so a later refactor cannot quietly undo it.
      const rows = await world.db
        .select({ id: schema.actions.id })
        .from(schema.actions)
        .where(
          and(
            eq(schema.actions.sourceType, 'incident'),
            eq(schema.actions.sourceId, secretIncidentId),
          ),
        );
      const actionId = rows[0]?.id ?? '';
      const got = await asActionOnly().actions.get({ actionId });
      expect({ sourceTitle: got.source?.title, sourceType: got.source?.type }).toEqual({
        sourceTitle: null,
        sourceType: 'incident',
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // IN-T — tenancy
  // ═══════════════════════════════════════════════════════════════════════
  describe('IN-T · tenancy', () => {
    it('IN-T01 · no incidents procedure reaches another tenant incident', async () => {
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const { incidentId: foreignId } = await otherAdmin.incidents.create({
        title: 'ZZFOREIGNINCIDENT-do-not-disclose',
        description: 'Another tenant business.',
        kind: 'injury',
        occurredAt: new Date(world.now.getTime() - 86_400_000),
        persons: [],
      });

      const reached: string[] = [];
      for (const path of incidentProcedures()) {
        const res = await callFor(asAdmin(), path, { incidentId: foreignId });
        if (res.ok && serialise(res.value).includes('ZZFOREIGNINCIDENT')) reached.push(path);
      }
      expect(reached).toEqual([]);

      const [row] = await world.db
        .select({ title: schema.incidents.title, status: schema.incidents.status })
        .from(schema.incidents)
        .where(eq(schema.incidents.id, foreignId));
      expect({ title: row?.title, status: row?.status }).toEqual({
        title: 'ZZFOREIGNINCIDENT-do-not-disclose',
        status: 'reported',
      });
    });

    it('IN-T02 · an incident cannot be sited at, or name a person from, another tenant', async () => {
      const sited = await callFor(asAdmin(), 'incidents.create', {
        title: 'Cross-tenant siting probe',
        kind: 'near_miss',
        occurredAt: new Date(world.now.getTime() - 3_600_000),
        siteId: world.b.sites.primary,
      });
      expect({ sitedAtForeignSite: sited.ok }).toEqual({ sitedAtForeignSite: false });

      const named = await callFor(asAdmin(), 'incidents.create', {
        title: 'Cross-tenant person probe',
        kind: 'injury',
        occurredAt: new Date(world.now.getTime() - 3_600_000),
        persons: [
          { userId: world.b.actors.standard, name: 'Foreign person', category: 'employee' },
        ],
      });
      expect({ namedForeignPerson: named.ok }).toEqual({ namedForeignPerson: false });
    });
  });
});

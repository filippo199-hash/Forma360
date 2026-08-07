/**
 * Contractors module — the audit suite (FreeHS).
 *
 * The first module put through the runbook agreed in
 * `docs/reviews/` round-table: instead of another prose review, the module
 * is exercised against a seeded world (two tenants, 200 users, 120
 * contractors, narrow custom permission sets, planted boundary cases) and the
 * findings are *tests*, not paragraphs. A document does not hold a fix in
 * place; a failing test does.
 *
 * Four axes, and the first is the one that generalises:
 *
 *   1. **CT-P — the generated permission matrix.** Every `contractors.*`
 *      procedure is enumerated from the router at runtime and called by a
 *      user who holds no contractors key. Every one must refuse. This is not
 *      a hand-written list, so it cannot drift: a procedure added tomorrow is
 *      in the matrix tomorrow, and the only way to exempt one is to declare
 *      it public here, in the open, with a reason.
 *
 *   2. **CT-T — tenancy.** Ground rule 4. Tenant B is a near-mirror of tenant
 *      A, so a missing tenant predicate surfaces as another tenant's rows
 *      rather than as an empty result.
 *
 *   3. **CT-C / CT-G — the boundaries.** Compliance derivation and the
 *      unauthenticated gate: expiry on the last day of cover, pending and
 *      rejected paperwork, manual overrides, double check-in, cross-site
 *      admission.
 *
 *   4. **CT-V — volume.** 120 contractors and 200 users, which is above every
 *      default `limit: 50` in the codebase — the threshold at which
 *      truncation and unbounded-list defects become observable.
 *
 * Tests that assert a defect *currently present* are marked `[BUG]` in their
 * title and written to describe correct behaviour, so they fail until the
 * behaviour is right. That is deliberate: this file is the acceptance
 * criteria for the fix pass.
 */
import type { PGlite } from '@electric-sql/pglite';
import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';
import { bootWorld, VOLUME_CONTRACTORS, type World } from './__fixtures__/world';

const createCaller = createCallerFactory(appRouter);
type Caller = ReturnType<typeof createCaller>;

/**
 * Procedures that are unauthenticated **by design**, with the reason. Adding
 * to this list is the only way to exempt something from CT-P01, which makes
 * widening the public surface a visible, reviewable act.
 */
const DECLARED_PUBLIC: Record<string, string> = {
  'contractors.publicByToken':
    'contractor document upload portal — no login, opaque per-contractor token',
  'contractors.gate.publicByToken': 'gate kiosk listing — no login, opaque per-tenant token',
  'contractors.gate.selfCheckIn': 'gate kiosk self check-in — no login, opaque per-tenant token',
};

/**
 * Procedures deliberately available to any authenticated member of the
 * tenant because they are scoped to the caller themselves.
 */
const DECLARED_SELF_SCOPED: Record<string, string> = {
  'contractors.users.me': "the caller's own contractor-user record",
  'contractors.users.acknowledge': 'the caller acknowledging their own induction',
  'contractors.induction.get': 'the induction text the caller must read',
};

function contractorProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter((k) => k.startsWith('contractors.'))
    .sort();
}

/** Resolve a dotted procedure path on a caller into something callable. */
function resolve(caller: Caller, path: string): (input?: unknown) => Promise<unknown> {
  const fn = path
    .split('.')
    .reduce<Record<string, unknown>>(
      (acc, part) => acc[part] as Record<string, unknown>,
      caller as unknown as Record<string, unknown>,
    );
  return fn as unknown as (input?: unknown) => Promise<unknown>;
}

async function callFor(
  caller: Caller,
  path: string,
  input?: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; code: string; message: string }> {
  try {
    const value = await resolve(caller, path)(input);
    return { ok: true, value };
  } catch (err) {
    const code = err instanceof TRPCError ? err.code : 'NON_TRPC_ERROR';
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, code, message };
  }
}

describe('contractors — audit suite', () => {
  let world: World;
  let client: PGlite;

  beforeAll(async () => {
    resetDependentsRegistryForTests();
    world = await bootWorld();
    client = world.client;
  }, 180_000);

  afterAll(async () => {
    await client.close();
  });

  const asAdminA = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  const asPublic = () => createCaller(world.publicCtx());

  // ═══════════════════════════════════════════════════════════════════════
  // CT-P — the generated permission matrix
  // ═══════════════════════════════════════════════════════════════════════
  describe('CT-P · permissions', () => {
    it('CT-P00 · the matrix covers every contractors procedure the router exposes', () => {
      const procs = contractorProcedures();
      // A canary: if the module grows and nobody updates this file, the
      // count changes and the reviewer is told rather than the coverage
      // silently thinning.
      expect(procs.length).toBeGreaterThanOrEqual(52);
      for (const key of Object.keys(DECLARED_PUBLIC)) expect(procs).toContain(key);
      for (const key of Object.keys(DECLARED_SELF_SCOPED)) expect(procs).toContain(key);
    });

    it('CT-P01 · every non-public procedure refuses a user holding no contractors key', async () => {
      // The seeded Standard set contains no `contractors.*` key at all, so
      // this is the "ordinary employee" case, and it is the direction nobody
      // tests: over-permission is silent, under-permission gets reported by
      // the user within a day.
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.standard));
      const leaked: Array<{ path: string; outcome: string }> = [];

      for (const path of contractorProcedures()) {
        if (path in DECLARED_PUBLIC || path in DECLARED_SELF_SCOPED) continue;
        const res = await callFor(caller, path, undefined);
        if (res.ok) {
          leaked.push({ path, outcome: 'RESOLVED without permission' });
        } else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          // A Zod failure here would mean input parsing ran before the
          // permission check — not a hole, but it means the gate is not
          // being reached and the assertion is not proving what it claims.
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }

      expect(leaked).toEqual([]);
    });

    it('CT-P02 · a read-only viewer cannot perform any contractors mutation', async () => {
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.viewer));
      const contractorId = world.a.contractorIds[0] as string;

      const mutations: Array<[string, unknown]> = [
        ['contractors.create', { name: 'Should Not Exist Ltd' }],
        ['contractors.update', { id: contractorId, name: 'Renamed' }],
        ['contractors.archive', { id: contractorId }],
        [
          'contractors.setComplianceOverride',
          { id: contractorId, override: 'compliant', reason: 'nope' },
        ],
        ['contractors.regenerateUploadLink', { id: contractorId }],
        ['contractors.gate.regenerateToken', undefined],
      ];

      for (const [path, input] of mutations) {
        const res = await callFor(caller, path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
        if (!res.ok) expect({ path, code: res.code }).toEqual({ path, code: 'FORBIDDEN' });
      }
    });

    it('CT-P03 · [BUG] a gate operator can actually work the gate', async () => {
      // `contractors.gate` is a real key in the catalogue. It is used in two
      // places — to show the Gate nav entry (nav-model.ts) and to choose
      // overstay-alert recipients (contractor-overstay.ts) — and it gates NO
      // procedure. So a receptionist granted exactly the gate key is shown a
      // door that does not open: check-in and check-out both demand
      // `contractors.manage`, which also grants renaming contractors,
      // deleting visits and regenerating the kiosk token.
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.gateOperator));
      const visitId = world.a.visits.scheduledToday as string;

      const res = await callFor(caller, 'contractors.visits.checkIn', { id: visitId });
      expect({ checkInAllowed: res.ok }).toEqual({ checkInAllowed: true });
    });

    it('CT-P04 · a gate operator still cannot edit commercial records', async () => {
      // The other half of CT-P03: separating the key must not hand the
      // receptionist the contractor directory.
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.gateOperator));
      const contractorId = world.a.contractorIds[0] as string;
      const res = await callFor(caller, 'contractors.update', {
        id: contractorId,
        name: 'Receptionist Was Here Ltd',
      });
      expect(res.ok).toBe(false);
    });

    it('CT-P05 · a document verifier can verify but cannot rewrite the requirement set', async () => {
      // Builds its own contractor rather than borrowing a planted one: the
      // fixture is shared across the whole file and read-mostly, so a test
      // that verifies a planted pending document would silently change what
      // CT-C05 is asserting about.
      const admin = asAdminA();
      const { id: contractorId } = await admin.contractors.create({
        name: 'Probe — Verifier Scope Ltd',
      });
      const { id: requirementId } = await admin.contractors.addRequirement({
        contractorId,
        name: 'Public Liability Insurance',
      });
      const { id: documentId } = await admin.contractors.addDocument({
        requirementId,
        storageKey: `${world.a.tenantId}/contractors/${contractorId}/pli.pdf`,
        filename: 'pli.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        startDate: new Date(world.now.getTime() - 86_400_000).toISOString().slice(0, 10),
        endDate: new Date(world.now.getTime() + 86_400_000 * 90).toISOString().slice(0, 10),
      });

      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.docVerifier));
      const verify = await callFor(caller, 'contractors.verifyDocument', { id: documentId });
      expect({ step: 'verify', ok: verify.ok }).toEqual({ step: 'verify', ok: true });

      const addReq = await callFor(caller, 'contractors.addRequirement', {
        contractorId,
        name: 'Invented Requirement',
      });
      expect({ step: 'addRequirement', ok: addReq.ok }).toEqual({
        step: 'addRequirement',
        ok: false,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CT-T — multi-tenancy (ground rule 4)
  // ═══════════════════════════════════════════════════════════════════════
  describe('CT-T · tenancy', () => {
    it('CT-T01 · the directory never returns another tenant rows', async () => {
      const list = (await asAdminA().contractors.list()) as Array<{ id: string; name: string }>;
      const foreign = new Set(world.b.contractorIds);
      expect(list.filter((c) => foreign.has(c.id))).toEqual([]);
      // The mirror shares names, so a leak would look like duplicates.
      const dupes = list.filter((c) => c.name === 'Contractor 001 Ltd');
      expect(dupes).toHaveLength(1);
    });

    it('CT-T02 · a contractor id from another tenant is not readable', async () => {
      const res = await callFor(asAdminA(), 'contractors.get', {
        id: world.b.contractorIds[0] as string,
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(['NOT_FOUND', 'FORBIDDEN']).toContain(res.code);
    });

    it('CT-T03 · a contractor from another tenant is never actually modified', async () => {
      // The data-integrity half, asserted separately from the API-contract
      // half (CT-T03b) so the two cannot be confused: every mutation here
      // carries `eq(contractors.tenantId, ctx.tenantId)` in its WHERE, so a
      // cross-tenant write is impossible even where the call reports success.
      const foreignId = world.b.contractorIds[0] as string;
      for (const [path, input] of [
        ['contractors.update', { id: foreignId, name: 'Cross-tenant rename' }],
        ['contractors.archive', { id: foreignId }],
        ['contractors.regenerateUploadLink', { id: foreignId }],
        [
          'contractors.setComplianceOverride',
          { id: foreignId, override: 'compliant', reason: 'x' },
        ],
        ['contractors.addRequirement', { contractorId: foreignId, name: 'Injected' }],
      ] as Array<[string, unknown]>) {
        await callFor(asAdminA(), path, input);
      }

      const owner = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const after = (await owner.contractors.get({ id: foreignId })) as {
        contractor: { name: string; archivedAt: Date | null; complianceOverride: string | null };
        requirements: Array<{ name: string }>;
      };
      expect(after.contractor.name).toBe('Contractor 001 Ltd');
      expect(after.contractor.archivedAt).toBeNull();
      expect(after.contractor.complianceOverride).toBeNull();
      expect(after.requirements.map((r) => r.name)).not.toContain('Injected');
    });

    it('CT-T03b · [BUG] archive does not report success for a contractor it did not touch', async () => {
      // `archive` is the one mutation in the module that skips
      // `loadContractorOrThrow` and fires a bare UPDATE ... WHERE tenant AND
      // id. For an unknown or foreign id that matches zero rows and still
      // returns `{ ok: true }`, so the UI shows an "Archived" toast for a
      // contractor that is still live. Its siblings (`update`,
      // `regenerateUploadLink`, `setComplianceOverride`) all load first and
      // throw NOT_FOUND — this one is the odd one out.
      const foreign = await callFor(asAdminA(), 'contractors.archive', {
        id: world.b.contractorIds[0] as string,
      });
      const unknown = await callFor(asAdminA(), 'contractors.archive', {
        id: '01JUNKJUNKJUNKJUNKJUNKJUNK',
      });
      expect({ foreignReportedOk: foreign.ok, unknownReportedOk: unknown.ok }).toEqual({
        foreignReportedOk: false,
        unknownReportedOk: false,
      });
    });

    it('CT-T04 · a visit cannot be created against another tenant contractor', async () => {
      const res = await callFor(asAdminA(), 'contractors.visits.create', {
        contractorId: world.b.contractorIds[0] as string,
        title: 'Cross-tenant visit',
        scheduledStart: world.now.toISOString(),
      });
      expect(res.ok).toBe(false);
    });

    it('CT-T05 · a gate token only ever resolves its own tenant visits', async () => {
      const { token } = await createCaller(
        world.ctxFor(world.a.tenantId, world.a.actors.admin),
      ).contractors.gate.regenerateToken();
      const kiosk = (await asPublic().contractors.gate.publicByToken({ token })) as {
        visits: Array<{ id: string }>;
      };
      const foreignVisitIds = new Set(Object.values(world.b.visits));
      expect(kiosk.visits.filter((v) => foreignVisitIds.has(v.id))).toEqual([]);
    });

    it('CT-T06 · a gate token cannot check in another tenant visit', async () => {
      const { token } = await createCaller(
        world.ctxFor(world.a.tenantId, world.a.actors.admin),
      ).contractors.gate.regenerateToken();
      const res = await callFor(asPublic(), 'contractors.gate.selfCheckIn', {
        token,
        visitId: world.b.visits.scheduledToday as string,
        eventType: 'check_in',
      });
      expect(res.ok).toBe(false);
    });

    it('CT-T07 · an upload token resolves only its own contractor requirements', async () => {
      const res = (await asPublic().contractors.publicByToken({
        token: 'seed-upload-token-northgate-001',
      })) as { contractorName: string; requirements: Array<{ id: string }> };
      expect(res.contractorName).toBe('Contractor 001 Ltd');
      // Tenant B has an identically named contractor with its own
      // requirements; none of them may appear here.
      expect(res.requirements.length).toBeGreaterThan(0);
      expect(res.requirements.length).toBeLessThanOrEqual(3);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CT-S — what leaves the building
  // ═══════════════════════════════════════════════════════════════════════
  describe('CT-S · data exposure', () => {
    it('CT-S01 · [BUG] the directory does not hand the portal token to every reader', async () => {
      // `contractors.list` is `select()` with no projection, so it returns
      // every column — including `uploadToken`, the bearer credential for
      // the public no-login upload portal. Regenerating that token requires
      // `contractors.manage`; reading it requires only `contractors.view`.
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.viewer));
      const list = (await caller.contractors.list()) as Array<Record<string, unknown>>;
      expect(list.length).toBeGreaterThan(0);
      const withToken = list.filter(
        (c) => c.uploadToken !== undefined && c.uploadToken !== null,
      ).length;
      expect({ rowsExposingUploadToken: withToken }).toEqual({ rowsExposingUploadToken: 0 });
    });

    it('CT-S02 · the public portal exposes only the contractor name and its slots', async () => {
      const res = (await asPublic().contractors.publicByToken({
        token: 'seed-upload-token-northgate-001',
      })) as Record<string, unknown>;
      // No notes, no contact details, no compliance state, no ids beyond the
      // requirement ids the uploader must post against.
      expect(Object.keys(res).sort()).toEqual(['contractorName', 'requirements']);
    });

    it('CT-S03 · an unknown token is rejected rather than resolving to anything', async () => {
      for (const token of ['not-a-real-token', 'seed-upload-token-northgate-999', 'x'.repeat(40)]) {
        const res = await callFor(asPublic(), 'contractors.publicByToken', { token });
        expect({ token, ok: res.ok }).toEqual({ token, ok: false });
      }
    });

    it('CT-S04 · an archived contractor is absent from the directory', async () => {
      const list = (await asAdminA().contractors.list()) as Array<{ id: string }>;
      expect(list.map((c) => c.id)).not.toContain(world.a.planted.archived);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CT-C — compliance derivation boundaries
  // ═══════════════════════════════════════════════════════════════════════
  describe('CT-C · compliance boundaries', () => {
    let byId: Map<string, { complianceStatus: string; derivedComplianceStatus: string }>;

    beforeAll(async () => {
      const list = (await asAdminA().contractors.list()) as Array<{
        id: string;
        complianceStatus: string;
        derivedComplianceStatus: string;
      }>;
      byId = new Map(list.map((c) => [c.id, c]));
    });

    const statusOf = (key: string): string =>
      byId.get(world.a.planted[key] as string)?.complianceStatus ?? 'ABSENT';

    it('CT-C01 · no requirements reads as no_requirements, never as compliant', () => {
      expect(statusOf('noRequirements')).toBe('no_requirements');
    });

    it('CT-C02 · a blocking requirement with no document is non_compliant', () => {
      expect(statusOf('missingDocument')).toBe('non_compliant');
    });

    it('CT-C03 · cover that ends today is still cover today', () => {
      // The last day of an insurance policy is a covered day. If this reads
      // non_compliant, a contractor is turned away from site on a day they
      // are lawfully insured; the inverse would admit them a day late.
      expect(statusOf('expiresToday')).toBe('compliant');
    });

    it('CT-C04 · cover that lapsed yesterday is not cover', () => {
      expect(statusOf('expiredYesterday')).toBe('non_compliant');
    });

    it('CT-C05 · an unchecked upload does not satisfy a blocking slot', () => {
      expect(statusOf('pendingOnly')).toBe('non_compliant');
    });

    it('CT-C06 · a rejected document does not satisfy a blocking slot', () => {
      expect(statusOf('rejectedOnly')).toBe('non_compliant');
    });

    it('CT-C07 · a manual suspension beats fully valid paperwork', () => {
      const row = byId.get(world.a.planted.suspended as string);
      expect(row?.complianceStatus).toBe('suspended');
      // ...and the derived value is still visible underneath, so clearing
      // the override does not require re-deriving by hand.
      expect(row?.derivedComplianceStatus).toBe('compliant');
    });

    it('CT-C08 · an unmet ADVISORY requirement does not block', () => {
      expect(statusOf('advisoryGapOnly')).not.toBe('non_compliant');
    });

    it('CT-C09 · [BUG] compliance can be asked as at a past date', async () => {
      // Every other register in this platform can answer "what was true on
      // the day" — training has `statusAsOf`, inspections freeze an access
      // snapshot, RAMS freezes a pack version (ADR 0007). Contractor
      // compliance cannot: `today()` in contractors.ts reads `new Date()`
      // directly and no procedure accepts an `asOf`.
      //
      // That is the first question asked after an incident involving a
      // contractor — "was their insurance in force when this happened?" —
      // and today the honest answer is that the register only knows about
      // now. Document dates are retained, so the data is there; only the
      // query is missing.
      const shape = (
        appRouter as unknown as {
          _def: { procedures: Record<string, { _def?: { inputs?: unknown[] } }> };
        }
      )._def.procedures['contractors.get'];
      const inputs = (shape?._def?.inputs ?? []) as Array<{ shape?: Record<string, unknown> }>;
      const acceptsAsOf = inputs.some((i) => i.shape !== undefined && 'asOf' in i.shape);
      expect({ acceptsAsOf }).toEqual({ acceptsAsOf: true });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CT-G — the unauthenticated gate
  // ═══════════════════════════════════════════════════════════════════════
  describe('CT-G · gate kiosk', () => {
    async function freshToken(): Promise<string> {
      const { token } = await createCaller(
        world.ctxFor(world.a.tenantId, world.a.actors.admin),
      ).contractors.gate.regenerateToken();
      return token;
    }

    it('CT-G01 · regenerating the token revokes the previous one', async () => {
      const first = await freshToken();
      const okBefore = await callFor(asPublic(), 'contractors.gate.publicByToken', {
        token: first,
      });
      expect(okBefore.ok).toBe(true);

      await freshToken();
      const after = await callFor(asPublic(), 'contractors.gate.publicByToken', { token: first });
      expect({ oldTokenStillWorks: after.ok }).toEqual({ oldTokenStillWorks: false });
    });

    it('CT-G02 · a non-compliant contractor is refused at the kiosk', async () => {
      const token = await freshToken();
      const res = await callFor(asPublic(), 'contractors.gate.selfCheckIn', {
        token,
        visitId: world.a.visits.nonCompliantVisit as string,
        eventType: 'check_in',
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('FORBIDDEN');
    });

    it('CT-G03 · a cancelled visit cannot be checked in', async () => {
      const token = await freshToken();
      const res = await callFor(asPublic(), 'contractors.gate.selfCheckIn', {
        token,
        visitId: world.a.visits.cancelled as string,
        eventType: 'check_in',
      });
      expect(res.ok).toBe(false);
    });

    it('CT-G04 · checking out a visit that was never checked in is refused', async () => {
      const token = await freshToken();
      const res = await callFor(asPublic(), 'contractors.gate.selfCheckIn', {
        token,
        visitId: world.a.visits.scheduledOtherSite as string,
        eventType: 'check_out',
      });
      expect(res.ok).toBe(false);
    });

    it('CT-G05 · [BUG] a double tap at the kiosk does not double-log an arrival', async () => {
      // Kiosks get tapped twice. The visit-event log is the evidential
      // record of who was on site and when; two check_in rows for one
      // arrival corrupts it, and re-stamping `checkedInAt` moves the clock
      // the overstay worker measures from — so a contractor can reset their
      // own overstay by re-scanning.
      const token = await freshToken();
      const admin = asAdminA();
      const { id: visitId } = await admin.contractors.visits.create({
        contractorId: world.a.contractorIds[1] as string,
        title: 'Double-tap probe',
        scheduledStart: world.now.toISOString(),
        authorize: true,
      });

      await asPublic().contractors.gate.selfCheckIn({ token, visitId, eventType: 'check_in' });
      const second = await callFor(asPublic(), 'contractors.gate.selfCheckIn', {
        token,
        visitId,
        eventType: 'check_in',
      });

      const events = (await admin.contractors.visits.events({ visitId })) as Array<{
        eventType: string;
      }>;
      const checkIns = events.filter((e) => e.eventType === 'check_in').length;
      expect({ secondAccepted: second.ok, checkIns }).toEqual({
        secondAccepted: false,
        checkIns: 1,
      });
    });

    it('CT-G06 · [BUG] the kiosk shows only visits for its own site', async () => {
      // The token resolves a *tenant*, not a site, and the listing query
      // filters on tenant + time only. A tenant with two sites therefore
      // shows every site's contractor arrivals — names, companies and times
      // — on an unauthenticated screen in each reception, and lets the North
      // Yard kiosk admit a visit booked for the South Depot.
      const token = await freshToken();
      const kiosk = (await asPublic().contractors.gate.publicByToken({ token })) as {
        visits: Array<{ id: string }>;
      };
      const ids = new Set(kiosk.visits.map((v) => v.id));
      expect({
        showsOtherSiteVisit: ids.has(world.a.visits.scheduledOtherSite as string),
      }).toEqual({ showsOtherSiteVisit: false });
    });

    it('CT-G07 · required capture fields are enforced on self check-in', async () => {
      const admin = asAdminA();
      const { id: fieldId } = await admin.contractors.gateFields.create({
        label: 'Vehicle registration',
        fieldType: 'text',
        required: true,
      });
      const token = await freshToken();
      const { id: visitId } = await admin.contractors.visits.create({
        contractorId: world.a.contractorIds[2] as string,
        title: 'Capture-field probe',
        scheduledStart: world.now.toISOString(),
        authorize: true,
      });

      const missing = await callFor(asPublic(), 'contractors.gate.selfCheckIn', {
        token,
        visitId,
        eventType: 'check_in',
      });
      expect({ acceptedWithoutRequiredField: missing.ok }).toEqual({
        acceptedWithoutRequiredField: false,
      });

      const supplied = await callFor(asPublic(), 'contractors.gate.selfCheckIn', {
        token,
        visitId,
        eventType: 'check_in',
        capturedFields: { [fieldId]: 'AB12 CDE' },
      });
      expect(supplied.ok).toBe(true);

      await admin.contractors.gateFields.remove({ id: fieldId });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CT-V — volume
  // ═══════════════════════════════════════════════════════════════════════
  describe('CT-V · volume', () => {
    it('CT-V01 · the directory holds its shape at 120+ contractors', async () => {
      const started = process.hrtime.bigint();
      const list = (await asAdminA().contractors.list()) as Array<{ id: string }>;
      const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
      expect(list.length).toBeGreaterThanOrEqual(VOLUME_CONTRACTORS);
      // Not a benchmark — a tripwire for an accidental N+1. The derivation
      // is three queries plus an in-memory join; if someone moves it inside
      // the row map this becomes hundreds of round trips and blows the budget.
      expect({ overBudget: ms > 5_000, ms: Math.round(ms) }).toMatchObject({ overBudget: false });
    });

    it('CT-V02 · [BUG] the directory is paginated', async () => {
      // `contractors.list` takes no input at all: no limit, no cursor, no
      // search. Every contractor with every column is serialised on every
      // page load. At 120 that is untidy; at the 500+ a facilities group
      // carries it is the page.
      const shape = (
        appRouter as unknown as {
          _def: { procedures: Record<string, { _def?: { inputs?: unknown[] } }> };
        }
      )._def.procedures['contractors.list'];
      const inputs = shape?._def?.inputs ?? [];
      expect({ acceptsPaginationInput: inputs.length > 0 }).toEqual({
        acceptsPaginationInput: true,
      });
    });

    it('CT-V03 · the on-site board resolves with volume present', async () => {
      const onSite = (await asAdminA().contractors.visits.onSiteNow()) as Array<{ id: string }>;
      const ids = new Set(onSite.map((v) => v.id));
      expect(ids.has(world.a.visits.overstaying as string)).toBe(true);
      expect(ids.has(world.a.visits.onSiteFresh as string)).toBe(true);
      // Someone who never arrived is not on the board.
      expect(ids.has(world.a.visits.scheduledToday as string)).toBe(false);
    });

    it('CT-V04 · the user picker used to invite contractor users reaches past the first page', async () => {
      // 200 users is above the `users.list` default of 50. Any picker that
      // calls it with no search silently stops at the fiftieth person — the
      // exact defect found in the training module (TR-A2).
      const caller = asAdminA();
      const firstPage = (await caller.users.list({})) as {
        users: Array<{ name: string }>;
        hasMore: boolean;
      };
      expect(firstPage.users.length).toBeLessThanOrEqual(50);
      expect(firstPage.hasMore).toBe(true);

      const searched = (await caller.users.list({ search: 'Worker 199' })) as {
        users: Array<{ name: string }>;
      };
      expect(searched.users.map((r) => r.name)).toContain('Worker 199');
    });
  });
});

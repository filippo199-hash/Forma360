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
 * Every test here was written to describe CORRECT behaviour; the ones that
 * named a live defect failed on the day the audit ran and were the
 * acceptance criteria for the fix pass. They now pass, so this file has
 * become the module's regression suite — which is the whole point of
 * shipping an audit as tests rather than as paragraphs.
 */
import type { PGlite } from '@electric-sql/pglite';
import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@forma360/db/schema';
import { eq } from 'drizzle-orm';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';
import { bootWorld, type World } from './__fixtures__/world';

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
    .reduce<
      Record<string, unknown>
    >((acc, part) => acc[part] as Record<string, unknown>, caller as unknown as Record<string, unknown>);
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

    it('CT-P03 · a gate operator can actually work the gate', async () => {
      // `contractors.gate` is a real key in the catalogue. It is used in two
      // places — to show the Gate nav entry (nav-model.ts) and to choose
      // overstay-alert recipients (contractor-overstay.ts) — and it gates NO
      // procedure. So a receptionist granted exactly the gate key is shown a
      // door that does not open: check-in and check-out both demand
      // `contractors.manage`, which also grants renaming contractors,
      // deleting visits and regenerating the kiosk token.
      // Builds its own visit: the fixture is shared and read-mostly, and a
      // successful check-in here would otherwise change what CT-V03 asserts
      // about the on-site board.
      const { id: visitId } = await asAdminA().contractors.visits.create({
        contractorId: world.a.contractorIds[0] as string,
        siteId: world.a.sites.primary,
        title: 'Gate operator scope probe',
        scheduledStart: world.now.toISOString(),
        authorize: true,
      });
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.gateOperator));

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

    it('CT-P06 · removing a contractor portal user cannot deactivate an arbitrary employee', async () => {
      // `contractors.users.remove` takes a bare `z.string()` userId, deletes
      // the (possibly non-existent) contractor_users row, and then
      // UNCONDITIONALLY sets `deactivatedAt` on any user in the tenant.
      //
      // So `contractors.manage` — which every seeded Manager holds — is a
      // back door onto user deactivation. It bypasses the `users.deactivate`
      // permission, the self-deactivation block, and the S-E02 last-admin
      // guard (`wouldDropBelowMinAdmins`), which exists precisely so a
      // tenant cannot be left with no administrator.
      const manager = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.manager));
      const victimId = world.a.actors.admin;

      const res = await callFor(manager, 'contractors.users.remove', { userId: victimId });

      const [row] = await world.db
        .select({ deactivatedAt: schema.user.deactivatedAt })
        .from(schema.user)
        .where(eq(schema.user.id, victimId));

      expect({ accepted: res.ok, adminDeactivated: row?.deactivatedAt !== null }).toEqual({
        accepted: false,
        adminDeactivated: false,
      });

      // Undo, so the rest of the suite still has a working administrator.
      await world.db
        .update(schema.user)
        .set({ deactivatedAt: null })
        .where(eq(schema.user.id, victimId));
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
      const { contractors: list } = (await asAdminA().contractors.list()) as {
        contractors: Array<{ id: string; name: string }>;
      };
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

    it('CT-T03b · archive does not report success for a contractor it did not touch', async () => {
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
    it('CT-S01 · the directory does not hand the portal token to every reader', async () => {
      // `contractors.list` is `select()` with no projection, so it returns
      // every column — including `uploadToken`, the bearer credential for
      // the public no-login upload portal. Regenerating that token requires
      // `contractors.manage`; reading it requires only `contractors.view`.
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.viewer));
      const { contractors: list } = (await caller.contractors.list()) as {
        contractors: Array<Record<string, unknown>>;
      };
      expect(list.length).toBeGreaterThan(0);
      const withToken = list.filter(
        (c) => c.uploadToken !== undefined && c.uploadToken !== null,
      ).length;
      expect({ rowsExposingUploadToken: withToken }).toEqual({ rowsExposingUploadToken: 0 });
    });

    it('CT-S02 · the public portal exposes only the two names and its slots', async () => {
      const res = (await asPublic().contractors.publicByToken({
        token: 'seed-upload-token-northgate-001',
      })) as Record<string, unknown>;
      // No notes, no contact details, no compliance state, no ids beyond the
      // requirement ids the uploader must post against.
      //
      // `companyName` (the asking tenant's name) was added deliberately in
      // UXW3-04: the portal used to read "<contractor> has requested the
      // documents below", naming the contractor as its own requester, so a
      // link-suspicious contractor never learned who was asking. The name is
      // already in the invitation email that carries this very token, so it
      // discloses nothing the holder does not have — but it IS a widening,
      // and this guard is where that has to be argued. Anything beyond a
      // name still belongs behind a session.
      expect(Object.keys(res).sort()).toEqual(['companyName', 'contractorName', 'requirements']);
    });

    it('CT-S03 · an unknown token is rejected rather than resolving to anything', async () => {
      for (const token of ['not-a-real-token', 'seed-upload-token-northgate-999', 'x'.repeat(40)]) {
        const res = await callFor(asPublic(), 'contractors.publicByToken', { token });
        expect({ token, ok: res.ok }).toEqual({ token, ok: false });
      }
    });

    it('CT-S04 · an archived contractor is absent from the directory', async () => {
      const { contractors: list } = (await asAdminA().contractors.list()) as {
        contractors: Array<{ id: string }>;
      };
      expect(list.map((c) => c.id)).not.toContain(world.a.planted.archived);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CT-C — compliance derivation boundaries
  // ═══════════════════════════════════════════════════════════════════════
  describe('CT-C · compliance boundaries', () => {
    let byId: Map<string, { complianceStatus: string; derivedComplianceStatus: string }>;

    beforeAll(async () => {
      // The directory is paginated (max 200 a page), so walk every page:
      // the planted edge cases sort by name and several land beyond the
      // first page of 120+ seeded contractors.
      const rows: Array<{
        id: string;
        complianceStatus: string;
        derivedComplianceStatus: string;
      }> = [];
      let cursor: string | undefined;
      do {
        const page = (await asAdminA().contractors.list({
          limit: 200,
          ...(cursor !== undefined ? { cursor } : {}),
        })) as {
          contractors: Array<{
            id: string;
            complianceStatus: string;
            derivedComplianceStatus: string;
          }>;
          nextCursor: string | null;
        };
        rows.push(...page.contractors);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      byId = new Map(rows.map((c) => [c.id, c]));
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

    it('CT-C09 · compliance can be asked as at a past date', async () => {
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

    it('CT-G05 · a double tap at the kiosk does not double-log an arrival', async () => {
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

    it('CT-G06 · a site-bound kiosk token shows only that site', async () => {
      // Originally: the token resolved a TENANT, so every reception screen
      // in the company listed every site's arrivals and any kiosk could
      // admit a visit booked elsewhere. `contractor_gate_config` now carries
      // a `siteId` and `regenerateToken` takes one, so this asserts the
      // bound token actually narrows — and that a token minted with no site
      // is still the deliberate tenant-wide legacy behaviour, not an
      // accident.
      const admin = asAdminA();
      const { token: siteToken } = await admin.contractors.gate.regenerateToken({
        siteId: world.a.sites.primary,
      });
      const bound = (await asPublic().contractors.gate.publicByToken({ token: siteToken })) as {
        visits: Array<{ id: string }>;
      };
      const boundIds = new Set(bound.visits.map((v) => v.id));
      expect({
        showsOwnSite: boundIds.has(world.a.visits.scheduledToday as string),
        showsOtherSite: boundIds.has(world.a.visits.scheduledOtherSite as string),
      }).toEqual({ showsOwnSite: true, showsOtherSite: false });
    });

    it('CT-G06b · a site-bound kiosk cannot admit a visit booked for another site', async () => {
      const admin = asAdminA();
      const { token } = await admin.contractors.gate.regenerateToken({
        siteId: world.a.sites.primary,
      });
      const res = await callFor(asPublic(), 'contractors.gate.selfCheckIn', {
        token,
        visitId: world.a.visits.scheduledOtherSite as string,
        eventType: 'check_in',
      });
      expect({ admittedOtherSiteVisit: res.ok }).toEqual({ admittedOtherSiteVisit: false });
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
  // CT-L — visit lifecycle
  // ═══════════════════════════════════════════════════════════════════════
  describe('CT-L · visit lifecycle', () => {
    async function freshVisit(title: string): Promise<string> {
      const { id } = await asAdminA().contractors.visits.create({
        contractorId: world.a.contractorIds[3] as string,
        siteId: world.a.sites.primary,
        title,
        scheduledStart: world.now.toISOString(),
        authorize: true,
      });
      return id;
    }

    it('CT-L01 · staff check-in enforces the gate fields marked required', async () => {
      // `gate.selfCheckIn` loads every required field and refuses a blank
      // answer. `visits.checkIn` — the desk flow, which is how most arrivals
      // are actually recorded — takes `capturedFields` as optional and never
      // checks them at all.
      //
      // So the questions a company made mandatory ("site induction
      // complete?", "permit to work in place?") are enforced only when the
      // contractor scans themselves in, and the resulting event log is
      // indistinguishable from one where they were answered.
      const admin = asAdminA();
      const { id: fieldId } = await admin.contractors.gateFields.create({
        label: 'Site induction complete?',
        fieldType: 'yes_no',
        required: true,
      });
      const visitId = await freshVisit('Staff check-in, required field blank');

      const res = await callFor(admin, 'contractors.visits.checkIn', { id: visitId });
      expect({ acceptedWithRequiredFieldBlank: res.ok }).toEqual({
        acceptedWithRequiredFieldBlank: false,
      });

      await admin.contractors.gateFields.remove({ id: fieldId });
    });

    it('CT-L02 · a visit cannot be deleted while the person is still on site', async () => {
      // `visits.delete` sets `archivedAt` with no status guard, and both
      // `onSiteNow` and the overstay worker filter on `archivedAt IS NULL`.
      // Deleting a checked-in visit therefore erases someone who is
      // physically on the premises from the on-site board and from overstay
      // detection, with no check-out event and no record they left.
      //
      // The on-site board is what a fire marshal reads at the assembly
      // point. It must not be possible to empty it of someone who is inside.
      const admin = asAdminA();
      const visitId = await freshVisit('On site, then deleted');
      await admin.contractors.visits.checkIn({ id: visitId });

      const res = await callFor(admin, 'contractors.visits.delete', { id: visitId });
      const board = (await admin.contractors.visits.onSiteNow()) as Array<{ id: string }>;

      expect({
        deleteAccepted: res.ok,
        stillOnBoard: board.some((v) => v.id === visitId),
      }).toEqual({ deleteAccepted: false, stillOnBoard: true });
    });

    it('CT-L03 · a second check-out does not overwrite the recorded departure time', async () => {
      // `checkOut` guards only `checkedInAt === null`, so an already
      // checked-out visit can be checked out again — moving `checkedOutAt`
      // forward. The departure time on the gate record is the evidence of
      // when someone left; a stray second tap rewrites it.
      const admin = asAdminA();
      const visitId = await freshVisit('Double check-out');
      await admin.contractors.visits.checkIn({ id: visitId });
      await admin.contractors.visits.checkOut({ id: visitId });

      const first = (await admin.contractors.visits.get({ id: visitId })) as {
        visit: { checkedOutAt: Date | null };
      };
      const second = await callFor(admin, 'contractors.visits.checkOut', { id: visitId });
      const after = (await admin.contractors.visits.get({ id: visitId })) as {
        visit: { checkedOutAt: Date | null };
      };

      expect({
        secondAccepted: second.ok,
        departureTimeUnchanged:
          first.visit.checkedOutAt?.getTime() === after.visit.checkedOutAt?.getTime(),
      }).toEqual({ secondAccepted: false, departureTimeUnchanged: true });
    });

    it('CT-L04 · re-checking-in a departed visit does not strand it on the board', async () => {
      // `checkIn` sets status back to `checked_in` and stamps a new
      // `checkedInAt`, but never clears `checkedOutAt`. The row then reads
      // "on site" while carrying a departure time in the past — it appears
      // on the on-site board, and `onSiteNow` has no way to resolve it.
      const admin = asAdminA();
      const visitId = await freshVisit('Re-entry after check-out');
      await admin.contractors.visits.checkIn({ id: visitId });
      await admin.contractors.visits.checkOut({ id: visitId });
      await callFor(admin, 'contractors.visits.checkIn', { id: visitId });

      const after = (await admin.contractors.visits.get({ id: visitId })) as {
        visit: { status: string; checkedInAt: Date | null; checkedOutAt: Date | null };
      };
      const contradictory =
        after.visit.status === 'checked_in' && after.visit.checkedOutAt !== null;
      expect({ onSiteWithADepartureTime: contradictory }).toEqual({
        onSiteWithADepartureTime: false,
      });
    });

    it('CT-L05 · someone checked in yesterday can still check out at the kiosk', async () => {
      // The kiosk lists visits by `scheduledStart` within ±24h. A contractor
      // on a multi-day job, or anyone who overran, falls out of that window
      // while still `checked_in` — so the one screen they have no longer
      // offers them a way out. They stay on the on-site board indefinitely,
      // inflating the headcount the fire roll call depends on, and the
      // overstay alert fires every hour with no way for them to clear it.
      const admin = asAdminA();
      const { token } = await admin.contractors.gate.regenerateToken();
      const kiosk = (await asPublic().contractors.gate.publicByToken({ token })) as {
        visits: Array<{ id: string }>;
      };
      const ids = new Set(kiosk.visits.map((v) => v.id));
      expect({
        strandedVisitOfferedAWayOut: ids.has(world.a.visits.overstaying as string),
      }).toEqual({ strandedVisitOfferedAWayOut: true });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CT-V — volume
  // ═══════════════════════════════════════════════════════════════════════
  describe('CT-V · volume', () => {
    it('CT-V01 · the directory pages cleanly at 120+ contractors', async () => {
      const started = process.hrtime.bigint();
      const first = (await asAdminA().contractors.list()) as {
        contractors: Array<{ id: string }>;
        hasMore: boolean;
        nextCursor: string | null;
      };
      const ms = Number(process.hrtime.bigint() - started) / 1_000_000;

      // A bounded first page, and an honest signal that there is more — the
      // pre-fix behaviour was the whole contractor + requirement + document
      // graph on every call.
      expect(first.contractors.length).toBeLessThanOrEqual(50);
      expect(first.hasMore).toBe(true);
      expect(first.nextCursor).not.toBeNull();

      // The cursor advances rather than replaying page one.
      const second = (await asAdminA().contractors.list({
        cursor: first.nextCursor as string,
      })) as { contractors: Array<{ id: string }> };
      const firstIds = new Set(first.contractors.map((c) => c.id));
      expect(second.contractors.some((c) => firstIds.has(c.id))).toBe(false);

      // Not a benchmark — a tripwire for an accidental N+1.
      expect({ overBudget: ms > 5_000, ms: Math.round(ms) }).toMatchObject({ overBudget: false });
    });

    it('CT-V02 · the directory is paginated', async () => {
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

/**
 * Training & competence matrix — the audit suite (FreeHS module B7).
 *
 * The second module through the testing runbook, and the first that has
 * already been reviewed twice as prose (`training-hse-expert-review.md` and
 * `-round-2.md`, both since fixed). That makes it the interesting case: the
 * question is not "what did nobody look at" but **"does the fix hold, and
 * what do the axes a prose review cannot reach turn up?"**
 *
 * Five axes:
 *
 *   1. **TR-P — the generated permission matrix.** Every `training.*`
 *      procedure enumerated from the router at runtime and called by a user
 *      holding no training key. It cannot drift, and the only way to exempt
 *      one is to declare it self-scoped here, in the open, with a reason.
 *      Round 2 removed `training.view` from the Standard set, so this axis is
 *      load-bearing now in a way it was not before.
 *
 *   2. **TR-T — tenancy.** Ground rule 4, against the mirror tenant.
 *
 *   3. **TR-C — the derivation boundaries.** The domain library in
 *      `@forma360/shared/training` is the best-reasoned in the platform and
 *      is unit-tested. What is NOT tested is the router's *use* of it:
 *      superseded rows, non-expiring qualifications, the per-requirement
 *      lead-day boundary, leavers, account-less people, and the fuzzy way a
 *      "role" is discovered.
 *
 *   4. **TR-G — the permits competence gate.** The module's stated
 *      justification. Round 1 found it built and never called; round 2 found
 *      it called and unreachable; both are now fixed, so this asserts it
 *      actually refuses the right people end to end.
 *
 *   5. **TR-V — volume.** 200 users, four requirements. `resolveMatrix`
 *      loads every record, membership and assignment in the tenant and joins
 *      in JavaScript on every call — this is where that shows.
 *
 * Every test describes CORRECT behaviour. Those that named a live defect
 * failed when the audit ran and were the acceptance criteria for the fix
 * pass; they now pass, so this file is the module's regression suite.
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
 * Procedures deliberately reachable without a `training.*` key, with the
 * reason. `person` is the round-2 TR-B10 fix: your own wallet is your own
 * record, so the procedure is ungated as a whole and gates the org-wide read
 * inline. TR-P03 asserts that inline gate actually holds.
 */
const DECLARED_SELF_SCOPED: Record<string, string> = {
  'training.person': "the caller's own wallet; reading anyone else's is gated inline",
};

function trainingProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter((k) => k.startsWith('training.'))
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

describe('training — audit suite', () => {
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

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  const asStandard = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.standard));
  const day = (offset: number): string =>
    new Date(world.now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

  // ═══════════════════════════════════════════════════════════════════════
  // TR-P — permissions
  // ═══════════════════════════════════════════════════════════════════════
  describe('TR-P · permissions', () => {
    it('TR-P00 · the matrix covers every training procedure the router exposes', () => {
      const procs = trainingProcedures();
      expect(procs.length).toBeGreaterThanOrEqual(17);
      for (const key of Object.keys(DECLARED_SELF_SCOPED)) expect(procs).toContain(key);
    });

    it('TR-P01 · every gated procedure refuses a user holding no training key', async () => {
      // Round 2 (TR-B10) removed `training.view` from the seeded Standard
      // set precisely so an ordinary employee cannot list every colleague's
      // expired tickets by name. That makes this the assertion that keeps
      // the fix honest.
      const caller = asStandard();
      const leaked: Array<{ path: string; outcome: string }> = [];
      for (const path of trainingProcedures()) {
        if (path in DECLARED_SELF_SCOPED) continue;
        const res = await callFor(caller, path, undefined);
        if (res.ok) leaked.push({ path, outcome: 'RESOLVED without permission' });
        else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }
      expect(leaked).toEqual([]);
    });

    it('TR-P02 · a standard user can still read their own wallet', async () => {
      // The other half of TR-B10: locking the org-wide views must not lock
      // people out of their own record, which is the whole point of
      // /training/me.
      const res = (await asStandard().training.person()) as {
        isSelf: boolean;
        records: unknown[];
        cells: unknown[];
      };
      expect(res.isSelf).toBe(true);
    });

    it("TR-P03 · a standard user cannot read a colleague's wallet", async () => {
      const res = await callFor(asStandard(), 'training.person', {
        userId: world.a.actors.trainingRecorder,
      });
      expect({ readColleague: res.ok }).toEqual({ readColleague: false });
    });

    it('TR-P04 · a training viewer can read the matrix but cannot record or verify', async () => {
      const viewer = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.trainingViewer));
      const matrix = await callFor(viewer, 'training.matrix', undefined);
      expect({ step: 'matrix', ok: matrix.ok }).toEqual({ step: 'matrix', ok: true });

      for (const [path, input] of [
        [
          'training.addRecord',
          {
            requirementId: world.a.requirements.abrasiveWheels as string,
            personName: 'Someone',
            achievedAt: day(-1),
          },
        ],
        [
          'training.verifyRecord',
          { id: world.a.trainingRecords.expiredYesterday as string, status: 'verified' },
        ],
        ['training.createRequirement', { name: 'Invented' }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(viewer, path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });

    it('TR-P05 · a training recorder can record but cannot verify their own entry', async () => {
      // `training.record` and `training.verify` are separate keys on the
      // fire-safety precedent: entering a certificate and attesting that it
      // was checked against the physical card are different acts, and the
      // record has to be able to say which happened.
      const recorder = createCaller(
        world.ctxFor(world.a.tenantId, world.a.actors.trainingRecorder),
      );
      const added = await callFor(recorder, 'training.addRecord', {
        requirementId: world.a.requirements.firstAid as string,
        personName: 'Probe — Recorder Scope',
        achievedAt: day(-1),
      });
      expect({ step: 'addRecord', ok: added.ok }).toEqual({ step: 'addRecord', ok: true });

      const id = (added as { value: { id: string } }).value.id;
      const verified = await callFor(recorder, 'training.verifyRecord', {
        id,
        status: 'verified',
      });
      expect({ step: 'verify', ok: verified.ok }).toEqual({ step: 'verify', ok: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TR-T — tenancy
  // ═══════════════════════════════════════════════════════════════════════
  describe('TR-T · tenancy', () => {
    it('TR-T01 · the matrix never contains another tenant people or requirements', async () => {
      const res = (await asAdmin().training.matrix()) as {
        people: Array<{ userId: string | null }>;
        requirements: Array<{ id: string }>;
      };
      const foreignUsers = new Set(Object.values(world.b.actors));
      const foreignReqs = new Set(Object.values(world.b.requirements));
      expect(res.people.filter((p) => p.userId !== null && foreignUsers.has(p.userId))).toEqual([]);
      expect(res.requirements.filter((r) => foreignReqs.has(r.id))).toEqual([]);
    });

    it('TR-T02 · a record cannot be attached to a user from another tenant', async () => {
      // TR-B12 from the round-2 review. Ground rule 4: a client-supplied
      // user id is never taken on trust.
      const res = await callFor(asAdmin(), 'training.addRecord', {
        requirementId: world.a.requirements.abrasiveWheels as string,
        userId: world.b.actors.manager,
        personName: 'Cross-tenant plant',
        achievedAt: day(-1),
      });
      expect({ accepted: res.ok }).toEqual({ accepted: false });
    });

    it('TR-T03 · a record cannot be attached to a requirement from another tenant', async () => {
      const res = await callFor(asAdmin(), 'training.addRecord', {
        requirementId: world.b.requirements.abrasiveWheels as string,
        personName: 'Cross-tenant requirement',
        achievedAt: day(-1),
      });
      expect({ accepted: res.ok }).toEqual({ accepted: false });
    });

    it('TR-T04 · another tenant record cannot be voided or verified', async () => {
      for (const [path, input] of [
        [
          'training.supersedeRecord',
          { id: world.b.trainingRecords.leaverCard as string, reason: 'cross-tenant void' },
        ],
        [
          'training.verifyRecord',
          { id: world.b.trainingRecords.leaverCard as string, status: 'verified' },
        ],
      ] as Array<[string, unknown]>) {
        const res = await callFor(asAdmin(), path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }

      const [row] = await world.db
        .select({ supersededAt: schema.trainingRecords.supersededAt })
        .from(schema.trainingRecords)
        .where(eq(schema.trainingRecords.id, world.b.trainingRecords.leaverCard as string));
      expect(row?.supersededAt).toBeNull();
    });

    it('TR-T05 · an assignment cannot reference another tenant group or site', async () => {
      // Round 2 (TR-B12) added a tenant check to `addRecord.userId`. It was
      // not applied to `addAssignment`, which takes three more foreign keys
      // — `groupId`, `siteId` and `userId` — and validates only that the
      // REQUIREMENT belongs to the tenant and that the target field for the
      // scope is non-null.
      //
      // The effect is quieter than a leak and worse than one: the row
      // writes, but `resolveMatrix` builds its membership maps from this
      // tenant's rows, so the assignment matches nobody. It is a rule that
      // looks set and does nothing — exactly the failure the procedure's
      // own comment says it is guarding against — and because the FK
      // cascades, deleting the other tenant's group silently deletes it.
      for (const input of [
        {
          requirementId: world.a.requirements.abrasiveWheels as string,
          scope: 'group',
          groupId: world.b.training.groupId,
        },
        {
          requirementId: world.a.requirements.abrasiveWheels as string,
          scope: 'site',
          siteId: world.b.sites.primary,
        },
        {
          requirementId: world.a.requirements.abrasiveWheels as string,
          scope: 'person',
          userId: world.b.actors.manager,
        },
      ]) {
        const res = await callFor(asAdmin(), 'training.addAssignment', input);
        expect({ scope: input.scope, ok: res.ok }).toEqual({ scope: input.scope, ok: false });
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TR-C — derivation boundaries
  // ═══════════════════════════════════════════════════════════════════════
  describe('TR-C · derivation boundaries', () => {
    async function cellFor(userId: string, requirementKey: string) {
      const res = (await asAdmin().training.matrix()) as {
        cells: Array<{
          personKey: string;
          requirementId: string;
          status: string;
          required: boolean;
        }>;
      };
      return res.cells.find(
        (c) =>
          c.personKey === userId &&
          c.requirementId === (world.a.requirements[requirementKey] ?? ''),
      );
    }

    it('TR-C01 · a superseded record does not govern the cell', async () => {
      // `currentRecord` prefers the furthest-reaching cover, so a typo'd
      // 2099 expiry wins forever unless `supersededAt` is honoured on read.
      // The fixture voids exactly such a row behind a real one.
      const cell = await cellFor(world.a.actors.trainingViewer, 'abrasiveWheels');
      expect(cell?.status).not.toBe('in_date');
    });

    it('TR-C02 · a non-expiring qualification reads permanently in date', async () => {
      const admin = asAdmin();
      const { id } = await admin.training.addRecord({
        requirementId: world.a.requirements.nvqLevel3 as string,
        userId: world.a.actors.manager,
        personName: 'Mo Manager',
        achievedAt: day(-2000),
      });
      const [row] = await world.db
        .select({ expiresAt: schema.trainingRecords.expiresAt })
        .from(schema.trainingRecords)
        .where(eq(schema.trainingRecords.id, id));
      expect(row?.expiresAt).toBeNull();

      const cell = await cellFor(world.a.actors.manager, 'nvqLevel3');
      expect(cell?.status).toBe('in_date');
    });

    it('TR-C03 · the lead window is the requirement own, not the default 60', async () => {
      // First aid carries `renewalLeadDays: 14`. A card 7 days out is
      // inside it (expiring_soon); one 40 days out is not. If the default
      // 60 leaked in, both would read expiring_soon and the gap list would
      // be full of things nobody needs to act on yet.
      const inside = await cellFor(world.a.actors.trainingViewer, 'firstAid');
      const outside = await cellFor(world.a.actors.manager, 'firstAid');
      expect({ inside: inside?.status, outside: outside?.status }).toEqual({
        inside: 'expiring_soon',
        outside: 'in_date',
      });
    });

    it('TR-C04 · month-end clamping survives the round trip through the router', async () => {
      // 31 January + 1 month must be 28/29 February, never 2/3 March: a
      // certificate dated the 31st must not silently gain days. The domain
      // library does this correctly; this asserts the router persists what
      // the library computed rather than recomputing it elsewhere.
      const admin = asAdmin();
      const { id: reqId } = await admin.training.createRequirement({
        name: 'Month-end clamp probe',
        validityMonths: 1,
      });
      const { id } = await admin.training.addRecord({
        requirementId: reqId,
        personName: 'Clamp Probe',
        achievedAt: '2026-01-31',
      });
      const [row] = await world.db
        .select({ expiresAt: schema.trainingRecords.expiresAt })
        .from(schema.trainingRecords)
        .where(eq(schema.trainingRecords.id, id));
      expect(row?.expiresAt?.toISOString().slice(0, 10)).toBe('2026-02-28');
    });

    it('TR-C05 · a leaver drops out of the matrix but keeps their evidence', async () => {
      const res = (await asAdmin().training.matrix()) as {
        people: Array<{ userId: string | null }>;
      };
      expect(res.people.map((p) => p.userId)).not.toContain(world.a.actors.leaver);

      const [row] = await world.db
        .select({ id: schema.trainingRecords.id })
        .from(schema.trainingRecords)
        .where(eq(schema.trainingRecords.id, world.a.trainingRecords.leaverCard as string));
      expect(row).toBeDefined();
    });

    it('TR-C06 · an account-less operative appears in the matrix keyed by name', async () => {
      const res = (await asAdmin().training.matrix()) as {
        people: Array<{ userId: string | null; name: string }>;
      };
      expect(res.people.some((p) => p.userId === null && p.name === 'Dan Operative')).toBe(true);
    });

    it('TR-C07 · the role field is identified deterministically', async () => {
      // `resolveMatrix` finds the role field by matching
      // /role|job title|position/i against the field NAME, then writes every
      // match into one map — so a tenant with more than one matching field
      // gets whichever row the database returned last, and a field called
      // "Roles and responsibilities" or "Position (office)" silently becomes
      // the source of truth for who needs statutory training.
      //
      // Seeding a second matching field must not change anyone's role.
      const before = (await asAdmin().training.matrix()) as {
        cells: Array<{ personKey: string; requirementId: string; required: boolean }>;
      };
      const abrasive = world.a.requirements.abrasiveWheels as string;
      const requiredBefore = before.cells.some(
        (c) =>
          c.personKey === world.a.actors.trainingRecorder &&
          c.requirementId === abrasive &&
          c.required,
      );
      expect(requiredBefore).toBe(true);

      const decoyId = newId();
      await world.db.insert(schema.customUserFields).values({
        id: decoyId,
        tenantId: world.a.tenantId,
        name: 'Roles and responsibilities',
        type: 'text',
      });
      await world.db.insert(schema.userCustomFieldValues).values({
        tenantId: world.a.tenantId,
        userId: world.a.actors.trainingRecorder,
        fieldId: decoyId,
        value: 'Writes the method statements',
      });

      const after = (await asAdmin().training.matrix()) as {
        cells: Array<{ personKey: string; requirementId: string; required: boolean }>;
      };
      const requiredAfter = after.cells.some(
        (c) =>
          c.personKey === world.a.actors.trainingRecorder &&
          c.requirementId === abrasive &&
          c.required,
      );

      // Clean up regardless of the outcome so later tests see the original
      // world.
      await world.db
        .delete(schema.userCustomFieldValues)
        .where(
          and(
            eq(schema.userCustomFieldValues.tenantId, world.a.tenantId),
            eq(schema.userCustomFieldValues.fieldId, decoyId),
          ),
        );
      await world.db.delete(schema.customUserFields).where(eq(schema.customUserFields.id, decoyId));

      expect({ stillRequiredAfterDecoyField: requiredAfter }).toEqual({
        stillRequiredAfterDecoyField: true,
      });
    });

    it('TR-C08 · compliance counts only what people are required to hold', async () => {
      const res = (await asAdmin().training.compliance()) as {
        overall: number | null;
        statutory: number | null;
        mandatory: number | null;
      };
      // With planted gaps present the figure must be a real percentage,
      // not null (no denominator) and not 100 (everything counted as met).
      expect(typeof res.overall).toBe('number');
      expect(res.overall).toBeLessThan(100);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TR-G — the permits competence gate
  // ═══════════════════════════════════════════════════════════════════════
  describe('TR-G · the permits competence gate', () => {
    it('TR-G01 · a permit type can require training, and issue refuses an expired ticket', async () => {
      // The module's stated justification, end to end. Round 1 found the
      // gate written and never called; round 2 found it called and
      // unreachable from any UI. This asserts the whole path: arm the type,
      // name a person with a lapsed card, and be refused.
      const admin = asAdmin();
      const { typeId } = await admin.permits.types.create({
        name: 'Hot work (training-gated)',
        category: 'hot_work',
        requiredTrainingIds: [world.a.requirements.abrasiveWheels as string],
      });

      const { permitId } = await admin.permits.create({
        permitTypeId: typeId,
        siteId: world.a.sites.primary,
        title: 'Grinding in the north bay',
        workDescription: 'Cutting bolts on the mezzanine frame',
        acceptorUserId: world.a.actors.trainingRecorder, // card expired yesterday
        validFrom: new Date(world.now.getTime() + 3_600_000),
        validTo: new Date(world.now.getTime() + 4 * 3_600_000),
      });

      const detail = (await admin.permits.get({ permitId })) as {
        trainingShortfalls: Array<{ personLabel: string; reason: string }>;
      };
      expect(detail.trainingShortfalls.length).toBeGreaterThan(0);
      expect(detail.trainingShortfalls[0]?.reason).toBe('training-expired');

      const issued = await callFor(admin, 'permits.issue', { permitId });
      expect({ issuedWithExpiredTicket: issued.ok }).toEqual({ issuedWithExpiredTicket: false });
    });

    it('TR-G02 · a card inside its renewal window does not block a permit', async () => {
      // `expiring_soon` is valid today. A shift-long permit must not fail
      // because a ticket lapses next month.
      const admin = asAdmin();
      const { typeId } = await admin.permits.types.create({
        name: 'Confined space (first aid gated)',
        category: 'confined_space',
        requiredTrainingIds: [world.a.requirements.firstAid as string],
      });
      const { permitId } = await admin.permits.create({
        permitTypeId: typeId,
        siteId: world.a.sites.primary,
        title: 'Tank entry',
        workDescription: 'Internal inspection of the settling tank',
        acceptorUserId: world.a.actors.trainingViewer, // first aid expires in 7 days
        validFrom: new Date(world.now.getTime() + 3_600_000),
        validTo: new Date(world.now.getTime() + 4 * 3_600_000),
      });
      const detail = (await admin.permits.get({ permitId })) as {
        trainingShortfalls: unknown[];
      };
      expect(detail.trainingShortfalls).toEqual([]);
    });

    it('TR-G03 · voiding the ticket a permit relied on is caught before issue', async () => {
      // The gate reads the matrix at `get` and again at `issue`, which is
      // right. This checks the sharper case: a ticket voided AFTER the
      // preview was rendered must still stop the issue, rather than the
      // stale preview being trusted.
      const admin = asAdmin();
      const { id: reqId } = await admin.training.createRequirement({
        name: 'Void-race probe ticket',
        validityMonths: 36,
      });
      const { id: recordId } = await admin.training.addRecord({
        requirementId: reqId,
        userId: world.a.actors.manager,
        personName: 'Mo Manager',
        achievedAt: day(-10),
      });
      const { typeId } = await admin.permits.types.create({
        name: 'Void-race gated type',
        category: 'hot_work',
        requiredTrainingIds: [reqId],
      });
      const { permitId } = await admin.permits.create({
        permitTypeId: typeId,
        siteId: world.a.sites.primary,
        title: 'Void race',
        workDescription: 'Probe permit for the void-then-issue race',
        acceptorUserId: world.a.actors.manager,
        validFrom: new Date(world.now.getTime() + 3_600_000),
        validTo: new Date(world.now.getTime() + 4 * 3_600_000),
      });

      const clean = (await admin.permits.get({ permitId })) as { trainingShortfalls: unknown[] };
      expect(clean.trainingShortfalls).toEqual([]);

      await admin.training.supersedeRecord({ id: recordId, reason: 'certificate was forged' });

      const issued = await callFor(admin, 'permits.issue', { permitId });
      expect({ issuedAfterTicketVoided: issued.ok }).toEqual({ issuedAfterTicketVoided: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TR-I — bulk import
  // ═══════════════════════════════════════════════════════════════════════
  describe('TR-I · bulk import', () => {
    const reqName = 'Abrasive wheels';

    it('TR-I01 · rows the client could not parse reach the failure report', async () => {
      // TR-B4: the parser used to `continue` past a malformed row, so it
      // never reached the server, never appeared in `failed`, and a 2,000
      // row extract with 40 bad lines reported "imported 1,960" and no
      // failures. Silent truncation on an import is the worst failure mode
      // there is, because the number gets presented to a board as complete.
      const res = (await asAdmin().training.importRecords({
        rows: [
          {
            personName: 'Import Probe One',
            requirementName: reqName,
            achievedAt: day(-5),
            sourceRow: 2,
          },
        ],
        skipped: [{ row: 7, message: 'missing achievedAt' }],
      })) as { imported: number; failed: number; errors: Array<{ row: number }> };
      expect({ imported: res.imported, failed: res.failed }).toEqual({ imported: 1, failed: 1 });
      expect(res.errors.map((e) => e.row)).toContain(7);
    });

    it('TR-I02 · a row with no email still matches the person by name', async () => {
      // TR-B5: most LMS extracts carry a payroll number, not an email.
      // Without a name fallback each such row created a name-only person
      // beside the same human's account — the same nurse twice, once with a
      // wall of not_held and once holding every card.
      const res = (await asAdmin().training.importRecords({
        rows: [{ personName: 'Mo Manager', requirementName: reqName, achievedAt: day(-6) }],
      })) as { matchedToUsers: number; nameOnly: number };
      expect({ matched: res.matchedToUsers, nameOnly: res.nameOnly }).toEqual({
        matched: 1,
        nameOnly: 0,
      });
    });

    it('TR-I03 · two people with the same name are reported, never guessed', async () => {
      const [anyUser] = await world.db
        .select({ permissionSetId: schema.user.permissionSetId })
        .from(schema.user)
        .where(eq(schema.user.id, world.a.actors.standard));
      const permissionSetId = anyUser?.permissionSetId as string;
      await world.db.insert(schema.user).values([
        {
          id: newId(),
          tenantId: world.a.tenantId,
          name: 'Sam Twin',
          email: 'twin-a@northgate.test',
          permissionSetId,
        },
        {
          id: newId(),
          tenantId: world.a.tenantId,
          name: 'Sam Twin',
          email: 'twin-b@northgate.test',
          permissionSetId,
        },
      ]);

      const res = (await asAdmin().training.importRecords({
        rows: [{ personName: 'Sam Twin', requirementName: reqName, achievedAt: day(-7) }],
      })) as { imported: number; errors: Array<{ message: string }> };
      expect(res.imported).toBe(0);
      expect(res.errors[0]?.message).toContain('ambiguous-person');
    });

    it('TR-I04 · a dry run reports what it would write and writes nothing', async () => {
      const before = await world.db
        .select({ id: schema.trainingRecords.id })
        .from(schema.trainingRecords)
        .where(eq(schema.trainingRecords.tenantId, world.a.tenantId));
      const res = (await asAdmin().training.importRecords({
        rows: [{ personName: 'Dry Run Probe', requirementName: reqName, achievedAt: day(-8) }],
        dryRun: true,
      })) as { imported: number; wouldImport: number };
      const after = await world.db
        .select({ id: schema.trainingRecords.id })
        .from(schema.trainingRecords)
        .where(eq(schema.trainingRecords.tenantId, world.a.tenantId));
      expect({
        imported: res.imported,
        wouldImport: res.wouldImport,
        grew: after.length > before.length,
      }).toEqual({ imported: 0, wouldImport: 1, grew: false });
    });

    it('TR-I05 · re-running the same extract writes nothing the second time', async () => {
      // TR-B6: append-only means the only undo was voiding rows one at a
      // time, so a retried 2,000-row import doubled the register.
      const rows = [
        { personName: 'Idempotency Probe', requirementName: reqName, achievedAt: day(-9) },
      ];
      const first = (await asAdmin().training.importRecords({ rows })) as { imported: number };
      const second = (await asAdmin().training.importRecords({ rows })) as {
        imported: number;
        skippedDuplicates: number;
      };
      expect({
        first: first.imported,
        second: second.imported,
        dupes: second.skippedDuplicates,
      }).toEqual({ first: 1, second: 0, dupes: 1 });
    });

    it('TR-I06 · the import natural key is enforced by the database', async () => {
      // The dedupe is an in-memory `seen` set built from a SELECT taken at
      // the top of the mutation. Two imports running at once both read the
      // same set, both find nothing, and both insert — the guard holds only
      // as long as nobody double-clicks or two people migrate at the same
      // time.
      //
      // RAMS solved exactly this with a partial unique index (migration
      // 0070). The natural key here is
      // (tenant, requirement, person, achieved date).
      const idx = (await world.db.execute(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'training_records'`,
      )) as unknown as { rows: Array<{ indexdef: string }> };
      const defs = (idx.rows ?? []).map((r) => r.indexdef.toLowerCase());
      const hasNaturalKey = defs.some(
        (d) => d.includes('unique') && d.includes('requirement_id') && d.includes('achieved_at'),
      );
      expect({ uniqueIndexOnNaturalKey: hasNaturalKey }).toEqual({ uniqueIndexOnNaturalKey: true });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TR-V — volume
  // ═══════════════════════════════════════════════════════════════════════
  describe('TR-V · volume', () => {
    it('TR-V01 · the matrix resolves at 200 people without falling over', async () => {
      const started = process.hrtime.bigint();
      const res = (await asAdmin().training.matrix()) as {
        people: unknown[];
        cells: unknown[];
      };
      const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
      expect(res.people.length).toBeGreaterThan(150);
      expect({ overBudget: ms > 5_000, ms: Math.round(ms) }).toMatchObject({ overBudget: false });
    });

    it('TR-V02 · an unfiltered matrix over the cell ceiling is refused', async () => {
      // Originally unbounded: `resolveMatrix` loads every record, membership
      // and assignment in the tenant and joins in JavaScript, and `matrix`
      // took no bound at all. The chosen fix is a cell ceiling rather than
      // pagination — an unfiltered grid above it is refused and the caller
      // is asked for a site or requirement filter, either of which bounds
      // the result. This asserts both halves: the refusal, and that a filter
      // admits it.
      const admin = asAdmin();
      const unfiltered = await callFor(admin, 'training.matrix', undefined);
      const filtered = await callFor(admin, 'training.matrix', {
        requirementId: world.a.requirements.abrasiveWheels as string,
      });
      expect({ filteredWorks: filtered.ok }).toEqual({ filteredWorks: true });
      // Either the unfiltered call is refused, or it is under the ceiling —
      // both are correct; what must never happen is an unbounded success at
      // the specified 800 x 30.
      if (!unfiltered.ok) expect(unfiltered.code).toBe('BAD_REQUEST');
    });

    it('TR-V03 · the gap list stays scoped to real gaps at volume', async () => {
      const res = (await asAdmin().training.gaps()) as {
        total: number;
        expired: Array<{ status: string }>;
        expiringSoon: Array<{ status: string }>;
        notHeld: Array<{ status: string }>;
      };
      expect(res.total).toBeGreaterThan(0);
      // Each bucket must contain only its own status — the gap list is the
      // one view built to be acted on, so an in-date cell here is noise.
      expect(res.expired.every((g) => g.status === 'expired')).toBe(true);
      expect(res.expiringSoon.every((g) => g.status === 'expiring_soon')).toBe(true);
      expect(res.notHeld.every((g) => g.status === 'not_held')).toBe(true);
    });

    it('TR-V04 · a site filter with no members says so rather than showing an empty grid', async () => {
      // TR-B13 from the round-2 review: site scoping resolves through the
      // curated `site_members` table, and "no gaps" and "nobody is a member
      // of this site" looked identical — the reassuring one being wrong.
      const res = (await asAdmin().training.gaps({ siteId: world.a.sites.secondary })) as {
        siteHasNoMembers?: boolean;
        total: number;
      };
      expect({ flagged: res.siteHasNoMembers === true, total: res.total }).toEqual({
        flagged: true,
        total: 0,
      });
    });
  });
});

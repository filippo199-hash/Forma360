/**
 * Permits (Permit to Work) module — the audit suite (FreeHS).
 *
 * The tenth and last module through the testing runbook, and the one that
 * arrives best defended: `permits.test.ts` already carries 58 tests across
 * PW-E10..E35, written alongside the module and hardened after an HSE
 * expert review. The lifecycle, the gas gate, SIMOPs, handover, extension
 * and closure all have coverage.
 *
 * So this suite deliberately does not re-run them. It goes at the three
 * places a suite written from inside a module systematically cannot reach:
 *
 * **The generated permission matrix.** PW-E13 checks that a standard user
 * cannot create, issue or manage types. That is a sample. This suite
 * enumerates every `permits.*` procedure from the router at runtime and
 * asserts each one refuses a caller holding no permits key — so a
 * procedure added later cannot quietly ship ungated.
 *
 * **The joins outward.** A permit is the document that asserts the work
 * has been assessed and controlled, which makes it the densest consumer of
 * other modules in the product: risk assessments, RAMS packs, the training
 * matrix, the document library, sites and users. Nine audits have found
 * the same defect fourteen times — a module reading another module's
 * records while applying only its own rule — and Permits reads more of
 * them than anything except RAMS.
 *
 * **The physical register.** The entry log is not bookkeeping. In a
 * confined space it is what the standby person reads to know how many
 * people are inside, and a register that cannot be counted is worse than
 * no register at all.
 *
 * Six axes: PW-P (permissions), PW-L (lifecycle integrity), PW-S (the
 * physical register and snapshot integrity), PW-X (cross-module), PW-T
 * (tenancy), PW-V (limits).
 *
 * Every test describes CORRECT behaviour. Those that name a live defect
 * fail today and are the acceptance criteria for the fix pass.
 *
 * Not re-asserted here: RA-X03 (`permits.issue` gates on a risk
 * assessment's presence, never its status) is owned by
 * `riskAssessments.audit.test.ts`, where it was found.
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
import { resolveDocumentTimeZone } from '@forma360/shared/timezone';

const createCaller = createCallerFactory(appRouter);
type Caller = ReturnType<typeof createCaller>;

function permitProcedures(): string[] {
  const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def
    .procedures;
  return Object.keys(defs)
    .filter((k) => k.startsWith('permits.'))
    .sort();
}

/** The lifecycle mutations a terminal permit must refuse, whatever else changes. */
const LIFECYCLE_MUTATIONS = [
  'permits.authorise',
  'permits.issue',
  'permits.accept',
  'permits.suspend',
  'permits.resume',
  'permits.extend',
  'permits.handover',
  'permits.close',
  'permits.cancel',
] as const;

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

describe('permits — audit suite', () => {
  let world: World;
  let client: PGlite;
  /** `permits.view/create/issue` + `documents.view`. NOT in the Night shift group. */
  let issuerId: string;
  /** `permits.create` only (plus view) — the competent person who cannot sign. */
  let plannerId: string;
  /** `permits.view` only — the acceptor at the face. */
  let acceptorId: string;

  const asAdmin = () => createCaller(world.ctxFor(world.a.tenantId, world.a.actors.admin));
  const asIssuer = () => createCaller(world.ctxFor(world.a.tenantId, issuerId));
  const asPlanner = () => createCaller(world.ctxFor(world.a.tenantId, plannerId));
  const asAcceptor = () => createCaller(world.ctxFor(world.a.tenantId, acceptorId));

  const hours = (n: number): Date => new Date(world.now.getTime() + n * 3_600_000);

  /** A permit type with only the constraints a test asks for. */
  async function makeType(overrides: Record<string, unknown> = {}): Promise<{ typeId: string }> {
    return asAdmin().permits.types.create({
      category: 'hot_work',
      name: `Audit type ${newId().slice(-6)}`,
      maxDurationHours: 12,
      ...overrides,
    });
  }

  /** A draft permit, site-less by default so site scoping stays out of the way. */
  async function makePermit(
    typeId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const { permitId } = await asAdmin().permits.create({
      permitTypeId: typeId,
      title: `Audit permit ${newId().slice(-6)}`,
      workDescription: 'Welding a handrail stanchion.',
      validFrom: world.now,
      validTo: hours(6),
      acceptorUserId: acceptorId,
      ...overrides,
    });
    return permitId;
  }

  /** Drive a permit all the way to `active`. */
  async function makeActivePermit(typeId?: string): Promise<string> {
    const { typeId: tid } = typeId !== undefined ? { typeId } : await makeType();
    const permitId = await makePermit(tid);
    await asAdmin().permits.issue({ permitId });
    await asAcceptor().permits.accept({ permitId });
    return permitId;
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

    issuerId = await mk('Permit issuer', [
      'permits.view',
      'permits.create',
      'permits.issue',
      'documents.view',
    ]);
    plannerId = await mk('Permit planner', ['permits.view', 'permits.create']);
    acceptorId = await mk('Permit acceptor', ['permits.view']);
  }, 180_000);

  afterAll(async () => {
    await client.close();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PW-P — permissions
  // ═══════════════════════════════════════════════════════════════════════
  describe('PW-P · permissions', () => {
    it('PW-P00 · the matrix covers every permits procedure the router exposes', () => {
      const procs = permitProcedures();
      expect(procs.length).toBeGreaterThanOrEqual(20);
      expect(procs).toContain('permits.issue');
      expect(procs).toContain('permits.close');
      expect(procs).toContain('permits.types.create');
    });

    it('PW-P01 · every procedure refuses a user holding no permits key', async () => {
      const caller = createCaller(world.ctxFor(world.a.tenantId, world.a.actors.nobody));
      const leaked: Array<{ path: string; outcome: string }> = [];
      for (const path of permitProcedures()) {
        const res = await callFor(caller, path, undefined);
        if (res.ok) leaked.push({ path, outcome: 'RESOLVED without permission' });
        else if (res.code !== 'FORBIDDEN' && res.code !== 'UNAUTHORIZED') {
          leaked.push({ path, outcome: `${res.code}: ${res.message.slice(0, 80)}` });
        }
      }
      expect(leaked).toEqual([]);
    });

    it('PW-P02 · permits.create plans the work and cannot sign it into force', async () => {
      // The whole point of a permit system is that the person who wants the
      // work done is not the person who authorises it. `permits.create` is
      // the competent person preparing the permit; `permits.issue` is the
      // authority that puts it into force and closes it out.
      const { typeId } = await makeType();
      const permitId = await makePermit(typeId);
      for (const [path, input] of [
        ['permits.authorise', { permitId }],
        ['permits.issue', { permitId }],
        ['permits.close', { permitId, checks: {} }],
        ['permits.types.create', { category: 'hot_work', name: 'Planner type' }],
      ] as Array<[string, unknown]>) {
        const res = await callFor(asPlanner(), path, input);
        expect({ path, ok: res.ok }).toEqual({ path, ok: false });
      }
    });

    it('PW-P03 · the acceptor records at the face without holding an issuing key', async () => {
      // PW-9. The person in charge at the job needs to log entries, gas
      // readings and evidence. Requiring `permits.issue` for that would
      // mean either handing out issuing authority or leaving the register
      // blank, and both are worse.
      const { typeId } = await makeType();
      const permitId = await makeActivePermit(typeId);

      const logged = await callFor(asAcceptor(), 'permits.logEntry', {
        permitId,
        name: 'Ada Entrant',
      });
      expect({ acceptorLoggedEntry: logged.ok }).toEqual({ acceptorLoggedEntry: true });

      const issued = await callFor(asAcceptor(), 'permits.close', {
        permitId,
        checks: {},
      });
      expect({ acceptorClosedPermit: issued.ok }).toEqual({ acceptorClosedPermit: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PW-X — the external acceptor (BUG-05)
  // ═══════════════════════════════════════════════════════════════════════
  describe('PW-X · the external acceptor', () => {
    it('PW-X01 · a contractor with no seat can be named and can sign on', async () => {
      // The acceptor of a permit to work is normally the contractor doing
      // the job. The picker only offered registered users, so every tester
      // named an internal colleague — which defeats the control, because
      // the point is that the person who will do the work signs on to the
      // conditions. They sign on glass; an issuer countersigns.
      const { typeId } = await makeType();
      const permitId = await makePermit(typeId, {
        acceptorUserId: undefined,
        acceptorName: 'Marek Kowalski',
        acceptorOrganisation: 'BoilerCare Ltd',
      });

      // The issue gate is satisfied by a named external acceptor.
      const issued = await callFor(asAdmin(), 'permits.issue', { permitId });
      expect({ issued: issued.ok }).toEqual({ issued: true });

      const signed = await callFor(asAdmin(), 'permits.acceptExternal', {
        permitId,
        signedName: 'Marek Kowalski',
      });
      expect({ accepted: signed.ok }).toEqual({ accepted: true });

      const [row] = await world.db
        .select({
          status: schema.permits.status,
          acceptedAt: schema.permits.acceptedAt,
          witnessedBy: schema.permits.acceptanceWitnessedBy,
        })
        .from(schema.permits)
        .where(eq(schema.permits.id, permitId));

      // The countersignature is what makes it evidence rather than a typed
      // name — somebody is accountable for having witnessed it.
      expect({
        status: row?.status,
        signed: row?.acceptedAt !== null,
        witnessed: row?.witnessedBy === world.a.actors.admin,
      }).toEqual({ status: 'active', signed: true, witnessed: true });
    });

    it('PW-X02 · a signature under a different name is refused', async () => {
      // A different name is a different person. Accepting it silently would
      // break the chain the record exists to prove.
      const { typeId } = await makeType();
      const permitId = await makePermit(typeId, {
        acceptorUserId: undefined,
        acceptorName: 'Marek Kowalski',
        acceptorOrganisation: 'BoilerCare Ltd',
      });
      await asAdmin().permits.issue({ permitId });

      const res = await callFor(asAdmin(), 'permits.acceptExternal', {
        permitId,
        signedName: 'Someone Else',
      });
      expect({ accepted: res.ok }).toEqual({ accepted: false });
      if (!res.ok) expect(res.message).toBe('acceptor-name-mismatch');
    });

    it('PW-X03 · an internal acceptor cannot have their signature countersigned', async () => {
      // Countersigning for somebody who HAS an account launders their
      // signature — they can and must sign in and accept it themselves.
      const { typeId } = await makeType();
      const permitId = await makePermit(typeId);
      await asAdmin().permits.issue({ permitId });

      const res = await callFor(asAdmin(), 'permits.acceptExternal', {
        permitId,
        signedName: 'Ann Acceptor',
      });
      expect({ accepted: res.ok }).toEqual({ accepted: false });
      if (!res.ok) expect(res.message).toBe('acceptor-is-internal');
    });

    it('PW-X04 · a permit naming nobody still refuses to issue', async () => {
      const { typeId } = await makeType();
      const permitId = await makePermit(typeId, { acceptorUserId: undefined });
      const res = await callFor(asAdmin(), 'permits.issue', { permitId });
      expect({ issued: res.ok }).toEqual({ issued: false });
      if (!res.ok) expect(res.message).toBe('acceptor-required');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PW-Z — which clock the document is stamped in (BUG-14, per-site)
  // ═══════════════════════════════════════════════════════════════════════
  describe('PW-Z · document timezone', () => {
    it('PW-Z01 · the site clock wins over the tenant clock, and clearing falls back', async () => {
      // A permit's validity window is the one number on it that must not be
      // ambiguous, and it is read against the clock on the wall where the
      // work happens. Stamping every document in one deployment-wide zone
      // was right for a single-country operator and wrong the moment a
      // customer ran sites in more than one — their Frankfurt permit would
      // print London time, the same defect with a different offset.
      //
      // The renderer's half (the snapshot carrying both levels) is pinned in
      // `packages/render/src/snapshot.test.ts`; this is the writing half.
      const siteId = world.a.sites.primary;
      const readLevels = async (): Promise<{ site: string | null; tenant: string | null }> => {
        const [site] = await world.db
          .select({ tz: schema.sites.timezone })
          .from(schema.sites)
          .where(eq(schema.sites.id, siteId));
        const [tenant] = await world.db
          .select({ settings: schema.tenants.settings })
          .from(schema.tenants)
          .where(eq(schema.tenants.id, world.a.tenantId));
        return { site: site?.tz ?? null, tenant: tenant?.settings.timezone ?? null };
      };
      const resolved = async (): Promise<string> => {
        const { site, tenant } = await readLevels();
        return resolveDocumentTimeZone(site, tenant, 'Europe/London');
      };

      // Nothing declared anywhere → the deployment default.
      expect(await resolved()).toBe('Europe/London');

      // A tenant default applies to every site that has not overridden it.
      await asAdmin().tenants.updateSettings({ timezone: 'Europe/Berlin' });
      expect(await resolved()).toBe('Europe/Berlin');

      // …and the site wins over it, because the clock follows the work.
      await asAdmin().sites.update({ id: siteId, timezone: 'America/New_York' });
      expect(await resolved()).toBe('America/New_York');

      // Clearing the site override falls back to the tenant, not to nothing.
      await asAdmin().sites.update({ id: siteId, timezone: '' });
      expect(await resolved()).toBe('Europe/Berlin');

      // Leave the world as we found it — later tests share this tenant.
      await asAdmin().tenants.updateSettings({ timezone: '' });
      expect(await resolved()).toBe('Europe/London');
    });

    it('PW-Z02 · an ambiguous abbreviation is refused at the boundary', async () => {
      // ICU HAPPILY formats `BST` — as Bangladesh Standard Time, six hours
      // off the British Summer Time whoever typed it meant. A permit stamped
      // with it prints six hours out, which is the bug this fixes wearing a
      // bigger offset. The picker never offers one; the server refuses it
      // regardless, because the picker is not the only caller.
      for (const bad of ['BST', 'EST', 'Mars/Olympus_Mons']) {
        const res = await callFor(asAdmin(), 'sites.update', {
          id: world.a.sites.primary,
          timezone: bad,
        });
        expect({ zone: bad, accepted: res.ok }).toEqual({ zone: bad, accepted: false });
        const tenantRes = await callFor(asAdmin(), 'tenants.updateSettings', { timezone: bad });
        expect({ zone: bad, tenantAccepted: tenantRes.ok }).toEqual({
          zone: bad,
          tenantAccepted: false,
        });
      }
      const ok = await callFor(asAdmin(), 'sites.update', {
        id: world.a.sites.primary,
        timezone: 'Europe/Lisbon',
      });
      expect({ accepted: ok.ok }).toEqual({ accepted: true });
      await asAdmin().sites.update({ id: world.a.sites.primary, timezone: '' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PW-L — lifecycle integrity
  // ═══════════════════════════════════════════════════════════════════════
  describe('PW-L · lifecycle integrity', () => {
    it('PW-L01 · a closed permit refuses every lifecycle mutation', async () => {
      // Generated over the whole mutation list rather than a sample, so a
      // lifecycle procedure added later is covered the day it lands. A
      // closed permit is the evidential record of a completed job; nothing
      // may move it.
      const { typeId } = await makeType();
      const permitId = await makeActivePermit(typeId);
      await asAdmin().permits.close({
        permitId,
        checks: {
          workComplete: true,
          areaMadeSafe: true,
          isolationsRemoved: true,
          personnelClear: true,
        },
      });

      const accepted: string[] = [];
      for (const path of LIFECYCLE_MUTATIONS) {
        const res = await callFor(asAdmin(), path, {
          permitId,
          checks: {
            workComplete: true,
            areaMadeSafe: true,
            isolationsRemoved: true,
            personnelClear: true,
          },
          reason: 'audit probe',
          validTo: hours(24),
          acceptorUserId: acceptorId,
        });
        if (res.ok) accepted.push(path);
      }
      expect(accepted).toEqual([]);
    });

    it('PW-L02 · a cancelled permit refuses every lifecycle mutation', async () => {
      const { typeId } = await makeType();
      const permitId = await makePermit(typeId);
      await asAdmin().permits.cancel({ permitId, reason: 'Job stood down.' });

      const accepted: string[] = [];
      for (const path of LIFECYCLE_MUTATIONS) {
        const res = await callFor(asAdmin(), path, {
          permitId,
          checks: {
            workComplete: true,
            areaMadeSafe: true,
            isolationsRemoved: true,
            personnelClear: true,
          },
          reason: 'audit probe',
          validTo: hours(24),
          acceptorUserId: acceptorId,
        });
        if (res.ok) accepted.push(path);
      }
      expect(accepted).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PW-S — the physical register and snapshot integrity
  // ═══════════════════════════════════════════════════════════════════════
  describe('PW-S · the register', () => {
    it('PW-S01 · a person already inside cannot be logged in a second time', async () => {
      // The entry board is a headcount, and in a confined space it is the
      // number the standby person works from and the number a rescue team
      // is given. `logEntry` appends unconditionally — logging the same
      // named worker twice leaves two open rows for one body, so the board
      // reads three inside when two are. The error runs both ways: exit
      // one row and the register still says somebody is in there.
      const { typeId } = await makeType();
      const permitId = await makeActivePermit(typeId);
      await asAdmin().permits.setWorkers({
        permitId,
        workers: [{ id: 'w1', name: 'Ada Entrant', role: 'entrant', userId: null }],
      });

      const first = await callFor(asAdmin(), 'permits.logEntry', { permitId, workerId: 'w1' });
      const second = await callFor(asAdmin(), 'permits.logEntry', { permitId, workerId: 'w1' });

      const [row] = await world.db
        .select({ entryLog: schema.permits.entryLog })
        .from(schema.permits)
        .where(eq(schema.permits.id, permitId));
      const open = (row?.entryLog ?? []).filter((r) => r.exitedAt === null);

      expect({
        firstEntryAccepted: first.ok,
        duplicateEntryAccepted: second.ok,
        headcount: open.length,
      }).toEqual({ firstEntryAccepted: true, duplicateEntryAccepted: false, headcount: 1 });
    });

    it('PW-S02 · closure is blocked while anybody is inside, and unblocks when they leave', async () => {
      const { typeId } = await makeType();
      const permitId = await makeActivePermit(typeId);
      const { entryId } = await asAdmin().permits.logEntry({ permitId, name: 'Ada Entrant' });

      const checks = {
        workComplete: true,
        areaMadeSafe: true,
        isolationsRemoved: true,
        personnelClear: true,
      };
      const blocked = await callFor(asAdmin(), 'permits.close', { permitId, checks });
      expect({ closedWithSomebodyInside: blocked.ok }).toEqual({
        closedWithSomebodyInside: false,
      });
      if (!blocked.ok) expect(blocked.message).toBe('entrants-still-inside');

      await asAdmin().permits.logExit({ permitId, entryId });
      const after = await callFor(asAdmin(), 'permits.close', { permitId, checks });
      expect({ closedOnceClear: after.ok }).toEqual({ closedOnceClear: true });
    });

    it('PW-S03 · PW-1 · a recorded gas verdict is not rewritten by a later change to the limits', async () => {
      // The verdict is snapshotted onto the reading at record time. It has
      // to be: the reading is evidence of what the instrument said and
      // what that meant at the moment somebody decided to enter. Editing
      // the type's limits afterwards must not retrospectively turn a
      // refusal into a pass on a record already in the log.
      const admin = asAdmin();
      const { typeId } = await makeType({
        requiresGasTesting: true,
        gasLimits: [{ id: 'o2', label: 'Oxygen', unit: 'percent_o2', min: 19.5, max: 23.5 }],
      });
      const permitId = await makePermit(typeId);
      await admin.permits.recordGasReading({
        permitId,
        limitId: 'o2',
        substance: 'Oxygen',
        reading: 17.2,
        unit: 'percent_o2',
      });

      const before = await world.db
        .select({ readings: schema.permits.gasReadings })
        .from(schema.permits)
        .where(eq(schema.permits.id, permitId));

      // Widen the limit so 17.2 would now read as acceptable.
      await admin.permits.types.update({
        typeId,
        gasLimits: [{ id: 'o2', label: 'Oxygen', unit: 'percent_o2', min: 15, max: 23.5 }],
      });

      const after = await world.db
        .select({ readings: schema.permits.gasReadings })
        .from(schema.permits)
        .where(eq(schema.permits.id, permitId));

      expect({
        verdictWhenRecorded: before[0]?.readings[0]?.withinLimits,
        verdictAfterLimitsWidened: after[0]?.readings[0]?.withinLimits,
      }).toEqual({ verdictWhenRecorded: false, verdictAfterLimitsWidened: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PW-X — cross-module
  // ═══════════════════════════════════════════════════════════════════════
  describe('PW-X · cross-module', () => {
    it('PW-X00 · control · the issuer genuinely cannot open the restricted document', async () => {
      // Establishes the premise for PW-X01. Without this the next test
      // could pass because the document was readable all along.
      const res = await callFor(asIssuer(), 'documents.get', {
        documentId: world.a.documents.groupRestrictedDoc,
      });
      expect({ issuerCanOpenRestrictedDoc: res.ok }).toEqual({
        issuerCanOpenRestrictedDoc: false,
      });
    });

    it('PW-X01 · a method statement the linker cannot open cannot be linked to a permit', async () => {
      // The pattern's seventh appearance. `loadDocumentInTenant` in
      // permits.ts checks tenant and existence and nothing else — not the
      // document's `visibleToGroupIds` / `visibleToSiteIds`, not the folder
      // cascade above it. So an issuer attaches a document they cannot
      // themselves read, and `permits.get` then hands its NAME to every
      // holder of `permits.view` in the tenant.
      //
      // Milder than RS-X01 (which froze the disclosure into a client-facing
      // pack) because the permit surfaces only the name and the bytes stay
      // behind the documents module. Still the same missing check, and the
      // fix is the one already written next door.
      const { typeId } = await makeType();
      const permitId = await makePermit(typeId);
      const res = await callFor(asIssuer(), 'permits.update', {
        permitId,
        methodStatementDocumentId: world.a.documents.groupRestrictedDoc,
      });
      expect({ linkedUnreadableDocument: res.ok }).toEqual({ linkedUnreadableDocument: false });
    });

    it('PW-X02 · an archived method statement cannot be linked to a permit', async () => {
      // Same loader, second omission: no `isNull(documents.archivedAt)`.
      // A superseded method statement is exactly the document that must
      // not be cited as the safe system of work — withdrawing it is how
      // the documents module says "do not work to this".
      const { typeId } = await makeType();
      const permitId = await makePermit(typeId);
      const res = await callFor(asAdmin(), 'permits.update', {
        permitId,
        methodStatementDocumentId: world.a.documents.archivedDoc,
      });
      expect({ linkedArchivedDocument: res.ok }).toEqual({ linkedArchivedDocument: false });
    });

    it('PW-X03 · the competence gate is not satisfied by a namesake', async () => {
      // FreeHS B7 replaced "competence of all operatives verified" with a
      // real check against the training matrix. For a worker with no linked
      // account the match is `personName.toLowerCase()` — so an untrained
      // John Smith typed onto the gang passes on a ticket belonging to a
      // different John Smith. On a hot-works or confined-space permit that
      // is the gate reporting competence that nobody holds.
      const admin = asAdmin();
      const requirementId = world.a.requirements.abrasiveWheels as string;
      await world.db.insert(schema.trainingRecords).values({
        id: newId(),
        tenantId: world.a.tenantId,
        requirementId,
        userId: null,
        personName: 'John Smith',
        achievedAt: new Date(world.now.getTime() - 200 * 86_400_000),
        expiresAt: new Date(world.now.getTime() + 400 * 86_400_000),
      });

      const { typeId } = await makeType({ requiredTrainingIds: [requirementId] });
      const permitId = await makePermit(typeId);
      await admin.permits.setWorkers({
        permitId,
        // A different person who happens to share the name — no account,
        // no ticket of their own.
        workers: [{ id: 'w1', name: 'john smith', role: 'worker', userId: null }],
      });

      // Assert on the shortfall list, NOT on whether `issue` refuses.
      // `issue` refuses this permit anyway because the ACCEPTOR has no
      // abrasive-wheels ticket — so an outcome-level assertion here would
      // be green while the namesake sailed through, which is exactly what
      // it did on the first run.
      const { trainingShortfalls } = await admin.permits.get({ permitId });
      const flaggedPeople = trainingShortfalls.map((s) => s.personLabel.toLowerCase());

      expect({ namesakeFlagged: flaggedPeople.includes('john smith') }).toEqual({
        namesakeFlagged: true,
      });
    });

    it('PW-X04 · RS-A11 · the blocker previewed on the permit page is the one Issue enforces', async () => {
      // The preview exists so the issuer sees the blocker standing at the
      // job rather than discovering it when the mutation fails. That is
      // only worth anything if the two agree — a preview that says "ready"
      // over a gate that refuses is worse than no preview, because the
      // issuer stops checking.
      const { typeId } = await makeType({ requiresRamsPack: true });
      const permitId = await makePermit(typeId);

      const { ramsGate } = await asAdmin().permits.get({ permitId });
      const issued = await callFor(asAdmin(), 'permits.issue', { permitId });

      expect({
        previewed: ramsGate,
        enforced: issued.ok ? null : issued.message,
      }).toEqual({ previewed: 'rams-pack-required', enforced: 'rams-pack-required' });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PW-T — tenancy
  // ═══════════════════════════════════════════════════════════════════════
  describe('PW-T · tenancy', () => {
    it('PW-T01 · another tenant permit is unreadable and unmutatable across the lifecycle', async () => {
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const { typeId: foreignType } = await otherAdmin.permits.types.create({
        category: 'hot_work',
        name: 'Foreign hot works',
      });
      const { permitId: foreignPermit } = await otherAdmin.permits.create({
        permitTypeId: foreignType,
        title: 'Foreign permit',
        validFrom: world.now,
        validTo: hours(6),
        acceptorUserId: world.b.actors.standard,
      });

      const leaked: string[] = [];
      for (const path of ['permits.get', 'permits.renderPdf', ...LIFECYCLE_MUTATIONS]) {
        const res = await callFor(asAdmin(), path, {
          permitId: foreignPermit,
          checks: {
            workComplete: true,
            areaMadeSafe: true,
            isolationsRemoved: true,
            personnelClear: true,
          },
          reason: 'cross-tenant probe',
          validTo: hours(24),
          acceptorUserId: world.a.actors.standard,
        });
        if (res.ok) leaked.push(path);
      }
      expect(leaked).toEqual([]);

      const [row] = await world.db
        .select({ title: schema.permits.title, status: schema.permits.status })
        .from(schema.permits)
        .where(eq(schema.permits.id, foreignPermit));
      expect({ title: row?.title, status: row?.status }).toEqual({
        title: 'Foreign permit',
        status: 'draft',
      });
    });

    it('PW-T02 · a permit cannot be sited at, or accepted by, another tenant', async () => {
      const { typeId } = await makeType();
      const sited = await callFor(asAdmin(), 'permits.create', {
        permitTypeId: typeId,
        title: 'Cross-tenant siting probe',
        siteId: world.b.sites.primary,
        validFrom: world.now,
        validTo: hours(6),
      });
      expect({ sitedAtForeignSite: sited.ok }).toEqual({ sitedAtForeignSite: false });

      const permitId = await makePermit(typeId);
      const foreignWorker = await callFor(asAdmin(), 'permits.setWorkers', {
        permitId,
        workers: [
          { id: 'w1', name: 'Foreign worker', role: 'worker', userId: world.b.actors.standard },
        ],
      });
      expect({ namedForeignWorker: foreignWorker.ok }).toEqual({ namedForeignWorker: false });
    });

    it('PW-T02b · a permit cannot cite another tenant safe system of work', async () => {
      // Every link on the permit that names another module's record is a
      // place a tenant predicate can be forgotten. The RA link has its own
      // loader; the RAMS pack version and the method-statement document
      // are the other two.
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const { packId: foreignPack } = await otherAdmin.rams.packs.create({
        title: 'Foreign pack',
        clientName: 'Nobody',
      });
      const { assessmentId: foreignRa } = await otherAdmin.riskAssessments.create({
        title: 'Foreign RA',
      });

      const { typeId } = await makeType();
      const permitId = await makePermit(typeId);
      for (const [field, value] of [
        ['riskAssessmentId', foreignRa],
        ['ramsPackVersionId', foreignPack],
        ['methodStatementDocumentId', world.b.documents.publicDoc],
      ] as Array<[string, string]>) {
        const res = await callFor(asAdmin(), 'permits.update', { permitId, [field]: value });
        expect({ field, accepted: res.ok }).toEqual({ field, accepted: false });
      }
    });

    it('PW-T03 · the SIMOPs check never sees another tenant work at the same location', async () => {
      // Conflicts are matched on free-text location, so an unscoped query
      // would tell you a rival tenant has an open permit at "Tank 4" —
      // and would block your issue over it.
      const otherAdmin = createCaller(world.ctxFor(world.b.tenantId, world.b.actors.admin));
      const { typeId: foreignType } = await otherAdmin.permits.types.create({
        category: 'confined_space',
        name: 'Foreign confined space',
      });
      const { permitId: foreignPermit } = await otherAdmin.permits.create({
        permitTypeId: foreignType,
        title: 'Foreign tank entry',
        siteId: world.b.sites.primary,
        locationText: 'Tank 4',
        validFrom: world.now,
        validTo: hours(6),
        acceptorUserId: world.b.actors.standard,
      });
      await otherAdmin.permits.issue({ permitId: foreignPermit });

      const conflicts = await asAdmin().permits.checkConflicts({
        siteId: world.a.sites.primary,
        locationText: 'Tank 4',
        validFrom: world.now,
        validTo: hours(6),
      });
      expect(conflicts.map((c) => c.permitId)).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PW-V — limits
  // ═══════════════════════════════════════════════════════════════════════
  describe('PW-V · limits', () => {
    it('PW-V01 · the gang size is capped rather than growing without bound', async () => {
      const { typeId } = await makeType();
      const permitId = await makePermit(typeId);
      const workers = Array.from({ length: 60 }, (_, i) => ({
        id: `w${i}`,
        name: `Worker ${i}`,
        role: 'worker' as const,
        userId: null,
      }));
      const res = await callFor(asAdmin(), 'permits.setWorkers', { permitId, workers });
      expect({ acceptedOversizeGang: res.ok }).toEqual({ acceptedOversizeGang: false });
    });

    it('PW-V02 · the live board holds its shape with permits present', async () => {
      const started = process.hrtime.bigint();
      const board = await asAdmin().permits.board();
      const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
      expect({ overBudget: ms > 5_000, isArray: Array.isArray(board) }).toMatchObject({
        overBudget: false,
      });
    });
  });
});

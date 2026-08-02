/**
 * Integration tests for the permits router (FreeHS module B3 — Permit to
 * Work & High-Risk Activities).
 *
 * Edge cases (PW-E01..E05 are the pure-helper cases in
 * packages/shared/src/permits.test.ts; PW-J01/J02 are the expiry-watch
 * worker cases in packages/jobs/src/workers/permit-expiry-watch.test.ts):
 *   - PW-E10: types.list seeds the nine default permit types exactly once;
 *     permits.create stamps sequential PTW-XXXX refs
 *   - PW-E11: tenant isolation on permits.get
 *   - PW-E12: a disabled module (wrong brand) refuses every call
 *   - PW-E13: standard users can view but not create, issue or manage types
 *   - PW-E14: create snapshots the type's preconditions unchecked and
 *     validates the validity window (inverted, over-cap) and the acceptor
 *   - PW-E15: issue guards, in order — acceptor required, issuer ≠ acceptor,
 *     preconditions complete, gas test where required, isolation
 *     certificate where required, rescue plan where required, authorising
 *     signature where required, window not already expired
 *   - PW-E16: authorise → issue → accept stamps every signature and event;
 *     acceptance is restricted to the named acceptor; the authoriser can
 *     never be the acceptor
 *   - PW-E17: SIMOPs conflict detection — overlapping open permits at the
 *     same site warn (same-area flag), issue refuses without explicit
 *     acknowledgement, different sites / disjoint windows do not conflict
 *   - PW-E18: suspension needs a reason and an active permit; resume needs
 *     the safe-to-resume confirmation
 *   - PW-E19: extension must lengthen the window, is capped per extension,
 *     and requires the authorising engineer to re-authorise where the type
 *     demands one
 *   - PW-E20: shift handover re-points the acceptor, drops the permit back
 *     to issued until the incoming acceptor signs on, and refuses the
 *     issuer or the outgoing acceptor as the target
 *   - PW-E21: closure requires all four close-out checks; closed permits
 *     are terminal
 *   - PW-E22: an expired-but-open permit shows overdue on the board and in
 *     the overview, and can still be closed
 *   - PW-E23: cancellation — draft cancel by its creator, permits.issue for
 *     the rest; cancelled permits are terminal
 *   - PW-E24: gas readings and attachments append with actor stamps and
 *     events; precondition check / uncheck is logged
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { createLogger } from '@forma360/shared/logger';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../context';
import { appRouter } from '../router';
import { createPermitsRouter } from './permits';
import { createCallerFactory, router } from '../trpc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return { client, db };
}

const silentLogger = () =>
  createLogger({ service: 'permits-test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);

const HOUR = 3_600_000;
/** A validity window offset from now, in hours. */
function window(startInHours: number, lengthHours: number): { validFrom: Date; validTo: Date } {
  const validFrom = new Date(Date.now() + startInHours * HOUR);
  const validTo = new Date(validFrom.getTime() + lengthHours * HOUR);
  return { validFrom, validTo };
}

describe('permits router', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let managerId: string;
  let standardId: string;
  let standard2Id: string;
  let siteA: string;
  let siteB: string;

  function callerFor(userId: string) {
    return createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId, email: 'permits@x.test', tenantId: tenantId as never },
      }),
    );
  }

  /** Seeded type id by category (types.list auto-seeds). */
  async function typeId(category: string): Promise<string> {
    const types = await callerFor(adminId).permits.types.list({});
    const t = types.find((row) => row.category === category);
    if (t === undefined) throw new Error(`no seeded type for ${category}`);
    return t.id;
  }

  /** A requirement-free custom type for simple lifecycle tests. */
  async function simpleTypeId(): Promise<string> {
    const admin = callerFor(adminId);
    const existing = await admin.permits.types.list({});
    const found = existing.find((t) => t.name === 'General high-risk');
    if (found !== undefined) return found.id;
    const created = await admin.permits.types.create({
      category: 'other',
      name: 'General high-risk',
      maxDurationHours: 12,
      preconditions: [
        { id: 'area_ready', label: 'Work area prepared' },
        { id: 'briefing_done', label: 'Task briefing delivered' },
      ],
    });
    return created.typeId;
  }

  /** Check every precondition on a draft permit (as admin). */
  async function checkAll(permitId: string): Promise<void> {
    const admin = callerFor(adminId);
    const detail = await admin.permits.get({ permitId });
    for (const p of detail.preconditions) {
      await admin.permits.checkPrecondition({ permitId, preconditionId: p.id, checked: true });
    }
  }

  /** Draft → issued → active on the simple type: acceptor accepts. */
  async function activePermit(overrides?: {
    siteId?: string;
    locationText?: string;
    lengthHours?: number;
  }): Promise<string> {
    const admin = callerFor(adminId);
    const { permitId } = await admin.permits.create({
      permitTypeId: await simpleTypeId(),
      title: 'Tank farm maintenance',
      siteId: overrides?.siteId ?? siteA,
      locationText: overrides?.locationText ?? 'Bay 4',
      acceptorUserId: standardId,
      ...window(0, overrides?.lengthHours ?? 6),
    });
    await checkAll(permitId);
    await admin.permits.issue({ permitId, acknowledgeConflicts: true });
    await callerFor(standardId).permits.accept({ permitId });
    return permitId;
  }

  const allChecks = {
    workComplete: true,
    areaMadeSafe: true,
    isolationsRemoved: true,
    personnelClear: true,
  };

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db
      .insert(schema.tenants)
      .values({ id: tenantId, name: 'Acme', slug: `acme-${tenantId}` });
    const sets = await seedDefaultPermissionSets(db as never, tenantId);
    adminId = `usr_${newId()}`;
    managerId = `usr_${newId()}`;
    standardId = `usr_${newId()}`;
    standard2Id = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminId,
        name: 'Alice Admin',
        email: `alice-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.administrator,
      },
      {
        id: managerId,
        name: 'Mark Manager',
        email: `mark-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.manager,
      },
      {
        id: standardId,
        name: 'Stan Standard',
        email: `stan-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.standard,
      },
      {
        id: standard2Id,
        name: 'Nina Nights',
        email: `nina-${tenantId}@acme.test`,
        tenantId,
        permissionSetId: sets.standard,
      },
    ]);
    siteA = newId();
    siteB = newId();
    await db.insert(schema.sites).values([
      { id: siteA, tenantId, name: 'Refinery' },
      { id: siteB, tenantId, name: 'Depot' },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it('PW-E10: types.list seeds the nine defaults once; refs stamp sequentially', async () => {
    const admin = callerFor(adminId);
    const first = await admin.permits.types.list({});
    expect(first).toHaveLength(9);
    expect(first.every((t) => t.isSystem)).toBe(true);
    const categories = first.map((t) => t.category).sort();
    expect(new Set(categories).size).toBe(9);

    // Second call must not duplicate the seed.
    const second = await admin.permits.types.list({});
    expect(second).toHaveLength(9);
    expect(second.map((t) => t.id).sort()).toEqual(first.map((t) => t.id).sort());

    const hotWork = first.find((t) => t.category === 'hot_work');
    expect(hotWork?.requiresGasTesting).toBe(true);
    expect(hotWork?.preconditions.length).toBeGreaterThan(0);

    const a = await admin.permits.create({
      permitTypeId: await simpleTypeId(),
      title: 'First job',
      ...window(0, 4),
    });
    const b = await admin.permits.create({
      permitTypeId: await simpleTypeId(),
      title: 'Second job',
      ...window(0, 4),
    });
    expect(a.referenceNumber).toBe('PTW-0001');
    expect(b.referenceNumber).toBe('PTW-0002');
  });

  it('PW-E11: permits.get is tenant-isolated', async () => {
    const admin = callerFor(adminId);
    const { permitId } = await admin.permits.create({
      permitTypeId: await simpleTypeId(),
      title: 'Isolated job',
      ...window(0, 4),
    });

    const otherTenant = newId();
    await db
      .insert(schema.tenants)
      .values({ id: otherTenant, name: 'Rival', slug: `rival-${otherTenant}` });
    const otherSets = await seedDefaultPermissionSets(db as never, otherTenant);
    const otherUser = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: otherUser,
      name: 'Eve',
      email: `eve-${otherTenant}@rival.test`,
      tenantId: otherTenant,
      permissionSetId: otherSets.administrator,
    });
    const otherCaller = createCaller(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: otherUser, email: 'eve@rival.test', tenantId: otherTenant as never },
      }),
    );
    await expect(otherCaller.permits.get({ permitId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('PW-E12: a disabled module refuses every call', async () => {
    const disabledRouter = router({ permits: createPermitsRouter({ enabled: false }) });
    const disabledCaller = createCallerFactory(disabledRouter)(
      createTestContext({
        db: db as never,
        logger: silentLogger(),
        auth: { userId: adminId, email: 'a@x.test', tenantId: tenantId as never },
      }),
    );
    await expect(disabledCaller.permits.types.list({})).rejects.toMatchObject({
      message: 'module-disabled',
    });
    await expect(disabledCaller.permits.list({})).rejects.toMatchObject({
      message: 'module-disabled',
    });
    await expect(disabledCaller.permits.board()).rejects.toMatchObject({
      message: 'module-disabled',
    });
  });

  it('PW-E13: standard users can view but not create, issue or manage types', async () => {
    const admin = callerFor(adminId);
    const standard = callerFor(standardId);
    await admin.permits.create({
      permitTypeId: await simpleTypeId(),
      title: 'Visible job',
      ...window(0, 4),
    });

    const list = await standard.permits.list({ status: 'all' });
    expect(list).toHaveLength(1);
    await expect(
      standard.permits.create({
        permitTypeId: await simpleTypeId(),
        title: 'Nope',
        ...window(0, 4),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      standard.permits.types.create({ category: 'other', name: 'X', preconditions: [] }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Manager holds permits.create + permits.issue.
    const manager = callerFor(managerId);
    const created = await manager.permits.create({
      permitTypeId: await simpleTypeId(),
      title: 'Manager job',
      acceptorUserId: standardId,
      ...window(0, 4),
    });
    expect(created.referenceNumber).toBe('PTW-0002');
  });

  it('PW-E14: create snapshots preconditions and validates window + acceptor', async () => {
    const admin = callerFor(adminId);
    const hotWorkId = await typeId('hot_work');

    const { permitId } = await admin.permits.create({
      permitTypeId: hotWorkId,
      title: 'Welding on line 2',
      siteId: siteA,
      ...window(0, 6),
    });
    const detail = await admin.permits.get({ permitId });
    expect(detail.preconditions.length).toBeGreaterThanOrEqual(4);
    expect(detail.preconditions.every((p) => !p.checked && p.checkedBy === null)).toBe(true);
    expect(detail.status).toBe('draft');
    expect(detail.type.category).toBe('hot_work');

    // Inverted window.
    const w = window(2, 4);
    await expect(
      admin.permits.create({
        permitTypeId: hotWorkId,
        title: 'Backwards',
        validFrom: w.validTo,
        validTo: w.validFrom,
      }),
    ).rejects.toMatchObject({ message: 'window-invalid' });

    // Over the hot-work 12 h cap.
    await expect(
      admin.permits.create({ permitTypeId: hotWorkId, title: 'Marathon', ...window(0, 13) }),
    ).rejects.toMatchObject({ message: 'window-too-long' });

    // Acceptor must belong to the tenant.
    await expect(
      admin.permits.create({
        permitTypeId: hotWorkId,
        title: 'Ghost acceptor',
        acceptorUserId: 'usr_does_not_exist',
        ...window(0, 4),
      }),
    ).rejects.toMatchObject({ message: 'unknown-user' });

    // update revalidates the window against the type cap.
    await expect(
      admin.permits.update({ permitId, validFrom: w.validFrom, validTo: w.validFrom }),
    ).rejects.toMatchObject({ message: 'window-invalid' });
  });

  it('PW-E15: issue guards fire in order until the permit is complete', async () => {
    const admin = callerFor(adminId);

    // Simple type: acceptor first, then preconditions.
    const { permitId: simple } = await admin.permits.create({
      permitTypeId: await simpleTypeId(),
      title: 'Guarded job',
      ...window(0, 4),
    });
    await expect(admin.permits.issue({ permitId: simple })).rejects.toMatchObject({
      message: 'acceptor-required',
    });
    await admin.permits.update({ permitId: simple, acceptorUserId: adminId });
    await expect(admin.permits.issue({ permitId: simple })).rejects.toMatchObject({
      message: 'issuer-is-acceptor',
    });
    await admin.permits.update({ permitId: simple, acceptorUserId: standardId });
    await expect(admin.permits.issue({ permitId: simple })).rejects.toMatchObject({
      message: 'preconditions-incomplete',
    });
    await checkAll(simple);
    const issued = await admin.permits.issue({ permitId: simple });
    expect(issued.status).toBe('issued');

    // Hot work requires a recorded gas test.
    const { permitId: hot } = await admin.permits.create({
      permitTypeId: await typeId('hot_work'),
      title: 'Grinding',
      siteId: siteB,
      acceptorUserId: standardId,
      ...window(0, 4),
    });
    await checkAll(hot);
    await expect(admin.permits.issue({ permitId: hot })).rejects.toMatchObject({
      message: 'gas-test-required',
    });
    await admin.permits.recordGasReading({
      permitId: hot,
      substance: 'Flammable vapour',
      reading: 2,
      unit: 'percent_lel',
    });
    expect((await admin.permits.issue({ permitId: hot })).status).toBe('issued');

    // Electrical requires an isolation certificate AND an authorising signature.
    const { permitId: elec } = await admin.permits.create({
      permitTypeId: await typeId('electrical'),
      title: 'Busbar work',
      siteId: siteB,
      locationText: 'Substation 1',
      acceptorUserId: standardId,
      ...window(0, 4),
    });
    await checkAll(elec);
    await expect(admin.permits.issue({ permitId: elec })).rejects.toMatchObject({
      message: 'isolation-certificate-required',
    });
    await admin.permits.update({ permitId: elec, isolationCertificateRef: 'ISO-2231' });
    await expect(admin.permits.issue({ permitId: elec })).rejects.toMatchObject({
      message: 'authorisation-required',
    });

    // Work at height requires a rescue plan.
    const { permitId: wah } = await admin.permits.create({
      permitTypeId: await typeId('work_at_height'),
      title: 'Gutter clearance',
      siteId: siteB,
      locationText: 'North elevation',
      acceptorUserId: standardId,
      ...window(0, 4),
    });
    await checkAll(wah);
    await expect(admin.permits.issue({ permitId: wah })).rejects.toMatchObject({
      message: 'rescue-plan-required',
    });

    // A window already in the past cannot be issued.
    const { permitId: past } = await admin.permits.create({
      permitTypeId: await simpleTypeId(),
      title: 'Too late',
      acceptorUserId: standardId,
      ...window(-3, 2),
    });
    await checkAll(past);
    await expect(admin.permits.issue({ permitId: past })).rejects.toMatchObject({
      message: 'window-past',
    });
  });

  it('PW-E16: authorise → issue → accept stamps every signature and event', async () => {
    const admin = callerFor(adminId);
    const manager = callerFor(managerId);
    const standard = callerFor(standardId);

    const { permitId } = await admin.permits.create({
      permitTypeId: await typeId('electrical'),
      title: 'Panel replacement',
      siteId: siteA,
      locationText: 'MCC room',
      acceptorUserId: standardId,
      isolationCertificateRef: 'ISO-9917',
      ...window(0, 6),
    });
    await checkAll(permitId);

    // The acceptor cannot authorise their own permit.
    await db
      .update(schema.permits)
      .set({ acceptorUserId: managerId })
      .where(eq(schema.permits.id, permitId));
    await expect(manager.permits.authorise({ permitId })).rejects.toMatchObject({
      message: 'authoriser-is-acceptor',
    });
    await db
      .update(schema.permits)
      .set({ acceptorUserId: standardId })
      .where(eq(schema.permits.id, permitId));

    await manager.permits.authorise({ permitId });
    await expect(manager.permits.authorise({ permitId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    await admin.permits.issue({ permitId });

    // Only the named acceptor can accept.
    await expect(callerFor(standard2Id).permits.accept({ permitId })).rejects.toMatchObject({
      message: 'not-the-acceptor',
    });
    await standard.permits.accept({ permitId });

    const detail = await admin.permits.get({ permitId });
    expect(detail.status).toBe('active');
    expect(detail.authoriserUserId).toBe(managerId);
    expect(detail.authorisedAt).not.toBeNull();
    expect(detail.issuerUserId).toBe(adminId);
    expect(detail.issuedAt).not.toBeNull();
    expect(detail.acceptorUserId).toBe(standardId);
    expect(detail.acceptedAt).not.toBeNull();
    expect(detail.parties.authoriserName).toBe('Mark Manager');
    expect(detail.parties.issuerName).toBe('Alice Admin');
    expect(detail.parties.acceptorName).toBe('Stan Standard');

    const kinds = detail.events.map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['created', 'authorised', 'issued', 'accepted']));
  });

  it('PW-E17: overlapping open permits at the same site conflict; issue needs acknowledgement', async () => {
    const admin = callerFor(adminId);
    await activePermit({ siteId: siteA, locationText: 'Bay 4' });

    // Same site, overlapping window → one conflict; same normalised area.
    const conflicts = await admin.permits.checkConflicts({
      siteId: siteA,
      locationText: '  bay 4 ',
      ...window(1, 4),
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.sameArea).toBe(true);

    // Different site → no conflict. Disjoint window → no conflict.
    expect(await admin.permits.checkConflicts({ siteId: siteB, ...window(1, 4) })).toHaveLength(0);
    expect(await admin.permits.checkConflicts({ siteId: siteA, ...window(7, 4) })).toHaveLength(0);

    // Issuing a second overlapping permit without acknowledgement refuses.
    const { permitId: second } = await admin.permits.create({
      permitTypeId: await simpleTypeId(),
      title: 'Clashing job',
      siteId: siteA,
      locationText: 'Bay 4',
      acceptorUserId: standard2Id,
      ...window(1, 4),
    });
    await checkAll(second);
    await expect(admin.permits.issue({ permitId: second })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'simops-conflict',
    });
    const issued = await admin.permits.issue({ permitId: second, acknowledgeConflicts: true });
    expect(issued.status).toBe('issued');
  });

  it('PW-E18: suspend needs an active permit and a reason; resume needs confirmation', async () => {
    const admin = callerFor(adminId);
    const permitId = await activePermit();

    await admin.permits.suspend({ permitId, reason: 'Gas alarm in adjacent unit' });
    let detail = await admin.permits.get({ permitId });
    expect(detail.status).toBe('suspended');
    expect(detail.suspensionReason).toBe('Gas alarm in adjacent unit');

    await expect(
      admin.permits.resume({ permitId, confirmSafeToResume: false }),
    ).rejects.toMatchObject({ message: 'resume-confirmation-required' });
    await admin.permits.resume({ permitId, confirmSafeToResume: true });
    detail = await admin.permits.get({ permitId });
    expect(detail.status).toBe('active');
    expect(detail.suspendedAt).toBeNull();

    // Suspending a merely-issued permit is not a legal transition.
    const { permitId: draftOnly } = await admin.permits.create({
      permitTypeId: await simpleTypeId(),
      title: 'Not started',
      acceptorUserId: standardId,
      ...window(0, 4),
    });
    await checkAll(draftOnly);
    await admin.permits.issue({ permitId: draftOnly, acknowledgeConflicts: true });
    await expect(
      admin.permits.suspend({ permitId: draftOnly, reason: 'changed conditions' }),
    ).rejects.toMatchObject({ message: 'invalid-transition' });
  });

  it('PW-E19: extension lengthens the window, is capped, and needs re-authorisation', async () => {
    const admin = callerFor(adminId);
    const manager = callerFor(managerId);
    const permitId = await activePermit({ lengthHours: 4 });
    const before = await admin.permits.get({ permitId });

    // Must be later than the current end.
    await expect(
      admin.permits.extend({ permitId, newValidTo: new Date(before.validTo.getTime() - HOUR) }),
    ).rejects.toMatchObject({ message: 'extension-not-later' });

    // One extension may add at most maxDurationHours (12 h on the simple type).
    await expect(
      admin.permits.extend({
        permitId,
        newValidTo: new Date(before.validTo.getTime() + 13 * HOUR),
      }),
    ).rejects.toMatchObject({ message: 'extension-too-long' });

    const extended = await admin.permits.extend({
      permitId,
      newValidTo: new Date(before.validTo.getTime() + 2 * HOUR),
    });
    expect(extended.extensionCount).toBe(1);
    expect(new Date(extended.validTo).getTime()).toBe(before.validTo.getTime() + 2 * HOUR);

    // An authoriser-required type only extends under the authoriser's hand.
    const { permitId: elec } = await admin.permits.create({
      permitTypeId: await typeId('electrical'),
      title: 'HV switching',
      siteId: siteB,
      acceptorUserId: standardId,
      isolationCertificateRef: 'ISO-1',
      ...window(0, 6),
    });
    await checkAll(elec);
    await manager.permits.authorise({ permitId: elec });
    await admin.permits.issue({ permitId: elec });
    await callerFor(standardId).permits.accept({ permitId: elec });

    const elecBefore = await admin.permits.get({ permitId: elec });
    await expect(
      admin.permits.extend({
        permitId: elec,
        newValidTo: new Date(elecBefore.validTo.getTime() + HOUR),
      }),
    ).rejects.toMatchObject({ message: 'reauthorisation-required' });
    const reExtended = await manager.permits.extend({
      permitId: elec,
      newValidTo: new Date(elecBefore.validTo.getTime() + HOUR),
    });
    expect(reExtended.extensionCount).toBe(1);
  });

  it('PW-E20: handover re-points the acceptor and demands re-acceptance', async () => {
    const admin = callerFor(adminId);
    const permitId = await activePermit();

    // The issuer cannot become the acceptor; the current acceptor is a no-op.
    await expect(admin.permits.handover({ permitId, toUserId: adminId })).rejects.toMatchObject({
      message: 'acceptor-is-issuer',
    });
    await expect(admin.permits.handover({ permitId, toUserId: standardId })).rejects.toMatchObject({
      message: 'same-acceptor',
    });

    // A bystander without permits.issue cannot hand over.
    await expect(
      callerFor(standard2Id).permits.handover({ permitId, toUserId: standard2Id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // The outgoing acceptor hands over to the night shift.
    await callerFor(standardId).permits.handover({ permitId, toUserId: standard2Id });
    let detail = await admin.permits.get({ permitId });
    expect(detail.status).toBe('issued');
    expect(detail.acceptorUserId).toBe(standard2Id);
    expect(detail.acceptedAt).toBeNull();

    await callerFor(standard2Id).permits.accept({ permitId });
    detail = await admin.permits.get({ permitId });
    expect(detail.status).toBe('active');
    expect(detail.events.map((e) => e.kind)).toEqual(expect.arrayContaining(['handed_over']));
  });

  it('PW-E21: closure requires all four checks; closed permits are terminal', async () => {
    const admin = callerFor(adminId);
    const permitId = await activePermit();

    await expect(
      admin.permits.close({
        permitId,
        checks: { ...allChecks, isolationsRemoved: false },
      }),
    ).rejects.toMatchObject({ message: 'closure-checks-incomplete' });

    await admin.permits.close({ permitId, checks: allChecks, notes: 'All clear' });
    const detail = await admin.permits.get({ permitId });
    expect(detail.status).toBe('closed');
    expect(detail.closedBy).toBe(adminId);
    expect(detail.closureNotes).toBe('All clear');

    await expect(
      admin.permits.suspend({ permitId, reason: 'too late anyway' }),
    ).rejects.toMatchObject({ message: 'invalid-transition' });
    await expect(admin.permits.close({ permitId, checks: allChecks })).rejects.toMatchObject({
      message: 'invalid-transition',
    });
  });

  it('PW-E22: an expired open permit is overdue on the board and still closable', async () => {
    const admin = callerFor(adminId);
    const permitId = await activePermit({ lengthHours: 2 });

    // Force the validity window into the past — the permit was never closed.
    await db
      .update(schema.permits)
      .set({ validTo: new Date(Date.now() - HOUR) })
      .where(eq(schema.permits.id, permitId));

    const board = await admin.permits.board();
    const row = board.permits.find((p) => p.id === permitId);
    expect(row?.overdue).toBe(true);

    const overview = await admin.permits.overview();
    expect(overview.overdue).toBe(1);
    expect(overview.active).toBe(1);

    await admin.permits.close({ permitId, checks: allChecks });
    const after = await admin.permits.board();
    expect(after.permits.find((p) => p.id === permitId)).toBeUndefined();
  });

  it('PW-E23: draft cancel by its creator; permits.issue for the rest; terminal', async () => {
    const admin = callerFor(adminId);
    const manager = callerFor(managerId);

    const { permitId } = await manager.permits.create({
      permitTypeId: await simpleTypeId(),
      title: 'Doomed draft',
      ...window(0, 4),
    });

    // A standard user (neither creator nor permits.issue) cannot cancel.
    await expect(
      callerFor(standardId).permits.cancel({ permitId, reason: 'not mine to cancel' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await manager.permits.cancel({ permitId, reason: 'Job descoped' });
    const detail = await admin.permits.get({ permitId });
    expect(detail.status).toBe('cancelled');
    expect(detail.cancellationReason).toBe('Job descoped');

    await expect(manager.permits.cancel({ permitId, reason: 'again' })).rejects.toMatchObject({
      message: 'invalid-transition',
    });

    // An active permit cancels under permits.issue.
    const active = await activePermit();
    await manager.permits.cancel({ permitId: active, reason: 'Weather closed the site' });
    expect((await admin.permits.get({ permitId: active })).status).toBe('cancelled');
  });

  it('PW-E24: gas readings, attachments and precondition checks append with events', async () => {
    const admin = callerFor(adminId);
    const { permitId } = await admin.permits.create({
      permitTypeId: await typeId('confined_space'),
      title: 'Vessel entry',
      siteId: siteA,
      acceptorUserId: standardId,
      ...window(0, 4),
    });

    await admin.permits.recordGasReading({
      permitId,
      substance: 'O2',
      reading: 20.9,
      unit: 'percent_o2',
      note: 'Pre-entry test',
    });
    await admin.permits.addAttachment({
      permitId,
      kind: 'isolation_certificate',
      storageKey: `${tenantId}/permits/${permitId}/iso-cert.pdf`,
      filename: 'iso-cert.pdf',
    });

    const detail = await admin.permits.get({ permitId });
    expect(detail.gasReadings).toHaveLength(1);
    expect(detail.gasReadings[0]?.takenByName).toBe('Alice Admin');
    expect(detail.gasReadings[0]?.reading).toBe(20.9);
    expect(detail.attachments).toHaveLength(1);
    expect(detail.attachments[0]?.kind).toBe('isolation_certificate');

    const first = detail.preconditions[0];
    expect(first).toBeDefined();
    if (first === undefined) throw new Error('unreachable');
    await admin.permits.checkPrecondition({
      permitId,
      preconditionId: first.id,
      checked: true,
      note: 'Verified on site',
    });
    let after = await admin.permits.get({ permitId });
    expect(after.preconditions[0]?.checked).toBe(true);
    expect(after.preconditions[0]?.checkedByName).toBe('Alice Admin');
    expect(after.preconditions[0]?.note).toBe('Verified on site');

    await admin.permits.checkPrecondition({ permitId, preconditionId: first.id, checked: false });
    after = await admin.permits.get({ permitId });
    expect(after.preconditions[0]?.checked).toBe(false);

    const kinds = after.events.map((e) => e.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'gas_reading_recorded',
        'attachment_added',
        'precondition_checked',
        'precondition_unchecked',
      ]),
    );

    // Unknown precondition ids are refused.
    await expect(
      admin.permits.checkPrecondition({ permitId, preconditionId: 'nope', checked: true }),
    ).rejects.toMatchObject({ message: 'unknown-precondition' });
  });
});

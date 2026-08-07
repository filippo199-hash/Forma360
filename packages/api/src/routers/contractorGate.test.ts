/**
 * Contractors router — gate check-in (Phase 2b).
 *
 * Covers configurable capture fields, staff check-in writing an audit event
 * with captured answers, and the public self-scan kiosk (token → today's
 * visits + fields → self check-in), including required-field enforcement.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from '../context';
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';

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

const createCaller = createCallerFactory(appRouter);
const silentLogger = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

describe('contractors gate (Phase 2b)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let contractorId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@x.test`, tenantId: tenantId as never },
    });
  }
  function publicCtx(): Context {
    return createTestContext({ db: db as unknown as Database, logger: silentLogger(), auth: null });
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminUserId = newId();
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Admin',
      email: 'admin@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
    const caller = createCaller(ctxFor(adminUserId));
    ({ id: contractorId } = await caller.contractors.create({ name: 'Sparky Electrical' }));
  });

  afterEach(async () => {
    await client.close();
  });

  it('configures capture fields and records them on staff check-in', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: fieldId } = await caller.contractors.gateFields.create({
      label: 'Vehicle reg',
      fieldType: 'text',
      required: true,
    });
    const fields = await caller.contractors.gateFields.list();
    expect(fields.map((f) => f.label)).toEqual(['Vehicle reg']);

    const { id: visitId } = await caller.contractors.visits.create({
      contractorId,
      title: 'Rewire',
      scheduledStart: new Date().toISOString(),
      authorize: true,
    });
    await caller.contractors.visits.checkIn({
      id: visitId,
      capturedFields: { [fieldId]: 'AB12 CDE' },
    });

    const events = await caller.contractors.visits.events({ visitId });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('check_in');
    expect(events[0]?.method).toBe('staff');
    expect(events[0]?.actorName).toBe('Admin');
    expect(events[0]?.capturedFields).toEqual({ [fieldId]: 'AB12 CDE' });
  });

  it('self-scan kiosk lists today visits + fields and checks in via token', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await caller.contractors.gateFields.create({ label: 'Induction done?', fieldType: 'yes_no' });
    const { id: visitId } = await caller.contractors.visits.create({
      contractorId,
      title: 'Rewire',
      scheduledStart: new Date().toISOString(),
      authorize: true,
    });
    const { token } = await caller.contractors.gate.regenerateToken();

    const pub = createCaller(publicCtx());
    const kiosk = await pub.contractors.gate.publicByToken({ token });
    expect(kiosk.visits.map((v) => v.id)).toContain(visitId);
    expect(kiosk.fields.map((f) => f.label)).toEqual(['Induction done?']);

    await pub.contractors.gate.selfCheckIn({ token, visitId, eventType: 'check_in' });
    const events = await caller.contractors.visits.events({ visitId });
    expect(events[0]?.method).toBe('self_scan');
    expect(events[0]?.actorName).toBeNull();
    const visit = await caller.contractors.visits.get({ id: visitId });
    expect(visit.visit.status).toBe('checked_in');
  });

  it('self-scan rejects check-in that omits a required field', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id: fieldId } = await caller.contractors.gateFields.create({
      label: 'Vehicle reg',
      required: true,
    });
    const { id: visitId } = await caller.contractors.visits.create({
      contractorId,
      title: 'Rewire',
      scheduledStart: new Date().toISOString(),
      authorize: true,
    });
    const { token } = await caller.contractors.gate.regenerateToken();
    const pub = createCaller(publicCtx());

    await expect(
      pub.contractors.gate.selfCheckIn({ token, visitId, eventType: 'check_in' }),
    ).rejects.toThrow(/required/i);

    // Providing the field succeeds.
    await pub.contractors.gate.selfCheckIn({
      token,
      visitId,
      eventType: 'check_in',
      capturedFields: { [fieldId]: 'AB12 CDE' },
    });
    const visit = await caller.contractors.visits.get({ id: visitId });
    expect(visit.visit.status).toBe('checked_in');
  });

  it('CT-G06: a site kiosk shows only its own site, and admits only its own site', async () => {
    // One token used to unlock every reception screen in the company: each
    // kiosk listed every site's arrivals — names, companies, times, with no
    // session — and could admit a visit booked somewhere else.
    const caller = createCaller(ctxFor(adminUserId));
    const siteA = await caller.sites.create({ name: 'Depot A' });
    const siteB = await caller.sites.create({ name: 'Depot B' });

    const { id: visitA } = await caller.contractors.visits.create({
      contractorId,
      title: 'Rewire A',
      siteId: siteA.id,
      scheduledStart: new Date().toISOString(),
      authorize: true,
    });
    const { id: visitB } = await caller.contractors.visits.create({
      contractorId,
      title: 'Rewire B',
      siteId: siteB.id,
      scheduledStart: new Date().toISOString(),
      authorize: true,
    });

    const { token: tokenA } = await caller.contractors.gate.regenerateToken({ siteId: siteA.id });
    const { token: tokenB } = await caller.contractors.gate.regenerateToken({ siteId: siteB.id });
    expect(tokenA).not.toBe(tokenB);

    const pub = createCaller(publicCtx());
    const kioskA = await pub.contractors.gate.publicByToken({ token: tokenA });
    expect(kioskA.siteName).toBe('Depot A');
    expect(kioskA.visits.map((v) => v.id)).toContain(visitA);
    expect(kioskA.visits.map((v) => v.id)).not.toContain(visitB);

    // Kiosk A cannot admit a visit booked for site B.
    await expect(
      pub.contractors.gate.selfCheckIn({ token: tokenA, visitId: visitB, eventType: 'check_in' }),
    ).rejects.toThrow();
    await expect(
      pub.contractors.gate.selfCheckIn({ token: tokenA, visitId: visitA, eventType: 'check_in' }),
    ).resolves.toBeDefined();
  });

  it('CT-G06: revoking one kiosk leaves the others alive', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const siteA = await caller.sites.create({ name: 'Depot A' });
    const siteB = await caller.sites.create({ name: 'Depot B' });
    const { token: tokenA } = await caller.contractors.gate.regenerateToken({ siteId: siteA.id });
    const { token: tokenB } = await caller.contractors.gate.regenerateToken({ siteId: siteB.id });

    const revoked = await caller.contractors.gate.revokeToken({ siteId: siteA.id });
    expect(revoked.revoked).toBe(1);
    // Revoking again is honest about having found nothing.
    expect((await caller.contractors.gate.revokeToken({ siteId: siteA.id })).revoked).toBe(0);

    const pub = createCaller(publicCtx());
    await expect(pub.contractors.gate.publicByToken({ token: tokenA })).rejects.toThrow();
    await expect(pub.contractors.gate.publicByToken({ token: tokenB })).resolves.toBeDefined();
  });

  it('CT-G06: a visit with no site stays reachable from every kiosk', async () => {
    // `contractorVisits.siteId` is nullable and `visits.create` never
    // required it, so most existing rows have none. Hiding them would
    // strand anyone already checked in under such a visit with no screen
    // to check out from.
    const caller = createCaller(ctxFor(adminUserId));
    const site = await caller.sites.create({ name: 'Depot' });
    const { id: unsited } = await caller.contractors.visits.create({
      contractorId,
      title: 'No site recorded',
      scheduledStart: new Date().toISOString(),
      authorize: true,
    });
    const { token } = await caller.contractors.gate.regenerateToken({ siteId: site.id });
    const pub = createCaller(publicCtx());
    const kiosk = await pub.contractors.gate.publicByToken({ token });
    expect(kiosk.visits.map((v) => v.id)).toContain(unsited);
    await expect(
      pub.contractors.gate.selfCheckIn({ token, visitId: unsited, eventType: 'check_in' }),
    ).resolves.toBeDefined();
  });

  it('CT-G08: a suspended contractor is barred at the gate and cannot be waived', async () => {
    // A manual override REPLACES the derived status, and only
    // `non_compliant` was refused — so suspending a contractor whose
    // paperwork had also lapsed converted a refusal into an admission.
    const caller = createCaller(ctxFor(adminUserId));
    await caller.contractors.setComplianceOverride({ id: contractorId, override: 'suspended' });
    const { id: visitId } = await caller.contractors.visits.create({
      contractorId,
      title: 'Rewire',
      scheduledStart: new Date().toISOString(),
      authorize: true,
    });
    // Not even with an override reason — a suspension is not a desk call.
    await expect(
      caller.contractors.visits.checkIn({ id: visitId, overrideReason: 'Manager said ok' }),
    ).rejects.toThrow(/contractor_suspended/);

    const { token } = await caller.contractors.gate.regenerateToken();
    const pub = createCaller(publicCtx());
    await expect(
      pub.contractors.gate.selfCheckIn({ token, visitId, eventType: 'check_in' }),
    ).rejects.toThrow(/contractor_suspended/);
  });

  it('CT-G05: a second scan cannot re-stamp the check-in time', async () => {
    // The overstay worker measures from `checkedInAt`, so a contractor
    // could clear their own overstay alert simply by scanning again.
    const caller = createCaller(ctxFor(adminUserId));
    const { id: visitId } = await caller.contractors.visits.create({
      contractorId,
      title: 'Rewire',
      scheduledStart: new Date().toISOString(),
      authorize: true,
    });
    const { token } = await caller.contractors.gate.regenerateToken();
    const pub = createCaller(publicCtx());
    await pub.contractors.gate.selfCheckIn({ token, visitId, eventType: 'check_in' });
    const first = (await caller.contractors.visits.get({ id: visitId })).visit.checkedInAt;
    await expect(
      pub.contractors.gate.selfCheckIn({ token, visitId, eventType: 'check_in' }),
    ).rejects.toThrow(/visit-already-checked-in/);
    expect((await caller.contractors.visits.get({ id: visitId })).visit.checkedInAt).toEqual(first);
  });

  it('an invalid kiosk token is rejected', async () => {
    const pub = createCaller(publicCtx());
    await expect(pub.contractors.gate.publicByToken({ token: 'nope-nope-nope' })).rejects.toThrow();
  });
});

/**
 * PF-19 (platform HSE review): the compliance gate + versioned induction.
 *
 * Edge cases:
 *   - CG-E10: staff check-in refuses a non-compliant contractor without an
 *     override reason; proceeds WITH one and records it on the event
 *   - CG-E11: the kiosk hard-blocks a non-compliant contractor and the
 *     kiosk listing carries complianceStatus
 *   - CG-E12: walk-in passes the same gate as staff check-in
 *   - CG-E13: a manual compliance override to compliant unblocks the gate
 *   - CI-E01: induction is versioned — editing the text forces portal users
 *     to re-acknowledge before contractor-scoped reads work again
 *   - CV-E10: onSiteWithOpenPermits joins checked-in visits to open permits
 *     held by the contractor's people
 */
describe('contractor compliance gate + induction (PF-19)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let contractorId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silentLogger(),
      auth: { userId, email: `${userId}@x.test`, tenantId: tenantId as never },
    });
  }
  function publicCtx(): Context {
    return createTestContext({ db: db as unknown as Database, logger: silentLogger(), auth: null });
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: `a-${tenantId}` });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminUserId = newId();
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Admin',
      email: `admin-${tenantId}@acme.test`,
      tenantId,
      permissionSetId: seeded.administrator,
    });
    const caller = createCaller(ctxFor(adminUserId));
    ({ id: contractorId } = await caller.contractors.create({ name: 'Sparky Electrical' }));
    // A blocking requirement with no verified document → non-compliant.
    await caller.contractors.addRequirement({
      contractorId,
      name: 'Public liability insurance',
      blocking: true,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  async function scheduledVisit(): Promise<string> {
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.visits.create({
      contractorId,
      title: 'Rewire',
      scheduledStart: new Date().toISOString(),
      authorize: true,
    });
    return id;
  }

  it('CG-E10: staff check-in blocks non-compliant without a reason; records the override', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const visitId = await scheduledVisit();
    await expect(caller.contractors.visits.checkIn({ id: visitId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'contractor_non_compliant',
    });

    await caller.contractors.visits.checkIn({
      id: visitId,
      overrideReason: 'Insurance renewal certificate sighted on paper at the gate',
    });
    const events = await caller.contractors.visits.events({ visitId });
    expect(events[0]?.overrideReason).toMatch(/sighted on paper/);
  });

  it('CG-E11: kiosk hard-blocks non-compliant and shows compliance on the list', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const visitId = await scheduledVisit();
    const { token } = await caller.contractors.gate.regenerateToken();
    const pub = createCaller(publicCtx());
    const listing = await pub.contractors.gate.publicByToken({ token });
    expect(listing.visits[0]?.complianceStatus).toBe('non_compliant');
    await expect(
      pub.contractors.gate.selfCheckIn({ token, visitId, eventType: 'check_in' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'contractor_non_compliant' });
  });

  it('CG-E12: walk-in passes the same gate', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await expect(
      caller.contractors.visits.createWalkIn({ contractorId, title: 'Emergency callout' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'contractor_non_compliant' });
    const { id } = await caller.contractors.visits.createWalkIn({
      contractorId,
      title: 'Emergency callout',
      overrideReason: 'Burst main - authorised by duty manager',
    });
    const events = await caller.contractors.visits.events({ visitId: id });
    expect(events[0]?.overrideReason).toMatch(/duty manager/);
  });

  it('CG-E13: a manual compliant override unblocks the gate', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    await caller.contractors.setComplianceOverride({ id: contractorId, override: 'compliant' });
    const visitId = await scheduledVisit();
    await caller.contractors.visits.checkIn({ id: visitId });
    const visit = await caller.contractors.visits.get({ id: visitId });
    expect(visit.visit.status).toBe('checked_in');
  });

  it('CI-E01: induction version bump forces re-acknowledgement server-side', async () => {
    const admin = createCaller(ctxFor(adminUserId));
    await admin.contractors.induction.set({ body: 'Site rules v1: hard hats everywhere.' });

    // A portal user with the observations activity.
    const portalSetId = newId();
    await db.insert(schema.permissionSets).values({
      id: portalSetId,
      tenantId,
      name: 'Portal: Sparky',
      permissions: ['issues.view', 'issues.report'],
    });
    const portalUserId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: portalUserId,
      name: 'Paula Portal',
      email: `paula-${tenantId}@sparky.test`,
      tenantId,
      permissionSetId: portalSetId,
    });
    await db.insert(schema.contractorUsers).values({
      id: newId(),
      tenantId,
      contractorId,
      userId: portalUserId,
      activities: ['observations'],
    });
    const portal = createCaller(ctxFor(portalUserId));

    // Not yet acknowledged → contractor-scoped reads are refused server-side.
    await expect(portal.issues.issues.list({})).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'induction_required',
    });

    await portal.contractors.users.acknowledge();
    await expect(portal.issues.issues.list({})).resolves.toBeDefined();
    const me1 = await portal.contractors.users.me();
    expect(me1?.inductionCurrent).toBe(true);
    expect(me1?.inductionVersion).toBe(1);

    // Editing the text bumps the version → stale ack blocks again.
    const v2 = await admin.contractors.induction.set({
      body: 'Site rules v2: hard hats AND eye protection.',
    });
    expect(v2.version).toBe(2);
    await expect(portal.issues.issues.list({})).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'induction_required',
    });
    const me2 = await portal.contractors.users.me();
    expect(me2?.inductionCurrent).toBe(false);

    await portal.contractors.users.acknowledge();
    await expect(portal.issues.issues.list({})).resolves.toBeDefined();

    // Saving identical text does NOT bump the version.
    const same = await admin.contractors.induction.set({
      body: 'Site rules v2: hard hats AND eye protection.',
    });
    expect(same.version).toBe(2);
  });

  it('CV-E10: onSiteWithOpenPermits joins checked-in visits to open permits', async () => {
    const admin = createCaller(ctxFor(adminUserId));
    await admin.contractors.setComplianceOverride({ id: contractorId, override: 'compliant' });

    // Contractor person who accepted an active permit.
    const workerId = `usr_${newId()}`;
    const workerSetId = newId();
    await db.insert(schema.permissionSets).values({
      id: workerSetId,
      tenantId,
      name: 'Portal worker',
      permissions: [],
    });
    await db.insert(schema.user).values({
      id: workerId,
      name: 'Wes Welder',
      email: `wes-${tenantId}@sparky.test`,
      tenantId,
      permissionSetId: workerSetId,
    });
    await db.insert(schema.contractorUsers).values({
      id: newId(),
      tenantId,
      contractorId,
      userId: workerId,
      activities: [],
      acknowledgedAt: new Date(),
      acknowledgedVersion: 1,
    });
    const permitTypeId = newId();
    await db.insert(schema.permitTypes).values({
      id: permitTypeId,
      tenantId,
      category: 'hot_work',
      name: 'Hot work',
      createdBy: adminUserId,
    });
    const now = Date.now();
    await db.insert(schema.permits).values([
      {
        id: newId(),
        tenantId,
        permitTypeId,
        referenceNumber: 'PTW-0001',
        title: 'Roof torch-on',
        status: 'active',
        validFrom: new Date(now - 3_600_000),
        validTo: new Date(now + 3_600_000),
        acceptorUserId: workerId,
        createdBy: adminUserId,
      },
      {
        id: newId(),
        tenantId,
        permitTypeId,
        referenceNumber: 'PTW-0002',
        title: 'Old job',
        status: 'closed',
        validFrom: new Date(now - 7_200_000),
        validTo: new Date(now - 3_600_000),
        acceptorUserId: workerId,
        createdBy: adminUserId,
      },
    ]);

    // No visit checked in yet → empty.
    expect(await admin.contractors.visits.onSiteWithOpenPermits()).toEqual([]);

    const { id: visitId } = await admin.contractors.visits.createWalkIn({
      contractorId,
      title: 'Roof works',
    });
    const rows = await admin.contractors.visits.onSiteWithOpenPermits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      visitId,
      contractorName: 'Sparky Electrical',
      permitReference: 'PTW-0001',
      permitStatus: 'active',
    });
  });
});

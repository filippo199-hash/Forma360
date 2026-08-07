/**
 * Contractors router — visits / calendar sub-router (Phase 2a).
 *
 * Covers the visit lifecycle (schedule → authorise → check-in → check-out),
 * walk-ins (created already checked-in), calendar range filtering, and the
 * check-out guard (can't check out something never checked in).
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

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

describe('contractors.visits router', () => {
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

  it('schedules a visit, authorises it, then checks in and out', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.visits.create({
      contractorId,
      title: 'Rewire east wing',
      scheduledStart: inDays(2),
    });

    let visit = await caller.contractors.visits.get({ id });
    expect(visit.visit.status).toBe('scheduled');
    expect(visit.visit.authorizedByUserId).toBeNull();
    expect(visit.contractorName).toBe('Sparky Electrical');

    await caller.contractors.visits.authorize({ id });
    visit = await caller.contractors.visits.get({ id });
    expect(visit.visit.authorizedByUserId).toBe(adminUserId);
    expect(visit.authorizedByName).toBe('Admin');

    await caller.contractors.visits.checkIn({ id });
    visit = await caller.contractors.visits.get({ id });
    expect(visit.visit.status).toBe('checked_in');
    expect(visit.visit.checkedInAt).not.toBeNull();

    await caller.contractors.visits.checkOut({ id });
    visit = await caller.contractors.visits.get({ id });
    expect(visit.visit.status).toBe('checked_out');
    expect(visit.visit.checkedOutAt).not.toBeNull();
  });

  it('create with authorize:true stamps the authoriser immediately', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.visits.create({
      contractorId,
      title: 'Pre-approved visit',
      scheduledStart: inDays(1),
      authorize: true,
    });
    const visit = await caller.contractors.visits.get({ id });
    expect(visit.visit.authorizedByUserId).toBe(adminUserId);
  });

  it('walk-ins are created already checked-in and authorised', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.visits.createWalkIn({
      contractorId,
      title: 'Unplanned callout',
    });
    const visit = await caller.contractors.visits.get({ id });
    expect(visit.visit.status).toBe('checked_in');
    expect(visit.visit.isWalkIn).toBe(true);
    expect(visit.visit.checkedInAt).not.toBeNull();
    expect(visit.visit.authorizedByUserId).toBe(adminUserId);
  });

  it('cannot check out a visit that was never checked in', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.visits.create({
      contractorId,
      title: 'Future visit',
      scheduledStart: inDays(3),
    });
    // CT-L03: the refusal is now a slug from the shared visit state
    // machine, so the desk and the kiosk cannot disagree about it.
    await expect(caller.contractors.visits.checkOut({ id })).rejects.toThrow(
      /visit-not-checked-in/,
    );
  });

  it('CT-L02: a visit cannot be deleted or cancelled while someone is on site', async () => {
    // The on-site board is what a fire marshal reads at the assembly
    // point. Archiving a checked-in visit erased someone physically
    // present, with no check-out and no record they ever left.
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.visits.createWalkIn({
      contractorId,
      title: 'On site now',
    });
    await expect(caller.contractors.visits.delete({ id })).rejects.toThrow(/visit-on-site/);
    await expect(caller.contractors.visits.setStatus({ id, status: 'cancelled' })).rejects.toThrow(
      /visit-on-site/,
    );

    // Check them out first, then it is fine.
    await caller.contractors.visits.checkOut({ id });
    await expect(caller.contractors.visits.delete({ id })).resolves.toBeDefined();
  });

  it('CT-L03: a second check-out cannot overwrite the real departure time', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.visits.createWalkIn({
      contractorId,
      title: 'Leaving',
    });
    await caller.contractors.visits.checkOut({ id });
    const first = (await caller.contractors.visits.get({ id })).visit.checkedOutAt;
    await expect(caller.contractors.visits.checkOut({ id })).rejects.toThrow(
      /visit-already-checked-out/,
    );
    expect((await caller.contractors.visits.get({ id })).visit.checkedOutAt).toEqual(first);
  });

  it('CT-L04: re-entry after a genuine check-out clears the old departure', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.visits.createWalkIn({
      contractorId,
      title: 'In and out and in',
    });
    await caller.contractors.visits.checkOut({ id });
    await caller.contractors.visits.checkIn({ id });
    const visit = (await caller.contractors.visits.get({ id })).visit;
    expect(visit.status).toBe('checked_in');
    // A stale `checkedOutAt` alongside `checked_in` reads as "left at 14:02"
    // for someone standing in the building.
    expect(visit.checkedOutAt).toBeNull();
  });

  it('CT-L01: the desk enforces required gate questions, same as the kiosk', async () => {
    // A staff-recorded arrival used to produce an event indistinguishable
    // from one where the induction question had actually been asked.
    const caller = createCaller(ctxFor(adminUserId));
    await caller.contractors.gateFields.create({
      label: 'Site induction completed?',
      fieldType: 'yes_no',
      required: true,
    });
    const { id } = await caller.contractors.visits.create({
      contractorId,
      title: 'Rewire',
      scheduledStart: new Date().toISOString(),
      authorize: true,
    });
    await expect(caller.contractors.visits.checkIn({ id })).rejects.toThrow(/gate_field_required/);
  });

  it('CT-P03: a gate operator can check in and out without contractors.manage', async () => {
    // `contractors.gate` existed in the catalogue and gated NO procedure —
    // ticking it granted nothing, and the only way to let a receptionist
    // check someone in was `contractors.manage`, which also authorises
    // rename, archive, delete and token rotation.
    const gateSetId = newId();
    await db.insert(schema.permissionSets).values({
      id: gateSetId,
      tenantId,
      name: 'Reception',
      permissions: ['contractors.view', 'contractors.gate'],
    });
    const receptionistId = newId();
    await db.insert(schema.user).values({
      id: receptionistId,
      name: 'Reception',
      email: 'reception@acme.test',
      tenantId,
      permissionSetId: gateSetId,
    });

    const admin = createCaller(ctxFor(adminUserId));
    const { id } = await admin.contractors.visits.create({
      contractorId,
      title: 'Rewire',
      scheduledStart: new Date().toISOString(),
      authorize: true,
    });

    const reception = createCaller(ctxFor(receptionistId));
    await expect(reception.contractors.visits.checkIn({ id })).resolves.toBeDefined();
    await expect(reception.contractors.visits.checkOut({ id })).resolves.toBeDefined();
    await expect(
      reception.contractors.visits.createWalkIn({ contractorId, title: 'Walk-in' }),
    ).resolves.toBeDefined();

    // …but not the admin operations that share the module.
    await expect(reception.contractors.visits.delete({ id })).rejects.toThrow(/permission/i);
    await expect(
      reception.contractors.update({ id: contractorId, name: 'Renamed' }),
    ).rejects.toThrow(/permission/i);
  });

  it('calendar list returns only visits inside the range; delete hides them', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const soon = await caller.contractors.visits.create({
      contractorId,
      title: 'Soon',
      scheduledStart: inDays(1),
    });
    await caller.contractors.visits.create({
      contractorId,
      title: 'Far future',
      scheduledStart: inDays(60),
    });

    const inRange = await caller.contractors.visits.list({ from: inDays(0), to: inDays(7) });
    expect(inRange.map((v) => v.title)).toEqual(['Soon']);

    await caller.contractors.visits.delete({ id: soon.id });
    const afterDelete = await caller.contractors.visits.list({ from: inDays(0), to: inDays(7) });
    expect(afterDelete).toHaveLength(0);
  });

  it('onSiteNow lists only checked-in visits, with visitor names', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    // A walk-in with a named attendee is immediately on site.
    const walkIn = await caller.contractors.visits.createWalkIn({
      contractorId,
      title: 'On site now',
      visitorName: 'Alice Volt',
    });
    // A scheduled-but-not-checked-in visit must NOT appear.
    await caller.contractors.visits.create({
      contractorId,
      title: 'Later',
      scheduledStart: inDays(1),
    });

    let onSite = await caller.contractors.visits.onSiteNow();
    expect(onSite.map((v) => v.title)).toEqual(['On site now']);
    expect(onSite[0]?.visitorName).toBe('Alice Volt');
    expect(onSite[0]?.contractorName).toBe('Sparky Electrical');

    // After check-out it drops off the board.
    await caller.contractors.visits.checkOut({ id: walkIn.id });
    onSite = await caller.contractors.visits.onSiteNow();
    expect(onSite).toHaveLength(0);
  });

  it('setStatus marks a scheduled visit cancelled or no_show', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { id } = await caller.contractors.visits.create({
      contractorId,
      title: 'To cancel',
      scheduledStart: inDays(2),
    });
    await caller.contractors.visits.setStatus({ id, status: 'cancelled' });
    const visit = await caller.contractors.visits.get({ id });
    expect(visit.visit.status).toBe('cancelled');
    // Cancelled visits cannot be checked in.
    await expect(caller.contractors.visits.checkIn({ id })).rejects.toThrow(/cancelled/);
  });
});

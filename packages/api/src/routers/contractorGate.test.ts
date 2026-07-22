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

  it('an invalid kiosk token is rejected', async () => {
    const pub = createCaller(publicCtx());
    await expect(pub.contractors.gate.publicByToken({ token: 'nope-nope-nope' })).rejects.toThrow();
  });
});

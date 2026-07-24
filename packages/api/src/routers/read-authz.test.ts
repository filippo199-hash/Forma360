/**
 * Read-authorization tests (security review PR 2).
 *
 * A user WITHOUT a module's `.view` permission must not be able to read that
 * module's data through side channels: `users.get` (another member's PII) or
 * `search.global` (entity names/filenames the module itself would hide).
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from '@forma360/db/client';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import { resetDependentsRegistryForTests } from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from '../context';
import { loadContractorScope } from '../contractor-scope';
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
const silent = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

describe('read authorization', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminId: string;
  let restrictedId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silent(),
      auth: { userId, email: `${userId}@x.test`, tenantId: tenantId as never },
    });
  }

  beforeEach(async () => {
    resetDependentsRegistryForTests();
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);

    // A permission set with NO permissions at all.
    const noPerms = newId();
    await db.insert(schema.permissionSets).values({
      id: noPerms,
      tenantId,
      name: 'Restricted',
      permissions: [],
    });

    adminId = newId();
    await db.insert(schema.user).values({
      id: adminId,
      name: 'Admin',
      email: 'admin@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
    restrictedId = newId();
    await db.insert(schema.user).values({
      id: restrictedId,
      name: 'Restricted',
      email: 'restricted@acme.test',
      tenantId,
      permissionSetId: noPerms,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('users.get requires users.view to read another member, but self is always allowed', async () => {
    const restricted = createCaller(ctxFor(restrictedId));
    // Reading another user without users.view → FORBIDDEN.
    await expect(restricted.users.get({ id: adminId })).rejects.toThrow(/users\.view/);
    // Reading own record is always allowed.
    await expect(restricted.users.get({ id: restrictedId })).resolves.toMatchObject({
      user: { id: restrictedId },
    });
    // An admin (holds users.view) can read anyone.
    const admin = createCaller(ctxFor(adminId));
    await expect(admin.users.get({ id: restrictedId })).resolves.toMatchObject({
      user: { id: restrictedId },
    });
  });

  it('search.global hides categories the caller has no .view permission for', async () => {
    // Admin creates a document whose name matches the query.
    const admin = createCaller(ctxFor(adminId));
    await admin.documents.create({
      name: 'SearchMe Policy',
      storageKey: `${tenantId}/documents/searchme.pdf`,
      filename: 'searchme.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
    });

    // Admin search finds it.
    const adminResults = await admin.search.global({ query: 'SearchMe' });
    expect(adminResults.documents.length).toBe(1);

    // The restricted user (no documents.view) gets no document hits.
    const restricted = createCaller(ctxFor(restrictedId));
    const restrictedResults = await restricted.search.global({ query: 'SearchMe' });
    expect(restrictedResults.documents).toEqual([]);
  });

  it('contractor portal users see only their own contractor’s records', async () => {
    // Two contractors, each with a portal user holding actions view + create.
    const contractorA = newId();
    const contractorB = newId();
    await db.insert(schema.contractors).values([
      { id: contractorA, tenantId, name: 'Acme Sub' },
      { id: contractorB, tenantId, name: 'Beta Sub' },
    ]);
    const portalSet = newId();
    await db.insert(schema.permissionSets).values({
      id: portalSet,
      tenantId,
      name: 'Portal',
      permissions: ['actions.view', 'actions.create'],
    });
    const userA = newId();
    const userB = newId();
    await db.insert(schema.user).values([
      { id: userA, name: 'Sub A', email: 'a@sub.test', tenantId, permissionSetId: portalSet },
      { id: userB, name: 'Sub B', email: 'b@sub.test', tenantId, permissionSetId: portalSet },
    ]);
    await db.insert(schema.contractorUsers).values([
      { id: newId(), tenantId, contractorId: contractorA, userId: userA },
      { id: newId(), tenantId, contractorId: contractorB, userId: userB },
    ]);

    // loadContractorScope: internal → null; portal user → their own contractor.
    expect(await loadContractorScope(db as unknown as Database, tenantId, adminId)).toBeNull();
    const scopeA = await loadContractorScope(db as unknown as Database, tenantId, userA);
    expect(scopeA?.contractorId).toBe(contractorA);
    expect(scopeA?.userIds).toEqual([userA]);

    const callerA = createCaller(ctxFor(userA));
    const callerB = createCaller(ctxFor(userB));
    const admin = createCaller(ctxFor(adminId));
    const { actionId: aAction } = await callerA.actions.createStandalone({ title: 'A task' });
    const { actionId: bAction } = await callerB.actions.createStandalone({ title: 'B task' });
    const { actionId: internalAction } = await admin.actions.createStandalone({
      title: 'Internal task',
    });

    // Contractor A's portal user: list shows only their own; get on others → NOT_FOUND.
    const aIds = (await callerA.actions.list({})).map((r) => r.id);
    expect(aIds).toContain(aAction);
    expect(aIds).not.toContain(bAction);
    expect(aIds).not.toContain(internalAction);
    await expect(callerA.actions.get({ actionId: bAction })).rejects.toThrow(/NOT_FOUND/i);
    await expect(callerA.actions.get({ actionId: internalAction })).rejects.toThrow(/NOT_FOUND/i);
    await expect(callerA.actions.get({ actionId: aAction })).resolves.toBeDefined();

    // Internal admin is unrestricted — sees all three.
    const adminIds = (await admin.actions.list({})).map((r) => r.id);
    expect(adminIds).toEqual(expect.arrayContaining([aAction, bAction, internalAction]));
  });
});

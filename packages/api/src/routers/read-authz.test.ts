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
import { TEMPLATE_SCHEMA_VERSION } from '@forma360/shared/template-schema';
import { createLogger } from '@forma360/shared/logger';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from '../context';
import { loadContractorScope } from '../contractor-scope';
import { appRouter } from '../router';
import { assertUsersInTenant } from '../tenant-guards';
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
    // Induction acknowledged — this test covers data scoping, not the
    // PF-19 induction gate (contractorGate.test.ts CI-E01 covers that).
    await db.insert(schema.contractorUsers).values([
      {
        id: newId(),
        tenantId,
        contractorId: contractorA,
        userId: userA,
        acknowledgedAt: new Date(),
        acknowledgedVersion: 1,
      },
      {
        id: newId(),
        tenantId,
        contractorId: contractorB,
        userId: userB,
        acknowledgedAt: new Date(),
        acknowledgedVersion: 1,
      },
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
    const aIds = (await callerA.actions.list({})).rows.map((r) => r.id);
    expect(aIds).toContain(aAction);
    expect(aIds).not.toContain(bAction);
    expect(aIds).not.toContain(internalAction);
    await expect(callerA.actions.get({ actionId: bAction })).rejects.toThrow(/action-not-found/);
    await expect(callerA.actions.get({ actionId: internalAction })).rejects.toThrow(
      /action-not-found/,
    );
    await expect(callerA.actions.get({ actionId: aAction })).resolves.toBeDefined();

    // Internal admin is unrestricted — sees all three.
    const adminIds = (await admin.actions.list({})).rows.map((r) => r.id);
    expect(adminIds).toEqual(expect.arrayContaining([aAction, bAction, internalAction]));
  });

  it('IS-S01..S04: the contractor boundary holds at every inspections door, not just list/get', async () => {
    // `loadContractorScope` was called at exactly two procedures — the two
    // named `list` and `get` — while every other door the same permissions
    // open resolved by tenant + id and stopped. The scope stopped at the
    // procedure NAME rather than at the boundary.
    const contractorA = newId();
    await db.insert(schema.contractors).values({ id: contractorA, tenantId, name: 'Acme Sub' });
    const portalSet = newId();
    await db.insert(schema.permissionSets).values({
      id: portalSet,
      tenantId,
      name: 'Portal inspections',
      // Exactly what CONTRACTOR_ACTIVITIES.inspections grants — three
      // permissions, tenant-wide, to an external company's staff.
      permissions: ['inspections.view', 'inspections.conduct', 'inspections.sign'],
    });
    const portalUser = newId();
    await db.insert(schema.user).values({
      id: portalUser,
      name: 'Sub A',
      email: 'sub-a@sub.test',
      tenantId,
      permissionSetId: portalSet,
    });
    await db.insert(schema.contractorUsers).values({
      id: newId(),
      tenantId,
      contractorId: contractorA,
      userId: portalUser,
      acknowledgedAt: new Date(),
      acknowledgedVersion: 1,
    });

    // An internal inspection the portal user has nothing to do with.
    const admin = createCaller(ctxFor(adminId));
    const templateId = newId();
    const versionId = newId();
    await db.insert(schema.templates).values({
      id: templateId,
      tenantId,
      name: 'Monthly plant check',
      status: 'published',
      currentVersionId: versionId,
      createdBy: adminId,
    });
    await db.insert(schema.templateVersions).values({
      id: versionId,
      tenantId,
      templateId,
      versionNumber: 1,
      isCurrent: true,
      // Minimal valid content — the boundary assertions never render it;
      // it only has to satisfy the column's Zod type.
      content: {
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
        title: 'Monthly plant check',
        pages: [
          {
            id: newId(),
            type: 'title' as const,
            title: 'Title',
            sections: [
              {
                id: newId(),
                title: 's',
                items: [
                  {
                    id: newId(),
                    type: 'conductedBy' as const,
                    prompt: 'Conducted by',
                    required: false,
                  },
                ],
              },
            ],
          },
        ],
        settings: {
          titleFormat: '{{title}}',
          documentNumberFormat: 'INS-{{n}}',
          documentNumberStart: 1,
        },
        customResponseSets: [],
      },
    });
    const inspectionId = newId();
    await db.insert(schema.inspections).values({
      id: inspectionId,
      tenantId,
      templateId,
      templateVersionId: versionId,
      title: 'Internal walk-round',
      status: 'in_progress',
      createdBy: adminId,
      conductedBy: adminId,
      accessSnapshot: {
        groups: [],
        sites: [],
        permissions: [],
        snapshotAt: new Date().toISOString(),
      },
    });

    const portal = createCaller(ctxFor(portalUser));

    // The canonical read was already correct — that is what made the rest
    // look safe.
    await expect(portal.inspections.get({ inspectionId })).rejects.toThrow(/NOT_FOUND/i);

    // IS-S01 — the signature sheet: slots, assignees, signatures collected.
    await expect(portal.signatures.listSlots({ inspectionId })).rejects.toThrow(/NOT_FOUND/i);

    // IS-S03 — overwriting the answers on somebody else's walk-round.
    await expect(portal.inspections.saveProgress({ inspectionId, responses: {} })).rejects.toThrow(
      /NOT_FOUND/i,
    );

    // IS-S04 — signing it. A signature is an attestation by a named person
    // that they carried out a check.
    await expect(
      portal.signatures.sign({
        inspectionId,
        slotIndex: 0,
        // `slotId` is the field the audit's own first attempt omitted, which
        // is how IS-S04 originally "passed": the refusal recorded as the
        // boundary holding was Zod. A passing test that asserts a refusal
        // is not evidence until you have seen the refusal reason.
        slotId: newId(),
        signerName: 'Sub A',
        signatureData: 'data:image/png;base64,AAAA',
      }),
    ).rejects.toThrow(/NOT_FOUND/i);

    // IS-S02, the critical one — and it leaks THROUGH them rather than to
    // them: the share token is opaque, unauthenticated and built to be
    // forwarded.
    await expect(portal.exports.listShareLinks({ inspectionId })).rejects.toThrow(/NOT_FOUND/i);

    // Found by the parity guard rather than the audit: `submit` is gated on
    // `inspections.conduct` and `reopen` on `inspections.view` — both
    // granted tenant-wide by the same activity.
    await expect(portal.inspections.submit({ inspectionId })).rejects.toThrow(/NOT_FOUND/i);
    await expect(portal.inspections.reopen({ inspectionId })).rejects.toThrow(/NOT_FOUND/i);

    // Control: the fixture is real and an internal user is unaffected —
    // so none of the refusals above can be passing on an empty database.
    const adminIds = (await admin.inspections.list({})).map((r) => r.id);
    expect(adminIds).toContain(inspectionId);
    expect((await portal.inspections.list({})).map((r) => r.id)).not.toContain(inspectionId);
  });

  it('the contractor boundary holds at every actions door too', async () => {
    // The Inspections audit named `actions` as the third router with the
    // identical shape and an unexamined answer. It was right: `actions.view`
    // gates the whole activity/comments surface.
    const contractorA = newId();
    await db.insert(schema.contractors).values({ id: contractorA, tenantId, name: 'Gamma Sub' });
    const portalSet = newId();
    await db.insert(schema.permissionSets).values({
      id: portalSet,
      tenantId,
      name: 'Portal actions',
      permissions: ['actions.view', 'actions.create'],
    });
    const portalUser = newId();
    await db.insert(schema.user).values({
      id: portalUser,
      name: 'Sub G',
      email: 'sub-g@sub.test',
      tenantId,
      permissionSetId: portalSet,
    });
    await db.insert(schema.contractorUsers).values({
      id: newId(),
      tenantId,
      contractorId: contractorA,
      userId: portalUser,
      acknowledgedAt: new Date(),
      acknowledgedVersion: 1,
    });

    const admin = createCaller(ctxFor(adminId));
    const { actionId } = await admin.actions.createStandalone({ title: 'Internal task' });
    const portal = createCaller(ctxFor(portalUser));

    await expect(portal.actions.get({ actionId })).rejects.toThrow(/action-not-found/);
    await expect(portal.actions.activity.list({ actionId })).rejects.toThrow(/action-not-found/);
    await expect(portal.actions.comments.list({ actionId })).rejects.toThrow(/action-not-found/);
    await expect(
      portal.actions.comments.create({ actionId, body: 'Reading your thread' }),
    ).rejects.toThrow(/action-not-found/);
  });

  it('write-path guards reject a foreign-tenant reference id', async () => {
    // A second tenant with a permission set + user of its own.
    const otherTenant = newId();
    await db.insert(schema.tenants).values({ id: otherTenant, name: 'Other', slug: 'other' });
    const otherSet = newId();
    await db.insert(schema.permissionSets).values({
      id: otherSet,
      tenantId: otherTenant,
      name: 'Other',
      permissions: [],
    });
    const foreignUser = newId();
    await db.insert(schema.user).values({
      id: foreignUser,
      name: 'Foreign',
      email: 'foreign@other.test',
      tenantId: otherTenant,
      permissionSetId: otherSet,
    });

    // The guard itself: own id passes, foreign id → NOT_FOUND, empty → no-op.
    const database = db as unknown as Database;
    await expect(assertUsersInTenant(database, tenantId, [adminId])).resolves.toBeUndefined();
    await expect(assertUsersInTenant(database, tenantId, [])).resolves.toBeUndefined();
    await expect(assertUsersInTenant(database, tenantId, [foreignUser])).rejects.toThrow(
      /not found in this tenant/i,
    );

    // End-to-end: an admin cannot assign an action to the foreign-tenant user
    // (which would otherwise leak that user's name + email via actions.get).
    const admin = createCaller(ctxFor(adminId));
    await expect(
      admin.actions.createStandalone({ title: 'X', assigneeUserId: foreignUser }),
    ).rejects.toThrow(/not found/i);
  });
});

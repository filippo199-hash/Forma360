/**
 * Integration tests for the Documents router (Phase 5C).
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
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, type Context } from '../context';
import { appRouter } from '../router';
import { isDocumentVisibleToUser } from './document-visibility';
import { createCallerFactory } from '../trpc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');
/**
 * Every migration in the directory, in order.
 *
 * This used to be a CURATED list — the subset a given suite needed, for
 * speed. The cost was a manual chore CLAUDE.md had to document ("add the
 * next migration to that list"), and missing it left a table half-built:
 * Drizzle writes every column it knows about, so the first insert failed
 * with `column does not exist`, in a suite unrelated to the change that
 * caused it. Sixteen lists had drifted.
 *
 * Applying all of them costs about two seconds, which is not worth a
 * recurring footgun on a schema that changes every week. `MIG-L01` pins
 * that the lists and the ORM agree.
 */
async function migrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
}

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  for (const file of await migrationFiles()) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    for (const stmt of sqlText.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) await client.exec(stmt);
    }
  }
  return { client, db };
}

const createCaller = createCallerFactory(appRouter);

function silentLogger() {
  return createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
}

const FIFTY_MB = 50 * 1024 * 1024;

describe('Documents router (Phase 5C)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let seededSets: Awaited<ReturnType<typeof seedDefaultPermissionSets>>;

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
    seededSets = seeded;
    adminUserId = newId();
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Admin',
      email: 'admin@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('creates a folder and creates a document inside it', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { folderId } = await caller.documentFolders.create({ name: 'Safety Docs' });
    const folders = await caller.documentFolders.list({});
    expect(folders.some((f) => f.id === folderId)).toBe(true);

    const { documentId } = await caller.documents.create({
      name: 'Risk Assessment 2024',
      folderId,
      storageKey: `${tenantId}/documents/risk-2024.pdf`,
      filename: 'risk-2024.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    const { document: doc, folderName } = await caller.documents.get({ documentId });
    expect(doc.name).toBe('Risk Assessment 2024');
    expect(folderName).toBe('Safety Docs');
    expect(doc.currentVersion).toBe(1);
  });

  it('B8: by-id reads (get/versions) enforce folder visibility for non-members', async () => {
    const admin = createCaller(ctxFor(adminUserId));

    // A group + a folder restricted to it + a document inside.
    const groupId = newId();
    await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'North Team' });
    const { folderId } = await admin.documentFolders.create({
      name: 'North Only',
      visibleToGroupIds: [groupId],
    });
    const { documentId } = await admin.documents.create({
      name: 'North Secret',
      folderId,
      storageKey: `${tenantId}/documents/north-secret.pdf`,
      filename: 'north-secret.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    // Standard user NOT in the group vs Standard user IN the group.
    const outsiderId = newId();
    const memberId = newId();
    await db.insert(schema.user).values([
      {
        id: outsiderId,
        name: 'Outsider',
        email: 'out@acme.test',
        tenantId,
        permissionSetId: seededSets.standard,
      },
      {
        id: memberId,
        name: 'Member',
        email: 'mem@acme.test',
        tenantId,
        permissionSetId: seededSets.standard,
      },
    ]);
    await db.insert(schema.groupMembers).values({ tenantId, groupId, userId: memberId });

    // Non-member: get + versions are FORBIDDEN, and the doc is absent from list.
    const outsider = createCaller(ctxFor(outsiderId));
    await expect(outsider.documents.get({ documentId })).rejects.toThrow(/FORBIDDEN|not-visible/i);
    await expect(outsider.documents.versions.list({ documentId })).rejects.toThrow(
      /FORBIDDEN|not-visible/i,
    );
    const outsiderList = (await outsider.documents.list({})).documents;
    expect(outsiderList.find((d) => d.id === documentId)).toBeUndefined();

    // Member of the group: get + versions succeed.
    const member = createCaller(ctxFor(memberId));
    expect((await member.documents.get({ documentId })).document.id).toBe(documentId);
    expect(await member.documents.versions.list({ documentId })).toHaveLength(1);

    // Admin (manager) bypasses visibility entirely.
    expect((await admin.documents.get({ documentId })).document.id).toBe(documentId);
  });

  it('D-E03: rejects files larger than 50 MB', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    await expect(
      caller.documents.create({
        name: 'Huge file',
        storageKey: `${tenantId}/documents/huge.bin`,
        filename: 'huge.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: FIFTY_MB + 1,
      }),
    ).rejects.toThrow();
  });

  it('uploads a new version and bumps currentVersion', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { documentId } = await caller.documents.create({
      name: 'Policy v1',
      storageKey: `${tenantId}/documents/policy-v1.pdf`,
      filename: 'policy-v1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    });

    const { version } = await caller.documents.uploadVersion({
      documentId,
      storageKey: `${tenantId}/documents/policy-v2.pdf`,
      filename: 'policy-v2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2200,
    });
    expect(version).toBe(2);

    const { document: doc } = await caller.documents.get({ documentId });
    expect(doc.currentVersion).toBe(2);

    const versions = await caller.documents.versions.list({ documentId });
    expect(versions).toHaveLength(2);

    // Promote v1 back to current — re-points file fields, no new version.
    await caller.documents.setCurrentVersion({ documentId, version: 1 });
    const { document: reverted } = await caller.documents.get({ documentId });
    expect(reverted.currentVersion).toBe(1);
    expect(reverted.filename).toBe('policy-v1.pdf');
    expect(await caller.documents.versions.list({ documentId })).toHaveLength(2);
  });

  it('D-E06: prevents deleting a folder with documents', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { folderId } = await caller.documentFolders.create({ name: 'Occupied' });
    await caller.documents.create({
      name: 'Some doc',
      folderId,
      storageKey: `${tenantId}/documents/k`,
      filename: 'f.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    });

    await expect(caller.documentFolders.delete({ folderId })).rejects.toThrow(
      'folder-has-documents',
    );
  });

  it('D-E06: prevents deleting a folder with sub-folders', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { folderId: parentId } = await caller.documentFolders.create({ name: 'Parent' });
    await caller.documentFolders.create({ name: 'Child', parentId });

    await expect(caller.documentFolders.delete({ folderId: parentId })).rejects.toThrow(
      'folder-has-subfolders',
    );
  });

  it('grants and revokes document access', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { documentId } = await caller.documents.create({
      name: 'Confidential',
      storageKey: `${tenantId}/documents/k`,
      filename: 'conf.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
    });

    // PF-29 regression: real user ids are 30 chars (usr_ + ULID).
    // DC-T07: and the grantee has to actually EXIST in this tenant — the
    // grant used to accept any string and return success, so this test
    // previously passed with an id nobody held.
    const granteeId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: granteeId,
      name: 'Grantee',
      email: 'grantee@acme.test',
      tenantId,
      permissionSetId: seededSets.standard,
    });
    const { accessId } = await caller.documents.access.grant({
      documentId,
      subjectType: 'user',
      subjectId: granteeId,
      permission: 'view',
    });

    const accessList = await caller.documents.access.list({ documentId });
    expect(accessList.some((a) => a.id === accessId)).toBe(true);

    await caller.documents.access.revoke({ accessId });
    const afterRevoke = await caller.documents.access.list({ documentId });
    expect(afterRevoke.some((a) => a.id === accessId)).toBe(false);
  });

  it('PF-26: an ACL grant admits a viewer the group/site rules exclude — and revoke removes it', async () => {
    const admin = createCaller(ctxFor(adminUserId));
    // A group-restricted document the standard viewer is NOT a member of.
    const groupId = newId();
    await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'HR only' });
    const { documentId } = await admin.documents.create({
      name: 'Restricted policy',
      storageKey: `${tenantId}/documents/restricted`,
      filename: 'policy.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 512,
    });
    // Visibility lives on update (create takes the file facts only).
    await admin.documents.update({ documentId, visibleToGroupIds: [groupId] });
    const viewerId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: viewerId,
      name: 'Vera Viewer',
      email: `vera-${tenantId}@acme.test`,
      tenantId,
      permissionSetId: seededSets.standard,
    });
    const viewer = createCaller(ctxFor(viewerId));

    // Excluded by visibility rules.
    await expect(viewer.documents.get({ documentId })).rejects.toThrow(/FORBIDDEN|not-visible/i);
    expect(
      (await viewer.documents.list({})).documents.find((d) => d.id === documentId),
    ).toBeUndefined();

    // The write-only table now reads: a user grant admits her.
    const { accessId } = await admin.documents.access.grant({
      documentId,
      subjectType: 'user',
      subjectId: viewerId,
      permission: 'view',
    });
    expect((await viewer.documents.get({ documentId })).document.id).toBe(documentId);
    expect(
      (await viewer.documents.list({})).documents.find((d) => d.id === documentId),
    ).toBeDefined();

    // Revoke closes the door again.
    await admin.documents.access.revoke({ accessId });
    await expect(viewer.documents.get({ documentId })).rejects.toThrow(/FORBIDDEN|not-visible/i);
  });

  it('DC-T05: a visibility rule cannot name a group or site from another tenant', async () => {
    // These two arrays decide WHO MAY READ the document, and they were the
    // one input nobody checked. Plain jsonb, no foreign key — so a
    // cross-tenant or stale id persisted cleanly and then matched nobody:
    // the document restricted to a group that does not exist here, readable
    // only by managers, while the UI showed a rule resolving to nothing.
    const caller = createCaller(ctxFor(adminUserId));
    const { documentId } = await caller.documents.create({
      name: 'Restricted',
      storageKey: `${tenantId}/documents/k`,
      filename: 'r.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    });

    const otherTenantId = newId();
    await db.insert(schema.tenants).values({ id: otherTenantId, name: 'Rival', slug: 'rival' });
    const foreignGroupId = newId();
    await db
      .insert(schema.groups)
      .values({ id: foreignGroupId, tenantId: otherTenantId, name: 'Their team' });
    const foreignSiteId = newId();
    await db
      .insert(schema.sites)
      .values({ id: foreignSiteId, tenantId: otherTenantId, name: 'Their depot' });

    await expect(
      caller.documents.update({ documentId, visibleToGroupIds: [foreignGroupId] }),
    ).rejects.toThrow(/group not found in this tenant/i);
    await expect(
      caller.documents.update({ documentId, visibleToSiteIds: [foreignSiteId] }),
    ).rejects.toThrow(/site not found in this tenant/i);
    // A stale id that belongs to nobody is refused for the same reason.
    await expect(
      caller.documents.update({ documentId, visibleToGroupIds: [newId()] }),
    ).rejects.toThrow(/group not found in this tenant/i);

    // Clearing the restriction must still work — the guard is a no-op on [].
    await expect(
      caller.documents.update({ documentId, visibleToGroupIds: [], visibleToSiteIds: [] }),
    ).resolves.toBeDefined();
  });

  it('DC-T05: a folder visibility rule is guarded too — the cascade makes it worse', async () => {
    // A folder's visibility cascades to every document inside it and to every
    // sub-folder, so an unchecked id here silently buries a whole branch of
    // the library behind a rule that matches nobody.
    const caller = createCaller(ctxFor(adminUserId));
    const otherTenantId = newId();
    await db.insert(schema.tenants).values({ id: otherTenantId, name: 'Rival', slug: 'rival' });
    const foreignGroupId = newId();
    await db
      .insert(schema.groups)
      .values({ id: foreignGroupId, tenantId: otherTenantId, name: 'Their team' });

    await expect(
      caller.documentFolders.create({ name: 'Buried', visibleToGroupIds: [foreignGroupId] }),
    ).rejects.toThrow(/group not found in this tenant/i);

    const { folderId } = await caller.documentFolders.create({ name: 'Fine' });
    await expect(
      caller.documentFolders.update({ folderId, visibleToGroupIds: [foreignGroupId] }),
    ).rejects.toThrow(/group not found in this tenant/i);
  });

  it('DC-T07: granting access to a subject who is not in this tenant is refused', async () => {
    // The grant used to accept any string and return success, so an
    // administrator believed they had shared a document and had not — and
    // nobody complains about access they never knew they were promised.
    const caller = createCaller(ctxFor(adminUserId));
    const { documentId } = await caller.documents.create({
      name: 'Shared',
      storageKey: `${tenantId}/documents/k`,
      filename: 's.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    });

    const otherTenantId = newId();
    await db.insert(schema.tenants).values({ id: otherTenantId, name: 'Rival', slug: 'rival' });
    const foreignSets = await seedDefaultPermissionSets(db as unknown as Database, otherTenantId);
    const foreignUserId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: foreignUserId,
      name: 'Stranger',
      email: 'stranger@rival.test',
      tenantId: otherTenantId,
      permissionSetId: foreignSets.standard,
    });

    await expect(
      caller.documents.access.grant({
        documentId,
        subjectType: 'user',
        subjectId: foreignUserId,
        permission: 'view',
      }),
    ).rejects.toThrow(/user not found in this tenant/i);

    // A typo'd id is the same silent no-op, and is refused the same way.
    await expect(
      caller.documents.access.grant({
        documentId,
        subjectType: 'group',
        subjectId: newId(),
        permission: 'view',
      }),
    ).rejects.toThrow(/group not found in this tenant/i);

    // …and so is a grant aimed at another tenant's document.
    await expect(
      caller.documents.access.grant({
        documentId: newId(),
        subjectType: 'user',
        subjectId: adminUserId,
        permission: 'view',
      }),
    ).rejects.toThrow();
  });

  it('DC-S01: the named sign-off roster needs headsUp.analytics.view; the counts do not', async () => {
    // Heads-Up gates exactly this data behind `headsUp.analytics.view`, which
    // the seeded Standard set does NOT hold. This procedure needed only
    // `documents.view`, which it does — so any shift supervisor could open a
    // policy, click Signatures, and read every colleague's name, email and
    // personal viewed/acknowledged/signed timestamps.
    const admin = createCaller(ctxFor(adminUserId));
    const { documentId } = await admin.documents.create({
      name: 'Drug and alcohol policy',
      storageKey: `${tenantId}/documents/k`,
      filename: 'policy.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
    });

    const readerId = newId();
    await db.insert(schema.user).values({
      id: readerId,
      name: 'Reader',
      email: 'reader@acme.test',
      tenantId,
      permissionSetId: seededSets.standard,
    });
    const signerId = newId();
    await db.insert(schema.user).values({
      id: signerId,
      name: 'Signer',
      email: 'signer@acme.test',
      tenantId,
      permissionSetId: seededSets.standard,
    });

    const headsUpId = newId();
    await db.insert(schema.headsUps).values({
      id: headsUpId,
      tenantId,
      title: 'Read and sign',
      description: 'Please sign.',
      status: 'published',
      engagementLevel: 'signature',
      requireSignature: true,
      createdByUserId: adminUserId,
    });
    await db.insert(schema.headsUpDocuments).values({
      tenantId,
      headsUpId,
      documentId,
      documentVersion: 1,
    });
    await db.insert(schema.headsUpRecipients).values({
      id: newId(),
      tenantId,
      headsUpId,
      userId: signerId,
      signedAt: new Date(),
    });

    // A Standard reader gets the totals and NO names.
    const reader = createCaller(ctxFor(readerId));
    const asReader = await reader.documents.signatureRequests({ documentId });
    expect(asReader[0]?.engagement).toEqual({
      total: 1,
      viewed: 0,
      acknowledged: 1,
      signed: 1,
    });
    expect(asReader[0]?.recipients).toEqual([]);
    expect(asReader[0]?.canSeeRoster).toBe(false);

    // An administrator (org.settings) still sees the roster.
    const asAdmin = await admin.documents.signatureRequests({ documentId });
    expect(asAdmin[0]?.canSeeRoster).toBe(true);
    expect(asAdmin[0]?.recipients.map((r) => r.email)).toEqual(['signer@acme.test']);
  });

  it('DC-S04: a page whose first rows are all restricted is not an empty register', async () => {
    // Alphabetical order + SQL LIMIT + filter-in-JS-after meant a tenant
    // whose first N documents by name sit in one restricted folder showed
    // everyone else "No documents here" while they held legitimate access.
    const admin = createCaller(ctxFor(adminUserId));
    const groupId = newId();
    await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'HR' });
    const { folderId } = await admin.documentFolders.create({
      name: 'HR',
      visibleToGroupIds: [groupId],
    });

    // Three restricted documents that sort BEFORE the readable one.
    for (const name of ['AAA restricted', 'BBB restricted', 'CCC restricted']) {
      await admin.documents.create({
        name,
        folderId,
        storageKey: `${tenantId}/documents/k`,
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
      });
    }
    const { documentId: readable } = await admin.documents.create({
      name: 'ZZZ everyone',
      storageKey: `${tenantId}/documents/k`,
      filename: 'z.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
    });

    const outsiderId = newId();
    await db.insert(schema.user).values({
      id: outsiderId,
      name: 'Outsider',
      email: 'outsider@acme.test',
      tenantId,
      permissionSetId: seededSets.standard,
    });
    const outsider = createCaller(ctxFor(outsiderId));
    // A page of 1: the naive implementation returned zero rows because the
    // only row it fetched was restricted.
    const page = await outsider.documents.list({ limit: 1 });
    expect(page.documents.map((d) => d.id)).toEqual([readable]);
  });

  it('DC-S05: a document can be created already restricted', async () => {
    // The column default is [] = visible to everyone and `create` could not
    // set it, so a restricted contract was readable by the whole tenant from
    // the moment of upload until someone remembered the Access tab.
    const admin = createCaller(ctxFor(adminUserId));
    const groupId = newId();
    await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'HR' });
    const { documentId } = await admin.documents.create({
      name: 'Disciplinary letter',
      storageKey: `${tenantId}/documents/k`,
      filename: 'd.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      visibleToGroupIds: [groupId],
    });

    const outsiderId = newId();
    await db.insert(schema.user).values({
      id: outsiderId,
      name: 'Outsider',
      email: 'nosy@acme.test',
      tenantId,
      permissionSetId: seededSets.standard,
    });
    const outsider = createCaller(ctxFor(outsiderId));
    await expect(outsider.documents.get({ documentId })).rejects.toThrow(/FORBIDDEN|not-visible/i);
    // …and the guard applies here too.
    const otherTenantId = newId();
    await db.insert(schema.tenants).values({ id: otherTenantId, name: 'Rival', slug: 'rival' });
    const foreignGroupId = newId();
    await db
      .insert(schema.groups)
      .values({ id: foreignGroupId, tenantId: otherTenantId, name: 'Theirs' });
    await expect(
      admin.documents.create({
        name: 'Bad',
        storageKey: `${tenantId}/documents/k`,
        filename: 'b.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        visibleToGroupIds: [foreignGroupId],
      }),
    ).rejects.toThrow(/group not found in this tenant/i);
  });

  it('DC-S03: a document-level ACL grant survives the by-id read path', async () => {
    // `isDocumentVisibleToUser` took an OPTIONAL `id`, and the download route
    // never selected it — so `grants.docIds.has(doc.id)` could never fire.
    // A PF-26 grantee saw the document in the register and on the detail page,
    // then downloaded a file containing {"error":"NOT_FOUND"}. Folder-level
    // grants worked, which made it read as a storage fault. `id` is now
    // required, so the omission is a compile error.
    const admin = createCaller(ctxFor(adminUserId));
    const groupId = newId();
    await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'HR' });
    const { documentId } = await admin.documents.create({
      name: 'Granted only',
      storageKey: `${tenantId}/documents/k`,
      filename: 'g.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      visibleToGroupIds: [groupId],
    });

    const granteeId = newId();
    await db.insert(schema.user).values({
      id: granteeId,
      name: 'Grantee',
      email: 'granted@acme.test',
      tenantId,
      permissionSetId: seededSets.standard,
    });
    const grantee = createCaller(ctxFor(granteeId));
    // Not in the group: refused.
    await expect(grantee.documents.get({ documentId })).rejects.toThrow(/FORBIDDEN|not-visible/i);

    await admin.documents.access.grant({
      documentId,
      subjectType: 'user',
      subjectId: granteeId,
      permission: 'view',
    });

    // The grant is honoured by the same helper the download route calls,
    // with the document id supplied.
    const [row] = await db
      .select({
        id: schema.documents.id,
        folderId: schema.documents.folderId,
        visibleToGroupIds: schema.documents.visibleToGroupIds,
        visibleToSiteIds: schema.documents.visibleToSiteIds,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(row).toBeDefined();
    if (row === undefined) throw new Error('expected the document row');
    expect(await isDocumentVisibleToUser(db as unknown as Database, tenantId, granteeId, row)).toBe(
      true,
    );
  });

  it('archives and restores a document', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { documentId } = await caller.documents.create({
      name: 'Archive me',
      storageKey: `${tenantId}/documents/k`,
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 500,
    });

    await caller.documents.archive({ documentId });
    const { document: archived } = await caller.documents.get({ documentId });
    expect(archived.archivedAt).not.toBeNull();

    await caller.documents.restore({ documentId });
    const { document: restored } = await caller.documents.get({ documentId });
    expect(restored.archivedAt).toBeNull();
  });
});

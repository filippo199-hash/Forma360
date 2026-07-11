/**
 * Integration tests for the Documents router (Phase 5C).
 */
import { readFile } from 'node:fs/promises';
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
import { appRouter } from '../router';
import { createCallerFactory } from '../trpc';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'db', 'migrations');
const MIGRATION_FILES = [
  '0000_initial.sql',
  '0001_auth.sql',
  '0002_permissions.sql',
  '0003_phase1_org_backbone.sql',
  '0004_phase2_templates_inspections.sql',
  '0005_phase2_inspections.sql',
  '0006_phase2_schedules.sql',
  '0007_inspections_archived_at.sql',
  '0008_invitations.sql',
  '0009_signature_workflow.sql',
  '0010_issues.sql',
  '0011_observations_richer.sql',
  '0012_actions_phase4.sql',
  '0013_actions_phase4b.sql',
  '0014_phase5.sql',
  '0015_phase8_compliance.sql',
  '0016_headsup_share_reactions.sql',
  '0017_heads_up_enhancements.sql',
  '0018_documents_v2.sql',
  '0019_schedule_enhancements.sql',
  '0020_compliance_scope.sql',
  '0021_compliance_features.sql',
  '0022_action_type_labels.sql',
  '0023_inspections_source_link.sql',
  '0024_invite_group_site.sql',
  '0025_user_phone.sql',
  '0026_asset_description.sql',
  '0027_maintenance_notifications.sql',
  '0028_observation_notification_recipients.sql',
  '0029_asset_links.sql',
  '0030_drop_compliance.sql',
  '0031_ai_assistant.sql',
  '0032_user_first_last_name.sql',
  '0033_document_visibility.sql',
  '0034_maintenance_programs.sql',
  '0035_asset_owner.sql',
  '0036_site_projects.sql',
  '0037_site_media.sql',
  '0038_site_plans.sql',
  '0039_site_geolocation.sql',
  '0040_site_groups.sql',
  '0041_heads_up_documents.sql',
  '0042_contractors.sql',
];

async function bootDb(): Promise<{ client: PGlite; db: PgliteDatabase<typeof schema> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  for (const file of MIGRATION_FILES) {
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

    const granteeId = newId();
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

/**
 * Integration tests for Assets & Maintenance routers (Phase 5B).
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
  '0043_contractors_phase1b.sql',
  '0044_contractor_visits.sql',
  '0045_contractor_gate.sql',
  '0046_contractor_assets.sql',
  '0047_contractor_users.sql',
  '0048_contractor_visit_visitor.sql',
  '0049_contractor_compliance_override.sql',
  '0050_contractor_visit_overstay.sql',
  '0051_site_fk_integrity.sql',
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

describe('Assets router (Phase 5B)', () => {
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

  it('creates an asset type and uses it on an asset', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { typeId } = await caller.assetTypes.create({
      name: 'Vehicle',
      description: 'Motor vehicles',
    });

    const types = await caller.assetTypes.list({});
    expect(types.some((t) => t.id === typeId)).toBe(true);

    const { assetId } = await caller.assets.create({ name: 'Truck 001', typeId });
    const { asset, assetType } = await caller.assets.get({ assetId });
    expect(asset.name).toBe('Truck 001');
    expect(assetType?.id).toBe(typeId);
    expect(asset.qrToken).toBeDefined();
  });

  it('stores an owner on create and returns the owner name on get', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { assetId } = await caller.assets.create({
      name: 'Forklift #3',
      ownerUserId: adminUserId,
    });

    const { asset, ownerName } = await caller.assets.get({ assetId });
    expect(asset.ownerUserId).toBe(adminUserId);
    expect(ownerName).toBe('Admin');

    // Clearing the owner via update nulls it out.
    await caller.assets.update({ assetId, ownerUserId: null });
    const after = await caller.assets.get({ assetId });
    expect(after.asset.ownerUserId).toBeNull();
    expect(after.ownerName).toBeNull();
  });

  it('AS-E11: prevents creating an asset with a parent that itself has a parent', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { assetId: grandparentId } = await caller.assets.create({ name: 'Site A' });
    const { assetId: parentId } = await caller.assets.create({
      name: 'Zone 1',
      parentId: grandparentId,
    });

    await expect(caller.assets.create({ name: 'Sub-zone', parentId })).rejects.toThrow(
      'asset-parent-depth-exceeded',
    );
  });

  it('AS-E01: prevents archiving a parent with active sub-assets', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { assetId: parentId } = await caller.assets.create({ name: 'Parent' });
    await caller.assets.create({ name: 'Child', parentId });

    await expect(caller.assets.archive({ assetId: parentId })).rejects.toThrow(
      /asset-has-sub-assets/,
    );

    // After archiving the child, parent should be archivable.
    const { assetId: childId } = await caller.assets.create({
      name: 'Child2',
      parentId,
    });
    await caller.assets.archive({ assetId: childId });
    // The first child is still active, so should still fail.
    await expect(caller.assets.archive({ assetId: parentId })).rejects.toThrow(
      /asset-has-sub-assets/,
    );
  });

  it('AS-E12: prevents archiving a type with active assets', async () => {
    const caller = createCaller(ctxFor(adminUserId));

    const { typeId } = await caller.assetTypes.create({ name: 'Crane' });
    await caller.assets.create({ name: 'Crane #1', typeId });

    await expect(caller.assetTypes.archive({ typeId })).rejects.toThrow(
      /asset-type-has-active-assets/,
    );
  });

  it('records readings and lists them', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { assetId } = await caller.assets.create({ name: 'Pump A' });

    await caller.assets.readings.add({
      assetId,
      fieldName: 'runtime_hours',
      value: 1250,
      unit: 'h',
      source: 'manual',
    });

    const readings = await caller.assets.readings.list({ assetId });
    expect(readings).toHaveLength(1);
    expect(readings[0]?.fieldName).toBe('runtime_hours');
    expect(readings[0]?.value).toBe('1250');
  });

  it('creates a maintenance plan and links assets', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { assetId } = await caller.assets.create({ name: 'Generator' });

    const { planId } = await caller.maintenancePlans.create({
      name: '6-month service',
      planType: 'time',
      intervalDays: 180,
      notificationDaysBefore: [7, 14],
    });

    await caller.maintenancePlans.linkAssets({ planId, assetIds: [assetId] });

    const { linkedAssets } = await caller.maintenancePlans.get({ planId });
    expect(linkedAssets).toHaveLength(1);
    expect(linkedAssets[0]?.assetId).toBe(assetId);
  });

  it('maintenance table returns status for linked plans', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { assetId } = await caller.assets.create({ name: 'Compressor' });
    const { planId } = await caller.maintenancePlans.create({
      name: 'Monthly check',
      planType: 'time',
      intervalDays: 30,
    });
    await caller.maintenancePlans.linkAssets({ planId, assetIds: [assetId] });

    const table = await caller.maintenancePlans.table();
    const row = table.find((r) => r.planId === planId && r.assetId === assetId);
    expect(row).toBeDefined();
    // No last service date => on_schedule (no due date to compare).
    expect(row?.status).toBe('on_schedule');
  });
});

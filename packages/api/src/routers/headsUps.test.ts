/**
 * Integration tests for the Heads Up router (Phase 5A).
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

describe('Heads Up router (Phase 5A)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let memberUserId: string;

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
    memberUserId = newId();
    await db.insert(schema.user).values([
      {
        id: adminUserId,
        name: 'Admin',
        email: 'admin@acme.test',
        tenantId,
        permissionSetId: seeded.administrator,
      },
      {
        id: memberUserId,
        name: 'Member',
        email: 'member@acme.test',
        tenantId,
        permissionSetId: seeded.standard,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  it('creates a draft heads-up and lists it', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { headsUpId } = await caller.headsUps.create({
      title: 'Safety briefing',
      description: 'All staff must attend.',
      engagementLevel: 'acknowledge',
    });

    const list = await caller.headsUps.list({});
    expect(list.some((h) => h.id === headsUpId)).toBe(true);

    const { headsUp } = await caller.headsUps.get({ headsUpId });
    expect(headsUp.title).toBe('Safety briefing');
    expect(headsUp.status).toBe('draft');
    expect(headsUp.engagementLevel).toBe('acknowledge');
  });

  it('publishes a heads-up and adds individual recipients', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { headsUpId } = await caller.headsUps.create({
      title: 'Q1 Update',
      engagementLevel: 'view',
    });

    const { recipientCount } = await caller.headsUps.publish({
      headsUpId,
      userIds: [memberUserId],
    });

    expect(recipientCount).toBe(1);

    const { headsUp } = await caller.headsUps.get({ headsUpId });
    expect(headsUp.status).toBe('published');
  });

  it('tracks view engagement correctly', async () => {
    const adminCaller = createCaller(ctxFor(adminUserId));
    const memberCaller = createCaller(ctxFor(memberUserId));

    const { headsUpId } = await adminCaller.headsUps.create({
      title: 'Test view tracking',
      engagementLevel: 'view',
    });
    await adminCaller.headsUps.publish({ headsUpId, userIds: [memberUserId] });

    // Not viewed yet.
    const before = await adminCaller.headsUps.engagementSummary({ headsUpId });
    expect(before.viewed).toBe(0);
    expect(before.notViewed).toBe(1);

    // Mark viewed.
    await memberCaller.headsUps.markViewed({ headsUpId });

    const after = await adminCaller.headsUps.engagementSummary({ headsUpId });
    expect(after.viewed).toBe(1);
    expect(after.notViewed).toBe(0);
  });

  it('H-E09: requires acknowledgement before signing', async () => {
    const adminCaller = createCaller(ctxFor(adminUserId));
    const memberCaller = createCaller(ctxFor(memberUserId));

    const { headsUpId } = await adminCaller.headsUps.create({
      title: 'Must sign',
      engagementLevel: 'sign',
      requireAcknowledgement: true,
      requireSignature: true,
    });
    await adminCaller.headsUps.publish({ headsUpId, userIds: [memberUserId] });

    // Attempt to sign without acknowledging first.
    await expect(
      memberCaller.headsUps.sign({ headsUpId, signatureData: 'sig-data' }),
    ).rejects.toThrow('must-acknowledge-before-sign');

    // Acknowledge first, then sign.
    await memberCaller.headsUps.markAcknowledged({ headsUpId });
    await memberCaller.headsUps.sign({ headsUpId, signatureData: 'sig-data' });

    const summary = await adminCaller.headsUps.engagementSummary({ headsUpId });
    expect(summary.signed).toBe(1);
  });

  it('archives a heads-up', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { headsUpId } = await caller.headsUps.create({ title: 'Archive me' });
    await caller.headsUps.archive({ headsUpId });

    const { headsUp } = await caller.headsUps.get({ headsUpId });
    expect(headsUp.status).toBe('archived');
  });

  it('creates and lists comments', async () => {
    const caller = createCaller(ctxFor(adminUserId));
    const { headsUpId } = await caller.headsUps.create({ title: 'Comment test' });
    await caller.headsUps.comments.create({ headsUpId, body: 'Great briefing!' });

    const comments = await caller.headsUps.comments.list({ headsUpId });
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe('Great briefing!');
  });
});

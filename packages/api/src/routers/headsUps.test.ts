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
  '0052_reference_counters.sql',
  '0063_action_reminders.sql',
  '0064_document_expiry_reminders.sql',
  '0065_backfill_freehs_permission_keys.sql',
  '0066_wave_f_field.sql',
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

  it('#4: attaches a library document and surfaces sign-offs on the document page', async () => {
    const adminCaller = createCaller(ctxFor(adminUserId));
    const memberCaller = createCaller(ctxFor(memberUserId));

    const { documentId } = await adminCaller.documents.create({
      name: 'Safety Policy',
      storageKey: `${tenantId}/documents/policy.pdf`,
      filename: 'policy.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    const { headsUpId } = await adminCaller.headsUps.create({
      title: 'Please sign the policy',
      engagementLevel: 'sign',
      requireAcknowledgement: true,
      requireSignature: true,
      documentIds: [documentId],
    });
    await adminCaller.headsUps.publish({ headsUpId, userIds: [memberUserId] });

    // The document is linked, version-anchored, recipient pending.
    let reqs = await adminCaller.documents.signatureRequests({ documentId });
    expect(reqs).toHaveLength(1);
    expect(reqs[0]?.documentVersion).toBe(1);
    expect(reqs[0]?.recipients).toHaveLength(1);
    expect(reqs[0]?.recipients[0]?.signedAt).toBeNull();

    // The recipient acknowledges + signs; the sign-off shows on the doc page.
    await memberCaller.headsUps.markAcknowledged({ headsUpId });
    await memberCaller.headsUps.sign({ headsUpId, signatureData: 'sig' });

    reqs = await adminCaller.documents.signatureRequests({ documentId });
    expect(reqs[0]?.recipients[0]?.signedAt).not.toBeNull();
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

  it('listForRecipient + getForRecipient: recipient inbox with engagement', async () => {
    const adminCaller = createCaller(ctxFor(adminUserId));
    const memberCaller = createCaller(ctxFor(memberUserId));

    const { headsUpId } = await adminCaller.headsUps.create({
      title: 'Please sign',
      engagementLevel: 'sign',
      requireAcknowledgement: true,
      requireSignature: true,
    });
    await adminCaller.headsUps.publish({ headsUpId, userIds: [memberUserId] });

    // Recipient sees it, pending (not yet signed).
    const list = await memberCaller.headsUps.listForRecipient();
    const row = list.find((h) => h.id === headsUpId);
    expect(row).toBeDefined();
    expect(row?.pending).toBe(true);
    expect(row?.creatorName).toBe('Admin');

    // pending filter includes it; done filter excludes it.
    const pendingList = await memberCaller.headsUps.listForRecipient({ filter: 'pending' });
    expect(pendingList.some((h) => h.id === headsUpId)).toBe(true);
    const doneList = await memberCaller.headsUps.listForRecipient({ filter: 'done' });
    expect(doneList.some((h) => h.id === headsUpId)).toBe(false);

    // getForRecipient returns it with engagement state.
    const detail = await memberCaller.headsUps.getForRecipient({ headsUpId });
    expect(detail.headsUp.title).toBe('Please sign');
    expect(detail.creatorName).toBe('Admin');
    expect(detail.engagement.signedAt).toBeNull();

    // A non-recipient (the admin creator) cannot read it → NOT_FOUND.
    await expect(adminCaller.headsUps.getForRecipient({ headsUpId })).rejects.toThrow(
      'heads-up-not-found',
    );

    // Engagement mutations flip the returned fields.
    await memberCaller.headsUps.markViewed({ headsUpId });
    await memberCaller.headsUps.markAcknowledged({ headsUpId });
    await memberCaller.headsUps.sign({ headsUpId, signatureData: 'sig' });

    const afterSign = await memberCaller.headsUps.getForRecipient({ headsUpId });
    expect(afterSign.engagement.viewedAt).not.toBeNull();
    expect(afterSign.engagement.acknowledgedAt).not.toBeNull();
    expect(afterSign.engagement.signedAt).not.toBeNull();

    // Now done filter includes it (pending flipped false); pending excludes it.
    const afterPending = await memberCaller.headsUps.listForRecipient({ filter: 'pending' });
    expect(afterPending.some((h) => h.id === headsUpId)).toBe(false);
    const afterDone = await memberCaller.headsUps.listForRecipient({ filter: 'done' });
    expect(afterDone.some((h) => h.id === headsUpId && h.pending === false)).toBe(true);
  });

  it('recipient views exclude draft heads-ups', async () => {
    const adminCaller = createCaller(ctxFor(adminUserId));
    const memberCaller = createCaller(ctxFor(memberUserId));

    // A draft with a recipient row must not surface — the status guard, not
    // just the absence of recipients, is what protects it.
    const { headsUpId } = await adminCaller.headsUps.create({ title: 'Draft only' });
    await db.insert(schema.headsUpRecipients).values({
      id: newId(),
      tenantId,
      headsUpId,
      userId: memberUserId,
    });

    const list = await memberCaller.headsUps.listForRecipient();
    expect(list.some((h) => h.id === headsUpId)).toBe(false);

    await expect(memberCaller.headsUps.getForRecipient({ headsUpId })).rejects.toThrow(
      'heads-up-not-found',
    );
  });
});

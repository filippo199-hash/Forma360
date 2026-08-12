/**
 * Integration tests for the template-level signature workflow.
 *
 * Covers:
 *   - Sequential submit: 3 signers → first signer notified, status flips to
 *     `awaiting_signature_workflow`, 3 pending rows.
 *   - Sequential signing chain: each sign triggers the next email; final
 *     sign completes the inspection + (optional) completion emails.
 *   - Parallel submit: all signers emailed at once.
 *   - Out-of-order sequential sign rejected with FORBIDDEN.
 *   - listAwaitingMySignature: sequential returns only the current-turn
 *     signer's row; parallel returns the row for every pending signer.
 *   - validateSignatureWorkflow rejects enabled + empty signers.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { createLogger } from '@forma360/shared/logger';
import { newId } from '@forma360/shared/id';
import * as schema from '@forma360/db/schema';
import { seedDefaultPermissionSets } from '@forma360/permissions/seed';
import {
  TEMPLATE_SCHEMA_VERSION,
  validateSignatureWorkflow,
  type TemplateContent,
} from '@forma360/shared/template-schema';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { createTestContext, type Context } from '../context';
import { __authStubMailbox, appRouter, type AuthStubMail } from '../router';
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
  '0067_wave_g_platform.sql',
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
const silent = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });

/** Build template content with workflow attached. */
function workflowContent(args: {
  title: string;
  mode: 'sequential' | 'parallel';
  signerIds: string[];
  notifyOnCompletion?: boolean;
}): TemplateContent {
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    title: args.title,
    pages: [
      {
        id: newId(),
        type: 'title',
        title: 'Title',
        sections: [
          {
            id: newId(),
            title: 's',
            items: [{ id: newId(), type: 'conductedBy', prompt: 'Conducted by', required: false }],
          },
        ],
      },
      {
        id: newId(),
        type: 'inspection',
        title: 'Inspection',
        sections: [
          {
            id: newId(),
            title: 's',
            items: [
              {
                id: newId(),
                type: 'text',
                prompt: 'Notes?',
                required: false,
                multiline: false,
                maxLength: 2000,
              },
            ],
          },
        ],
      },
    ],
    settings: {
      titleFormat: '{date}',
      documentNumberFormat: '{counter:6}',
      documentNumberStart: 1,
      signatureWorkflow: {
        enabled: true,
        mode: args.mode,
        signatoryUserIds: args.signerIds,
        notifyOnCompletion: args.notifyOnCompletion ?? false,
      },
    },
    customResponseSets: [],
  };
}

describe('template-level signature workflow', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let signer1Id: string;
  let signer2Id: string;
  let signer3Id: string;
  let mailbox: AuthStubMail[];

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silent(),
      auth: { userId, email: 'a@x', tenantId: tenantId as never },
    });
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    __authStubMailbox.length = 0;
    mailbox = __authStubMailbox;

    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    adminUserId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Alice Admin',
      email: 'alice@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
    signer1Id = `usr_${newId()}`;
    signer2Id = `usr_${newId()}`;
    signer3Id = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: signer1Id,
        name: 'Signer One',
        email: 'one@acme.test',
        tenantId,
        permissionSetId: seeded.administrator,
      },
      {
        id: signer2Id,
        name: 'Signer Two',
        email: 'two@acme.test',
        tenantId,
        permissionSetId: seeded.administrator,
      },
      {
        id: signer3Id,
        name: 'Signer Three',
        email: 'three@acme.test',
        tenantId,
        permissionSetId: seeded.administrator,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  async function publishWorkflowTemplate(args: {
    name: string;
    mode: 'sequential' | 'parallel';
    signerIds: string[];
    notifyOnCompletion?: boolean;
  }): Promise<string> {
    const adminCaller = createCaller(ctxFor(adminUserId));
    const { templateId } = await adminCaller.templates.create({ name: args.name });
    await adminCaller.templates.saveDraft({
      templateId,
      content: workflowContent({
        title: args.name,
        mode: args.mode,
        signerIds: args.signerIds,
        notifyOnCompletion: args.notifyOnCompletion ?? false,
      }),
    });
    await adminCaller.templates.publish({ templateId });
    return templateId;
  }

  describe('submit', () => {
    it('sequential: notifies only the first signer; creates 3 pending rows', async () => {
      const templateId = await publishWorkflowTemplate({
        name: 'Sequential3',
        mode: 'sequential',
        signerIds: [signer1Id, signer2Id, signer3Id],
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      // Clear the mailbox so we only see signature-related emails.
      mailbox.length = 0;

      const res = await adminCaller.inspections.submit({ inspectionId });
      expect(res.status).toBe('awaiting_signature_workflow');

      const inspRow = (
        await db.select().from(schema.inspections).where(eq(schema.inspections.id, inspectionId))
      )[0];
      expect(inspRow?.status).toBe('awaiting_signature_workflow');
      expect(inspRow?.submittedAt).toBeInstanceOf(Date);

      const signerRows = await db
        .select()
        .from(schema.inspectionWorkflowSigners)
        .where(eq(schema.inspectionWorkflowSigners.inspectionId, inspectionId));
      expect(signerRows).toHaveLength(3);
      expect(signerRows.every((r) => r.status === 'pending')).toBe(true);

      const requestEmails = mailbox.filter((m) => m.templateKey === 'signature-workflow-request');
      expect(requestEmails).toHaveLength(1);
      expect(requestEmails[0]?.to).toBe('one@acme.test');
    });

    it('parallel: notifies every signer immediately on submit', async () => {
      const templateId = await publishWorkflowTemplate({
        name: 'Parallel3',
        mode: 'parallel',
        signerIds: [signer1Id, signer2Id, signer3Id],
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      mailbox.length = 0;

      const res = await adminCaller.inspections.submit({ inspectionId });
      expect(res.status).toBe('awaiting_signature_workflow');

      const requestEmails = mailbox.filter((m) => m.templateKey === 'signature-workflow-request');
      expect(requestEmails).toHaveLength(3);
      const recipients = requestEmails.map((m) => m.to).sort();
      expect(recipients).toEqual(['one@acme.test', 'three@acme.test', 'two@acme.test']);
    });

    it('NP-SG1: signature_request prefs — muted email keeps the bell row and vice versa', async () => {
      await db
        .update(schema.user)
        .set({ notificationPrefs: { 'email:signature_request': false } })
        .where(eq(schema.user.id, signer1Id));
      await db
        .update(schema.user)
        .set({ notificationPrefs: { 'inapp:signature_request': false } })
        .where(eq(schema.user.id, signer2Id));
      const templateId = await publishWorkflowTemplate({
        name: 'PrefsPar',
        mode: 'parallel',
        signerIds: [signer1Id, signer2Id, signer3Id],
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      mailbox.length = 0;

      await adminCaller.inspections.submit({ inspectionId });

      // Signer 1 muted the email — signers 2 and 3 still get theirs.
      const requestEmails = mailbox.filter((m) => m.templateKey === 'signature-workflow-request');
      expect(requestEmails.map((m) => m.to).sort()).toEqual(['three@acme.test', 'two@acme.test']);
      // Signer 2 muted the bell — signers 1 and 3 still get rows.
      const bells = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.kind, 'signature_request'));
      expect(bells.map((b) => b.userId).sort()).toEqual([signer1Id, signer3Id].sort());
    });
  });

  describe('signing', () => {
    it('sequential: signer 1 signs → signer 2 gets notified; status stays awaiting', async () => {
      const templateId = await publishWorkflowTemplate({
        name: 'SeqChain',
        mode: 'sequential',
        signerIds: [signer1Id, signer2Id, signer3Id],
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      await adminCaller.inspections.submit({ inspectionId });
      mailbox.length = 0;

      const s1Caller = createCaller(ctxFor(signer1Id));
      const r = await s1Caller.inspections.signWorkflow({
        inspectionId,
        signatureData: 'data:image/png;base64,one',
      });
      expect(r.status).toBe('awaiting_signature_workflow');
      expect(r.allSigned).toBe(false);

      const inspRow = (
        await db.select().from(schema.inspections).where(eq(schema.inspections.id, inspectionId))
      )[0];
      expect(inspRow?.status).toBe('awaiting_signature_workflow');

      const signer1Row = (
        await db
          .select()
          .from(schema.inspectionWorkflowSigners)
          .where(
            and(
              eq(schema.inspectionWorkflowSigners.inspectionId, inspectionId),
              eq(schema.inspectionWorkflowSigners.signerUserId, signer1Id),
            ),
          )
      )[0];
      expect(signer1Row?.status).toBe('signed');
      expect(signer1Row?.signedAt).toBeInstanceOf(Date);

      const emails = mailbox.filter((m) => m.templateKey === 'signature-workflow-request');
      expect(emails).toHaveLength(1);
      expect(emails[0]?.to).toBe('two@acme.test');
    });

    it('sequential: all signers sign → status completes; completion emails fan out', async () => {
      const templateId = await publishWorkflowTemplate({
        name: 'SeqAll',
        mode: 'sequential',
        signerIds: [signer1Id, signer2Id, signer3Id],
        notifyOnCompletion: true,
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      await adminCaller.inspections.submit({ inspectionId });

      await createCaller(ctxFor(signer1Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'one',
      });
      await createCaller(ctxFor(signer2Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'two',
      });
      mailbox.length = 0;

      const r3 = await createCaller(ctxFor(signer3Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'three',
      });
      expect(r3.status).toBe('completed');
      expect(r3.allSigned).toBe(true);

      const inspRow = (
        await db.select().from(schema.inspections).where(eq(schema.inspections.id, inspectionId))
      )[0];
      expect(inspRow?.status).toBe('completed');
      expect(inspRow?.completedAt).toBeInstanceOf(Date);

      const completionEmails = mailbox.filter(
        (m) => m.templateKey === 'signature-workflow-complete',
      );
      expect(completionEmails).toHaveLength(3);
      const recipients = completionEmails.map((m) => m.to).sort();
      expect(recipients).toEqual(['one@acme.test', 'three@acme.test', 'two@acme.test']);

      // Every recipient also gets a signature_complete bell row.
      const bells = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.kind, 'signature_complete'));
      expect(bells.map((b) => b.userId).sort()).toEqual(
        [signer1Id, signer2Id, signer3Id].sort(),
      );
    });

    it('NP-SG2: signature_complete prefs — per-channel mutes hold on the completion fan-out', async () => {
      await db
        .update(schema.user)
        .set({ notificationPrefs: { 'email:signature_complete': false } })
        .where(eq(schema.user.id, signer1Id));
      await db
        .update(schema.user)
        .set({ notificationPrefs: { 'inapp:signature_complete': false } })
        .where(eq(schema.user.id, signer2Id));
      const templateId = await publishWorkflowTemplate({
        name: 'PrefsDone',
        mode: 'parallel',
        signerIds: [signer1Id, signer2Id],
        notifyOnCompletion: true,
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      await adminCaller.inspections.submit({ inspectionId });
      mailbox.length = 0;

      await createCaller(ctxFor(signer1Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'one',
      });
      await createCaller(ctxFor(signer2Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'two',
      });

      const completionEmails = mailbox.filter(
        (m) => m.templateKey === 'signature-workflow-complete',
      );
      expect(completionEmails.map((m) => m.to)).toEqual(['two@acme.test']);
      const bells = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.kind, 'signature_complete'));
      expect(bells.map((b) => b.userId)).toEqual([signer1Id]);
    });

    it('parallel: signer order does not matter; final signer completes inspection', async () => {
      const templateId = await publishWorkflowTemplate({
        name: 'ParAll',
        mode: 'parallel',
        signerIds: [signer1Id, signer2Id, signer3Id],
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      await adminCaller.inspections.submit({ inspectionId });

      // Sign in reverse — parallel mode permits any order.
      await createCaller(ctxFor(signer3Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'three',
      });
      await createCaller(ctxFor(signer1Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'one',
      });
      const r2 = await createCaller(ctxFor(signer2Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'two',
      });
      expect(r2.status).toBe('completed');

      const inspRow = (
        await db.select().from(schema.inspections).where(eq(schema.inspections.id, inspectionId))
      )[0];
      expect(inspRow?.status).toBe('completed');
    });

    it('sequential out-of-order sign is rejected with FORBIDDEN', async () => {
      const templateId = await publishWorkflowTemplate({
        name: 'SeqOrder',
        mode: 'sequential',
        signerIds: [signer1Id, signer2Id, signer3Id],
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      await adminCaller.inspections.submit({ inspectionId });

      // Signer 2 attempts to sign before signer 1.
      await expect(
        createCaller(ctxFor(signer2Id)).inspections.signWorkflow({
          inspectionId,
          signatureData: 'two-early',
        }),
      ).rejects.toThrow(/not your turn|FORBIDDEN/i);
    });
  });

  describe('listAwaitingMySignature', () => {
    it('sequential: returns the inspection only for the current-turn signer', async () => {
      const templateId = await publishWorkflowTemplate({
        name: 'SeqList',
        mode: 'sequential',
        signerIds: [signer1Id, signer2Id, signer3Id],
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      await adminCaller.inspections.submit({ inspectionId });

      const s1List = await createCaller(ctxFor(signer1Id)).inspections.listAwaitingMySignature();
      expect(s1List).toHaveLength(1);
      expect(s1List[0]?.inspectionId).toBe(inspectionId);
      expect(s1List[0]?.mode).toBe('sequential');
      expect(s1List[0]?.requesterName).toBe('Alice Admin');

      const s2List = await createCaller(ctxFor(signer2Id)).inspections.listAwaitingMySignature();
      expect(s2List).toHaveLength(0);
      const s3List = await createCaller(ctxFor(signer3Id)).inspections.listAwaitingMySignature();
      expect(s3List).toHaveLength(0);

      // After signer 1 signs, signer 2 becomes the current turn.
      await createCaller(ctxFor(signer1Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'one',
      });
      const s1After = await createCaller(ctxFor(signer1Id)).inspections.listAwaitingMySignature();
      expect(s1After).toHaveLength(0);
      const s2After = await createCaller(ctxFor(signer2Id)).inspections.listAwaitingMySignature();
      expect(s2After).toHaveLength(1);
    });

    it('parallel: returns the inspection for every pending signer', async () => {
      const templateId = await publishWorkflowTemplate({
        name: 'ParList',
        mode: 'parallel',
        signerIds: [signer1Id, signer2Id, signer3Id],
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      await adminCaller.inspections.submit({ inspectionId });

      const s1List = await createCaller(ctxFor(signer1Id)).inspections.listAwaitingMySignature();
      const s2List = await createCaller(ctxFor(signer2Id)).inspections.listAwaitingMySignature();
      const s3List = await createCaller(ctxFor(signer3Id)).inspections.listAwaitingMySignature();
      expect(s1List).toHaveLength(1);
      expect(s2List).toHaveLength(1);
      expect(s3List).toHaveLength(1);
      expect(s1List[0]?.mode).toBe('parallel');

      // After signer 1 signs, they no longer see it, but 2 + 3 still do.
      await createCaller(ctxFor(signer1Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'one',
      });
      const s1After = await createCaller(ctxFor(signer1Id)).inspections.listAwaitingMySignature();
      const s2After = await createCaller(ctxFor(signer2Id)).inspections.listAwaitingMySignature();
      expect(s1After).toHaveLength(0);
      expect(s2After).toHaveLength(1);
    });
  });

  describe('inspections.get exposes workflow state for the status page', () => {
    it('sequential: only the current-turn signer gets viewerCanSignWorkflow=true', async () => {
      const templateId = await publishWorkflowTemplate({
        name: 'SeqGet',
        mode: 'sequential',
        signerIds: [signer1Id, signer2Id, signer3Id],
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      await adminCaller.inspections.submit({ inspectionId });

      // Signer 1 is the current turn → can sign; name pre-fill resolves.
      const s1 = await createCaller(ctxFor(signer1Id)).inspections.get({ inspectionId });
      expect(s1.viewerCanSignWorkflow).toBe(true);
      expect(s1.viewerSignerName).toBe('Signer One');
      expect(s1.workflowSigners).toHaveLength(3);
      expect(s1.workflowSigners.every((r) => r.status === 'pending')).toBe(true);
      expect(s1.workflowSigners.map((r) => r.signerName)).toEqual([
        'Signer One',
        'Signer Two',
        'Signer Three',
      ]);

      // Signer 2 is not yet their turn → cannot sign, but still sees the roster.
      const s2 = await createCaller(ctxFor(signer2Id)).inspections.get({ inspectionId });
      expect(s2.viewerCanSignWorkflow).toBe(false);
      expect(s2.viewerSignerName).toBe('Signer Two');

      // A non-signatory admin can view the roster but never sign.
      const admin = await adminCaller.inspections.get({ inspectionId });
      expect(admin.viewerCanSignWorkflow).toBe(false);
      expect(admin.viewerSignerName).toBeNull();
      expect(admin.workflowSigners).toHaveLength(3);

      // After signer 1 signs, the turn advances to signer 2.
      await createCaller(ctxFor(signer1Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'one',
      });
      const s1After = await createCaller(ctxFor(signer1Id)).inspections.get({ inspectionId });
      expect(s1After.viewerCanSignWorkflow).toBe(false);
      const s2After = await createCaller(ctxFor(signer2Id)).inspections.get({ inspectionId });
      expect(s2After.viewerCanSignWorkflow).toBe(true);
    });

    it('parallel: every pending signer gets viewerCanSignWorkflow=true', async () => {
      const templateId = await publishWorkflowTemplate({
        name: 'ParGet',
        mode: 'parallel',
        signerIds: [signer1Id, signer2Id],
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      await adminCaller.inspections.submit({ inspectionId });

      const s1 = await createCaller(ctxFor(signer1Id)).inspections.get({ inspectionId });
      const s2 = await createCaller(ctxFor(signer2Id)).inspections.get({ inspectionId });
      expect(s1.viewerCanSignWorkflow).toBe(true);
      expect(s2.viewerCanSignWorkflow).toBe(true);

      // Once signer 1 has signed, they can no longer sign; signer 2 still can.
      await createCaller(ctxFor(signer1Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'one',
      });
      const s1After = await createCaller(ctxFor(signer1Id)).inspections.get({ inspectionId });
      expect(s1After.viewerCanSignWorkflow).toBe(false);
      const s2After = await createCaller(ctxFor(signer2Id)).inspections.get({ inspectionId });
      expect(s2After.viewerCanSignWorkflow).toBe(true);
    });

    it('completed inspection: no one can sign', async () => {
      const templateId = await publishWorkflowTemplate({
        name: 'DoneGet',
        mode: 'parallel',
        signerIds: [signer1Id],
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { inspectionId } = await adminCaller.inspections.create({ templateId });
      await adminCaller.inspections.submit({ inspectionId });
      await createCaller(ctxFor(signer1Id)).inspections.signWorkflow({
        inspectionId,
        signatureData: 'one',
      });

      const done = await createCaller(ctxFor(signer1Id)).inspections.get({ inspectionId });
      expect(done.inspection.status).toBe('completed');
      expect(done.viewerCanSignWorkflow).toBe(false);
      expect(done.workflowSigners[0]?.status).toBe('signed');
    });
  });

  describe('schema validation', () => {
    it('validateSignatureWorkflow rejects enabled with no signatories', () => {
      const content = workflowContent({
        title: 'Empty',
        mode: 'sequential',
        signerIds: [],
      });
      const r = validateSignatureWorkflow(content);
      expect(r.valid).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });

    it('validateSignatureWorkflow accepts disabled workflow with no signatories', () => {
      const content = workflowContent({
        title: 'Disabled',
        mode: 'sequential',
        signerIds: [],
      });
      // Manually disable for the test.
      const sw = content.settings.signatureWorkflow;
      if (sw !== undefined) {
        content.settings.signatureWorkflow = { ...sw, enabled: false };
      }
      const r = validateSignatureWorkflow(content);
      expect(r.valid).toBe(true);
    });

    it('templates.publish rejects a draft with enabled-but-empty workflow', async () => {
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { templateId } = await adminCaller.templates.create({ name: 'BadWorkflow' });
      await adminCaller.templates.saveDraft({
        templateId,
        content: workflowContent({
          title: 'BadWorkflow',
          mode: 'sequential',
          signerIds: [],
        }),
      });
      await expect(adminCaller.templates.publish({ templateId })).rejects.toThrow(/signatories/i);
    });
  });
});

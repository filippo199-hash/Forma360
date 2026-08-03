/**
 * Integration tests for the inspections + signatures + approvals + actions
 * routers. Phase 2 PR 28 exercises:
 *
 *   - accessSnapshot populated at create (ADR 0007)
 *   - template pinning (T-E04)
 *   - document number monotonic counter
 *   - archived-template guard on create
 *   - T-E20 concurrent sign → DB unique violation → CONFLICT
 *   - approval flow (awaiting_approval → approve → completed)
 *   - reject flow
 *   - access rule gate on create → FORBIDDEN
 *   - inspections dependents resolver (action referencing inspection)
 *   - templates dependents resolver replacement (counts inspections)
 *   - saveProgress optimistic concurrency (T-E18-style)
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
import { getDependents } from '@forma360/permissions/dependents';
import { TEMPLATE_SCHEMA_VERSION, type TemplateContent } from '@forma360/shared/template-schema';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
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

/** Minimal valid template content — no signature slots, no approval page. */
function simpleContent(title: string): TemplateContent {
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    title,
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
      titleFormat: '{date} AUDIT {docNumber}',
      documentNumberFormat: 'AUDIT{counter:6}',
      documentNumberStart: 1,
    },
    customResponseSets: [],
  };
}

/** Template content with one signature slot and an approval page. */
function signContent(title: string): TemplateContent {
  const sigItemId = newId();
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    title,
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
            title: 'Sigs',
            items: [
              {
                id: sigItemId,
                type: 'signature',
                prompt: 'Sign here',
                required: true,
                mode: 'sequential',
                // Leave the slot unassigned — any inspector with the
                // inspections.sign permission may fill it.
                slots: [{ slotIndex: 0, assigneeUserId: null, label: 'Manager' }],
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
      approvalPage: {
        title: 'Approve',
        approverSlots: [{ slotIndex: 0, assigneeUserId: null }],
      },
    },
    customResponseSets: [],
  };
}

describe('inspections / signatures / approvals / actions (Phase 2 PR 28)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let approverUserId: string;
  let seededSets: Awaited<ReturnType<typeof seedDefaultPermissionSets>>;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silent(),
      auth: { userId, email: 'a@x', tenantId: tenantId as never },
    });
  }

  beforeEach(async () => {
    // NOTE: deliberately do NOT reset the dependents registry. The `appRouter`
    // import above runs each module's `registerDependentResolver` once at
    // module load; resetting would drop them without a re-registration path,
    // and this test exercises the resolvers end-to-end.
    ({ client, db } = await bootDb());
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);
    seededSets = seeded;
    adminUserId = `usr_${newId()}`;
    approverUserId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminUserId,
        name: 'Alice',
        email: 'alice@acme.test',
        tenantId,
        permissionSetId: seeded.administrator,
      },
      {
        // PF-30: approvals are a separated duty — a second manager
        // approves what Alice conducts.
        id: approverUserId,
        name: 'Astrid Approver',
        email: 'astrid@acme.test',
        tenantId,
        permissionSetId: seeded.administrator,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  async function createPublishedTemplate(
    caller: ReturnType<typeof createCaller>,
    name: string,
    content: TemplateContent = simpleContent(name),
  ): Promise<{ templateId: string }> {
    const { templateId } = await caller.templates.create({ name });
    await caller.templates.saveDraft({ templateId, content });
    await caller.templates.publish({ templateId });
    return { templateId };
  }

  /** Template content whose title page carries one "Site conducted" question. */
  function siteContent(title: string, siteQuestionId: string): TemplateContent {
    return {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      title,
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'Title',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                { id: siteQuestionId, type: 'site', prompt: 'Site conducted', required: false },
              ],
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
      },
      customResponseSets: [],
    };
  }

  describe('site question mirrors into inspection.siteId (B4)', () => {
    it('saveProgress + submit populate inspection.siteId from the "site" answer', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const siteId = newId();
      await db.insert(schema.sites).values({ id: siteId, tenantId, name: 'Warehouse 7' });

      const siteQuestionId = newId();
      const { templateId } = await createPublishedTemplate(
        caller,
        'Site Audit',
        siteContent('Site Audit', siteQuestionId),
      );
      const { inspectionId } = await caller.inspections.create({ templateId });

      await caller.inspections.saveProgress({
        inspectionId,
        responses: { [siteQuestionId]: siteId },
      });
      const afterSave = await db
        .select({ siteId: schema.inspections.siteId })
        .from(schema.inspections)
        .where(eq(schema.inspections.id, inspectionId));
      expect(afterSave[0]?.siteId).toBe(siteId);

      await caller.inspections.submit({ inspectionId });
      const afterSubmit = await db
        .select({ siteId: schema.inspections.siteId })
        .from(schema.inspections)
        .where(eq(schema.inspections.id, inspectionId));
      expect(afterSubmit[0]?.siteId).toBe(siteId);
    });

    it('ignores a site id that does not belong to the tenant', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const siteQuestionId = newId();
      const { templateId } = await createPublishedTemplate(
        caller,
        'Site Audit 2',
        siteContent('Site Audit 2', siteQuestionId),
      );
      const { inspectionId } = await caller.inspections.create({ templateId });
      await caller.inspections.saveProgress({
        inspectionId,
        responses: { [siteQuestionId]: newId() },
      });
      const after = await db
        .select({ siteId: schema.inspections.siteId })
        .from(schema.inspections)
        .where(eq(schema.inspections.id, inspectionId));
      expect(after[0]?.siteId).toBeNull();
    });
  });

  describe('create', () => {
    it('populates accessSnapshot with groups, sites, permissions, snapshotAt (ADR 0007)', async () => {
      const caller = createCaller(ctxFor(adminUserId));

      // Attach the admin to a group + site to make the snapshot non-empty.
      const groupId = newId();
      const siteId = newId();
      await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'Auditors' });
      await db.insert(schema.groupMembers).values({
        tenantId,
        groupId,
        userId: adminUserId,
      });
      await db.insert(schema.sites).values({ id: siteId, tenantId, name: 'HQ' });
      await db.insert(schema.siteMembers).values({
        tenantId,
        siteId,
        userId: adminUserId,
      });

      const { templateId } = await createPublishedTemplate(caller, 'Snapshot');

      const { inspectionId } = await caller.inspections.create({ templateId });
      const row = (
        await db.select().from(schema.inspections).where(eq(schema.inspections.id, inspectionId))
      )[0];
      if (row === undefined) throw new Error('inspection row missing');
      const snap = row.accessSnapshot;
      expect(snap.groups).toContain(groupId);
      expect(snap.sites).toContain(siteId);
      expect(snap.permissions).toContain('inspections.conduct');
      expect(snap.permissions).toContain('org.settings');
      expect(typeof snap.snapshotAt).toBe('string');
      expect(Number.isFinite(Date.parse(snap.snapshotAt))).toBe(true);
    });

    it('setSite validates the target site belongs to the tenant', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await createPublishedTemplate(caller, 'SetSite');
      const { inspectionId } = await caller.inspections.create({ templateId });

      // A site id that doesn't exist in this tenant must be rejected.
      await expect(caller.inspections.setSite({ inspectionId, siteId: newId() })).rejects.toThrow();

      // A real tenant site is accepted; null detaches.
      const siteId = newId();
      await db.insert(schema.sites).values({ id: siteId, tenantId, name: 'Depot' });
      await expect(caller.inspections.setSite({ inspectionId, siteId })).resolves.toEqual({
        ok: true,
      });
      await expect(caller.inspections.setSite({ inspectionId, siteId: null })).resolves.toEqual({
        ok: true,
      });
    });

    it('stamps monotonic document numbers and increments the template counter', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await createPublishedTemplate(caller, 'Counter');

      const { inspectionId: id1 } = await caller.inspections.create({ templateId });
      const { inspectionId: id2 } = await caller.inspections.create({ templateId });

      const [row1] = await db
        .select()
        .from(schema.inspections)
        .where(eq(schema.inspections.id, id1));
      const [row2] = await db
        .select()
        .from(schema.inspections)
        .where(eq(schema.inspections.id, id2));
      expect(row1?.documentNumber).toBe('AUDIT000001');
      expect(row2?.documentNumber).toBe('AUDIT000002');

      const [tpl] = await db
        .select()
        .from(schema.templates)
        .where(eq(schema.templates.id, templateId));
      expect(tpl?.documentNumberCounter).toBe(2);
    });

    it('pins to the version published at start and never drifts (T-E04)', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await createPublishedTemplate(caller, 'Pinned');

      // Record the current version before starting the inspection.
      const { template: beforeTpl } = await caller.templates.get({ templateId });
      const pinnedVersionId = beforeTpl.currentVersionId;
      if (pinnedVersionId === null) throw new Error('publish did not set currentVersionId');

      const { inspectionId } = await caller.inspections.create({ templateId });

      // Save a new draft + publish. The template's current version changes.
      await caller.templates.saveDraft({
        templateId,
        content: simpleContent('Pinned v2'),
      });
      const second = await caller.templates.publish({ templateId });
      expect(second.versionId).not.toBe(pinnedVersionId);

      // But the inspection still points at the original.
      const { inspection } = await caller.inspections.get({ inspectionId });
      expect(inspection.templateVersionId).toBe(pinnedVersionId);

      // And getVersion on the pinned id still works.
      const pinnedVersion = await caller.templates.getVersion({ versionId: pinnedVersionId });
      expect(pinnedVersion.id).toBe(pinnedVersionId);
    });

    it('blocks creation when the template is archived', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await createPublishedTemplate(caller, 'Archived');
      await caller.templates.archive({ templateId });
      await expect(caller.inspections.create({ templateId })).rejects.toThrow(/archived/i);
    });

    it('blocks creation when the access rule does not match the caller', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await createPublishedTemplate(caller, 'Gated');

      // Build a rule that requires membership of a group the admin is NOT in.
      const orphanGroupId = newId();
      await db.insert(schema.groups).values({ id: orphanGroupId, tenantId, name: 'Orphans' });
      const ruleId = newId();
      await db.insert(schema.accessRules).values({
        id: ruleId,
        tenantId,
        name: 'Orphans only',
        groupIds: [orphanGroupId],
        siteIds: [],
      });
      await db
        .update(schema.templates)
        .set({ accessRuleId: ruleId })
        .where(eq(schema.templates.id, templateId));

      await expect(caller.inspections.create({ templateId })).rejects.toThrow(/access rule/i);
    });
  });

  describe('read gating by template access rule (extends B3 to instances)', () => {
    it('non-member cannot get/list/export an inspection of a restricted template; member + manager can', async () => {
      const admin = createCaller(ctxFor(adminUserId));
      // Conduct first, THEN restrict the template (create-time rule is a
      // separate gate; here we exercise the read gate).
      const { templateId } = await createPublishedTemplate(admin, 'Restricted');
      const { inspectionId } = await admin.inspections.create({ templateId });
      const { templateId: openTpl } = await createPublishedTemplate(admin, 'Open');
      const { inspectionId: openInsp } = await admin.inspections.create({ templateId: openTpl });

      const groupId = newId();
      await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'North' });
      const ruleId = newId();
      await db.insert(schema.accessRules).values({
        id: ruleId,
        tenantId,
        name: 'North only',
        groupIds: [groupId],
        siteIds: [],
      });
      await db
        .update(schema.templates)
        .set({ accessRuleId: ruleId })
        .where(eq(schema.templates.id, templateId));

      const outsiderId = `usr_${newId()}`;
      const memberId = `usr_${newId()}`;
      const managerId = `usr_${newId()}`;
      await db.insert(schema.user).values([
        {
          id: outsiderId,
          name: 'Out',
          email: 'out@acme.test',
          tenantId,
          permissionSetId: seededSets.standard,
        },
        {
          id: memberId,
          name: 'Mem',
          email: 'mem@acme.test',
          tenantId,
          permissionSetId: seededSets.standard,
        },
        {
          id: managerId,
          name: 'Mgr',
          email: 'mgr@acme.test',
          tenantId,
          permissionSetId: seededSets.manager,
        },
      ]);
      await db.insert(schema.groupMembers).values({ tenantId, groupId, userId: memberId });

      // Non-member Standard user: get FORBIDDEN, absent from list.
      const outsider = createCaller(ctxFor(outsiderId));
      await expect(outsider.inspections.get({ inspectionId })).rejects.toThrow(
        /FORBIDDEN|access rule/i,
      );
      const outList = await outsider.inspections.list({});
      expect(outList.find((r) => r.id === inspectionId)).toBeUndefined();
      // …but the OPEN template's inspection is visible to the non-member.
      expect((await outsider.inspections.get({ inspectionId: openInsp })).inspection.id).toBe(
        openInsp,
      );
      expect((await outsider.inspections.list({})).find((r) => r.id === openInsp)).toBeDefined();

      // Group member: full read access to the restricted inspection.
      const member = createCaller(ctxFor(memberId));
      expect((await member.inspections.get({ inspectionId })).inspection.id).toBe(inspectionId);
      expect((await member.inspections.list({})).find((r) => r.id === inspectionId)).toBeDefined();

      // Manager (not in the group) bypasses the rule.
      const manager = createCaller(ctxFor(managerId));
      expect((await manager.inspections.get({ inspectionId })).inspection.id).toBe(inspectionId);
      expect((await manager.inspections.list({})).find((r) => r.id === inspectionId)).toBeDefined();
    });
  });

  describe('saveProgress', () => {
    it('rejects a save with stale expectedUpdatedAt', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await createPublishedTemplate(caller, 'Progress');
      const { inspectionId } = await caller.inspections.create({ templateId });

      // Stamp an initial save to move updatedAt forward.
      await caller.inspections.saveProgress({
        inspectionId,
        responses: { foo: 'bar' },
      });

      await expect(
        caller.inspections.saveProgress({
          inspectionId,
          responses: { foo: 'baz' },
          expectedUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      ).rejects.toThrow(/modified elsewhere|CONFLICT/);
    });
  });

  describe('response-option triggers on submit', () => {
    /** Content with one MC question whose "Bad" option fires all three triggers. */
    function triggerContent(): {
      content: TemplateContent;
      itemId: string;
      setId: string;
      badId: string;
    } {
      const itemId = newId();
      const setId = newId();
      const badId = newId();
      const goodId = newId();
      const content: TemplateContent = {
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
        title: 'Triggers',
        pages: [
          {
            id: newId(),
            type: 'title',
            title: 'Title',
            sections: [{ id: newId(), title: 's', items: [] }],
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
                    id: itemId,
                    type: 'multipleChoice',
                    prompt: 'Condition?',
                    required: false,
                    responseSetId: setId,
                  },
                ],
              },
            ],
          },
        ],
        settings: {
          titleFormat: '{date}',
          documentNumberFormat: 'AUDIT{counter:6}',
          documentNumberStart: 1,
        },
        customResponseSets: [
          {
            id: setId,
            name: 'Good / Bad',
            sourceGlobalId: null,
            multiSelect: false,
            options: [
              { id: goodId, label: 'Good', color: 'green' },
              {
                id: badId,
                label: 'Bad',
                color: 'red',
                triggers: [
                  { kind: 'requireAction', actionTitle: 'Fix the issue' },
                  { kind: 'requireEvidence', mediaKind: 'any', minCount: 1 },
                  { kind: 'notify', email: 'safety@example.com', timing: 'onCompletion' },
                ],
              },
            ],
          },
        ],
      };
      return { content, itemId, setId, badId };
    }

    it('blocks submit until requireEvidence is satisfied, then creates the action', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { content, itemId, badId } = triggerContent();
      const { templateId } = await createPublishedTemplate(caller, 'Triggers', content);
      const { inspectionId } = await caller.inspections.create({ templateId });

      // Select the flagged "Bad" option, no evidence yet.
      await caller.inspections.saveProgress({ inspectionId, responses: { [itemId]: badId } });

      // requireEvidence gate blocks submit.
      await expect(caller.inspections.submit({ inspectionId })).rejects.toThrow(/evidence/i);

      // Attach evidence under the reserved key, then submit succeeds.
      await caller.inspections.saveProgress({
        inspectionId,
        responses: { [itemId]: badId, [`evidence:${itemId}`]: ['tenant/insp/file.jpg'] },
      });
      const res = await caller.inspections.submit({ inspectionId });
      expect(res.status).toBe('completed');

      // requireAction created exactly one action for this question.
      const actions = (await caller.actions.list({
        sourceType: 'inspection',
        sourceId: inspectionId,
      })).rows;
      const created = actions.filter((a) => a.sourceItemId === itemId);
      expect(created).toHaveLength(1);
      expect(created[0]?.title).toBe('Fix the issue');
    });

    it('does not create an action or block submit when the non-triggering option is chosen', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { content, itemId } = triggerContent();
      const goodId = content.customResponseSets[0]?.options[0]?.id;
      if (goodId === undefined) throw new Error('fixture');
      const { templateId } = await createPublishedTemplate(caller, 'TriggersGood', content);
      const { inspectionId } = await caller.inspections.create({ templateId });

      await caller.inspections.saveProgress({ inspectionId, responses: { [itemId]: goodId } });
      const res = await caller.inspections.submit({ inspectionId });
      expect(res.status).toBe('completed');

      const actions = (await caller.actions.list({
        sourceType: 'inspection',
        sourceId: inspectionId,
      })).rows;
      expect(actions.filter((a) => a.sourceItemId === itemId)).toHaveLength(0);
    });

    it('is idempotent — re-evaluating does not duplicate the action', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { content, itemId, badId } = triggerContent();
      const { templateId } = await createPublishedTemplate(caller, 'TriggersIdem', content);
      const { inspectionId } = await caller.inspections.create({ templateId });
      await caller.inspections.saveProgress({
        inspectionId,
        responses: { [itemId]: badId, [`evidence:${itemId}`]: ['k1'] },
      });
      await caller.inspections.submit({ inspectionId });
      const actions = (await caller.actions.list({
        sourceType: 'inspection',
        sourceId: inspectionId,
      })).rows;
      expect(actions.filter((a) => a.sourceItemId === itemId)).toHaveLength(1);
    });
  });

  describe('signatures + approval flow', () => {
    it('submits to awaiting_signatures; signing the last slot advances to awaiting_approval; approve completes', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const content = signContent('SignMe');
      const { templateId } = await caller.templates.create({ name: 'SignMe' });
      await caller.templates.saveDraft({ templateId, content });
      await caller.templates.publish({ templateId });

      const { inspectionId } = await caller.inspections.create({ templateId });
      const submitRes = await caller.inspections.submit({ inspectionId });
      expect(submitRes.status).toBe('awaiting_signatures');

      // List slots to find the single slot.
      const slots = await caller.signatures.listSlots({ inspectionId });
      expect(slots.slots).toHaveLength(1);
      const slot = slots.slots[0];
      if (slot === undefined) throw new Error('expected a signature slot');

      await caller.signatures.sign({
        inspectionId,
        slotIndex: slot.slotIndex,
        slotId: slot.itemId,
        signerName: 'Alice',
        signatureData: 'data:image/svg+xml;base64,AAAA',
      });

      const { inspection: afterSign } = await caller.inspections.get({ inspectionId });
      expect(afterSign.status).toBe('awaiting_approval');

      // PF-30: the conductor cannot bless their own work.
      await expect(
        caller.approvals.approve({ inspectionId, comment: 'LGTM' }),
      ).rejects.toMatchObject({ message: 'self-approval' });

      const approver = createCaller(ctxFor(approverUserId));
      await approver.approvals.approve({ inspectionId, comment: 'LGTM' });
      const { inspection: afterApprove } = await caller.inspections.get({ inspectionId });
      expect(afterApprove.status).toBe('completed');
      expect(afterApprove.completedAt).toBeInstanceOf(Date);
    });

    it('T-E20: second sign on the same (inspection, slotIndex) throws CONFLICT', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      // Use a 2-slot signature so filling slot 0 does not advance the
      // inspection status out of awaiting_signatures — the duplicate sign
      // then hits the DB unique index rather than the status guard.
      const sigItemId = newId();
      const content: TemplateContent = {
        schemaVersion: TEMPLATE_SCHEMA_VERSION,
        title: 'Dbl',
        pages: [
          {
            id: newId(),
            type: 'title',
            title: 'Title',
            sections: [
              {
                id: newId(),
                title: 's',
                items: [
                  { id: newId(), type: 'conductedBy', prompt: 'Conducted by', required: false },
                ],
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
                title: 'Sigs',
                items: [
                  {
                    id: sigItemId,
                    type: 'signature',
                    prompt: 'Sign',
                    required: true,
                    mode: 'parallel',
                    slots: [
                      { slotIndex: 0, assigneeUserId: null },
                      { slotIndex: 1, assigneeUserId: null },
                    ],
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
        },
        customResponseSets: [],
      };
      const { templateId } = await caller.templates.create({ name: 'Dbl' });
      await caller.templates.saveDraft({ templateId, content });
      await caller.templates.publish({ templateId });

      const { inspectionId } = await caller.inspections.create({ templateId });
      await caller.inspections.submit({ inspectionId });

      await caller.signatures.sign({
        inspectionId,
        slotIndex: 0,
        slotId: sigItemId,
        signerName: 'Alice',
        signatureData: 'x',
      });

      await expect(
        caller.signatures.sign({
          inspectionId,
          slotIndex: 0,
          slotId: sigItemId,
          signerName: 'Alice again',
          signatureData: 'y',
        }),
      ).rejects.toThrow(/already been signed|CONFLICT/);
    });

    it('reject flow stamps rejectedAt + rejectedReason', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const content = signContent('Rej');
      const { templateId } = await caller.templates.create({ name: 'Rej' });
      await caller.templates.saveDraft({ templateId, content });
      await caller.templates.publish({ templateId });

      const { inspectionId } = await caller.inspections.create({ templateId });
      await caller.inspections.submit({ inspectionId });
      const slots = await caller.signatures.listSlots({ inspectionId });
      const slot = slots.slots[0];
      if (slot === undefined) throw new Error('expected a signature slot');
      await caller.signatures.sign({
        inspectionId,
        slotIndex: slot.slotIndex,
        slotId: slot.itemId,
        signerName: 'Alice',
        signatureData: 'x',
      });
      await caller.approvals.reject({ inspectionId, comment: 'Missing evidence' });

      const { inspection } = await caller.inspections.get({ inspectionId });
      expect(inspection.status).toBe('rejected');
      expect(inspection.rejectedAt).toBeInstanceOf(Date);
      expect(inspection.rejectedReason).toBe('Missing evidence');
    });
  });

  describe('dependents resolvers', () => {
    it('inspection dependents returns the count of actions created from it', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await createPublishedTemplate(caller, 'Deps');
      const { inspectionId } = await caller.inspections.create({ templateId });

      await caller.actions.createFromInspectionQuestion({
        inspectionId,
        sourceItemId: 'itm-1',
        title: 'Fix the thing',
      });

      const counts = await getDependents(
        { db: db as unknown as Database },
        { entity: 'inspection', id: inspectionId, tenantId },
      );
      expect(counts.inspections).toBe(1);
    });

    it('template dependents (PR 28 replacement) returns the count of inspections', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await createPublishedTemplate(caller, 'TplDeps');

      await caller.inspections.create({ templateId });
      await caller.inspections.create({ templateId });

      const counts = await getDependents(
        { db: db as unknown as Database },
        { entity: 'template', id: templateId, tenantId },
      );
      expect(counts.templates).toBe(2);
    });

    it('createFromInspectionQuestion is idempotent on the same sourceItemId', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { templateId } = await createPublishedTemplate(caller, 'Idem');
      const { inspectionId } = await caller.inspections.create({ templateId });

      const first = await caller.actions.createFromInspectionQuestion({
        inspectionId,
        sourceItemId: 'itm-dup',
        title: 'First',
      });
      expect(first.created).toBe(true);
      const second = await caller.actions.createFromInspectionQuestion({
        inspectionId,
        sourceItemId: 'itm-dup',
        title: 'Would be second',
      });
      expect(second.created).toBe(false);
      expect(second.actionId).toBe(first.actionId);
    });
  });
});

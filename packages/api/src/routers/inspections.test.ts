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
    adminUserId = `usr_${newId()}`;
    await db.insert(schema.user).values({
      id: adminUserId,
      name: 'Alice',
      email: 'alice@acme.test',
      tenantId,
      permissionSetId: seeded.administrator,
    });
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

      await caller.approvals.approve({ inspectionId, comment: 'LGTM' });
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

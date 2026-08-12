/**
 * Integration tests for the issues router — Phase 3 PR 1.
 *
 * Exercises:
 *   Categories
 *   1. create + list
 *   2. archive + list filters
 *   3. I-E02 delete guard (open issues)
 *   4. share-token idempotency + rotate
 *   5. share-token revoke + regenerate
 *
 *   Issues
 *   6. create happy path (referenceNumber, counter)
 *   7. I-E11 server guard: archived category rejects create
 *   8. I-E03 stability: categorySnapshot frozen at issue create
 *   9. close + reopen + already-closed CONFLICT + reopen-open BAD_REQUEST
 *   10. archive + restore
 *   11. email fan-out to managers on create
 *   12. nearbyCount
 *   13. accessSnapshot present (ADR 0007)
 *   14. anonymous QR storage shape
 *
 *   Anonymous QR
 *   15. createFromShareToken happy path
 *   16. createFromShareToken with archived category
 *   17. createFromShareToken with revoked token
 *
 *   Comments
 *   18. delete: author / manager / forbidden
 *   19. non-author cannot update
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
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@forma360/db/client';
import { createTestContext, type Context } from '../context';
import { __authStubMailbox, appRouter } from '../router';
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

const silent = () => createLogger({ service: 'test', level: 'fatal', nodeEnv: 'test' });
const createCaller = createCallerFactory(appRouter);

describe('issues router (Phase 3 PR 1)', () => {
  let client: PGlite;
  let db: PgliteDatabase<typeof schema>;
  let tenantId: string;
  let adminUserId: string;
  let standardUserId: string;
  let managerUserId: string;

  function ctxFor(userId: string): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silent(),
      auth: { userId, email: `${userId}@x`, tenantId: tenantId as never },
    });
  }

  function publicCtx(): Context {
    return createTestContext({
      db: db as unknown as Database,
      logger: silent(),
      auth: null,
    });
  }

  beforeEach(async () => {
    ({ client, db } = await bootDb());
    __authStubMailbox.length = 0;
    tenantId = newId();
    await db.insert(schema.tenants).values({ id: tenantId, name: 'Acme', slug: 'acme' });
    const seeded = await seedDefaultPermissionSets(db as unknown as Database, tenantId);

    adminUserId = `usr_${newId()}`;
    managerUserId = `usr_${newId()}`;
    standardUserId = `usr_${newId()}`;
    await db.insert(schema.user).values([
      {
        id: adminUserId,
        name: 'Alice',
        email: 'alice@acme.test',
        tenantId,
        permissionSetId: seeded.administrator,
      },
      {
        id: managerUserId,
        name: 'Mallory',
        email: 'mallory@acme.test',
        tenantId,
        permissionSetId: seeded.manager,
      },
      {
        id: standardUserId,
        name: 'Stan',
        email: 'stan@acme.test',
        tenantId,
        permissionSetId: seeded.standard,
      },
    ]);
  });

  afterEach(async () => {
    await client.close();
  });

  // ─── Categories ──────────────────────────────────────────────────────────
  describe('categories', () => {
    it('create + list returns rows scoped to tenant', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      await caller.issues.categories.create({ name: 'Safety' });
      await caller.issues.categories.create({ name: 'Quality' });
      await caller.issues.categories.create({ name: 'Maintenance' });
      const list = await caller.issues.categories.list({});
      expect(list).toHaveLength(3);
      const names = list.map((c) => c.name).sort();
      expect(names).toEqual(['Maintenance', 'Quality', 'Safety']);
    });

    it('archive hides categories from the default list', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const a = await caller.issues.categories.create({ name: 'A' });
      await caller.issues.categories.create({ name: 'B' });
      await caller.issues.categories.create({ name: 'C' });
      await caller.issues.categories.archive({ categoryId: a.categoryId });
      const live = await caller.issues.categories.list({});
      expect(live).toHaveLength(2);
      const all = await caller.issues.categories.list({ includeArchived: true });
      expect(all).toHaveLength(3);
    });

    it('I-E02: delete blocked when open issues exist; archive succeeds', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { categoryId } = await caller.issues.categories.create({ name: 'SafetyOps' });
      await caller.issues.issues.create({ categoryId, title: 'Spill in aisle 3' });

      try {
        await caller.issues.categories.delete({ categoryId });
        throw new Error('expected delete to throw');
      } catch (err) {
        if (err === null || typeof err !== 'object') throw err;
        // Message is "category-has-open-issues"; cause data carries the count.
        const record = err as Record<string, unknown>;
        expect(String(record.message)).toContain('category-has-open-issues');
        const cause = record.cause as Record<string, unknown> | undefined;
        expect(cause?.openIssueCount).toBe(1);
      }
      // Archive still works.
      await caller.issues.categories.archive({ categoryId });
      const cat = await caller.issues.categories.get({ categoryId });
      expect(cat.archivedAt).not.toBeNull();
    });

    it('generateShareToken is idempotent; rotateShareToken returns a fresh token', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { categoryId } = await caller.issues.categories.create({ name: 'QR1' });
      const first = await caller.issues.categories.generateShareToken({ categoryId });
      const second = await caller.issues.categories.generateShareToken({ categoryId });
      expect(second.token).toBe(first.token);
      const rotated = await caller.issues.categories.rotateShareToken({ categoryId });
      expect(rotated.token).not.toBe(first.token);
      expect(rotated.url).toContain(rotated.token);
    });

    it('revokeShareToken clears the column; generateShareToken then creates a fresh one', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { categoryId } = await caller.issues.categories.create({ name: 'QR2' });
      const first = await caller.issues.categories.generateShareToken({ categoryId });
      await caller.issues.categories.revokeShareToken({ categoryId });
      const after = await caller.issues.categories.get({ categoryId });
      expect(after.publicShareToken).toBeNull();
      const fresh = await caller.issues.categories.generateShareToken({ categoryId });
      expect(fresh.token).not.toBe(first.token);
    });

    describe('publicGetByShareToken', () => {
      it('returns category info for a valid token', async () => {
        const adminCaller = createCaller(ctxFor(adminUserId));
        const { categoryId } = await adminCaller.issues.categories.create({
          name: 'QRPub',
        });
        const { token } = await adminCaller.issues.categories.generateShareToken({
          categoryId,
        });
        const publicCaller = createCaller(publicCtx());
        const result = await publicCaller.issues.categories.publicGetByShareToken({
          token,
        });
        expect(result).not.toBeNull();
        expect(result?.categoryId).toBe(categoryId);
        expect(result?.tenantId).toBe(tenantId);
        expect(result?.tenantName).toBe('Acme');
        expect(result?.categoryName).toBe('QRPub');
        expect(Array.isArray(result?.customQuestions)).toBe(true);
      });

      it('returns null for an unknown token', async () => {
        const publicCaller = createCaller(publicCtx());
        const result = await publicCaller.issues.categories.publicGetByShareToken({
          token: 'does-not-exist-xyz',
        });
        expect(result).toBeNull();
      });

      it('returns null when the category is archived', async () => {
        const adminCaller = createCaller(ctxFor(adminUserId));
        const { categoryId } = await adminCaller.issues.categories.create({
          name: 'QRArchPub',
        });
        const { token } = await adminCaller.issues.categories.generateShareToken({
          categoryId,
        });
        await adminCaller.issues.categories.archive({ categoryId });
        const publicCaller = createCaller(publicCtx());
        const result = await publicCaller.issues.categories.publicGetByShareToken({
          token,
        });
        expect(result).toBeNull();
      });
    });
  });

  // ─── Issues ──────────────────────────────────────────────────────────────
  describe('issues', () => {
    async function bootCategory(name = 'Cat'): Promise<string> {
      const caller = createCaller(ctxFor(adminUserId));
      const { categoryId } = await caller.issues.categories.create({ name });
      return categoryId;
    }

    it('create returns OBS-000001 and increments per tenant', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const categoryId = await bootCategory();
      const first = await caller.issues.issues.create({ categoryId, title: 'First' });
      const second = await caller.issues.issues.create({ categoryId, title: 'Second' });
      expect(first.referenceNumber).toBe('OBS-000001');
      expect(second.referenceNumber).toBe('OBS-000002');
    });

    it('I-E11: create rejected when category is archived', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const categoryId = await bootCategory('Archd');
      await caller.issues.categories.archive({ categoryId });
      await expect(
        caller.issues.issues.create({ categoryId, title: 'Should fail' }),
      ).rejects.toThrow(/category-archived/);
    });

    it('I-E03: categorySnapshot is frozen at issue create time', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const questionId = newId();
      const { categoryId } = await caller.issues.categories.create({
        name: 'I-E03',
        customQuestions: [
          {
            id: questionId,
            prompt: 'Which one?',
            type: 'multipleChoice',
            required: false,
            options: ['A', 'B', 'C'],
          },
        ],
      });
      const created = await caller.issues.issues.create({
        categoryId,
        title: 'Answered B',
        customQuestionResponses: { [questionId]: 'B' },
      });
      // Admin removes option B from the category definition.
      await caller.issues.categories.update({
        categoryId,
        customQuestions: [
          {
            id: questionId,
            prompt: 'Which one?',
            type: 'multipleChoice',
            required: false,
            options: ['A', 'C'],
          },
        ],
      });
      const { issue, categorySnapshot } = await caller.issues.issues.get({
        issueId: created.issueId,
      });
      // Response value preserved.
      expect(issue.customQuestionResponses[questionId]).toBe('B');
      // Snapshot's options still include B.
      const snapshotQ = categorySnapshot.customQuestions[0];
      expect(snapshotQ?.options).toEqual(['A', 'B', 'C']);
    });

    it('close + reopen, with status / conflict guards', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const categoryId = await bootCategory('CloseMe');
      const { issueId } = await caller.issues.issues.create({ categoryId, title: 'Close' });
      await caller.issues.issues.close({ issueId, reason: 'Resolved' });
      const closed = await caller.issues.issues.get({ issueId });
      expect(closed.issue.status).toBe('closed');
      expect(closed.issue.closedAt).not.toBeNull();
      // Closing again → CONFLICT.
      await expect(caller.issues.issues.close({ issueId })).rejects.toThrow(
        /already-closed|CONFLICT/i,
      );
      await caller.issues.issues.reopen({ issueId });
      const reopened = await caller.issues.issues.get({ issueId });
      expect(reopened.issue.status).toBe('open');
      expect(reopened.issue.closedAt).toBeNull();
      // Reopening an open issue → BAD_REQUEST.
      await expect(caller.issues.issues.reopen({ issueId })).rejects.toThrow(
        /not-closed|BAD_REQUEST/i,
      );
    });

    it('archive + restore; list excludes archived by default', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const categoryId = await bootCategory('Arch');
      const { issueId } = await caller.issues.issues.create({ categoryId, title: 'X' });
      await caller.issues.issues.archive({ issueId });
      const liveList = await caller.issues.issues.list({});
      expect(liveList.items.find((i) => i.id === issueId)).toBeUndefined();
      const allList = await caller.issues.issues.list({ includeArchived: true });
      expect(allList.items.find((i) => i.id === issueId)).toBeDefined();
      await caller.issues.issues.restore({ issueId });
      const back = await caller.issues.issues.list({});
      expect(back.items.find((i) => i.id === issueId)).toBeDefined();
    });

    it('sends one issue-created email to every issues.manage user', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const categoryId = await bootCategory('Notify');
      __authStubMailbox.length = 0;
      const { referenceNumber } = await caller.issues.issues.create({
        categoryId,
        title: 'Email me',
      });
      const issueMails = __authStubMailbox.filter((m) => m.templateKey === 'issue-created');
      // Administrator + Manager seeded sets both hold issues.manage.
      expect(issueMails.length).toBeGreaterThanOrEqual(1);
      const first = issueMails[0];
      expect(first?.variables.referenceNumber).toBe(referenceNumber);
      expect(first?.variables.categoryName).toBe('Notify');
      // PF-12: the link must target the real /observations route (the
      // old /en/issues/{id} URL 404ed on every notification).
      expect(first?.variables.viewUrl).toContain('/en/observations/');
      expect(first?.variables.viewUrl).not.toContain('/en/issues/');
      // Every emailed manager also gets an issue_reported bell row.
      const bells = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.kind, 'issue_reported'));
      expect(bells.length).toBe(issueMails.length);
      expect(bells[0]?.href).toContain('/observations/');
    });

    it('NP-IS1: issue_reported prefs — muted email keeps the bell row; muted inapp keeps the email', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const categoryId = await bootCategory('Prefs');
      const adminBells = () =>
        db
          .select()
          .from(schema.notifications)
          .where(
            and(
              eq(schema.notifications.kind, 'issue_reported'),
              eq(schema.notifications.userId, adminUserId),
            ),
          );

      await db
        .update(schema.user)
        .set({ notificationPrefs: { 'email:issue_reported': false } })
        .where(eq(schema.user.id, adminUserId));
      __authStubMailbox.length = 0;
      await caller.issues.issues.create({ categoryId, title: 'Muted email' });
      const mailsTo = () =>
        __authStubMailbox.filter((m) => m.templateKey === 'issue-created').map((m) => m.to);
      expect(mailsTo()).not.toContain('alice@acme.test');
      expect(await adminBells()).toHaveLength(1);

      await db
        .update(schema.user)
        .set({ notificationPrefs: { 'inapp:issue_reported': false } })
        .where(eq(schema.user.id, adminUserId));
      __authStubMailbox.length = 0;
      await caller.issues.issues.create({ categoryId, title: 'Muted bell' });
      expect(mailsTo()).toContain('alice@acme.test');
      // No new bell row for the admin — still just the first one.
      expect(await adminBells()).toHaveLength(1);
    });

    it('nearbyCount returns issues at the site within the window', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const categoryId = await bootCategory('Near');
      const siteId = newId();
      await db.insert(schema.sites).values({ id: siteId, tenantId, name: 'Site A' });
      const a = await caller.issues.issues.create({ categoryId, title: 'A', siteId });
      const b = await caller.issues.issues.create({ categoryId, title: 'B', siteId });
      // Backdate a third issue beyond the 24h window directly via the db.
      const oldId = newId();
      const old = new Date(Date.now() - 48 * 3_600_000);
      await db.insert(schema.issues).values({
        id: oldId,
        tenantId,
        categoryId,
        title: 'Old',
        status: 'open',
        reportedByUserId: adminUserId,
        reportedByName: 'Alice',
        reportedVia: 'app',
        siteId,
        dateOccurred: old,
        categorySnapshot: { categoryId, name: 'Near', customFields: [], customQuestions: [] },
        referenceNumber: 'ISS-OLD',
        accessSnapshot: {
          groupIds: [],
          siteIds: [],
          permissions: [],
          snapshotAt: old.toISOString(),
        },
        createdAt: old,
        updatedAt: old,
      });
      const { count } = await caller.issues.issues.nearbyCount({ siteId, withinHours: 24 });
      expect(count).toBe(2);
      // Sanity: a and b ids exist.
      expect(a.issueId).not.toBe(b.issueId);
    });

    it('populates accessSnapshot with groups, sites, permissions, snapshotAt (ADR 0007)', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const groupId = newId();
      const siteId = newId();
      await db.insert(schema.groups).values({ id: groupId, tenantId, name: 'Auditors' });
      await db.insert(schema.groupMembers).values({ tenantId, groupId, userId: adminUserId });
      await db.insert(schema.sites).values({ id: siteId, tenantId, name: 'HQ' });
      await db.insert(schema.siteMembers).values({ tenantId, siteId, userId: adminUserId });
      const categoryId = await bootCategory('Snap');
      const { issueId } = await caller.issues.issues.create({ categoryId, title: 'Snapshot' });
      const { issue } = await caller.issues.issues.get({ issueId });
      expect(issue.accessSnapshot.groupIds).toContain(groupId);
      expect(issue.accessSnapshot.siteIds).toContain(siteId);
      expect(issue.accessSnapshot.permissions).toContain('org.settings');
      expect(typeof issue.accessSnapshot.snapshotAt).toBe('string');
      expect(Number.isFinite(Date.parse(issue.accessSnapshot.snapshotAt))).toBe(true);
    });

    it('stores anonymous QR submission with reportedVia=qr and no userId', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { categoryId } = await caller.issues.categories.create({ name: 'QR3' });
      const { token } = await caller.issues.categories.generateShareToken({ categoryId });
      const publicCaller = createCaller(publicCtx());
      const { issueId } = await publicCaller.issues.issues.createFromShareToken({
        token,
        tenantId,
        title: 'Anonymous report',
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { issue } = await adminCaller.issues.issues.get({ issueId });
      expect(issue.reportedByUserId).toBeNull();
      expect(issue.reportedVia).toBe('qr');
      expect(issue.reportedByName).toBe('Anonymous (QR)');
    });
  });

  // ─── Anonymous QR submission ─────────────────────────────────────────────
  describe('createFromShareToken', () => {
    it('happy path: creates an anonymous issue and returns a reference number', async () => {
      const caller = createCaller(ctxFor(adminUserId));
      const { categoryId } = await caller.issues.categories.create({ name: 'QRHappy' });
      const { token } = await caller.issues.categories.generateShareToken({ categoryId });
      const publicCaller = createCaller(publicCtx());
      const result = await publicCaller.issues.issues.createFromShareToken({
        token,
        tenantId,
        title: 'Spill',
      });
      expect(result.referenceNumber).toMatch(/^OBS-\d{6}$/);
      const row = (
        await db.select().from(schema.issues).where(eq(schema.issues.id, result.issueId))
      )[0];
      expect(row?.reportedVia).toBe('qr');
      expect(row?.reportedByUserId).toBeNull();
      expect(row?.reportedByName).toBe('Anonymous (QR)');
    });

    it('I-E11 server guard via QR: archived category rejects the submission', async () => {
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { categoryId } = await adminCaller.issues.categories.create({ name: 'QRArch' });
      const { token } = await adminCaller.issues.categories.generateShareToken({ categoryId });
      await adminCaller.issues.categories.archive({ categoryId });
      const publicCaller = createCaller(publicCtx());
      await expect(
        publicCaller.issues.issues.createFromShareToken({
          token,
          tenantId,
          title: 'Late submission',
        }),
      ).rejects.toThrow(/category-archived/);
    });

    it('revoked token returns NOT_FOUND', async () => {
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { categoryId } = await adminCaller.issues.categories.create({ name: 'QRRev' });
      const { token } = await adminCaller.issues.categories.generateShareToken({ categoryId });
      await adminCaller.issues.categories.revokeShareToken({ categoryId });
      const publicCaller = createCaller(publicCtx());
      await expect(
        publicCaller.issues.issues.createFromShareToken({ token, tenantId, title: 'Nope' }),
      ).rejects.toThrow(/token-not-found|NOT_FOUND/);
    });
    it('PF-11: QR submit carries a site + photos; config lists sites; scope enforced', async () => {
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { categoryId } = await adminCaller.issues.categories.create({ name: 'QRMedia' });
      const { token } = await adminCaller.issues.categories.generateShareToken({ categoryId });
      const siteId = newId();
      await db.insert(schema.sites).values({ id: siteId, tenantId, name: 'Depot' });

      // The public config carries the site picker options.
      const publicCaller = createCaller(publicCtx());
      const config = await publicCaller.issues.categories.publicGetByShareToken({ token });
      expect(config?.sites.map((s) => s.name)).toContain('Depot');

      const media = [
        {
          key: `${tenantId}/issues/${newId()}/photo.jpg`,
          filename: 'photo.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 12_345,
        },
      ];
      const result = await publicCaller.issues.issues.createFromShareToken({
        token,
        tenantId,
        title: 'Blocked exit',
        siteId,
        media,
      });
      const row = (
        await db.select().from(schema.issues).where(eq(schema.issues.id, result.issueId))
      )[0];
      expect(row?.siteId).toBe(siteId);
      const attachments = await db
        .select()
        .from(schema.issueAttachments)
        .where(eq(schema.issueAttachments.issueId, result.issueId));
      expect(attachments).toHaveLength(1);
      expect(attachments[0]?.uploadedByUserId).toBeNull();
      expect(attachments[0]?.storageKey).toBe(media[0]?.key);

      // A key outside the token tenant's prefix is refused.
      await expect(
        publicCaller.issues.issues.createFromShareToken({
          token,
          tenantId,
          title: 'Sneaky',
          media: [
            {
              key: `${newId()}/issues/${newId()}/other.jpg`,
              filename: 'other.jpg',
              mimeType: 'image/jpeg',
              sizeBytes: 1,
            },
          ],
        }),
      ).rejects.toThrow(/media-key-out-of-scope/);

      // Non-image mime is refused.
      await expect(
        publicCaller.issues.issues.createFromShareToken({
          token,
          tenantId,
          title: 'Sneaky 2',
          media: [
            {
              key: `${tenantId}/issues/${newId()}/x.svg`,
              filename: 'x.svg',
              mimeType: 'image/svg+xml',
              sizeBytes: 1,
            },
          ],
        }),
      ).rejects.toThrow(/media-type-not-allowed/);
    });
  });

  // ─── Comments ────────────────────────────────────────────────────────────
  describe('comments', () => {
    async function bootIssue(): Promise<string> {
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { categoryId } = await adminCaller.issues.categories.create({ name: 'Talk' });
      const { issueId } = await adminCaller.issues.issues.create({
        categoryId,
        title: 'Discuss me',
      });
      return issueId;
    }

    it('author can delete own; non-author w/o manage gets FORBIDDEN; manager can delete', async () => {
      const issueId = await bootIssue();
      // Standard user authors a comment.
      const standardCaller = createCaller(ctxFor(standardUserId));
      const { commentId } = await standardCaller.issues.comments.create({
        issueId,
        body: 'Heads up',
      });

      // Another standard user (no manage perm) cannot delete it.
      const otherStandardId = `usr_${newId()}`;
      const sets = (
        await db
          .select()
          .from(schema.permissionSets)
          .where(eq(schema.permissionSets.tenantId, tenantId))
      ).find((s) => s.name === 'Standard');
      if (sets === undefined) throw new Error('seed missing Standard set');
      await db.insert(schema.user).values({
        id: otherStandardId,
        name: 'Sandy',
        email: 'sandy@acme.test',
        tenantId,
        permissionSetId: sets.id,
      });
      const otherCaller = createCaller(ctxFor(otherStandardId));
      await expect(otherCaller.issues.comments.delete({ commentId })).rejects.toThrow(
        /FORBIDDEN|not-comment-author/,
      );

      // Manager (issues.manage holder) can delete it.
      const managerCaller = createCaller(ctxFor(managerUserId));
      const result = await managerCaller.issues.comments.delete({ commentId });
      expect(result.ok).toBe(true);

      // Re-create + author deletes own.
      const second = await standardCaller.issues.comments.create({ issueId, body: 'Again' });
      const ownDelete = await standardCaller.issues.comments.delete({
        commentId: second.commentId,
      });
      expect(ownDelete.ok).toBe(true);
    });

    it('only the author can update their comment', async () => {
      const issueId = await bootIssue();
      const standardCaller = createCaller(ctxFor(standardUserId));
      const { commentId } = await standardCaller.issues.comments.create({
        issueId,
        body: 'Original',
      });
      const adminCaller = createCaller(ctxFor(adminUserId));
      await expect(
        adminCaller.issues.comments.update({ commentId, body: 'Hacked' }),
      ).rejects.toThrow(/FORBIDDEN|not-comment-author/);
      const result = await standardCaller.issues.comments.update({
        commentId,
        body: 'Updated',
      });
      expect(result.ok).toBe(true);
    });
  });

  // ─── PR-3 additions: activity / attachments / priority / assignee / due ──
  describe('PR-3 activity + attachments', () => {
    async function bootIssue(): Promise<string> {
      const adminCaller = createCaller(ctxFor(adminUserId));
      const { categoryId } = await adminCaller.issues.categories.create({
        name: 'PR3',
      });
      const { issueId } = await adminCaller.issues.issues.create({
        categoryId,
        title: 'PR-3 sample',
      });
      return issueId;
    }

    it('create writes a `created` activity event', async () => {
      const issueId = await bootIssue();
      const adminCaller = createCaller(ctxFor(adminUserId));
      const events = await adminCaller.issues.activity.list({ issueId });
      const created = events.find((e) => e.kind === 'created');
      expect(created).toBeDefined();
      expect(created?.actorUserId).toBe(adminUserId);
    });

    it('update with priority writes a priority_changed activity event', async () => {
      const issueId = await bootIssue();
      const adminCaller = createCaller(ctxFor(adminUserId));
      await adminCaller.issues.issues.update({ issueId, priority: 'high' });
      const events = await adminCaller.issues.activity.list({ issueId });
      const prio = events.find((e) => e.kind === 'priority_changed');
      expect(prio).toBeDefined();
      expect((prio?.payload as Record<string, unknown>).to).toBe('high');
    });

    it('update with assignee writes an assignee_changed activity event', async () => {
      const issueId = await bootIssue();
      const adminCaller = createCaller(ctxFor(adminUserId));
      await adminCaller.issues.issues.update({
        issueId,
        assigneeUserId: managerUserId,
      });
      const events = await adminCaller.issues.activity.list({ issueId });
      const assignee = events.find((e) => e.kind === 'assignee_changed');
      expect(assignee).toBeDefined();
      expect((assignee?.payload as Record<string, unknown>).to).toBe(managerUserId);
    });

    it('update with dueAt writes a due_date_changed activity event', async () => {
      const issueId = await bootIssue();
      const adminCaller = createCaller(ctxFor(adminUserId));
      const due = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
      await adminCaller.issues.issues.update({ issueId, dueAt: due });
      const events = await adminCaller.issues.activity.list({ issueId });
      const dueEvent = events.find((e) => e.kind === 'due_date_changed');
      expect(dueEvent).toBeDefined();
      expect((dueEvent?.payload as Record<string, unknown>).to).toBe(due);
    });

    it('close writes a status_changed activity event', async () => {
      const issueId = await bootIssue();
      const adminCaller = createCaller(ctxFor(adminUserId));
      await adminCaller.issues.issues.close({ issueId, reason: 'Done' });
      const events = await adminCaller.issues.activity.list({ issueId });
      const statusEvent = events.find((e) => e.kind === 'status_changed');
      expect(statusEvent).toBeDefined();
      expect((statusEvent?.payload as Record<string, unknown>).from).toBe('open');
      expect((statusEvent?.payload as Record<string, unknown>).to).toBe('closed');
    });

    it('comments.create writes a `commented` activity event', async () => {
      const issueId = await bootIssue();
      const adminCaller = createCaller(ctxFor(adminUserId));
      await adminCaller.issues.comments.create({ issueId, body: 'Hello' });
      const events = await adminCaller.issues.activity.list({ issueId });
      const commented = events.find((e) => e.kind === 'commented');
      expect(commented).toBeDefined();
      expect((commented?.payload as Record<string, unknown>).body).toBe('Hello');
    });

    it('attachments.create writes an attachment_added activity event', async () => {
      const issueId = await bootIssue();
      const adminCaller = createCaller(ctxFor(adminUserId));
      await adminCaller.issues.attachments.create({
        issueId,
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 12345,
        storageKey: `${tenantId}/issues/${issueId}/photo.jpg`,
      });
      const events = await adminCaller.issues.activity.list({ issueId });
      const added = events.find((e) => e.kind === 'attachment_added');
      expect(added).toBeDefined();
      expect((added?.payload as Record<string, unknown>).filename).toBe('photo.jpg');
    });

    it('activity.list returns events in DESC order', async () => {
      const issueId = await bootIssue();
      const adminCaller = createCaller(ctxFor(adminUserId));
      // Add at least two follow-up events with small delays so the
      // timestamps differ deterministically.
      await new Promise((r) => setTimeout(r, 5));
      await adminCaller.issues.issues.update({ issueId, priority: 'low' });
      await new Promise((r) => setTimeout(r, 5));
      await adminCaller.issues.comments.create({ issueId, body: 'A comment' });
      const events = await adminCaller.issues.activity.list({ issueId });
      // We expect a strictly non-increasing createdAt sequence.
      const times = events.map((e) => new Date(e.createdAt).getTime());
      for (let i = 1; i < times.length; i++) {
        const prev = times[i - 1] ?? 0;
        const cur = times[i] ?? 0;
        expect(prev).toBeGreaterThanOrEqual(cur);
      }
      // The most recent event should be the commented one.
      expect(events[0]?.kind).toBe('commented');
    });
  });
});

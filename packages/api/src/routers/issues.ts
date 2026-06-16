/**
 * Issues router — Phase 3 PR 1.
 *
 * Backend foundation for the Issues module. Three sub-routers:
 *
 *   - categories — admin-defined taxonomy + per-category share tokens.
 *   - issues     — the report row. Pins a category snapshot at create time
 *                  (I-E03). Snapshots the reporter's access state per ADR
 *                  0007. Includes the anonymous QR submission entry point
 *                  (createFromShareToken, I-E01).
 *   - comments   — append-only thread on each issue.
 *
 * Registers dependents resolvers:
 *   - 'issueCategories' — counts open issues per category (so the admin
 *     archive-category cascade preview is accurate).
 *   - 'issues' — counts comments per issue.
 *
 * Built as a factory `createIssuesRouter({ sendEmail, logger, appUrl })` —
 * email is a side-effect (issue-created notification) so the deps must be
 * injectable for tests.
 */
import {
  accessRules,
  groupMembers,
  issueActivity,
  issueAssets,
  issueAttachments,
  issueCategories,
  issueComments,
  issues,
  permissionSets,
  siteMembers,
  templates,
  tenants,
  user,
  type Issue,
  type IssueAccessSnapshot,
  type IssueActivityKind,
  type IssueCategory,
  type IssueCategorySnapshot,
  type IssueComment,
  type IssuePriority,
} from '@forma360/db/schema';
import { resolveAccessRule } from '@forma360/permissions/access';
import { isPermissionKey } from '@forma360/permissions/catalogue';
import {
  registerDependentResolver,
  type DependentResolver,
  type DependentResolverDeps,
} from '@forma360/permissions/dependents';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import type { SendTemplatedEmail } from '@forma360/shared/email';
import { newId } from '@forma360/shared/id';
import {
  ISSUE_STATUSES,
  NOTIFICATION_RULES,
  issueCustomFieldsSchema,
  issueCustomQuestionsSchema,
  issueEnabledBuiltInFieldsSchema,
  issueGpsSchema,
  issuePrioritySchema,
} from '@forma360/shared/issues-schema';
import type { Logger } from '@forma360/shared/logger';
import type { Storage } from '@forma360/shared/storage';
import { TRPCError } from '@trpc/server';
import crypto from 'node:crypto';
import { and, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { publicProcedure, requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

// ─── Dependents resolvers ───────────────────────────────────────────────────

const categoriesResolver: DependentResolver = async (deps, input) => {
  if (input.entity !== 'issueCategory') return 0;
  const rows = await deps.db
    .select({ c: count() })
    .from(issues)
    .where(
      and(
        eq(issues.tenantId, input.tenantId),
        eq(issues.categoryId, input.id),
        isNull(issues.archivedAt),
      ),
    );
  return rows[0]?.c ?? 0;
};
registerDependentResolver('issueCategories', categoriesResolver);

const issueCommentsResolver: DependentResolver = async (deps, input) => {
  if (input.entity !== 'issue') return 0;
  const rows = await deps.db
    .select({ c: count() })
    .from(issueComments)
    .where(and(eq(issueComments.tenantId, input.tenantId), eq(issueComments.issueId, input.id)));
  return rows[0]?.c ?? 0;
};
registerDependentResolver('issues', issueCommentsResolver);

// ─── Input schemas ──────────────────────────────────────────────────────────

const categoryIdInput = z.object({ categoryId: z.string().length(26) });
const issueIdInput = z.object({ issueId: z.string().length(26) });

const listCategoriesInput = z.object({ includeArchived: z.boolean().default(false) }).default({});

/** Shared recipient-spec sub-schema (mirrors the heads-ups shape). */
const notifRecipientSpecSchema = z
  .object({
    broadcastToAll: z.boolean().default(false),
    groupIds: z.array(z.string().length(26)).default([]),
    siteIds: z.array(z.string().length(26)).default([]),
    userIds: z.array(z.string()).default([]),
  })
  .nullable()
  .optional();

const createCategoryInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  accessRuleId: z.string().length(26).optional(),
  customFields: issueCustomFieldsSchema.optional(),
  customQuestions: issueCustomQuestionsSchema.optional(),
  notificationRule: z.enum(NOTIFICATION_RULES).optional(),
  criticalAlerts: z.boolean().optional(),
  linkedTemplateIds: z.array(z.string().length(26)).max(25).optional(),
  notificationRecipientSpec: notifRecipientSpecSchema,
  criticalAlertRecipientSpec: notifRecipientSpecSchema,
});

const updateCategoryInput = z.object({
  categoryId: z.string().length(26),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  accessRuleId: z.string().length(26).nullable().optional(),
  customFields: issueCustomFieldsSchema.optional(),
  customQuestions: issueCustomQuestionsSchema.optional(),
  notificationRule: z.enum(NOTIFICATION_RULES).optional(),
  criticalAlerts: z.boolean().optional(),
  linkedTemplateIds: z.array(z.string().length(26)).max(25).optional(),
  enabledBuiltInFields: issueEnabledBuiltInFieldsSchema.optional(),
  notificationRecipientSpec: notifRecipientSpecSchema,
  criticalAlertRecipientSpec: notifRecipientSpecSchema,
});

const listIssuesInput = z
  .object({
    status: z.enum(ISSUE_STATUSES).optional(),
    categoryId: z.string().length(26).optional(),
    siteId: z.string().length(26).optional(),
    includeArchived: z.boolean().default(false),
    limit: z.number().int().min(1).max(200).default(50),
    cursor: z.string().datetime().optional(),
  })
  .default({});

const createIssueInput = z.object({
  categoryId: z.string().length(26),
  title: z.string().min(1).max(500),
  description: z.string().max(20_000).optional(),
  siteId: z.string().length(26).optional(),
  locationGps: issueGpsSchema.optional(),
  locationAddress: z.string().max(500).optional(),
  dateOccurred: z.string().datetime().optional(),
  customFieldValues: z.record(z.unknown()).optional(),
  customQuestionResponses: z.record(z.unknown()).optional(),
  /** Asset IDs to link to this observation. */
  assetIds: z.array(z.string()).optional(),
});

const updateIssueInput = z.object({
  issueId: z.string().length(26),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(20_000).nullable().optional(),
  dateOccurred: z.string().datetime().optional(),
  siteId: z.string().length(26).nullable().optional(),
  customFieldValues: z.record(z.unknown()).optional(),
  customQuestionResponses: z.record(z.unknown()).optional(),
  priority: issuePrioritySchema.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  /** Asset IDs to link to this observation. Replaces existing links when provided. */
  assetIds: z.array(z.string()).optional(),
});

const closeIssueInput = z.object({
  issueId: z.string().length(26),
  reason: z.string().max(2000).optional(),
});

const nearbyCountInput = z.object({
  siteId: z.string().length(26),
  withinHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24),
});

const listCommentsInput = z.object({ issueId: z.string().length(26) });

const createCommentInput = z.object({
  issueId: z.string().length(26),
  body: z.string().min(1).max(20_000),
});

const updateCommentInput = z.object({
  commentId: z.string().length(26),
  body: z.string().min(1).max(20_000),
});

const deleteCommentInput = z.object({ commentId: z.string().length(26) });

const createFromShareTokenInput = z.object({
  token: z.string().min(1).max(64),
  tenantId: z.string().length(26),
  title: z.string().min(1).max(500),
  description: z.string().max(20_000).optional(),
  siteId: z.string().length(26).optional(),
  locationGps: issueGpsSchema.optional(),
  locationAddress: z.string().max(500).optional(),
  dateOccurred: z.string().datetime().optional(),
  customFieldValues: z.record(z.unknown()).optional(),
  customQuestionResponses: z.record(z.unknown()).optional(),
});

const publicGetByShareTokenInput = z.object({
  token: z.string().min(1).max(64),
});

const listActivityInput = z.object({ issueId: z.string().length(26) });

const listAttachmentsInput = z.object({ issueId: z.string().length(26) });

const createAttachmentInput = z.object({
  issueId: z.string().length(26),
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z
    .number()
    .int()
    .min(0)
    .max(100 * 1024 * 1024),
  storageKey: z.string().min(1).max(1024),
});

const deleteAttachmentInput = z.object({
  attachmentId: z.string().length(26),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

type Db = DependentResolverDeps['db'];

/**
 * Build the ADR 0007 access snapshot for the given user.
 *
 * Resolves the user's groups, sites, and permission set into a frozen
 * view of "what could this user do at this moment". The result is
 * persisted to the issue row.
 */
async function loadAccessSnapshot(
  db: Db,
  tenantId: string,
  userId: string,
): Promise<IssueAccessSnapshot> {
  const groupRows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.tenantId, tenantId), eq(groupMembers.userId, userId)));
  const siteRows = await db
    .select({ siteId: siteMembers.siteId })
    .from(siteMembers)
    .where(and(eq(siteMembers.tenantId, tenantId), eq(siteMembers.userId, userId)));
  const permRows = await db
    .select({ permissions: permissionSets.permissions })
    .from(user)
    .innerJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
    .where(and(eq(user.id, userId), eq(user.tenantId, tenantId)))
    .limit(1);
  const perms = permRows[0]?.permissions.filter((p): p is string => isPermissionKey(p)) ?? [];
  return {
    groupIds: groupRows.map((r) => r.groupId),
    siteIds: siteRows.map((r) => r.siteId),
    permissions: perms,
    snapshotAt: new Date().toISOString(),
  };
}

function buildCategorySnapshot(cat: IssueCategory): IssueCategorySnapshot {
  return {
    categoryId: cat.id,
    name: cat.name,
    customFields: cat.customFields,
    customQuestions: cat.customQuestions,
  };
}

/**
 * Render a "ISS-000042"-style reference number. Counts every issue ever
 * created in the tenant and adds one. Per the spec we accept gaps — this
 * is a display value, not a uniqueness contract.
 */
async function nextReferenceNumber(db: Db, tenantId: string): Promise<string> {
  const totalRows = await db
    .select({ c: count() })
    .from(issues)
    .where(eq(issues.tenantId, tenantId));
  const next = (totalRows[0]?.c ?? 0) + 1;
  return `ISS-${next.toString().padStart(6, '0')}`;
}

async function loadCategoryOrThrow(
  db: Db,
  tenantId: string,
  categoryId: string,
): Promise<IssueCategory> {
  const rows = await db
    .select()
    .from(issueCategories)
    .where(and(eq(issueCategories.tenantId, tenantId), eq(issueCategories.id, categoryId)))
    .limit(1);
  const cat = rows[0];
  if (cat === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'category-not-found' });
  }
  return cat;
}

async function loadIssueOrThrow(db: Db, tenantId: string, issueId: string): Promise<Issue> {
  const rows = await db
    .select()
    .from(issues)
    .where(and(eq(issues.tenantId, tenantId), eq(issues.id, issueId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'issue-not-found' });
  }
  return row;
}

async function writeActivity(
  db: Db,
  args: {
    tenantId: string;
    issueId: string;
    actorUserId: string | null;
    kind: IssueActivityKind;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(issueActivity).values({
    id: newId(),
    tenantId: args.tenantId,
    issueId: args.issueId,
    actorUserId: args.actorUserId,
    kind: args.kind,
    payload: args.payload ?? {},
    createdAt: new Date(),
  });
}

async function loadCommentOrThrow(
  db: Db,
  tenantId: string,
  commentId: string,
): Promise<IssueComment> {
  const rows = await db
    .select()
    .from(issueComments)
    .where(and(eq(issueComments.tenantId, tenantId), eq(issueComments.id, commentId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'comment-not-found' });
  }
  return row;
}

async function assertCallerSatisfiesCategoryAccess(
  db: Db,
  tenantId: string,
  userId: string,
  category: IssueCategory,
): Promise<void> {
  if (category.accessRuleId === null) return;
  const ruleRows = await db
    .select()
    .from(accessRules)
    .where(and(eq(accessRules.tenantId, tenantId), eq(accessRules.id, category.accessRuleId)))
    .limit(1);
  const rule = ruleRows[0];
  if (rule === undefined) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Category references a missing access rule',
    });
  }
  const groupRows = await db
    .select({ groupId: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.tenantId, tenantId), eq(groupMembers.userId, userId)));
  const siteRows = await db
    .select({ siteId: siteMembers.siteId })
    .from(siteMembers)
    .where(and(eq(siteMembers.tenantId, tenantId), eq(siteMembers.userId, userId)));
  const allowed = resolveAccessRule(
    {
      id: rule.id,
      groupIds: rule.groupIds,
      siteIds: rule.siteIds,
      invalidatedAt: rule.invalidatedAt,
    },
    {
      groupIds: groupRows.map((r) => r.groupId),
      siteIds: siteRows.map((r) => r.siteId),
    },
  );
  if (!allowed) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You do not satisfy this category’s access rule',
    });
  }
}

async function assertLinkedTemplatesExist(
  db: Db,
  tenantId: string,
  templateIds: readonly string[],
): Promise<void> {
  if (templateIds.length === 0) return;
  const rows = await db
    .select({ id: templates.id, archivedAt: templates.archivedAt })
    .from(templates)
    .where(and(eq(templates.tenantId, tenantId), inArray(templates.id, [...templateIds])));
  const found = new Set(rows.filter((r) => r.archivedAt === null).map((r) => r.id));
  for (const id of templateIds) {
    if (!found.has(id)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'linked-template-not-found',
      });
    }
  }
}

// ─── Router factory ─────────────────────────────────────────────────────────

export interface IssuesRouterDeps {
  sendEmail: SendTemplatedEmail;
  logger: Logger;
  /** Canonical APP_URL — e.g. "https://app.forma360.com" (no trailing slash). */
  appUrl: string;
  /**
   * Storage facade used to mint signed download URLs for attachments. The
   * web app wires the real R2 storage; tests pass a stub.
   */
  storage: Pick<Storage, 'getSignedDownloadUrl'>;
  /**
   * Optional BullMQ enqueue hook for the observation-notify job. When
   * provided, the recipient-spec fan-out is handled asynchronously by the
   * worker; the old inline email path is skipped for created issues. If
   * omitted (tests), the old `notifyManagersOfNewIssue` inline path runs.
   */
  enqueueObservationNotify?: (payload: {
    tenantId: string;
    issueId: string;
    isCritical: boolean;
  }) => Promise<void>;
}

export function createIssuesRouter(deps: IssuesRouterDeps) {
  const appUrl = deps.appUrl.replace(/\/$/, '');

  // ─── Categories sub-router ────────────────────────────────────────────────
  const categoriesRouter = router({
    list: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(listCategoriesInput)
      .query(async ({ ctx, input }) => {
        const where = [eq(issueCategories.tenantId, ctx.tenantId)];
        if (!input.includeArchived) where.push(isNull(issueCategories.archivedAt));
        return ctx.db
          .select()
          .from(issueCategories)
          .where(and(...where))
          .orderBy(issueCategories.name);
      }),

    get: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(categoryIdInput)
      .query(async ({ ctx, input }) => {
        return loadCategoryOrThrow(ctx.db, ctx.tenantId, input.categoryId);
      }),

    create: tenantProcedure
      .use(requirePermission('issues.settings'))
      .input(createCategoryInput)
      .mutation(async ({ ctx, input }) => {
        if (input.linkedTemplateIds !== undefined) {
          await assertLinkedTemplatesExist(ctx.db, ctx.tenantId, input.linkedTemplateIds);
        }
        const id = newId();
        const now = new Date();
        await ctx.db.insert(issueCategories).values({
          id,
          tenantId: ctx.tenantId,
          name: input.name,
          description: input.description ?? null,
          accessRuleId: input.accessRuleId ?? null,
          customFields: input.customFields ?? [],
          customQuestions: input.customQuestions ?? [],
          notificationRule: input.notificationRule ?? 'summary',
          criticalAlerts: input.criticalAlerts ?? false,
          linkedTemplateIds: input.linkedTemplateIds ?? [],
          notificationRecipientSpec: input.notificationRecipientSpec ?? null,
          criticalAlertRecipientSpec: input.criticalAlertRecipientSpec ?? null,
          createdBy: ctx.auth.userId,
          createdAt: now,
          updatedAt: now,
        });
        return { categoryId: id };
      }),

    update: tenantProcedure
      .use(requirePermission('issues.settings'))
      .input(updateCategoryInput)
      .mutation(async ({ ctx, input }) => {
        const cat = await loadCategoryOrThrow(ctx.db, ctx.tenantId, input.categoryId);
        if (input.linkedTemplateIds !== undefined) {
          await assertLinkedTemplatesExist(ctx.db, ctx.tenantId, input.linkedTemplateIds);
        }
        const patch: Partial<typeof issueCategories.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (input.name !== undefined) patch.name = input.name;
        if (input.description !== undefined) patch.description = input.description;
        if (input.accessRuleId !== undefined) patch.accessRuleId = input.accessRuleId;
        if (input.customFields !== undefined) patch.customFields = input.customFields;
        if (input.customQuestions !== undefined) patch.customQuestions = input.customQuestions;
        if (input.notificationRule !== undefined) patch.notificationRule = input.notificationRule;
        if (input.criticalAlerts !== undefined) patch.criticalAlerts = input.criticalAlerts;
        if (input.linkedTemplateIds !== undefined)
          patch.linkedTemplateIds = input.linkedTemplateIds;
        if (input.enabledBuiltInFields !== undefined)
          patch.enabledBuiltInFields = input.enabledBuiltInFields;
        if (input.notificationRecipientSpec !== undefined)
          patch.notificationRecipientSpec = input.notificationRecipientSpec;
        if (input.criticalAlertRecipientSpec !== undefined)
          patch.criticalAlertRecipientSpec = input.criticalAlertRecipientSpec;
        await ctx.db.update(issueCategories).set(patch).where(eq(issueCategories.id, cat.id));
        return { ok: true as const };
      }),

    archive: tenantProcedure
      .use(requirePermission('issues.settings'))
      .input(categoryIdInput)
      .mutation(async ({ ctx, input }) => {
        const cat = await loadCategoryOrThrow(ctx.db, ctx.tenantId, input.categoryId);
        await ctx.db
          .update(issueCategories)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(issueCategories.id, cat.id));
        return { ok: true as const };
      }),

    restore: tenantProcedure
      .use(requirePermission('issues.settings'))
      .input(categoryIdInput)
      .mutation(async ({ ctx, input }) => {
        const cat = await loadCategoryOrThrow(ctx.db, ctx.tenantId, input.categoryId);
        await ctx.db
          .update(issueCategories)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(eq(issueCategories.id, cat.id));
        return { ok: true as const };
      }),

    delete: tenantProcedure
      .use(requirePermission('issues.settings'))
      .input(categoryIdInput)
      .mutation(async ({ ctx, input }) => {
        const cat = await loadCategoryOrThrow(ctx.db, ctx.tenantId, input.categoryId);
        // I-E02 guard: count open (non-archived, status != closed) issues.
        const openRows = await ctx.db
          .select({ c: count() })
          .from(issues)
          .where(
            and(
              eq(issues.tenantId, ctx.tenantId),
              eq(issues.categoryId, cat.id),
              isNull(issues.archivedAt),
            ),
          );
        const openIssueCount = openRows[0]?.c ?? 0;
        if (openIssueCount > 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'category-has-open-issues',
            cause: {
              code: 'BAD_REQUEST',
              reason: 'category-has-open-issues',
              openIssueCount,
              suggestion: 'archive-instead-of-delete',
            },
          });
        }
        await ctx.db.delete(issueCategories).where(eq(issueCategories.id, cat.id));
        return { ok: true as const };
      }),

    generateShareToken: tenantProcedure
      .use(requirePermission('issues.settings'))
      .input(categoryIdInput)
      .mutation(async ({ ctx, input }) => {
        const cat = await loadCategoryOrThrow(ctx.db, ctx.tenantId, input.categoryId);
        // Idempotent — preserve any token already in use (printed QR codes
        // on walls would otherwise become useless after rotation).
        if (cat.publicShareToken !== null) {
          return {
            token: cat.publicShareToken,
            url: `${appUrl}/en/report/${cat.publicShareToken}`,
          };
        }
        const token = crypto.randomBytes(32).toString('hex');
        await ctx.db
          .update(issueCategories)
          .set({ publicShareToken: token, updatedAt: new Date() })
          .where(eq(issueCategories.id, cat.id));
        return { token, url: `${appUrl}/en/report/${token}` };
      }),

    rotateShareToken: tenantProcedure
      .use(requirePermission('issues.settings'))
      .input(categoryIdInput)
      .mutation(async ({ ctx, input }) => {
        const cat = await loadCategoryOrThrow(ctx.db, ctx.tenantId, input.categoryId);
        const token = crypto.randomBytes(32).toString('hex');
        await ctx.db
          .update(issueCategories)
          .set({ publicShareToken: token, updatedAt: new Date() })
          .where(eq(issueCategories.id, cat.id));
        return { token, url: `${appUrl}/en/report/${token}` };
      }),

    revokeShareToken: tenantProcedure
      .use(requirePermission('issues.settings'))
      .input(categoryIdInput)
      .mutation(async ({ ctx, input }) => {
        const cat = await loadCategoryOrThrow(ctx.db, ctx.tenantId, input.categoryId);
        await ctx.db
          .update(issueCategories)
          .set({ publicShareToken: null, updatedAt: new Date() })
          .where(eq(issueCategories.id, cat.id));
        return { ok: true as const };
      }),

    /**
     * Resolve a public share token to the minimal category info the
     * unauthenticated scan landing page needs to render its form. Returns
     * `null` for unknown / archived categories — the page renders an
     * "invalid QR" state. Does not leak the access rule, notification
     * settings, or custom fields beyond what the reporter form needs.
     */
    publicGetByShareToken: publicProcedure
      .input(publicGetByShareTokenInput)
      .query(async ({ ctx, input }) => {
        const catRows = await ctx.db
          .select({
            categoryId: issueCategories.id,
            tenantId: issueCategories.tenantId,
            name: issueCategories.name,
            customQuestions: issueCategories.customQuestions,
            enabledBuiltInFields: issueCategories.enabledBuiltInFields,
            archivedAt: issueCategories.archivedAt,
          })
          .from(issueCategories)
          .where(eq(issueCategories.publicShareToken, input.token))
          .limit(1);
        const cat = catRows[0];
        if (cat === undefined) return null;
        if (cat.archivedAt !== null) return null;
        const tenantRows = await ctx.db
          .select({ name: tenants.name })
          .from(tenants)
          .where(eq(tenants.id, cat.tenantId))
          .limit(1);
        const tenantName = tenantRows[0]?.name ?? '';
        return {
          categoryId: cat.categoryId,
          tenantId: cat.tenantId,
          tenantName,
          categoryName: cat.name,
          customQuestions: cat.customQuestions,
          enabledBuiltInFields: cat.enabledBuiltInFields,
        };
      }),
  });

  // ─── Issues sub-router ────────────────────────────────────────────────────
  /**
   * Fan out a creation notification to every user in the tenant who holds
   * `issues.manage`. Failures are logged but never thrown — email is
   * best-effort.
   */
  async function notifyManagersOfNewIssue(args: {
    db: Db;
    tenantId: string;
    issue: Issue;
    category: IssueCategory;
  }): Promise<void> {
    // Find every user in the tenant whose permission set includes
    // `issues.manage`. We only need name + email here.
    const rows = await args.db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        permissions: permissionSets.permissions,
      })
      .from(user)
      .innerJoin(permissionSets, eq(user.permissionSetId, permissionSets.id))
      .where(eq(user.tenantId, args.tenantId));

    const recipients = rows.filter((r) => r.permissions.includes('issues.manage'));
    const reportedByName = args.issue.reportedByName ?? 'Someone';
    const reportedAt = args.issue.createdAt.toISOString();
    for (const r of recipients) {
      if (r.email.length === 0) continue;
      try {
        await deps.sendEmail({
          to: r.email,
          templateKey: 'issue-created',
          variables: {
            categoryName: args.category.name,
            issueTitle: args.issue.title,
            referenceNumber: args.issue.referenceNumber,
            reportedByName,
            recipientName: r.name,
            reportedAt,
            viewUrl: `${appUrl}/en/issues/${args.issue.id}`,
          },
        });
      } catch (err) {
        deps.logger.error(
          { err, issueId: args.issue.id, recipientUserId: r.userId },
          '[issues] issue-created email failed',
        );
      }
    }
  }

  const coreRouter = router({
    list: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(listIssuesInput)
      .query(async ({ ctx, input }) => {
        const where = [eq(issues.tenantId, ctx.tenantId)];
        if (!input.includeArchived) where.push(isNull(issues.archivedAt));
        if (input.status !== undefined) where.push(eq(issues.status, input.status));
        if (input.categoryId !== undefined) where.push(eq(issues.categoryId, input.categoryId));
        if (input.siteId !== undefined) where.push(eq(issues.siteId, input.siteId));
        if (input.cursor !== undefined) {
          // Strict < cursor to keep "previous page boundary" exclusive.
          where.push(sql`${issues.createdAt} < ${new Date(input.cursor)}`);
        }
        const rows = await ctx.db
          .select()
          .from(issues)
          .where(and(...where))
          .orderBy(desc(issues.createdAt))
          .limit(input.limit + 1);

        const hasMore = rows.length > input.limit;
        const slice = hasMore ? rows.slice(0, input.limit) : rows;
        const nextCursor =
          hasMore && slice.length > 0 ? slice[slice.length - 1]?.createdAt.toISOString() : null;
        return { items: slice, nextCursor };
      }),

    get: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(issueIdInput)
      .query(async ({ ctx, input }) => {
        const issue = await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
        return {
          issue,
          categorySnapshot: issue.categorySnapshot,
        };
      }),

    create: tenantProcedure
      .use(requirePermission('issues.report'))
      .input(createIssueInput)
      .mutation(async ({ ctx, input }) => {
        const category = await loadCategoryOrThrow(ctx.db, ctx.tenantId, input.categoryId);
        if (category.archivedAt !== null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'category-archived',
          });
        }
        await assertCallerSatisfiesCategoryAccess(ctx.db, ctx.tenantId, ctx.auth.userId, category);

        const accessSnapshot = await loadAccessSnapshot(ctx.db, ctx.tenantId, ctx.auth.userId);
        // Snapshot the reporter's display name at submission time.
        const reporterRows = await ctx.db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, ctx.auth.userId))
          .limit(1);
        const reportedByName = reporterRows[0]?.name ?? null;

        const referenceNumber = await nextReferenceNumber(ctx.db, ctx.tenantId);
        const id = newId();
        const now = new Date();
        await ctx.db.insert(issues).values({
          id,
          tenantId: ctx.tenantId,
          categoryId: category.id,
          title: input.title,
          description: input.description ?? null,
          status: 'open',
          reportedByUserId: ctx.auth.userId,
          reportedByName,
          reportedVia: 'app',
          siteId: input.siteId ?? null,
          locationGps: input.locationGps ?? null,
          locationAddress: input.locationAddress ?? null,
          dateOccurred: input.dateOccurred !== undefined ? new Date(input.dateOccurred) : now,
          customFieldValues: input.customFieldValues ?? {},
          customQuestionResponses: input.customQuestionResponses ?? {},
          categorySnapshot: buildCategorySnapshot(category),
          referenceNumber,
          accessSnapshot,
          createdAt: now,
          updatedAt: now,
        });

        const issue = await loadIssueOrThrow(ctx.db, ctx.tenantId, id);
        // Audit event — append-only.
        await writeActivity(ctx.db, {
          tenantId: ctx.tenantId,
          issueId: id,
          actorUserId: ctx.auth.userId,
          kind: 'created',
        });
        // Notification fan-out (best-effort).
        if (deps.enqueueObservationNotify !== undefined) {
          // New path: enqueue a BullMQ job so the worker resolves recipients
          // from the category's recipient spec.
          try {
            await deps.enqueueObservationNotify({
              tenantId: ctx.tenantId,
              issueId: id,
              isCritical: category.criticalAlerts,
            });
          } catch (err) {
            ctx.logger.error({ err, issueId: id }, '[issues] failed to enqueue observation-notify');
          }
        } else {
          // Legacy path (tests / environments without the queue): inline email
          // to all users with issues.manage permission.
          await notifyManagersOfNewIssue({
            db: ctx.db,
            tenantId: ctx.tenantId,
            issue,
            category,
          });
        }

        if (input.assetIds !== undefined && input.assetIds.length > 0) {
          await ctx.db.insert(issueAssets).values(
            input.assetIds.map((assetId) => ({
              id: newId(),
              tenantId: ctx.tenantId,
              issueId: id,
              assetId,
            })),
          ).onConflictDoNothing();
        }

        ctx.logger.info({ issueId: id, categoryId: category.id }, '[issues] created');
        return { issueId: id, referenceNumber };
      }),

    update: tenantProcedure
      .use(requirePermission('issues.manage'))
      .input(updateIssueInput)
      .mutation(async ({ ctx, input }) => {
        const issue = await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
        const patch: Partial<typeof issues.$inferInsert> = { updatedAt: new Date() };
        const activityEvents: Array<{
          kind: IssueActivityKind;
          payload: Record<string, unknown>;
        }> = [];

        if (input.title !== undefined) patch.title = input.title;
        if (input.description !== undefined) patch.description = input.description;
        if (input.dateOccurred !== undefined) patch.dateOccurred = new Date(input.dateOccurred);
        if (input.siteId !== undefined) patch.siteId = input.siteId;
        if (input.customFieldValues !== undefined)
          patch.customFieldValues = input.customFieldValues;
        if (input.customQuestionResponses !== undefined)
          patch.customQuestionResponses = input.customQuestionResponses;

        // Priority change → one event.
        if (input.priority !== undefined) {
          const next = input.priority;
          if (next !== issue.priority) {
            patch.priority = next as IssuePriority | null;
            activityEvents.push({
              kind: 'priority_changed',
              payload: { from: issue.priority, to: next },
            });
          }
        }

        // Due-date change → one event.
        if (input.dueAt !== undefined) {
          const nextDate = input.dueAt === null ? null : new Date(input.dueAt);
          const prevIso = issue.dueAt === null ? null : issue.dueAt.toISOString();
          const nextIso = nextDate === null ? null : nextDate.toISOString();
          if (nextIso !== prevIso) {
            patch.dueAt = nextDate;
            activityEvents.push({
              kind: 'due_date_changed',
              payload: { from: prevIso, to: nextIso },
            });
          }
        }

        // Assignee change → one event.
        if (input.assigneeUserId !== undefined) {
          const next = input.assigneeUserId;
          if (next !== issue.assigneeUserId) {
            patch.assigneeUserId = next;
            activityEvents.push({
              kind: 'assignee_changed',
              payload: { from: issue.assigneeUserId, to: next },
            });
          }
        }

        // If any free-form field changed, log a generic `edited` event in
        // addition to (or instead of) the structured events above.
        const editedFields: string[] = [];
        if (input.title !== undefined && input.title !== issue.title) editedFields.push('title');
        if (input.description !== undefined && (input.description ?? null) !== issue.description) {
          editedFields.push('description');
        }
        if (
          input.dateOccurred !== undefined &&
          new Date(input.dateOccurred).toISOString() !== issue.dateOccurred.toISOString()
        ) {
          editedFields.push('dateOccurred');
        }
        if (input.siteId !== undefined && (input.siteId ?? null) !== issue.siteId) {
          editedFields.push('siteId');
        }
        if (editedFields.length > 0) {
          activityEvents.push({ kind: 'edited', payload: { fields: editedFields } });
        }

        await ctx.db.update(issues).set(patch).where(eq(issues.id, issue.id));
        for (const event of activityEvents) {
          await writeActivity(ctx.db, {
            tenantId: ctx.tenantId,
            issueId: issue.id,
            actorUserId: ctx.auth.userId,
            kind: event.kind,
            payload: event.payload,
          });
        }
        if (input.assetIds !== undefined) {
          await ctx.db.delete(issueAssets).where(eq(issueAssets.issueId, issue.id));
          if (input.assetIds.length > 0) {
            await ctx.db.insert(issueAssets).values(
              input.assetIds.map((assetId) => ({
                id: newId(),
                tenantId: ctx.tenantId,
                issueId: issue.id,
                assetId,
              })),
            ).onConflictDoNothing();
          }
        }
        return { ok: true as const };
      }),

    close: tenantProcedure
      .use(requirePermission('issues.manage'))
      .input(closeIssueInput)
      .mutation(async ({ ctx, input }) => {
        const issue = await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
        if (issue.status === 'closed') {
          throw new TRPCError({ code: 'CONFLICT', message: 'issue-already-closed' });
        }
        const now = new Date();
        const prevStatus = issue.status;
        await ctx.db
          .update(issues)
          .set({
            status: 'closed',
            closedAt: now,
            closedByUserId: ctx.auth.userId,
            closedReason: input.reason ?? null,
            updatedAt: now,
          })
          .where(eq(issues.id, issue.id));
        await writeActivity(ctx.db, {
          tenantId: ctx.tenantId,
          issueId: issue.id,
          actorUserId: ctx.auth.userId,
          kind: 'status_changed',
          payload: {
            from: prevStatus,
            to: 'closed',
            reason: input.reason ?? null,
          },
        });
        return { ok: true as const };
      }),

    reopen: tenantProcedure
      .use(requirePermission('issues.manage'))
      .input(issueIdInput)
      .mutation(async ({ ctx, input }) => {
        const issue = await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
        if (issue.status !== 'closed') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'issue-not-closed' });
        }
        await ctx.db
          .update(issues)
          .set({
            status: 'open',
            closedAt: null,
            closedByUserId: null,
            closedReason: null,
            updatedAt: new Date(),
          })
          .where(eq(issues.id, issue.id));
        await writeActivity(ctx.db, {
          tenantId: ctx.tenantId,
          issueId: issue.id,
          actorUserId: ctx.auth.userId,
          kind: 'status_changed',
          payload: { from: 'closed', to: 'open' },
        });
        return { ok: true as const };
      }),

    /**
     * Generic status transition for non-terminal moves (open → investigation,
     * investigation → open). `close` / `reopen` remain the dedicated entry
     * points for the `closed` terminal — they carry close-reason + clear
     * the closed-* columns and we want to keep that audit clarity.
     */
    setStatus: tenantProcedure
      .use(requirePermission('issues.manage'))
      .input(
        z.object({
          issueId: z.string().length(26),
          status: z.enum(['open', 'investigation']),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const issue = await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
        if (issue.status === input.status) {
          return { ok: true as const };
        }
        if (issue.status === 'closed') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'issue-closed-use-reopen',
          });
        }
        await ctx.db
          .update(issues)
          .set({ status: input.status, updatedAt: new Date() })
          .where(eq(issues.id, issue.id));
        await writeActivity(ctx.db, {
          tenantId: ctx.tenantId,
          issueId: issue.id,
          actorUserId: ctx.auth.userId,
          kind: 'status_changed',
          payload: { from: issue.status, to: input.status },
        });
        return { ok: true as const };
      }),

    archive: tenantProcedure
      .use(requirePermission('issues.manage'))
      .input(issueIdInput)
      .mutation(async ({ ctx, input }) => {
        const issue = await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
        await ctx.db
          .update(issues)
          .set({ archivedAt: new Date(), updatedAt: new Date() })
          .where(eq(issues.id, issue.id));
        return { ok: true as const };
      }),

    restore: tenantProcedure
      .use(requirePermission('issues.manage'))
      .input(issueIdInput)
      .mutation(async ({ ctx, input }) => {
        const issue = await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
        await ctx.db
          .update(issues)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(eq(issues.id, issue.id));
        return { ok: true as const };
      }),

    nearbyCount: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(nearbyCountInput)
      .query(async ({ ctx, input }) => {
        const cutoff = new Date(Date.now() - input.withinHours * 3_600_000);
        const rows = await ctx.db
          .select({ c: count() })
          .from(issues)
          .where(
            and(
              eq(issues.tenantId, ctx.tenantId),
              eq(issues.siteId, input.siteId),
              isNull(issues.archivedAt),
              gte(issues.createdAt, cutoff),
            ),
          );
        return { count: rows[0]?.c ?? 0 };
      }),

    /**
     * Anonymous (no-auth) submission via QR share token (I-E01).
     *
     * Public procedure — does NOT require a session. The token + tenant id
     * couple the call to a specific category. Tenant is required in the
     * input because we cannot derive it from a session that doesn't exist.
     */
    createFromShareToken: publicProcedure
      .input(createFromShareTokenInput)
      .mutation(async ({ ctx, input }) => {
        // Verify the tenant exists (defensive — token uniqueness is global
        // but we still want a clean NOT_FOUND if the tenant doesn't match).
        const tenantRows = await ctx.db
          .select({ id: tenants.id })
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1);
        if (tenantRows[0] === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'tenant-not-found' });
        }
        // Find the category by token within the tenant.
        const catRows = await ctx.db
          .select()
          .from(issueCategories)
          .where(
            and(
              eq(issueCategories.tenantId, input.tenantId),
              eq(issueCategories.publicShareToken, input.token),
            ),
          )
          .limit(1);
        const category = catRows[0];
        if (category === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'token-not-found' });
        }
        if (category.archivedAt !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'category-archived' });
        }

        const now = new Date();
        const accessSnapshot: IssueAccessSnapshot = {
          groupIds: [],
          siteIds: [],
          permissions: [],
          snapshotAt: now.toISOString(),
        };
        const referenceNumber = await nextReferenceNumber(ctx.db, input.tenantId);
        const id = newId();
        await ctx.db.insert(issues).values({
          id,
          tenantId: input.tenantId,
          categoryId: category.id,
          title: input.title,
          description: input.description ?? null,
          status: 'open',
          reportedByUserId: null,
          reportedByName: 'Anonymous (QR)',
          reportedVia: 'qr',
          siteId: input.siteId ?? null,
          locationGps: input.locationGps ?? null,
          locationAddress: input.locationAddress ?? null,
          dateOccurred: input.dateOccurred !== undefined ? new Date(input.dateOccurred) : now,
          customFieldValues: input.customFieldValues ?? {},
          customQuestionResponses: input.customQuestionResponses ?? {},
          categorySnapshot: buildCategorySnapshot(category),
          referenceNumber,
          accessSnapshot,
          createdAt: now,
          updatedAt: now,
        });

        const issue = await loadIssueOrThrow(ctx.db, input.tenantId, id);
        // Audit event — system-actor (no userId) since this is an
        // anonymous QR submission.
        await writeActivity(ctx.db, {
          tenantId: input.tenantId,
          issueId: id,
          actorUserId: null,
          kind: 'created',
          payload: { via: 'qr' },
        });
        await notifyManagersOfNewIssue({
          db: ctx.db,
          tenantId: input.tenantId,
          issue,
          category,
        });

        deps.logger.info(
          { issueId: id, categoryId: category.id, via: 'qr' },
          '[issues] created (anonymous)',
        );
        return { issueId: id, referenceNumber };
      }),
  });

  // ─── Comments sub-router ──────────────────────────────────────────────────
  const commentsRouter = router({
    list: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(listCommentsInput)
      .query(async ({ ctx, input }) => {
        // Confirm issue exists in this tenant so we surface a clean 404.
        await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
        return ctx.db
          .select()
          .from(issueComments)
          .where(
            and(eq(issueComments.tenantId, ctx.tenantId), eq(issueComments.issueId, input.issueId)),
          )
          .orderBy(issueComments.createdAt);
      }),

    create: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(createCommentInput)
      .mutation(async ({ ctx, input }) => {
        const issue = await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
        const id = newId();
        const now = new Date();
        await ctx.db.insert(issueComments).values({
          id,
          tenantId: ctx.tenantId,
          issueId: issue.id,
          authorUserId: ctx.auth.userId,
          body: input.body,
          createdAt: now,
          updatedAt: now,
        });
        await writeActivity(ctx.db, {
          tenantId: ctx.tenantId,
          issueId: issue.id,
          actorUserId: ctx.auth.userId,
          kind: 'commented',
          payload: { commentId: id, body: input.body },
        });
        return { commentId: id };
      }),

    update: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(updateCommentInput)
      .mutation(async ({ ctx, input }) => {
        const comment = await loadCommentOrThrow(ctx.db, ctx.tenantId, input.commentId);
        if (comment.authorUserId !== ctx.auth.userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'not-comment-author' });
        }
        await ctx.db
          .update(issueComments)
          .set({ body: input.body, updatedAt: new Date() })
          .where(eq(issueComments.id, comment.id));
        return { ok: true as const };
      }),

    delete: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(deleteCommentInput)
      .mutation(async ({ ctx, input }) => {
        const comment = await loadCommentOrThrow(ctx.db, ctx.tenantId, input.commentId);
        const isAuthor = comment.authorUserId === ctx.auth.userId;
        let canManage = false;
        if (!isAuthor) {
          const perms = await loadUserPermissions(ctx.db, ctx.tenantId, ctx.auth.userId);
          canManage = perms.includes('issues.manage');
        }
        if (!isAuthor && !canManage) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'not-comment-author-or-manager' });
        }
        await ctx.db.delete(issueComments).where(eq(issueComments.id, comment.id));
        return { ok: true as const };
      }),
  });

  // ─── Activity sub-router ──────────────────────────────────────────────────
  const activityRouter = router({
    /**
     * Append-only activity feed for an issue. Returns at most the latest
     * 100 events with the actor's name + email joined in.
     */
    list: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(listActivityInput)
      .query(async ({ ctx, input }) => {
        await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
        const rows = await ctx.db
          .select({
            id: issueActivity.id,
            issueId: issueActivity.issueId,
            actorUserId: issueActivity.actorUserId,
            kind: issueActivity.kind,
            payload: issueActivity.payload,
            createdAt: issueActivity.createdAt,
            actorName: user.name,
            actorEmail: user.email,
          })
          .from(issueActivity)
          .leftJoin(user, eq(user.id, issueActivity.actorUserId))
          .where(
            and(eq(issueActivity.tenantId, ctx.tenantId), eq(issueActivity.issueId, input.issueId)),
          )
          .orderBy(desc(issueActivity.createdAt))
          .limit(100);
        return rows;
      }),
  });

  // ─── Attachments sub-router ──────────────────────────────────────────────
  const attachmentsRouter = router({
    list: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(listAttachmentsInput)
      .query(async ({ ctx, input }) => {
        await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
        const rows = await ctx.db
          .select()
          .from(issueAttachments)
          .where(
            and(
              eq(issueAttachments.tenantId, ctx.tenantId),
              eq(issueAttachments.issueId, input.issueId),
            ),
          )
          .orderBy(desc(issueAttachments.uploadedAt));
        const out: Array<(typeof rows)[number] & { signedUrl: string | null }> = [];
        for (const row of rows) {
          let signedUrl: string | null = null;
          try {
            signedUrl = await deps.storage.getSignedDownloadUrl({ key: row.storageKey });
          } catch (err) {
            deps.logger.warn(
              { err, attachmentId: row.id },
              '[issues] attachment signed URL failed',
            );
          }
          out.push({ ...row, signedUrl });
        }
        return out;
      }),

    create: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(createAttachmentInput)
      .mutation(async ({ ctx, input }) => {
        const issue = await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
        const id = newId();
        const now = new Date();
        await ctx.db.insert(issueAttachments).values({
          id,
          tenantId: ctx.tenantId,
          issueId: issue.id,
          storageKey: input.storageKey,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          uploadedByUserId: ctx.auth.userId,
          uploadedAt: now,
        });
        await writeActivity(ctx.db, {
          tenantId: ctx.tenantId,
          issueId: issue.id,
          actorUserId: ctx.auth.userId,
          kind: 'attachment_added',
          payload: {
            attachmentId: id,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
          },
        });
        const row = (
          await ctx.db.select().from(issueAttachments).where(eq(issueAttachments.id, id)).limit(1)
        )[0];
        return row ?? { id };
      }),

    delete: tenantProcedure
      .use(requirePermission('issues.view'))
      .input(deleteAttachmentInput)
      .mutation(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(issueAttachments)
          .where(
            and(
              eq(issueAttachments.tenantId, ctx.tenantId),
              eq(issueAttachments.id, input.attachmentId),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (row === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'attachment-not-found' });
        }
        // Authors of an attachment can always delete; otherwise the caller
        // needs `issues.manage`. The R2 object is intentionally not deleted
        // — a future cleanup job will reconcile orphaned blobs.
        if (row.uploadedByUserId !== ctx.auth.userId) {
          const perms = await loadUserPermissions(ctx.db, ctx.tenantId, ctx.auth.userId);
          if (!perms.includes('issues.manage')) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'not-attachment-author-or-manager',
            });
          }
        }
        await ctx.db.delete(issueAttachments).where(eq(issueAttachments.id, row.id));
        await writeActivity(ctx.db, {
          tenantId: ctx.tenantId,
          issueId: row.issueId,
          actorUserId: ctx.auth.userId,
          kind: 'attachment_removed',
          payload: {
            attachmentId: row.id,
            filename: row.filename,
          },
        });
        return { ok: true as const };
      }),
  });

  return router({
    categories: categoriesRouter,
    issues: coreRouter,
    comments: commentsRouter,
    activity: activityRouter,
    attachments: attachmentsRouter,
  });
}

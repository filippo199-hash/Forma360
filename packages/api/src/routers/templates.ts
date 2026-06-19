/**
 * Templates admin + conduct-side router.
 *
 * Covers Phase 2 § 2.1. Every mutation wrapped in requirePermission.
 *
 *   - list (view)         — tenant-scoped list filtered by access rule.
 *                           Conducting users see templates whose access
 *                           rule they satisfy (T-27, T-28).
 *   - get (view)          — one template + its current version.
 *   - getVersion (view)   — fetch a specific version by id (for in-progress
 *                           inspections to read their pinned version).
 *   - create (manage)     — new template + an initial empty draft version.
 *   - saveDraft (manage)  — write content to the latest draft (or create a
 *                           new draft if the latest version is published).
 *                           Optimistic concurrency via expectedUpdatedAt —
 *                           T-E18 conflict flow.
 *   - publish (manage)    — atomically stamp the draft as the new current
 *                           version. Previous current flipped to false.
 *                           NEVER UPDATEs the content of a published row.
 *   - duplicate (create)  — new row, copy of latest version as draft.
 *   - archive (manage)    — sets archivedAt; schedules paused
 *                           (Phase 2.2 reads this); in-progress inspections
 *                           allowed to complete (T-E05).
 *   - exportJson (view)   — current version's content as parsed JSON.
 *   - importJson (create) — new template from a JSON blob, validated.
 *
 * Registers a `templates` dependents resolver that counts in-progress +
 * completed inspections pointing at any version of the template. Phase 2
 * inspection tables land in PR 28; the resolver's implementation imports
 * those tables, so for PR 26 we register a shim that returns 0 and the
 * full implementation updates it in PR 28. The registry pattern supports
 * re-registration so this is clean.
 */
import {
  accessRules,
  groupMembers,
  inspections,
  siteMembers,
  templateSchedules,
  templates,
  templateVersions,
  user,
} from '@forma360/db/schema';
import { resolveAccessRule } from '@forma360/permissions/access';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import { buildTemplateContentFromSpec } from '@forma360/shared/template-builder';
import { templateSpecSchema } from '@forma360/shared/template-spec';
import {
  parseTemplateContent,
  templateContentSchema,
  TEMPLATE_SCHEMA_VERSION,
  validateSignatureWorkflow,
  type TemplateContent,
} from '@forma360/shared/template-schema';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

// ─── Dependents resolver (shim — PR 28 replaces with inspection counts) ────

const templatesResolver: DependentResolver = async (_deps, input) => {
  if (input.entity !== 'template') return 0;
  // PR 28 will count inspections referencing any version of this template.
  // Returning 0 here keeps the cascade preview UI functional in the interim.
  return 0;
};
registerDependentResolver('templates', templatesResolver);

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Single-row CSV serialiser (RFC 4180: quote every cell, double embedded
 * quotes, \r\n terminator). Used by `exportAllCsv`.
 */
function csvQuoteRow(values: readonly unknown[]): string {
  return (
    values
      .map((v) => {
        if (v === null || v === undefined) return '""';
        const str =
          typeof v === 'string'
            ? v
            : typeof v === 'number' || typeof v === 'boolean'
              ? String(v)
              : typeof v === 'object'
                ? JSON.stringify(v)
                : String(v);
        return `"${str.replace(/"/g, '""')}"`;
      })
      .join(',') + '\r\n'
  );
}

/** Build a minimum valid content blob for a new template. */
function emptyContent(title: string): TemplateContent {
  // Every new template starts with a Title Page (site, date, person, location —
  // auto-populated at inspection start) and a first inspection page with one
  // Yes / No / N/A question. The Yes/No/N/A set is baked into the template's
  // customResponseSets with per-option colours; the "No" response is flagged on
  // the question itself (flaggedOptionIds), not on the shared set.
  const yesNoSetId = newId();
  const yesNoNoOptionId = newId();
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    title,
    pages: [
      {
        id: newId(),
        type: 'title',
        title: 'Title Page',
        sections: [
          {
            id: newId(),
            title: 'Details',
            items: [
              { id: newId(), type: 'site', prompt: 'Site conducted', required: true },
              { id: newId(), type: 'inspectionDate', prompt: 'Conducted on', required: false },
              { id: newId(), type: 'conductedBy', prompt: 'Prepared by', required: false },
              { id: newId(), type: 'location', prompt: 'Location', required: false },
            ],
          },
        ],
      },
      {
        id: newId(),
        type: 'inspection',
        title: 'Page 1',
        sections: [
          {
            id: newId(),
            title: 'Section 1',
            items: [
              {
                id: newId(),
                type: 'multipleChoice',
                prompt: 'Type question',
                required: false,
                responseSetId: yesNoSetId,
                flaggedOptionIds: [yesNoNoOptionId],
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
    // Built-in response-set library, available in every new template. Sets
    // carry per-option colours only; flagging is set per question. The Page 1
    // question uses the Yes / No / N/A set and flags its "No" response.
    customResponseSets: [
      {
        id: yesNoSetId,
        name: 'Yes / No / N/A',
        sourceGlobalId: null,
        multiSelect: false,
        options: [
          { id: newId(), label: 'Yes', color: 'green' },
          { id: yesNoNoOptionId, label: 'No', color: 'red' },
          { id: newId(), label: 'N/A', color: 'grey' },
        ],
      },
      {
        id: newId(),
        name: 'Good / Fair / Poor',
        sourceGlobalId: null,
        multiSelect: false,
        options: [
          { id: newId(), label: 'Good', color: 'green' },
          { id: newId(), label: 'Fair', color: 'amber' },
          { id: newId(), label: 'Poor', color: 'red' },
          { id: newId(), label: 'N/A', color: 'grey' },
        ],
      },
      {
        id: newId(),
        name: 'Safe / At Risk',
        sourceGlobalId: null,
        multiSelect: false,
        options: [
          { id: newId(), label: 'Safe', color: 'green' },
          { id: newId(), label: 'At Risk', color: 'red' },
          { id: newId(), label: 'N/A', color: 'grey' },
        ],
      },
      {
        id: newId(),
        name: 'Pass / Fail',
        sourceGlobalId: null,
        multiSelect: false,
        options: [
          { id: newId(), label: 'Pass', color: 'green' },
          { id: newId(), label: 'Fail', color: 'red' },
          { id: newId(), label: 'N/A', color: 'grey' },
        ],
      },
      {
        id: newId(),
        name: 'Compliant / Non-Compliant',
        sourceGlobalId: null,
        multiSelect: false,
        options: [
          { id: newId(), label: 'Compliant', color: 'green' },
          { id: newId(), label: 'Non-Compliant', color: 'red' },
          { id: newId(), label: 'N/A', color: 'grey' },
        ],
      },
    ],
  };
}

// ─── Input schemas ─────────────────────────────────────────────────────────

const createInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

const saveDraftInput = z.object({
  templateId: z.string().length(26),
  /** Full content blob. Validated by templateContentSchema before write. */
  content: z.unknown(),
  /**
   * Optimistic concurrency (T-E18). The client sends the updatedAt it last
   * saw on the draft version. The server rejects if the draft was updated
   * since, so the client can render a conflict modal.
   */
  expectedUpdatedAt: z.string().datetime().optional(),
});

const publishInput = z.object({
  templateId: z.string().length(26),
  /**
   * Optional audience scoping. Omit to leave the template's existing
   * accessRuleId alone (back-compat for callers that pre-date the Publish
   * tab). 'everyone' clears the rule; 'specific' creates or updates a
   * `[auto] Template: …` rule and points the template at it.
   */
  access: z
    .object({
      mode: z.enum(['everyone', 'specific']),
      groupIds: z.array(z.string().length(26)).max(100).default([]),
      siteIds: z.array(z.string().length(26)).max(100).default([]),
    })
    .optional(),
});

const duplicateInput = z.object({
  templateId: z.string().length(26),
});

const archiveInput = z.object({
  templateId: z.string().length(26),
});

const importJsonInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** Raw content blob — must conform to templateContentSchema. */
  content: z.unknown(),
});

// ─── Router ────────────────────────────────────────────────────────────────

export const templatesRouter = router({
  list: tenantProcedure
    .use(requirePermission('templates.view'))
    .input(
      z
        .object({
          includeArchived: z.boolean().default(false),
          status: z.enum(['draft', 'published', 'archived']).optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const where = [eq(templates.tenantId, ctx.tenantId)];
      if (!input.includeArchived) where.push(isNull(templates.archivedAt));
      if (input.status !== undefined) where.push(eq(templates.status, input.status));
      const rows = await ctx.db
        .select({
          id: templates.id,
          name: templates.name,
          description: templates.description,
          status: templates.status,
          currentVersionId: templates.currentVersionId,
          accessRuleId: templates.accessRuleId,
          archivedAt: templates.archivedAt,
          updatedAt: templates.updatedAt,
          createdByName: user.name,
        })
        .from(templates)
        .leftJoin(user, eq(user.id, templates.createdBy))
        .where(and(...where))
        .orderBy(desc(templates.updatedAt));

      if (rows.length === 0) return [];

      // Batch-fetch most recent publishedAt per template
      const templateIds = rows.map((r) => r.id);
      const pubVersions = await ctx.db
        .select({
          templateId: templateVersions.templateId,
          publishedAt: templateVersions.publishedAt,
        })
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.tenantId, ctx.tenantId),
            inArray(templateVersions.templateId, templateIds),
            isNotNull(templateVersions.publishedAt),
          ),
        )
        .orderBy(desc(templateVersions.publishedAt));

      const lastPublishedMap = new Map<string, Date>();
      for (const v of pubVersions) {
        if (!lastPublishedMap.has(v.templateId) && v.publishedAt !== null) {
          lastPublishedMap.set(v.templateId, v.publishedAt);
        }
      }

      // Fetch access rules (used for name display and non-manager visibility filtering)
      const ruleIds = Array.from(
        new Set(rows.map((r) => r.accessRuleId).filter((id): id is string => id !== null)),
      );
      const ruleRows =
        ruleIds.length === 0
          ? []
          : await ctx.db
              .select()
              .from(accessRules)
              .where(and(eq(accessRules.tenantId, ctx.tenantId), inArray(accessRules.id, ruleIds)));
      const ruleMap = new Map(ruleRows.map((r) => [r.id, r]));

      const enriched = rows.map((r) => ({
        ...r,
        lastPublishedAt: lastPublishedMap.get(r.id) ?? null,
        accessRuleName:
          r.accessRuleId !== null ? (ruleMap.get(r.accessRuleId)?.name ?? null) : null,
      }));

      // Admin / template-manager users see every template regardless of
      // access rule. For everyone else we gate by the rule: null = visible
      // to all, non-null = caller's group/site memberships must satisfy it.
      const isManager = ctx.permissions.includes('templates.manage');
      if (isManager) return enriched;

      const userGroupRows = await ctx.db
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(
          and(eq(groupMembers.tenantId, ctx.tenantId), eq(groupMembers.userId, ctx.auth.userId)),
        );
      const userSiteRows = await ctx.db
        .select({ siteId: siteMembers.siteId })
        .from(siteMembers)
        .where(
          and(eq(siteMembers.tenantId, ctx.tenantId), eq(siteMembers.userId, ctx.auth.userId)),
        );
      const userSnapshot = {
        groupIds: userGroupRows.map((r) => r.groupId),
        siteIds: userSiteRows.map((r) => r.siteId),
      };

      return enriched.filter((tpl) => {
        if (tpl.accessRuleId === null) return true;
        const rule = ruleMap.get(tpl.accessRuleId);
        if (rule === undefined) return false;
        return resolveAccessRule(rule, userSnapshot);
      });
    }),

  get: tenantProcedure
    .use(requirePermission('templates.view'))
    .input(z.object({ templateId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(templates)
        .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, input.templateId)))
        .limit(1);
      const tpl = rows[0];
      if (tpl === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

      // Load every version so the editor can show history.
      const versions = await ctx.db
        .select()
        .from(templateVersions)
        .where(
          and(eq(templateVersions.tenantId, ctx.tenantId), eq(templateVersions.templateId, tpl.id)),
        )
        .orderBy(desc(templateVersions.versionNumber));

      return { template: tpl, versions };
    }),

  /**
   * Fetch a specific version by id. Used by the inspection conduct runtime
   * to load the pinned version content (T-E04).
   */
  getVersion: tenantProcedure
    .use(requirePermission('templates.view'))
    .input(z.object({ versionId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.tenantId, ctx.tenantId),
            eq(templateVersions.id, input.versionId),
          ),
        )
        .limit(1);
      const version = rows[0];
      if (version === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      return version;
    }),

  create: tenantProcedure
    .use(requirePermission('templates.create'))
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const templateId = newId();
      const versionId = newId();
      const content = emptyContent(input.name);

      await ctx.db.transaction(async (tx) => {
        await tx.insert(templates).values({
          id: templateId,
          tenantId: ctx.tenantId,
          name: input.name,
          description: input.description ?? null,
          status: 'draft',
          currentVersionId: null,
          titleFormat: content.settings.titleFormat,
          createdBy: ctx.auth.userId,
        });
        await tx.insert(templateVersions).values({
          id: versionId,
          tenantId: ctx.tenantId,
          templateId,
          versionNumber: 1,
          content,
          isCurrent: false,
        });
      });

      ctx.logger.info({ templateId }, '[templates] created');
      return { templateId, draftVersionId: versionId };
    }),

  saveDraft: tenantProcedure
    .use(requirePermission('templates.manage'))
    .input(saveDraftInput)
    .mutation(async ({ ctx, input }) => {
      // Parse content through the Zod schema — fails loudly on any invariant
      // violation (T-E07 depth, T-E02 duplicate signers, T-E17 response-set
      // reference, ...).
      const parseResult = templateContentSchema.safeParse(input.content);
      if (!parseResult.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Template content failed validation',
          cause: { zodIssues: parseResult.error.flatten() },
        });
      }
      const content = parseResult.data;

      // Find the latest version. If it's published we open a new draft;
      // if it's already a draft we update it in place (respecting the
      // optimistic concurrency check — T-E18).
      const tpl = await ctx.db
        .select()
        .from(templates)
        .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, input.templateId)))
        .limit(1);
      const template = tpl[0];
      if (template === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (template.archivedAt !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot edit an archived template',
        });
      }

      const latest = await ctx.db
        .select()
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.tenantId, ctx.tenantId),
            eq(templateVersions.templateId, input.templateId),
          ),
        )
        .orderBy(desc(templateVersions.versionNumber))
        .limit(1);
      const latestVersion = latest[0];
      if (latestVersion === undefined) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Template has no versions' });
      }

      if (latestVersion.publishedAt !== null) {
        // Latest is published — create a new draft on top.
        const newVersionId = newId();
        await ctx.db.insert(templateVersions).values({
          id: newVersionId,
          tenantId: ctx.tenantId,
          templateId: input.templateId,
          versionNumber: latestVersion.versionNumber + 1,
          content,
          isCurrent: false,
        });
        await ctx.db
          .update(templates)
          .set({ updatedAt: new Date() })
          .where(eq(templates.id, input.templateId));
        return { versionId: newVersionId };
      }

      // Update the existing draft in place. T-E18 optimistic concurrency.
      if (input.expectedUpdatedAt !== undefined) {
        const expected = new Date(input.expectedUpdatedAt).getTime();
        const current = latestVersion.updatedAt.getTime();
        if (current !== expected) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Template was modified by another editor. Review their changes before saving.',
            cause: {
              code: 'CONFLICT',
              serverUpdatedAt: latestVersion.updatedAt.toISOString(),
              serverVersionId: latestVersion.id,
            },
          });
        }
      }
      await ctx.db
        .update(templateVersions)
        .set({ content, updatedAt: new Date() })
        .where(eq(templateVersions.id, latestVersion.id));
      await ctx.db
        .update(templates)
        .set({ updatedAt: new Date() })
        .where(eq(templates.id, input.templateId));
      return { versionId: latestVersion.id };
    }),

  /**
   * Publish the latest draft as the new current version. Atomic:
   *   - validate the draft's content through the Zod schema
   *   - stamp publishedAt + publishedBy
   *   - flip isCurrent on the draft
   *   - flip isCurrent off on the previous current (if any)
   *   - point templates.currentVersionId at the new version
   *   - template.status = 'published'
   *
   * NEVER writes to a published version's `content` field — that's the
   * immutability contract. Subsequent edits are new draft rows.
   */
  publish: tenantProcedure
    .use(requirePermission('templates.manage'))
    .input(publishInput)
    .mutation(async ({ ctx, input }) => {
      const tpl = await ctx.db
        .select()
        .from(templates)
        .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, input.templateId)))
        .limit(1);
      const template = tpl[0];
      if (template === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (template.archivedAt !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot publish an archived template',
        });
      }

      const latest = await ctx.db
        .select()
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.tenantId, ctx.tenantId),
            eq(templateVersions.templateId, input.templateId),
          ),
        )
        .orderBy(desc(templateVersions.versionNumber))
        .limit(1);
      const draft = latest[0];
      if (draft === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (draft.publishedAt !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'No draft to publish',
        });
      }

      // Validate once more at the publish boundary. Drafts saved via the
      // saveDraft path are already validated, but JSON imports or future
      // code paths may write drafts without.
      const parsed = templateContentSchema.safeParse(draft.content);
      if (!parsed.success) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Draft content failed validation',
          cause: { zodIssues: parsed.error.flatten() },
        });
      }
      // Cross-field signature-workflow check (enabled + at least one signer).
      const sw = validateSignatureWorkflow(parsed.data);
      if (!sw.valid) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: sw.errors.join(' '),
        });
      }

      // Resolve the new accessRuleId from the input. We compute this BEFORE
      // the publish transaction so any rule-shaped errors surface cleanly
      // rather than aborting the publish tx. `undefined` means "leave the
      // existing accessRuleId alone" (back-compat for callers that don't
      // know about the access input yet).
      let newAccessRuleId: string | null | undefined;
      if (input.access === undefined) {
        newAccessRuleId = undefined;
      } else if (input.access.mode === 'everyone') {
        newAccessRuleId = null;
      } else {
        const ruleName = `[auto] Template: ${template.name}`;
        const ruleGroupIds = input.access.groupIds;
        const ruleSiteIds = input.access.siteIds;
        if (template.accessRuleId !== null) {
          // Update the existing auto-rule in place.
          await ctx.db
            .update(accessRules)
            .set({
              name: ruleName,
              groupIds: ruleGroupIds,
              siteIds: ruleSiteIds,
              invalidatedAt: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(accessRules.id, template.accessRuleId),
                eq(accessRules.tenantId, ctx.tenantId),
              ),
            );
          newAccessRuleId = template.accessRuleId;
        } else {
          // Create a fresh auto-rule.
          const id = newId();
          await ctx.db.insert(accessRules).values({
            id,
            tenantId: ctx.tenantId,
            name: ruleName,
            groupIds: ruleGroupIds,
            siteIds: ruleSiteIds,
          });
          newAccessRuleId = id;
        }
      }

      const now = new Date();
      await ctx.db.transaction(async (tx) => {
        // Flip previous current off.
        if (template.currentVersionId !== null) {
          await tx
            .update(templateVersions)
            .set({ isCurrent: false, updatedAt: now })
            .where(eq(templateVersions.id, template.currentVersionId));
        }
        // Publish draft.
        await tx
          .update(templateVersions)
          .set({
            isCurrent: true,
            publishedAt: now,
            publishedBy: ctx.auth.userId,
            updatedAt: now,
          })
          .where(eq(templateVersions.id, draft.id));
        // Update template — include accessRuleId only when the caller
        // explicitly opted in via the input.
        const templateUpdate: {
          status: 'published';
          currentVersionId: string;
          updatedAt: Date;
          accessRuleId?: string | null;
        } = {
          status: 'published',
          currentVersionId: draft.id,
          updatedAt: now,
        };
        if (newAccessRuleId !== undefined) {
          templateUpdate.accessRuleId = newAccessRuleId;
        }
        await tx.update(templates).set(templateUpdate).where(eq(templates.id, input.templateId));
      });
      ctx.logger.info(
        { templateId: input.templateId, versionId: draft.id },
        '[templates] published',
      );
      return { versionId: draft.id };
    }),

  /**
   * Update only the audience scoping (accessRuleId) for a template — used
   * by the Visibility tab. Decoupled from `publish` so visibility can be
   * changed on a clean, already-published template without needing a draft.
   *
   *   - mode === 'everyone' → clears `accessRuleId` (leaves the orphaned
   *     auto-rule row in the DB; it's filtered out of `accessRules.list`).
   *   - mode === 'specific' → upserts the `[auto] Template: …` access rule
   *     and points the template at it.
   *
   * Refuses on archived templates (same guard as `publish`).
   */
  updateAccess: tenantProcedure
    .use(requirePermission('templates.manage'))
    .input(
      z.object({
        templateId: z.string().length(26),
        access: z.object({
          mode: z.enum(['everyone', 'specific']),
          groupIds: z.array(z.string().length(26)).max(100).default([]),
          siteIds: z.array(z.string().length(26)).max(100).default([]),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tplRows = await ctx.db
        .select()
        .from(templates)
        .where(and(eq(templates.id, input.templateId), eq(templates.tenantId, ctx.tenantId)))
        .limit(1);
      const template = tplRows[0];
      if (template === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (template.archivedAt !== null) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot edit an archived template',
        });
      }

      let newAccessRuleId: string | null;
      if (input.access.mode === 'everyone') {
        newAccessRuleId = null;
      } else {
        const ruleName = `[auto] Template: ${template.name}`;
        if (template.accessRuleId !== null) {
          await ctx.db
            .update(accessRules)
            .set({
              name: ruleName,
              groupIds: input.access.groupIds,
              siteIds: input.access.siteIds,
              invalidatedAt: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(accessRules.id, template.accessRuleId),
                eq(accessRules.tenantId, ctx.tenantId),
              ),
            );
          newAccessRuleId = template.accessRuleId;
        } else {
          const id = newId();
          await ctx.db.insert(accessRules).values({
            id,
            tenantId: ctx.tenantId,
            name: ruleName,
            groupIds: input.access.groupIds,
            siteIds: input.access.siteIds,
          });
          newAccessRuleId = id;
        }
      }

      await ctx.db
        .update(templates)
        .set({ accessRuleId: newAccessRuleId, updatedAt: new Date() })
        .where(and(eq(templates.id, input.templateId), eq(templates.tenantId, ctx.tenantId)));

      ctx.logger.info(
        { templateId: input.templateId, accessRuleId: newAccessRuleId },
        '[templates] access updated',
      );
      return { templateId: input.templateId, accessRuleId: newAccessRuleId };
    }),

  /**
   * Read the current audience-scoping config for a template — used by the
   * Visibility tab to hydrate the picker UI.
   *
   * If `accessRuleId` is null OR the referenced rule no longer exists
   * (defensive), we report 'everyone'. Otherwise we hand back the rule's
   * groupIds + siteIds for the picker to render.
   */
  getAccess: tenantProcedure
    .use(requirePermission('templates.view'))
    .input(z.object({ templateId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const tplRows = await ctx.db
        .select({ accessRuleId: templates.accessRuleId })
        .from(templates)
        .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, input.templateId)))
        .limit(1);
      const tpl = tplRows[0];
      if (tpl === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (tpl.accessRuleId === null) {
        return {
          mode: 'everyone' as const,
          groupIds: [] as readonly string[],
          siteIds: [] as readonly string[],
        };
      }
      const ruleRows = await ctx.db
        .select()
        .from(accessRules)
        .where(and(eq(accessRules.id, tpl.accessRuleId), eq(accessRules.tenantId, ctx.tenantId)))
        .limit(1);
      const rule = ruleRows[0];
      if (rule === undefined) {
        return {
          mode: 'everyone' as const,
          groupIds: [] as readonly string[],
          siteIds: [] as readonly string[],
        };
      }
      return {
        mode: 'specific' as const,
        groupIds: rule.groupIds,
        siteIds: rule.siteIds,
      };
    }),

  duplicate: tenantProcedure
    .use(requirePermission('templates.create'))
    .input(duplicateInput)
    .mutation(async ({ ctx, input }) => {
      const tpl = await ctx.db
        .select()
        .from(templates)
        .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, input.templateId)))
        .limit(1);
      const source = tpl[0];
      if (source === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

      // Duplicate from the latest version (draft or published — whatever's newest).
      const latest = await ctx.db
        .select()
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.tenantId, ctx.tenantId),
            eq(templateVersions.templateId, input.templateId),
          ),
        )
        .orderBy(desc(templateVersions.versionNumber))
        .limit(1);
      const sourceVersion = latest[0];
      if (sourceVersion === undefined) throw new TRPCError({ code: 'NOT_FOUND' });

      const newTemplateId = newId();
      const newVersionId = newId();
      const newName = `Copy of ${source.name}`;
      const duplicatedContent = { ...sourceVersion.content, title: newName };

      await ctx.db.transaction(async (tx) => {
        await tx.insert(templates).values({
          id: newTemplateId,
          tenantId: ctx.tenantId,
          name: newName,
          description: source.description,
          status: 'draft',
          currentVersionId: null,
          titleFormat: source.titleFormat,
          createdBy: ctx.auth.userId,
        });
        await tx.insert(templateVersions).values({
          id: newVersionId,
          tenantId: ctx.tenantId,
          templateId: newTemplateId,
          versionNumber: 1,
          content: duplicatedContent,
          isCurrent: false,
        });
      });
      return { templateId: newTemplateId };
    }),

  archive: tenantProcedure
    .use(requirePermission('templates.archive'))
    .input(archiveInput)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      // T-E05: archive + pause any schedules in one transaction so the
      // invariant "archived template has no active schedules" holds even
      // under concurrent writes.
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(templates)
          .set({ status: 'archived', archivedAt: now, updatedAt: now })
          .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, input.templateId)));
        await tx
          .update(templateSchedules)
          .set({ paused: true, updatedAt: now })
          .where(
            and(
              eq(templateSchedules.tenantId, ctx.tenantId),
              eq(templateSchedules.templateId, input.templateId),
              eq(templateSchedules.paused, false),
            ),
          );
      });
      ctx.logger.info({ templateId: input.templateId }, '[templates] archived + schedules paused');
      return { ok: true as const };
    }),

  /**
   * Restore an archived template back to draft state.
   *
   * Clears `archivedAt`, flips `status` back to `'draft'`. Schedules paused
   * by `archive` stay paused — the operator can resume them manually from
   * the schedules UI. Same permission as `archive` since restoring is the
   * inverse half of the same admin capability.
   */
  unarchive: tenantProcedure
    .use(requirePermission('templates.archive'))
    .input(z.object({ templateId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const result = await ctx.db
        .update(templates)
        .set({ archivedAt: null, status: 'draft', updatedAt: now })
        .where(and(eq(templates.id, input.templateId), eq(templates.tenantId, ctx.tenantId)))
        .returning({ id: templates.id });
      const row = result[0];
      if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      ctx.logger.info({ templateId: row.id }, '[templates] unarchived');
      return row;
    }),

  /**
   * Move a published template back to draft state.
   *
   * Used by the list page's "Move to draft" action. Crucially we keep
   * `currentVersionId` intact so any in-progress inspections that pinned
   * this version still resolve their content (ADR 0007 — access state at
   * time of action). The next saveDraft + publish cycle will flip
   * `isCurrent` on the prior version, same as a normal re-publish.
   *
   * Idempotent: no-op on drafts, refuses on archived templates.
   */
  unpublish: tenantProcedure
    .use(requirePermission('templates.manage'))
    .input(z.object({ templateId: z.string().length(26) }))
    .mutation(async ({ ctx, input }) => {
      const tpl = await ctx.db
        .select({ status: templates.status })
        .from(templates)
        .where(and(eq(templates.id, input.templateId), eq(templates.tenantId, ctx.tenantId)))
        .limit(1);
      const current = tpl[0];
      if (current === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      if (current.status === 'archived') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'cannot-unpublish-archived' });
      }
      if (current.status === 'draft') {
        // Already a draft — idempotent no-op.
        return { id: input.templateId };
      }
      const now = new Date();
      const result = await ctx.db
        .update(templates)
        .set({ status: 'draft', updatedAt: now })
        .where(and(eq(templates.id, input.templateId), eq(templates.tenantId, ctx.tenantId)))
        .returning({ id: templates.id });
      const row = result[0];
      if (row === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      ctx.logger.info({ templateId: row.id }, '[templates] unpublished (back to draft)');
      return row;
    }),

  exportJson: tenantProcedure
    .use(requirePermission('templates.view'))
    .input(z.object({ templateId: z.string().length(26) }))
    .query(async ({ ctx, input }) => {
      const latest = await ctx.db
        .select()
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.tenantId, ctx.tenantId),
            eq(templateVersions.templateId, input.templateId),
          ),
        )
        .orderBy(asc(templateVersions.versionNumber))
        .limit(1);
      // Actually, export should prefer the current version if one exists.
      const tpl = await ctx.db
        .select()
        .from(templates)
        .where(and(eq(templates.tenantId, ctx.tenantId), eq(templates.id, input.templateId)))
        .limit(1);
      const template = tpl[0];
      if (template === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      let version;
      if (template.currentVersionId !== null) {
        const rows = await ctx.db
          .select()
          .from(templateVersions)
          .where(eq(templateVersions.id, template.currentVersionId))
          .limit(1);
        version = rows[0];
      } else {
        version = latest[0];
      }
      if (version === undefined) throw new TRPCError({ code: 'NOT_FOUND' });
      return { content: version.content };
    }),

  /**
   * Export every template in the tenant as a CSV. Includes an
   * `usage_count` column (number of inspections referencing any version
   * of the template) computed via a left join aggregate so the list is
   * one query rather than N+1. PR 33.
   */
  exportAllCsv: tenantProcedure
    .use(requirePermission('templates.manage'))
    .query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          id: templates.id,
          name: templates.name,
          status: templates.status,
          currentVersionId: templates.currentVersionId,
          archivedAt: templates.archivedAt,
        })
        .from(templates)
        .where(eq(templates.tenantId, ctx.tenantId))
        .orderBy(asc(templates.name));

      // Version-count per template + currentVersionNumber + publishedAt —
      // pulled from template_versions in one grouped query.
      const versionAgg = await ctx.db
        .select({
          templateId: templateVersions.templateId,
          versionCount: sql<number>`count(*)::int`,
        })
        .from(templateVersions)
        .where(eq(templateVersions.tenantId, ctx.tenantId))
        .groupBy(templateVersions.templateId);
      const versionCountByTemplate = new Map<string, number>();
      for (const v of versionAgg) versionCountByTemplate.set(v.templateId, v.versionCount);

      // Usage-count per template — one grouped query across inspections.
      const usageAgg = await ctx.db
        .select({
          templateId: inspections.templateId,
          usageCount: sql<number>`count(*)::int`,
        })
        .from(inspections)
        .where(eq(inspections.tenantId, ctx.tenantId))
        .groupBy(inspections.templateId);
      const usageByTemplate = new Map<string, number>();
      for (const u of usageAgg) usageByTemplate.set(u.templateId, u.usageCount);

      // Current version number + publishedAt — targeted fetch for only
      // those templates that have one.
      const currentVersionIds = rows
        .map((r) => r.currentVersionId)
        .filter((id): id is string => id !== null);
      const versionMetaById = new Map<
        string,
        { versionNumber: number; publishedAt: Date | null }
      >();
      if (currentVersionIds.length > 0) {
        const versionRows = await ctx.db
          .select({
            id: templateVersions.id,
            versionNumber: templateVersions.versionNumber,
            publishedAt: templateVersions.publishedAt,
          })
          .from(templateVersions)
          .where(
            and(
              eq(templateVersions.tenantId, ctx.tenantId),
              inArray(templateVersions.id, currentVersionIds),
            ),
          );
        for (const v of versionRows) {
          versionMetaById.set(v.id, {
            versionNumber: v.versionNumber,
            publishedAt: v.publishedAt,
          });
        }
      }

      const header = [
        'template_id',
        'name',
        'status',
        'version_count',
        'current_version_number',
        'published_at',
        'archived_at',
        'usage_count',
      ];
      const lines: string[] = [csvQuoteRow(header)];
      for (const r of rows) {
        const meta =
          r.currentVersionId !== null ? versionMetaById.get(r.currentVersionId) : undefined;
        lines.push(
          csvQuoteRow([
            r.id,
            r.name,
            r.status,
            versionCountByTemplate.get(r.id) ?? 0,
            meta?.versionNumber ?? null,
            meta?.publishedAt?.toISOString() ?? null,
            r.archivedAt?.toISOString() ?? null,
            usageByTemplate.get(r.id) ?? 0,
          ]),
        );
      }
      const csv = lines.join('');
      return { csv, rowCount: rows.length };
    }),

  /**
   * Create a draft template from an AI-generated {@link templateSpecSchema}.
   * The spec is the small, forgiving contract the generation agent (AI chat /
   * PDF / Excel import) emits; the deterministic builder expands it into a
   * schema-valid `TemplateContent` (ids, response-set snapshots, forward-only
   * jumps, triggers, title page, settings). Never auto-publishes — like every
   * other create path, it lands a draft the user reviews in the editor.
   */
  createFromSpec: tenantProcedure
    .use(requirePermission('templates.create'))
    .input(z.object({ spec: templateSpecSchema }))
    .mutation(async ({ ctx, input }) => {
      // The builder always ends in templateContentSchema.parse(); a throw here
      // is a builder bug, not bad AI output (invalid logic is dropped, not fatal).
      const content = buildTemplateContentFromSpec(input.spec);
      const templateId = newId();
      const versionId = newId();
      await ctx.db.transaction(async (tx) => {
        await tx.insert(templates).values({
          id: templateId,
          tenantId: ctx.tenantId,
          name: content.title,
          description: content.description ?? null,
          status: 'draft',
          currentVersionId: null,
          titleFormat: content.settings.titleFormat,
          createdBy: ctx.auth.userId,
        });
        await tx.insert(templateVersions).values({
          id: versionId,
          tenantId: ctx.tenantId,
          templateId,
          versionNumber: 1,
          content,
          isCurrent: false,
        });
      });
      ctx.logger.info({ templateId }, '[templates] created from spec');
      return { templateId, draftVersionId: versionId };
    }),

  importJson: tenantProcedure
    .use(requirePermission('templates.create'))
    .input(importJsonInput)
    .mutation(async ({ ctx, input }) => {
      // Validate before touching the DB — T-04 / T-E14 spirit: "Never
      // auto-publish a converted template." We accept parse errors here
      // rather than trying to salvage partial imports.
      let parsed: TemplateContent;
      try {
        parsed = parseTemplateContent(input.content);
      } catch {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Imported JSON does not match the template content schema.',
        });
      }

      const templateId = newId();
      const versionId = newId();
      const name = input.name;
      const content: TemplateContent = { ...parsed, title: name };
      await ctx.db.transaction(async (tx) => {
        await tx.insert(templates).values({
          id: templateId,
          tenantId: ctx.tenantId,
          name,
          description: input.description ?? null,
          status: 'draft',
          currentVersionId: null,
          titleFormat: content.settings.titleFormat,
          createdBy: ctx.auth.userId,
        });
        await tx.insert(templateVersions).values({
          id: versionId,
          tenantId: ctx.tenantId,
          templateId,
          versionNumber: 1,
          content,
          isCurrent: false,
        });
      });
      return { templateId, draftVersionId: versionId };
    }),
});

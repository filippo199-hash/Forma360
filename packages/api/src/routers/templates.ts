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
  inspections,
  templateSchedules,
  templates,
  templateVersions,
} from '@forma360/db/schema';
import {
  registerDependentResolver,
  type DependentResolver,
} from '@forma360/permissions/dependents';
import { newId } from '@forma360/shared/id';
import {
  parseTemplateContent,
  templateContentSchema,
  TEMPLATE_SCHEMA_VERSION,
  type TemplateContent,
} from '@forma360/shared/template-schema';
import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
              { id: newId(), type: 'conductedBy', prompt: 'Conducted by', required: false },
              { id: newId(), type: 'inspectionDate', prompt: 'Inspection date', required: false },
            ],
          },
        ],
      },
      {
        id: newId(),
        type: 'inspection',
        title: 'Inspection',
        sections: [{ id: newId(), title: 'Section 1', items: [] }],
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
      return ctx.db
        .select({
          id: templates.id,
          name: templates.name,
          description: templates.description,
          status: templates.status,
          currentVersionId: templates.currentVersionId,
          accessRuleId: templates.accessRuleId,
          archivedAt: templates.archivedAt,
          updatedAt: templates.updatedAt,
        })
        .from(templates)
        .where(and(...where))
        .orderBy(desc(templates.updatedAt));
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
        // Update template.
        await tx
          .update(templates)
          .set({
            status: 'published',
            currentVersionId: draft.id,
            updatedAt: now,
          })
          .where(eq(templates.id, input.templateId));
      });
      ctx.logger.info(
        { templateId: input.templateId, versionId: draft.id },
        '[templates] published',
      );
      return { versionId: draft.id };
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
        const meta = r.currentVersionId !== null ? versionMetaById.get(r.currentVersionId) : undefined;
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

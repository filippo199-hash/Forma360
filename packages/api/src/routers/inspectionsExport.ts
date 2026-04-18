/**
 * Inspections CSV export + bulk archive — Phase 2 PR 33.
 *
 *   - exportCsv (inspections.export)    — streams a CSV string of rows
 *     matching the filter (or an explicit id list). Capped at 10_000 rows
 *     per call. RFC 4180 escaping — every cell quoted, embedded quotes
 *     doubled. Columns match the PR 33 spec exactly.
 *   - exportCsvUrl (inspections.export) — same query, uploads to R2 under
 *     `<tenantId>/inspections/exports/inspections-<ts>.csv`, returns the
 *     key + a signed download URL valid for DEFAULT_SIGNED_URL_EXPIRES_SECONDS.
 *   - archiveMany (inspections.manage)  — sets archivedAt on up to 500
 *     inspections in one transaction. Tenant-scoped at the WHERE level so a
 *     caller cannot archive another tenant's rows even if they supply the
 *     ids directly.
 *
 * The renderer + storage are injected so tests can run against deterministic
 * mocks (same pattern as the exports router — see `ExportsRouterDeps`).
 */
import type { Database } from '@forma360/db/client';
import {
  inspections,
  sites,
  templateVersions,
  templates,
  user,
} from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

/** Maximum rows in a single CSV export — avoids unbounded memory growth. */
export const INSPECTIONS_EXPORT_MAX_ROWS = 10_000;

/** Maximum ids in a single archiveMany call. */
export const INSPECTIONS_ARCHIVE_MAX_IDS = 500;

/**
 * Injected dependencies. Keeps the router pure: the web app wires R2 via
 * `@forma360/shared/storage`, tests wire an in-memory map.
 */
export interface InspectionsExportDeps {
  /**
   * Upload the CSV body to R2 under the given key. Resolves with the URL
   * clients can use to download. Tests pass a stub that stores the bytes
   * in a Map.
   */
  uploadCsv: (input: {
    key: string;
    body: string;
  }) => Promise<{ url: string }>;
  /** Wall-clock for deterministic filenames in tests. */
  now: () => Date;
}

const filterSchema = z.object({
  status: z
    .enum(['in_progress', 'awaiting_signatures', 'awaiting_approval', 'completed', 'rejected'])
    .optional(),
  templateId: z.string().length(26).optional(),
  siteId: z.string().length(26).optional(),
  /** ISO date or datetime, inclusive lower bound on startedAt. */
  dateFrom: z.string().datetime().optional(),
  /** Inclusive upper bound on startedAt. */
  dateTo: z.string().datetime().optional(),
  /** Include archived rows. Default false. */
  includeArchived: z.boolean().default(false),
});

const exportInput = z
  .object({
    filter: filterSchema.optional(),
    ids: z.array(z.string().length(26)).max(INSPECTIONS_EXPORT_MAX_ROWS).optional(),
  })
  .default({});

const archiveManyInput = z.object({
  ids: z.array(z.string().length(26)).min(1).max(INSPECTIONS_ARCHIVE_MAX_IDS),
});

/**
 * RFC 4180 CSV cell escape: quote every value, double embedded quotes,
 * preserve newlines and commas unchanged inside the quotes. Null → empty.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (value instanceof Date) return `"${value.toISOString()}"`;
  const str =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

/** Render one CSV row from an ordered array of values. Newline-terminated. */
export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(',') + '\r\n';
}

/** Fixed column order per PR 33 brief. Keep in sync with `buildCsv`. */
export const INSPECTIONS_CSV_HEADER = [
  'inspection_id',
  'title',
  'document_number',
  'status',
  'template_name',
  'template_version_number',
  'conducted_by',
  'site_name',
  'started_at',
  'submitted_at',
  'completed_at',
  'score_total',
  'score_max',
  'score_percentage',
] as const;

interface CsvRowShape {
  id: string;
  title: string;
  documentNumber: string | null;
  status: string;
  templateName: string | null;
  templateVersionNumber: number | null;
  conductedByName: string | null;
  siteName: string | null;
  startedAt: Date;
  submittedAt: Date | null;
  completedAt: Date | null;
  score: { total: number; max: number; percentage: number } | null;
}

/** Assemble the full CSV string. Export for the test suite. */
export function buildCsv(rows: readonly CsvRowShape[]): string {
  let out = csvRow(INSPECTIONS_CSV_HEADER);
  for (const r of rows) {
    out += csvRow([
      r.id,
      r.title,
      r.documentNumber,
      r.status,
      r.templateName,
      r.templateVersionNumber,
      r.conductedByName,
      r.siteName,
      r.startedAt.toISOString(),
      r.submittedAt === null ? null : r.submittedAt.toISOString(),
      r.completedAt === null ? null : r.completedAt.toISOString(),
      r.score?.total ?? null,
      r.score?.max ?? null,
      r.score?.percentage ?? null,
    ]);
  }
  return out;
}

/**
 * Run the filter query against the DB and join the adjacent human-readable
 * labels (template name, version number, site name, conductedBy display
 * name). Tenant scope is enforced at the top of the WHERE clause.
 */
async function queryCsvRows(
  db: Database,
  tenantId: string,
  input: z.infer<typeof exportInput>,
): Promise<CsvRowShape[]> {
  const where = [eq(inspections.tenantId, tenantId)];
  const filter: z.infer<typeof filterSchema> | undefined = input.filter;
  if (filter?.status !== undefined) where.push(eq(inspections.status, filter.status));
  if (filter?.templateId !== undefined) where.push(eq(inspections.templateId, filter.templateId));
  if (filter?.siteId !== undefined) where.push(eq(inspections.siteId, filter.siteId));
  if (filter?.dateFrom !== undefined) {
    where.push(gte(inspections.startedAt, new Date(filter.dateFrom)));
  }
  if (filter?.dateTo !== undefined) {
    where.push(lte(inspections.startedAt, new Date(filter.dateTo)));
  }
  if (!(filter?.includeArchived ?? false)) {
    where.push(isNull(inspections.archivedAt));
  }
  if (input.ids !== undefined && input.ids.length > 0) {
    where.push(inArray(inspections.id, input.ids));
  }

  const rows = await db
    .select({
      id: inspections.id,
      title: inspections.title,
      documentNumber: inspections.documentNumber,
      status: inspections.status,
      score: inspections.score,
      startedAt: inspections.startedAt,
      submittedAt: inspections.submittedAt,
      completedAt: inspections.completedAt,
      conductedBy: inspections.conductedBy,
      templateName: templates.name,
      templateVersionNumber: templateVersions.versionNumber,
      siteName: sites.name,
    })
    .from(inspections)
    .leftJoin(templates, eq(templates.id, inspections.templateId))
    .leftJoin(templateVersions, eq(templateVersions.id, inspections.templateVersionId))
    .leftJoin(sites, eq(sites.id, inspections.siteId))
    .where(and(...where))
    .orderBy(desc(inspections.startedAt))
    .limit(INSPECTIONS_EXPORT_MAX_ROWS);

  // Second pass: resolve conductedBy user id → display name. We do this in
  // one batched query to avoid N+1. Missing users (deleted/anonymised) are
  // rendered as the raw id so the CSV stays deterministic.
  const conductedByIds = Array.from(
    new Set(rows.map((r) => r.conductedBy).filter((id): id is string => id !== null)),
  );
  const userNameById = new Map<string, string>();
  if (conductedByIds.length > 0) {
    const userRows = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, conductedByIds));
    for (const u of userRows) userNameById.set(u.id, u.name);
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    documentNumber: r.documentNumber,
    status: r.status,
    templateName: r.templateName,
    templateVersionNumber: r.templateVersionNumber,
    conductedByName: r.conductedBy === null ? null : (userNameById.get(r.conductedBy) ?? r.conductedBy),
    siteName: r.siteName,
    startedAt: r.startedAt,
    submittedAt: r.submittedAt,
    completedAt: r.completedAt,
    score: r.score,
  }));
}

/**
 * Build the tenant-scoped R2 key for an inspections export. Uses a
 * timestamped filename + a fresh ULID as the "entity id" required by the
 * shared key convention (`<tenantId>/<module>/<entityId>/<filename>`).
 */
export function inspectionsExportKey(tenantId: string, now: Date): string {
  const ts = now.toISOString().replace(/[:.]/g, '-');
  const entityId = newId();
  const filename = `inspections-${ts}.csv`;
  return `${tenantId}/inspections/${entityId}/${filename}`;
}

export function createInspectionsExportRouter(deps: InspectionsExportDeps) {
  return router({
    exportCsv: tenantProcedure
      .use(requirePermission('inspections.export'))
      .input(exportInput)
      .mutation(async ({ ctx, input }) => {
        const rows = await queryCsvRows(ctx.db, ctx.tenantId, input);
        const csv = buildCsv(rows);
        ctx.logger.info(
          { rowCount: rows.length, bytes: csv.length },
          '[inspections] exportCsv',
        );
        return { csv, rowCount: rows.length };
      }),

    exportCsvUrl: tenantProcedure
      .use(requirePermission('inspections.export'))
      .input(exportInput)
      .mutation(async ({ ctx, input }) => {
        const rows = await queryCsvRows(ctx.db, ctx.tenantId, input);
        const csv = buildCsv(rows);
        const key = inspectionsExportKey(ctx.tenantId, deps.now());
        const { url } = await deps.uploadCsv({ key, body: csv });
        ctx.logger.info(
          { rowCount: rows.length, key },
          '[inspections] exportCsvUrl',
        );
        return { key, url, rowCount: rows.length };
      }),

    archiveMany: tenantProcedure
      .use(requirePermission('inspections.manage'))
      .input(archiveManyInput)
      .mutation(async ({ ctx, input }) => {
        const now = deps.now();
        const updated = await ctx.db
          .update(inspections)
          .set({ archivedAt: now, updatedAt: now })
          .where(
            and(
              eq(inspections.tenantId, ctx.tenantId),
              inArray(inspections.id, input.ids),
              isNull(inspections.archivedAt),
            ),
          )
          .returning({ id: inspections.id });
        if (updated.length === 0) {
          // No matching rows — either wrong tenant or all already archived.
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        ctx.logger.info({ count: updated.length }, '[inspections] archiveMany');
        return { count: updated.length };
      }),
  });
}

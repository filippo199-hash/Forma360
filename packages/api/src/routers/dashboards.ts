/**
 * Dashboards router — AI-built custom dashboards (ADR 0018).
 *
 * The paid counterpart of the fixed /analytics overview: saved,
 * versioned-spec dashboards composed by the AI builder, rendered by the
 * web app and the PDF route, delivered on schedules.
 *
 * Authorisation model (edge cases DH-E11..E19 in dashboards.test.ts):
 *   - Every procedure is gated by the `customDashboards` entitlement
 *     (PAYMENT_REQUIRED on the free plan — rows survive a downgrade).
 *   - `analytics.view` reads, `analytics.create` creates,
 *     `analytics.manage` manages other people's dashboards,
 *     `analytics.schedules.manage` configures PDF delivery. All four
 *     keys were forward-declared in Phase 1; this router is the first
 *     consumer of the latter three.
 *   - A non-owner sees a dashboard only when it is PUBLISHED and either
 *     tenant-visible or shared with them. Drafts are the owner's (and
 *     managers') private workspace.
 *   - Widget DATA is additionally gated per source on the VIEWER's
 *     permissions — a tenant-visible dashboard must not leak incident
 *     counts to someone who cannot open the incidents register. Refused
 *     widgets return a marker, not a hole in the response.
 */
import {
  dashboardSchedules,
  dashboardShares,
  dashboards,
  aiConversations,
  user,
} from '@forma360/db/schema';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { registerDependentResolver } from '@forma360/permissions/dependents';
import {
  dashboardDateRangeSchema,
  parseDashboardSpec,
  type DashboardSpec,
} from '@forma360/shared/dashboard-spec';
import {
  DASHBOARD_SOURCES,
  availableDashboardSources,
  type DashboardSourceId,
} from '@forma360/shared/dashboard-sources';
import { newId } from '@forma360/shared/id';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { RRule, rrulestr } from 'rrule';
import { z } from 'zod';
import type { Context } from '../context';
import {
  requireEntitlement,
  requirePermission,
  tenantProcedure,
} from '../procedures';
import { router, TRPCError } from '../trpc';
import {
  executeWidget,
  resolveDateRange,
  type GlobalFilters,
  type WidgetData,
} from '../dashboards/executor';

const ulid = z.string().length(26);

export const MAX_DASHBOARD_RECIPIENTS = 20;
export const MAX_SCHEDULES_PER_DASHBOARD = 5;

export interface DashboardsRouterDeps {
  /** Brand-gated module flags — same source of truth as the module routers. */
  modules: {
    riskAssessments: boolean;
    coshh: boolean;
    permits: boolean;
    fireSafety: boolean;
    incidents: boolean;
    rams: boolean;
    training: boolean;
  };
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /**
   * Dashboard → PDF via the shared Puppeteer pipeline in
   * `@forma360/render`. Optional: absent in non-web callers — the
   * `renderPdf` procedure refuses when unwired (PRECONDITION_FAILED
   * 'render-not-wired', the exports-router convention) rather than
   * half-rendering. Production wiring lives in
   * `apps/web/src/server/dashboards-deps.ts`.
   */
  renderPdf?: (input: {
    tenantId: string;
    dashboardId: string;
  }) => Promise<{ key: string; bytes: number; stub: boolean }>;
}

// ─── Dependents (cascade preview) ───────────────────────────────────────────

// The dashboards surface is the analytics module — register under that key.
registerDependentResolver('analytics', async ({ db }, { entity, id, tenantId }) => {
  if (entity !== 'dashboard') return 0;
  const rows = await db
    .select({ n: count() })
    .from(dashboardSchedules)
    .where(and(eq(dashboardSchedules.tenantId, tenantId), eq(dashboardSchedules.dashboardId, id)));
  return rows[0]?.n ?? 0;
});

// ─── Shared helpers ─────────────────────────────────────────────────────────

type Ctx = Context & {
  auth: NonNullable<Context['auth']>;
  tenantId: string;
  permissions: readonly string[];
};

function canManage(row: { ownerUserId: string }, ctx: Ctx): boolean {
  return (
    row.ownerUserId === ctx.auth.userId ||
    ctx.permissions.includes('analytics.manage') ||
    grantsAdminAccess(ctx.permissions)
  );
}

async function loadDashboard(ctx: Ctx, id: string) {
  const rows = await ctx.db
    .select()
    .from(dashboards)
    .where(and(eq(dashboards.tenantId, ctx.tenantId), eq(dashboards.id, id)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Dashboard not found' });
  }
  return row;
}

async function assertCanView(ctx: Ctx, row: typeof dashboards.$inferSelect): Promise<void> {
  if (canManage(row, ctx)) return;
  if (row.status !== 'published') {
    // NOT_FOUND, not FORBIDDEN — drafts don't exist for non-owners.
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Dashboard not found' });
  }
  if (row.visibility === 'tenant') return;
  if (row.visibility === 'selected') {
    const share = await ctx.db
      .select({ id: dashboardShares.id })
      .from(dashboardShares)
      .where(
        and(
          eq(dashboardShares.dashboardId, row.id),
          eq(dashboardShares.userId, ctx.auth.userId),
        ),
      )
      .limit(1);
    if (share[0] !== undefined) return;
  }
  throw new TRPCError({ code: 'NOT_FOUND', message: 'Dashboard not found' });
}

function assertManages(ctx: Ctx, row: typeof dashboards.$inferSelect): void {
  if (!canManage(row, ctx)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the dashboard owner' });
  }
}

/** BAD_REQUEST carrying every spec error — fed back to the AI correction loop. */
function parseSpecOrThrow(value: unknown): DashboardSpec {
  const parsed = parseDashboardSpec(value);
  if (!parsed.ok) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid dashboard spec: ${parsed.errors.join('; ')}`,
    });
  }
  return parsed.spec;
}

function validateRrule(rrule: string): string | null {
  try {
    const parsed = rrulestr(rrule, { dtstart: new Date() });
    if (parsed instanceof RRule) {
      if (parsed.options.freq === undefined || parsed.options.freq === null) {
        return 'RRULE must include a FREQ (e.g. FREQ=WEEKLY)';
      }
      // Same floor as template schedules: sub-hourly cadences starve the
      // shared worker and are never a legitimate report cadence.
      if (parsed.options.freq >= RRule.MINUTELY) {
        return 'RRULE frequency too high — the minimum interval is hourly';
      }
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid RRULE';
  }
}

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown timezone: ${timezone}` });
  }
}

const recipientsSchema = z
  .array(z.string().trim().toLowerCase().email().max(320))
  .min(1)
  .max(MAX_DASHBOARD_RECIPIENTS)
  .transform((emails) => [...new Set(emails)]);

/** Filesystem-friendly stem for the downloaded PDF, from the title. */
function pdfFilenameStem(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug.length > 0 ? slug : 'dashboard';
}

// ─── Router ─────────────────────────────────────────────────────────────────

export function createDashboardsRouter(deps: DashboardsRouterDeps) {
  const now = (): Date => deps.now?.() ?? new Date();

  const enabledBrandModules = () =>
    (Object.entries(deps.modules) as Array<[keyof DashboardsRouterDeps['modules'], boolean]>)
      .filter(([, enabled]) => enabled)
      .map(([mod]) => mod);

  /** 'ok' | why this viewer may not see this source's numbers. */
  function sourceAccess(
    sourceId: DashboardSourceId,
    permissions: readonly string[],
  ): 'ok' | 'module-disabled' | 'forbidden' {
    const source = DASHBOARD_SOURCES[sourceId];
    if (source.brandModule && !deps.modules[source.brandModule]) return 'module-disabled';
    if (grantsAdminAccess(permissions)) return 'ok';
    return permissions.includes(source.permission) ? 'ok' : 'forbidden';
  }

  /** Refuse specs referencing sources the AUTHOR cannot use (DH-E14b). */
  function assertSpecSourcesAvailable(spec: DashboardSpec, permissions: readonly string[]): void {
    const bad = new Set<string>();
    for (const widget of spec.widgets) {
      if (sourceAccess(widget.source as DashboardSourceId, permissions) !== 'ok') {
        bad.add(widget.source);
      }
    }
    if (bad.size > 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Sources not available: ${[...bad].join(', ')}`,
      });
    }
  }

  const entitled = tenantProcedure.use(requireEntitlement('customDashboards'));

  // ─── Reads ────────────────────────────────────────────────────────────

  const list = entitled.use(requirePermission('analytics.view')).query(async ({ ctx }) => {
    const [rows, myShares] = await Promise.all([
      ctx.db
        .select()
        .from(dashboards)
        .where(eq(dashboards.tenantId, ctx.tenantId))
        .orderBy(desc(dashboards.updatedAt)),
      ctx.db
        .select({ dashboardId: dashboardShares.dashboardId })
        .from(dashboardShares)
        .where(
          and(
            eq(dashboardShares.tenantId, ctx.tenantId),
            eq(dashboardShares.userId, ctx.auth.userId),
          ),
        ),
    ]);
    const sharedWithMe = new Set(myShares.map((s) => s.dashboardId));
    const manager =
      ctx.permissions.includes('analytics.manage') || grantsAdminAccess(ctx.permissions);
    const visible = rows.filter((row) => {
      if (manager || row.ownerUserId === ctx.auth.userId) return true;
      if (row.status !== 'published') return false;
      return row.visibility === 'tenant' || sharedWithMe.has(row.id);
    });

    const ownerIds = [...new Set(visible.map((r) => r.ownerUserId))];
    const owners =
      ownerIds.length === 0
        ? []
        : await ctx.db
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(and(eq(user.tenantId, ctx.tenantId), inArray(user.id, ownerIds)));
    const ownerName = new Map(owners.map((o) => [o.id, o.name]));

    return visible.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      visibility: row.visibility,
      ownerUserId: row.ownerUserId,
      ownerName: ownerName.get(row.ownerUserId) ?? null,
      isMine: row.ownerUserId === ctx.auth.userId,
      // Cheap structural peek for the card — full validation happens on get.
      widgetCount: Array.isArray((row.spec as { widgets?: unknown[] } | null)?.widgets)
        ? ((row.spec as { widgets: unknown[] }).widgets.length)
        : 0,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    }));
  });

  const get = entitled
    .use(requirePermission('analytics.view'))
    .input(z.object({ id: ulid }))
    .query(async ({ ctx, input }) => {
      const row = await loadDashboard(ctx as Ctx, input.id);
      await assertCanView(ctx as Ctx, row);
      const parsed = parseDashboardSpec(row.spec);
      const manages = canManage(row, ctx as Ctx);
      const shares = manages
        ? await ctx.db
            .select({ userId: dashboardShares.userId, name: user.name })
            .from(dashboardShares)
            .leftJoin(user, eq(user.id, dashboardShares.userId))
            .where(eq(dashboardShares.dashboardId, row.id))
        : [];
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        visibility: row.visibility,
        ownerUserId: row.ownerUserId,
        conversationId: row.conversationId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        spec: parsed.ok ? parsed.spec : null,
        specErrors: parsed.ok ? [] : parsed.errors,
        canEdit: manages,
        canSchedule:
          manages &&
          (ctx.permissions.includes('analytics.schedules.manage') ||
            grantsAdminAccess(ctx.permissions)),
        shares,
      };
    });

  const availableSources = entitled
    .use(requirePermission('analytics.view'))
    .query(({ ctx }) =>
      availableDashboardSources({
        brandModules: enabledBrandModules(),
        permissions: ctx.permissions,
        grantsAdmin: grantsAdminAccess(ctx.permissions),
      }),
    );

  // ─── Widget data ──────────────────────────────────────────────────────

  const viewFiltersSchema = z
    .object({
      dateRange: dashboardDateRangeSchema.optional(),
      siteIds: z.array(ulid).max(50).optional(),
    })
    .optional();

  async function runWidgets(
    ctx: Ctx,
    row: typeof dashboards.$inferSelect,
    overrides: z.infer<typeof viewFiltersSchema>,
    onlyWidgetId?: string,
  ) {
    const parsed = parseDashboardSpec(row.spec);
    if (!parsed.ok) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'spec-invalid' });
    }
    const spec = parsed.spec;
    const filters: GlobalFilters = {
      dateRange: overrides?.dateRange ?? spec.filterDefaults.dateRange,
      siteIds: overrides?.siteIds ?? spec.filterDefaults.siteIds,
    };
    const at = now();
    const widgets = onlyWidgetId
      ? spec.widgets.filter((w) => w.id === onlyWidgetId)
      : spec.widgets;
    if (onlyWidgetId && widgets.length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Widget not found' });
    }

    const results: Record<
      string,
      WidgetData | { error: 'forbidden' | 'module-disabled' | 'failed' }
    > = {};
    await Promise.all(
      widgets.map(async (widget) => {
        const access = sourceAccess(widget.source as DashboardSourceId, ctx.permissions);
        if (access !== 'ok') {
          results[widget.id] = { error: access };
          return;
        }
        try {
          results[widget.id] = await executeWidget({
            db: ctx.db,
            tenantId: ctx.tenantId,
            widget,
            filters,
            now: at,
          });
        } catch (err) {
          // One bad widget must not blank the whole dashboard.
          ctx.logger.warn(
            { widgetId: widget.id, source: widget.source, err: String(err) },
            'dashboard widget failed',
          );
          results[widget.id] = { error: 'failed' };
        }
      }),
    );

    const range = resolveDateRange(filters.dateRange, at);
    return {
      widgets: results,
      applied: {
        dateRange: filters.dateRange,
        siteIds: filters.siteIds,
        range: { from: range.from.toISOString(), to: range.to.toISOString() },
      },
    };
  }

  const data = entitled
    .use(requirePermission('analytics.view'))
    .input(z.object({ id: ulid, filters: viewFiltersSchema }))
    .query(async ({ ctx, input }) => {
      const row = await loadDashboard(ctx as Ctx, input.id);
      await assertCanView(ctx as Ctx, row);
      return runWidgets(ctx as Ctx, row, input.filters);
    });

  const widgetData = entitled
    .use(requirePermission('analytics.view'))
    .input(z.object({ id: ulid, widgetId: z.string().min(1).max(40), filters: viewFiltersSchema }))
    .query(async ({ ctx, input }) => {
      const row = await loadDashboard(ctx as Ctx, input.id);
      await assertCanView(ctx as Ctx, row);
      const result = await runWidgets(ctx as Ctx, row, input.filters, input.widgetId);
      const widget = result.widgets[input.widgetId];
      if (widget && 'error' in widget) {
        throw new TRPCError({ code: 'FORBIDDEN', message: widget.error });
      }
      return { data: widget as WidgetData, applied: result.applied, title: row.title };
    });

  // ─── PDF export ───────────────────────────────────────────────────────

  /**
   * Render (or refresh) the dashboard PDF in R2 and return its storage
   * key; the download route 302s to a short-lived signed URL. Same
   * access gate as viewing: entitlement + analytics.view + the
   * assertCanView visibility matrix — the PDF is the dashboard, worn as
   * a file.
   */
  const renderPdf = entitled
    .use(requirePermission('analytics.view'))
    .input(z.object({ id: ulid }))
    .mutation(async ({ ctx, input }) => {
      if (deps.renderPdf === undefined) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'render-not-wired' });
      }
      const row = await loadDashboard(ctx as Ctx, input.id);
      await assertCanView(ctx as Ctx, row);
      const rendered = await deps.renderPdf({ tenantId: ctx.tenantId, dashboardId: row.id });
      return {
        storageKey: rendered.key,
        filename: `${pdfFilenameStem(row.title)}.pdf`,
        sizeBytes: rendered.bytes,
        stub: rendered.stub,
      };
    });

  // ─── Mutations ────────────────────────────────────────────────────────

  const create = entitled
    .use(requirePermission('analytics.create'))
    .input(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        spec: z.unknown(),
        conversationId: ulid.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const spec = parseSpecOrThrow(input.spec);
      assertSpecSourcesAvailable(spec, ctx.permissions);
      if (input.conversationId !== undefined) {
        const convo = await ctx.db
          .select({ id: aiConversations.id })
          .from(aiConversations)
          .where(
            and(
              eq(aiConversations.id, input.conversationId),
              eq(aiConversations.tenantId, ctx.tenantId),
              eq(aiConversations.userId, ctx.auth.userId),
            ),
          )
          .limit(1);
        if (convo[0] === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Conversation not found' });
        }
      }
      const id = newId();
      const at = now();
      await ctx.db.insert(dashboards).values({
        id,
        tenantId: ctx.tenantId,
        ownerUserId: ctx.auth.userId,
        title: input.title,
        description: input.description ?? null,
        spec,
        status: 'draft',
        visibility: 'private',
        conversationId: input.conversationId ?? null,
        createdAt: at,
        updatedAt: at,
      });
      return { id };
    });

  const update = entitled
    .use(requirePermission('analytics.view'))
    .input(
      z.object({
        id: ulid,
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await loadDashboard(ctx as Ctx, input.id);
      assertManages(ctx as Ctx, row);
      await ctx.db
        .update(dashboards)
        .set({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedAt: now(),
        })
        .where(eq(dashboards.id, row.id));
      return { ok: true };
    });

  const updateSpec = entitled
    .use(requirePermission('analytics.view'))
    .input(
      z.object({
        id: ulid,
        spec: z.unknown(),
        /** Optimistic concurrency (T-E18 pattern): refuse a stale save. */
        expectedUpdatedAt: z.date(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await loadDashboard(ctx as Ctx, input.id);
      assertManages(ctx as Ctx, row);
      if (row.status === 'archived') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
      }
      if (row.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Dashboard changed since last read' });
      }
      const spec = parseSpecOrThrow(input.spec);
      assertSpecSourcesAvailable(spec, ctx.permissions);
      const at = now();
      await ctx.db
        .update(dashboards)
        .set({ spec, updatedAt: at })
        .where(eq(dashboards.id, row.id));
      return { updatedAt: at };
    });

  const setStatus = entitled
    .use(requirePermission('analytics.view'))
    .input(z.object({ id: ulid, status: z.enum(['draft', 'published']) }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadDashboard(ctx as Ctx, input.id);
      assertManages(ctx as Ctx, row);
      if (row.status === 'archived') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
      }
      await ctx.db
        .update(dashboards)
        .set({ status: input.status, updatedAt: now() })
        .where(eq(dashboards.id, row.id));
      return { ok: true };
    });

  const archive = entitled
    .use(requirePermission('analytics.view'))
    .input(z.object({ id: ulid }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadDashboard(ctx as Ctx, input.id);
      assertManages(ctx as Ctx, row);
      const at = now();
      // T-E05 pattern: archive and pause delivery in ONE transaction so a
      // tick between the two writes cannot email an archived dashboard.
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(dashboards)
          .set({ status: 'archived', archivedAt: at, updatedAt: at })
          .where(eq(dashboards.id, row.id));
        await tx
          .update(dashboardSchedules)
          .set({ paused: true, updatedAt: at })
          .where(eq(dashboardSchedules.dashboardId, row.id));
      });
      return { ok: true };
    });

  const restore = entitled
    .use(requirePermission('analytics.view'))
    .input(z.object({ id: ulid }))
    .mutation(async ({ ctx, input }) => {
      const row = await loadDashboard(ctx as Ctx, input.id);
      assertManages(ctx as Ctx, row);
      if (row.status !== 'archived') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'not-archived' });
      }
      // Schedules stay paused — resuming delivery is an explicit choice.
      await ctx.db
        .update(dashboards)
        .set({ status: 'draft', archivedAt: null, updatedAt: now() })
        .where(eq(dashboards.id, row.id));
      return { ok: true };
    });

  const setVisibility = entitled
    .use(requirePermission('analytics.view'))
    .input(
      z.object({
        id: ulid,
        visibility: z.enum(['private', 'selected', 'tenant']),
        /** Required when visibility is 'selected'. */
        userIds: z.array(z.string().min(1)).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await loadDashboard(ctx as Ctx, input.id);
      assertManages(ctx as Ctx, row);
      const at = now();
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(dashboards)
          .set({ visibility: input.visibility, updatedAt: at })
          .where(eq(dashboards.id, row.id));
        if (input.visibility === 'selected') {
          const userIds = [...new Set(input.userIds ?? [])].filter(
            (id) => id !== row.ownerUserId,
          );
          if (userIds.length === 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'Select at least one user to share with',
            });
          }
          const tenantUsers = await tx
            .select({ id: user.id })
            .from(user)
            .where(and(eq(user.tenantId, ctx.tenantId), inArray(user.id, userIds)));
          if (tenantUsers.length !== userIds.length) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown user in share list' });
          }
          await tx.delete(dashboardShares).where(eq(dashboardShares.dashboardId, row.id));
          await tx.insert(dashboardShares).values(
            userIds.map((userId) => ({
              id: newId(),
              tenantId: ctx.tenantId,
              dashboardId: row.id,
              userId,
              createdAt: at,
            })),
          );
        }
        // Shares for other visibilities are left in place on purpose —
        // flipping back to 'selected' restores the previous list.
      });
      return { ok: true };
    });

  // ─── Schedules (PDF delivery) ─────────────────────────────────────────

  const scheduleGuard = entitled.use(requirePermission('analytics.schedules.manage'));

  const listSchedules = entitled
    .use(requirePermission('analytics.view'))
    .input(z.object({ dashboardId: ulid }))
    .query(async ({ ctx, input }) => {
      const row = await loadDashboard(ctx as Ctx, input.dashboardId);
      assertManages(ctx as Ctx, row);
      return ctx.db
        .select()
        .from(dashboardSchedules)
        .where(eq(dashboardSchedules.dashboardId, row.id))
        .orderBy(desc(dashboardSchedules.createdAt));
    });

  const scheduleInput = z.object({
    dashboardId: ulid,
    rrule: z.string().min(1).max(500),
    timezone: z.string().min(1).max(100).default('UTC'),
    startAt: z.date(),
    endAt: z.date().optional(),
    recipients: recipientsSchema,
  });

  const createSchedule = scheduleGuard.input(scheduleInput).mutation(async ({ ctx, input }) => {
    const row = await loadDashboard(ctx as Ctx, input.dashboardId);
    assertManages(ctx as Ctx, row);
    if (row.status === 'archived') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
    }
    const rruleError = validateRrule(input.rrule);
    if (rruleError !== null) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid RRULE: ${rruleError}` });
    }
    assertValidTimezone(input.timezone);
    if (input.endAt !== undefined && input.endAt.getTime() <= input.startAt.getTime()) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'endAt must be after startAt' });
    }
    const existing = await ctx.db
      .select({ n: count() })
      .from(dashboardSchedules)
      .where(eq(dashboardSchedules.dashboardId, row.id));
    if ((existing[0]?.n ?? 0) >= MAX_SCHEDULES_PER_DASHBOARD) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `A dashboard can have at most ${MAX_SCHEDULES_PER_DASHBOARD} schedules`,
      });
    }
    const id = newId();
    const at = now();
    await ctx.db.insert(dashboardSchedules).values({
      id,
      tenantId: ctx.tenantId,
      dashboardId: row.id,
      rrule: input.rrule,
      timezone: input.timezone,
      startAt: input.startAt,
      endAt: input.endAt ?? null,
      recipients: input.recipients,
      paused: false,
      createdBy: ctx.auth.userId,
      createdAt: at,
      updatedAt: at,
    });
    // Accountability: tenant data will leave the platform — log who sends
    // what to whom (ADR 0018; recipients are the point, not incidental).
    ctx.logger.info(
      {
        dashboardId: row.id,
        scheduleId: id,
        recipientCount: input.recipients.length,
        createdBy: ctx.auth.userId,
      },
      'dashboard schedule created',
    );
    return { id };
  });

  const updateSchedule = scheduleGuard
    .input(
      z.object({
        id: ulid,
        rrule: z.string().min(1).max(500).optional(),
        timezone: z.string().min(1).max(100).optional(),
        startAt: z.date().optional(),
        endAt: z.date().nullable().optional(),
        recipients: recipientsSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(dashboardSchedules)
        .where(
          and(eq(dashboardSchedules.tenantId, ctx.tenantId), eq(dashboardSchedules.id, input.id)),
        )
        .limit(1);
      const schedule = rows[0];
      if (schedule === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }
      const dashboard = await loadDashboard(ctx as Ctx, schedule.dashboardId);
      assertManages(ctx as Ctx, dashboard);
      if (input.rrule !== undefined) {
        const rruleError = validateRrule(input.rrule);
        if (rruleError !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid RRULE: ${rruleError}` });
        }
      }
      if (input.timezone !== undefined) assertValidTimezone(input.timezone);
      await ctx.db
        .update(dashboardSchedules)
        .set({
          ...(input.rrule !== undefined ? { rrule: input.rrule } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
          ...(input.endAt !== undefined ? { endAt: input.endAt } : {}),
          ...(input.recipients !== undefined ? { recipients: input.recipients } : {}),
          updatedAt: now(),
        })
        .where(eq(dashboardSchedules.id, schedule.id));
      return { ok: true };
    });

  const setSchedulePaused = scheduleGuard
    .input(z.object({ id: ulid, paused: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(dashboardSchedules)
        .where(
          and(eq(dashboardSchedules.tenantId, ctx.tenantId), eq(dashboardSchedules.id, input.id)),
        )
        .limit(1);
      const schedule = rows[0];
      if (schedule === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }
      const dashboard = await loadDashboard(ctx as Ctx, schedule.dashboardId);
      assertManages(ctx as Ctx, dashboard);
      if (!input.paused && dashboard.status === 'archived') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'archived' });
      }
      await ctx.db
        .update(dashboardSchedules)
        .set({ paused: input.paused, updatedAt: now() })
        .where(eq(dashboardSchedules.id, schedule.id));
      return { ok: true };
    });

  const deleteSchedule = scheduleGuard
    .input(z.object({ id: ulid }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(dashboardSchedules)
        .where(
          and(eq(dashboardSchedules.tenantId, ctx.tenantId), eq(dashboardSchedules.id, input.id)),
        )
        .limit(1);
      const schedule = rows[0];
      if (schedule === undefined) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Schedule not found' });
      }
      const dashboard = await loadDashboard(ctx as Ctx, schedule.dashboardId);
      assertManages(ctx as Ctx, dashboard);
      await ctx.db.delete(dashboardSchedules).where(eq(dashboardSchedules.id, schedule.id));
      return { ok: true };
    });

  return router({
    list,
    get,
    availableSources,
    data,
    widgetData,
    renderPdf,
    create,
    update,
    updateSpec,
    setStatus,
    archive,
    restore,
    setVisibility,
    listSchedules,
    createSchedule,
    updateSchedule,
    setSchedulePaused,
    deleteSchedule,
  });
}

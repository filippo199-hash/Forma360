/**
 * Actions router — Phase 4 build.
 *
 * Phase 2 PR 28 landed a stub with just `createFromInspectionQuestion`
 * (idempotent on `sourceItemId`) plus a basic `list`. PR-5 (Observations
 * polish) added `createFromIssue` for ad-hoc actions raised from an
 * observation. This file is the full Phase 4 surface: standalone create,
 * full CRUD on the detail row, status transitions, activity log,
 * comments, archive / restore, and a filterable list.
 *
 * Custom action types, custom statuses, recurring actions, merge, and
 * action-type → template linking are explicitly out of scope here —
 * they'll land in a Phase 4 follow-on once the MVP is on prod.
 */
import { inspections, issues, user } from '@forma360/db/schema';
import {
  actionActivity,
  actionComments,
  actionPriority,
  actionStatus,
  actions,
  type Action,
  type ActionActivityKind,
} from '@forma360/db/schema';
import { type DependentResolverDeps } from '@forma360/permissions';
import { newId } from '@forma360/shared/id';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, ilike, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, tenantProcedure } from '../procedures';
import { router } from '../trpc';

type Db = DependentResolverDeps['db'];

const actionIdInput = z.object({ actionId: z.string().length(26) });

const ACTION_LIST_LIMIT = 100;

/**
 * Render an "AC-000042"-style reference number. Counts every action ever
 * created in the tenant and adds one — same trade-off as issues
 * (display value, gaps are acceptable).
 */
async function nextActionReferenceNumber(db: Db, tenantId: string): Promise<string> {
  const totalRows = await db
    .select({ c: count() })
    .from(actions)
    .where(eq(actions.tenantId, tenantId));
  const next = (totalRows[0]?.c ?? 0) + 1;
  return `AC-${next.toString().padStart(6, '0')}`;
}

async function loadActionOrThrow(db: Db, tenantId: string, actionId: string): Promise<Action> {
  const rows = await db
    .select()
    .from(actions)
    .where(and(eq(actions.tenantId, tenantId), eq(actions.id, actionId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'action-not-found' });
  }
  return row;
}

async function writeActivity(
  db: Db,
  args: {
    tenantId: string;
    actionId: string;
    actorUserId: string;
    kind: ActionActivityKind;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(actionActivity).values({
    id: newId(),
    tenantId: args.tenantId,
    actionId: args.actionId,
    actorUserId: args.actorUserId,
    kind: args.kind,
    payload: args.payload ?? {},
  });
}

function isUniqueViolation(err: unknown): boolean {
  const visit = (e: unknown): boolean => {
    if (typeof e !== 'object' || e === null) return false;
    const record = e as Record<string, unknown>;
    if (record.code === '23505') return true;
    const message = typeof record.message === 'string' ? record.message : '';
    if (/duplicate key|unique constraint|unique violation|UNIQUE/i.test(message)) return true;
    if ('cause' in record) return visit(record.cause);
    return false;
  };
  return visit(err);
}

const priorityEnum = z.enum(actionPriority);
const statusEnum = z.enum(actionStatus);

const listInput = z
  .object({
    status: statusEnum.optional(),
    sourceType: z.enum(['inspection', 'issue', 'standalone']).optional(),
    sourceId: z.string().length(26).optional(),
    /**
     * Server-resolved "assigned to me" filter — flips to `ctx.auth.userId`
     * inside the resolver so the client never has to know its own id.
     */
    assignedToMe: z.boolean().default(false),
    assigneeUserId: z.string().optional(),
    siteId: z.string().length(26).optional(),
    priority: priorityEnum.optional(),
    /** Case-insensitive search on `title`. Server uses ILIKE. */
    query: z.string().max(200).optional(),
    /**
     * When true: only rows whose due_at has passed and which aren't in
     * `completed` / `cancelled`. SafetyCulture parity for the "Overdue"
     * chip in the toolbar.
     */
    overdueOnly: z.boolean().default(false),
    includeArchived: z.boolean().default(false),
    /**
     * When true, the list omits `completed` and `cancelled` rows.
     * Matches SafetyCulture's "Hide closed" toggle.
     */
    hideClosed: z.boolean().default(false),
    /**
     * Sort options. `created` (desc, default) is the most useful for a
     * triaged inbox; `due` (asc) for "what's next"; `priority` (high → low)
     * for a workload view; `updated` (desc) for catching up after time off.
     */
    sortBy: z.enum(['created', 'due', 'priority', 'updated']).default('created'),
    /** Caller-bounded; default sorts by createdAt desc. */
    limit: z.number().int().min(1).max(ACTION_LIST_LIMIT).default(ACTION_LIST_LIMIT),
  })
  .default({
    assignedToMe: false,
    overdueOnly: false,
    includeArchived: false,
    hideClosed: false,
    sortBy: 'created',
    limit: ACTION_LIST_LIMIT,
  });

const createStandaloneInput = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(20_000).optional(),
  priority: priorityEnum.optional(),
  assigneeUserId: z.string().optional(),
  dueAt: z.string().datetime().optional(),
  siteId: z.string().length(26).optional(),
  label: z.string().max(80).optional(),
});

const createFromInspectionQuestionInput = z.object({
  inspectionId: z.string().length(26),
  sourceItemId: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  description: z.string().max(20_000).optional(),
  priority: priorityEnum.optional(),
  assigneeUserId: z.string().optional(),
  dueAt: z.string().datetime().optional(),
  siteId: z.string().length(26).optional(),
  label: z.string().max(80).optional(),
});

const createFromIssueInput = z.object({
  issueId: z.string().length(26),
  title: z.string().min(1).max(500),
  description: z.string().max(20_000).optional(),
  priority: priorityEnum.optional(),
  assigneeUserId: z.string().optional(),
  dueAt: z.string().datetime().optional(),
  siteId: z.string().length(26).optional(),
  label: z.string().max(80).optional(),
});

const updateInput = z.object({
  actionId: z.string().length(26),
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(20_000).nullable().optional(),
  priority: priorityEnum.nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  siteId: z.string().length(26).nullable().optional(),
  label: z.string().max(80).nullable().optional(),
});

const setStatusInput = z.object({
  actionId: z.string().length(26),
  status: statusEnum,
});

const createCommentInput = z.object({
  actionId: z.string().length(26),
  body: z.string().min(1).max(20_000),
});

const updateCommentInput = z.object({
  commentId: z.string().length(26),
  body: z.string().min(1).max(20_000),
});

const deleteCommentInput = z.object({
  commentId: z.string().length(26),
});

const listActivityInput = z.object({
  actionId: z.string().length(26),
  limit: z.number().int().min(1).max(200).default(100),
});

const listCommentsInput = z.object({
  actionId: z.string().length(26),
});

export const actionsRouter = router({
  list: tenantProcedure
    .use(requirePermission('actions.view'))
    .input(listInput)
    .query(async ({ ctx, input }) => {
      const where = [eq(actions.tenantId, ctx.tenantId)];
      if (input.status !== undefined) where.push(eq(actions.status, input.status));
      if (input.sourceType !== undefined) where.push(eq(actions.sourceType, input.sourceType));
      if (input.sourceId !== undefined) where.push(eq(actions.sourceId, input.sourceId));
      // "Assigned to me" is server-resolved against the caller's id so the
      // client doesn't need to know it. `assigneeUserId` (explicit) wins
      // if both are passed — useful for the future "filter by another
      // user" admin view.
      if (input.assigneeUserId !== undefined) {
        where.push(eq(actions.assigneeUserId, input.assigneeUserId));
      } else if (input.assignedToMe) {
        where.push(eq(actions.assigneeUserId, ctx.auth.userId));
      }
      if (input.siteId !== undefined) where.push(eq(actions.siteId, input.siteId));
      if (input.priority !== undefined) where.push(eq(actions.priority, input.priority));
      if (input.query !== undefined && input.query.trim().length > 0) {
        // Postgres ILIKE for case-insensitive prefix-anywhere match. Wrap
        // both sides in lower() not strictly needed for ILIKE but keeps
        // the SQL portable if we move off PG later.
        where.push(ilike(actions.title, `%${input.query.trim()}%`));
      }
      if (input.overdueOnly) {
        // Due in the past, not in a terminal status. Open / in_progress
        // both count as "still actionable".
        where.push(isNotNull(actions.dueAt));
        where.push(lt(actions.dueAt, new Date()));
        where.push(ne(actions.status, 'completed'));
        where.push(ne(actions.status, 'cancelled'));
      }
      if (!input.includeArchived) where.push(isNull(actions.archivedAt));
      if (input.hideClosed) {
        where.push(ne(actions.status, 'completed'));
        where.push(ne(actions.status, 'cancelled'));
      }

      // Sort order. Priority sort puts NULL last (NULLS LAST) so blank-
      // priority rows don't crowd the top. `CASE` maps the priority text
      // values to a numeric weight so the SQL is portable to other
      // backends; PG could use an enum here but actions.priority is `text`.
      const sortOrder = (() => {
        switch (input.sortBy) {
          case 'due':
            return [
              sql`${actions.dueAt} ASC NULLS LAST`,
              desc(actions.createdAt),
            ];
          case 'priority':
            return [
              sql`CASE ${actions.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC`,
              desc(actions.createdAt),
            ];
          case 'updated':
            return [desc(actions.updatedAt)];
          case 'created':
          default:
            return [desc(actions.createdAt)];
        }
      })();

      const rows = await ctx.db
        .select({
          id: actions.id,
          referenceNumber: actions.referenceNumber,
          title: actions.title,
          status: actions.status,
          priority: actions.priority,
          label: actions.label,
          assigneeUserId: actions.assigneeUserId,
          dueAt: actions.dueAt,
          siteId: actions.siteId,
          sourceType: actions.sourceType,
          sourceId: actions.sourceId,
          createdAt: actions.createdAt,
          updatedAt: actions.updatedAt,
          archivedAt: actions.archivedAt,
          assigneeName: user.name,
        })
        .from(actions)
        .leftJoin(user, eq(user.id, actions.assigneeUserId))
        .where(and(...where))
        .orderBy(...sortOrder)
        .limit(input.limit);
      return rows;
    }),

  get: tenantProcedure
    .use(requirePermission('actions.view'))
    .input(actionIdInput)
    .query(async ({ ctx, input }) => {
      const action = await loadActionOrThrow(ctx.db, ctx.tenantId, input.actionId);
      const assigneeRows =
        action.assigneeUserId !== null
          ? await ctx.db
              .select({ id: user.id, name: user.name, email: user.email })
              .from(user)
              .where(eq(user.id, action.assigneeUserId))
              .limit(1)
          : [];
      // Resolve the creator's display name so the detail page (notably
      // the synthetic-created-event fallback in the Activity timeline)
      // doesn't have to show the raw user id.
      const creatorRows = await ctx.db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, action.createdBy))
        .limit(1);
      // Resolve the linked source entity's display reference + title so
      // the source-link card on the detail page can render "Linked to
      // observation ISS-000002 — Wet floor near loading dock" instead
      // of the previous "Linked to observation 76X52B" (raw slice of the
      // internal id). Lazy: only fires when sourceId is set.
      let source: {
        type: 'issue' | 'inspection' | 'standalone';
        referenceNumber: string | null;
        title: string | null;
      } | null = null;
      if (action.sourceType === 'standalone' || action.sourceId === null) {
        source = { type: 'standalone', referenceNumber: null, title: null };
      } else if (action.sourceType === 'issue') {
        const rows = await ctx.db
          .select({ referenceNumber: issues.referenceNumber, title: issues.title })
          .from(issues)
          .where(and(eq(issues.tenantId, ctx.tenantId), eq(issues.id, action.sourceId)))
          .limit(1);
        const row = rows[0];
        source = {
          type: 'issue',
          referenceNumber: row?.referenceNumber ?? null,
          title: row?.title ?? null,
        };
      } else if (action.sourceType === 'inspection') {
        const rows = await ctx.db
          .select({ documentNumber: inspections.documentNumber, title: inspections.title })
          .from(inspections)
          .where(and(eq(inspections.tenantId, ctx.tenantId), eq(inspections.id, action.sourceId)))
          .limit(1);
        const row = rows[0];
        source = {
          type: 'inspection',
          referenceNumber: row?.documentNumber ?? null,
          title: row?.title ?? null,
        };
      }
      return {
        action,
        assignee: assigneeRows[0] ?? null,
        source,
        creatorName: creatorRows[0]?.name ?? null,
      };
    }),

  /**
   * Standalone create — no inspection / issue anchor. Picks a fresh
   * AC-NNNNNN reference number, writes a `created` activity row.
   */
  createStandalone: tenantProcedure
    .use(requirePermission('actions.create'))
    .input(createStandaloneInput)
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      const referenceNumber = await nextActionReferenceNumber(ctx.db, ctx.tenantId);
      const now = new Date();
      await ctx.db.insert(actions).values({
        id,
        tenantId: ctx.tenantId,
        sourceType: 'standalone',
        sourceId: null,
        sourceItemId: null,
        referenceNumber,
        title: input.title,
        description: input.description ?? null,
        status: 'open',
        priority: input.priority ?? null,
        label: input.label ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        dueAt: input.dueAt !== undefined ? new Date(input.dueAt) : null,
        siteId: input.siteId ?? null,
        createdBy: ctx.auth.userId,
        createdAt: now,
        updatedAt: now,
      });
      await writeActivity(ctx.db, {
        tenantId: ctx.tenantId,
        actionId: id,
        actorUserId: ctx.auth.userId,
        kind: 'created',
        payload: { sourceType: 'standalone' },
      });
      return { actionId: id, referenceNumber };
    }),

  /**
   * Inspection-question raised. Idempotent on
   * (sourceType=inspection, inspectionId, sourceItemId) — replays return
   * the existing row.
   */
  createFromInspectionQuestion: tenantProcedure
    .use(requirePermission('actions.create'))
    .input(createFromInspectionQuestionInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ id: actions.id })
        .from(actions)
        .where(
          and(
            eq(actions.tenantId, ctx.tenantId),
            eq(actions.sourceType, 'inspection'),
            eq(actions.sourceId, input.inspectionId),
            eq(actions.sourceItemId, input.sourceItemId),
          ),
        )
        .limit(1);
      if (existing[0] !== undefined) {
        return { actionId: existing[0].id, created: false as const };
      }

      const id = newId();
      const referenceNumber = await nextActionReferenceNumber(ctx.db, ctx.tenantId);
      const now = new Date();
      try {
        await ctx.db.insert(actions).values({
          id,
          tenantId: ctx.tenantId,
          sourceType: 'inspection',
          sourceId: input.inspectionId,
          sourceItemId: input.sourceItemId,
          referenceNumber,
          title: input.title,
          description: input.description ?? null,
          status: 'open',
          priority: input.priority ?? null,
          label: input.label ?? null,
          assigneeUserId: input.assigneeUserId ?? null,
          dueAt: input.dueAt !== undefined ? new Date(input.dueAt) : null,
          siteId: input.siteId ?? null,
          createdBy: ctx.auth.userId,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const race = await ctx.db
          .select({ id: actions.id })
          .from(actions)
          .where(
            and(
              eq(actions.tenantId, ctx.tenantId),
              eq(actions.sourceType, 'inspection'),
              eq(actions.sourceId, input.inspectionId),
              eq(actions.sourceItemId, input.sourceItemId),
            ),
          )
          .limit(1);
        if (race[0] === undefined) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Unique violation without a matching row',
          });
        }
        return { actionId: race[0].id, created: false as const };
      }
      await writeActivity(ctx.db, {
        tenantId: ctx.tenantId,
        actionId: id,
        actorUserId: ctx.auth.userId,
        kind: 'created',
        payload: { sourceType: 'inspection', sourceId: input.inspectionId },
      });
      return { actionId: id, referenceNumber, created: true as const };
    }),

  /**
   * Issue / Observation raised. No dedup — each call creates a row.
   */
  createFromIssue: tenantProcedure
    .use(requirePermission('actions.create'))
    .input(createFromIssueInput)
    .mutation(async ({ ctx, input }) => {
      const id = newId();
      const referenceNumber = await nextActionReferenceNumber(ctx.db, ctx.tenantId);
      const now = new Date();
      await ctx.db.insert(actions).values({
        id,
        tenantId: ctx.tenantId,
        sourceType: 'issue',
        sourceId: input.issueId,
        sourceItemId: null,
        referenceNumber,
        title: input.title,
        description: input.description ?? null,
        status: 'open',
        priority: input.priority ?? null,
        label: input.label ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        dueAt: input.dueAt !== undefined ? new Date(input.dueAt) : null,
        siteId: input.siteId ?? null,
        createdBy: ctx.auth.userId,
        createdAt: now,
        updatedAt: now,
      });
      await writeActivity(ctx.db, {
        tenantId: ctx.tenantId,
        actionId: id,
        actorUserId: ctx.auth.userId,
        kind: 'created',
        payload: { sourceType: 'issue', sourceId: input.issueId },
      });
      return { actionId: id, referenceNumber };
    }),

  /**
   * Generic field update — title / description / priority / due / label.
   * Writes one activity row per changed field. Mirrors the per-field
   * activity approach `issues.update` uses; the diff is calculated by
   * comparing the loaded row to the input.
   */
  update: tenantProcedure
    .use(requirePermission('actions.manage'))
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const action = await loadActionOrThrow(ctx.db, ctx.tenantId, input.actionId);
      const updates: Partial<typeof actions.$inferInsert> = { updatedAt: new Date() };
      const events: Array<{
        kind: ActionActivityKind;
        payload: Record<string, unknown>;
      }> = [];

      if (input.title !== undefined && input.title !== action.title) {
        updates.title = input.title;
        events.push({
          kind: 'title_changed',
          payload: { from: action.title, to: input.title },
        });
      }
      if (input.description !== undefined) {
        const next = input.description;
        if (next !== action.description) {
          updates.description = next;
          events.push({
            kind: 'description_changed',
            payload: { from: action.description, to: next },
          });
        }
      }
      if (input.priority !== undefined) {
        const next = input.priority;
        if (next !== action.priority) {
          updates.priority = next;
          events.push({
            kind: 'priority_changed',
            payload: { from: action.priority, to: next },
          });
        }
      }
      if (input.dueAt !== undefined) {
        const nextDate = input.dueAt === null ? null : new Date(input.dueAt);
        const prevMillis = action.dueAt === null ? null : action.dueAt.getTime();
        const nextMillis = nextDate === null ? null : nextDate.getTime();
        if (prevMillis !== nextMillis) {
          updates.dueAt = nextDate;
          events.push({
            kind: nextDate === null ? 'due_date_cleared' : 'due_date_changed',
            payload: {
              from: action.dueAt?.toISOString() ?? null,
              to: nextDate?.toISOString() ?? null,
            },
          });
        }
      }
      if (input.assigneeUserId !== undefined) {
        const next = input.assigneeUserId;
        if (next !== action.assigneeUserId) {
          updates.assigneeUserId = next;
          events.push({
            kind: next === null ? 'assignee_cleared' : 'assignee_changed',
            payload: { from: action.assigneeUserId, to: next },
          });
        }
      }
      if (input.siteId !== undefined) {
        const next = input.siteId;
        if (next !== action.siteId) {
          updates.siteId = next;
          events.push({
            kind: next === null ? 'site_cleared' : 'site_changed',
            payload: { from: action.siteId, to: next },
          });
        }
      }
      if (input.label !== undefined) {
        const next = input.label;
        if (next !== action.label) {
          updates.label = next;
          events.push({
            kind: 'label_changed',
            payload: { from: action.label, to: next },
          });
        }
      }

      if (events.length === 0) return { ok: true as const };

      await ctx.db.update(actions).set(updates).where(eq(actions.id, action.id));
      for (const ev of events) {
        await writeActivity(ctx.db, {
          tenantId: ctx.tenantId,
          actionId: action.id,
          actorUserId: ctx.auth.userId,
          kind: ev.kind,
          payload: ev.payload,
        });
      }
      return { ok: true as const };
    }),

  /**
   * Status transition. `completed` and `cancelled` are terminal — the
   * action stamps `closedAt` / `closedByUserId` and refuses further
   * status transitions until a manager explicitly moves it back.
   */
  setStatus: tenantProcedure
    .use(requirePermission('actions.manage'))
    .input(setStatusInput)
    .mutation(async ({ ctx, input }) => {
      const action = await loadActionOrThrow(ctx.db, ctx.tenantId, input.actionId);
      if (action.status === input.status) return { ok: true as const };

      const now = new Date();
      const wasTerminal = action.status === 'completed' || action.status === 'cancelled';
      const willBeTerminal = input.status === 'completed' || input.status === 'cancelled';

      const updates: Partial<typeof actions.$inferInsert> = {
        status: input.status,
        updatedAt: now,
      };

      if (willBeTerminal && !wasTerminal) {
        updates.closedAt = now;
        updates.closedByUserId = ctx.auth.userId;
      }
      if (!willBeTerminal && wasTerminal) {
        updates.closedAt = null;
        updates.closedByUserId = null;
      }

      await ctx.db.update(actions).set(updates).where(eq(actions.id, action.id));
      await writeActivity(ctx.db, {
        tenantId: ctx.tenantId,
        actionId: action.id,
        actorUserId: ctx.auth.userId,
        kind: 'status_changed',
        payload: { from: action.status, to: input.status },
      });
      return { ok: true as const };
    }),

  archive: tenantProcedure
    .use(requirePermission('actions.manage'))
    .input(actionIdInput)
    .mutation(async ({ ctx, input }) => {
      const action = await loadActionOrThrow(ctx.db, ctx.tenantId, input.actionId);
      if (action.archivedAt !== null) return { ok: true as const };
      const now = new Date();
      await ctx.db
        .update(actions)
        .set({ archivedAt: now, updatedAt: now })
        .where(eq(actions.id, action.id));
      await writeActivity(ctx.db, {
        tenantId: ctx.tenantId,
        actionId: action.id,
        actorUserId: ctx.auth.userId,
        kind: 'archived',
        payload: {},
      });
      return { ok: true as const };
    }),

  restore: tenantProcedure
    .use(requirePermission('actions.manage'))
    .input(actionIdInput)
    .mutation(async ({ ctx, input }) => {
      const action = await loadActionOrThrow(ctx.db, ctx.tenantId, input.actionId);
      if (action.archivedAt === null) return { ok: true as const };
      const now = new Date();
      await ctx.db
        .update(actions)
        .set({ archivedAt: null, updatedAt: now })
        .where(eq(actions.id, action.id));
      await writeActivity(ctx.db, {
        tenantId: ctx.tenantId,
        actionId: action.id,
        actorUserId: ctx.auth.userId,
        kind: 'restored',
        payload: {},
      });
      return { ok: true as const };
    }),

  activity: router({
    list: tenantProcedure
      .use(requirePermission('actions.view'))
      .input(listActivityInput)
      .query(async ({ ctx, input }) => {
        await loadActionOrThrow(ctx.db, ctx.tenantId, input.actionId);
        const rows = await ctx.db
          .select({
            id: actionActivity.id,
            actorUserId: actionActivity.actorUserId,
            kind: actionActivity.kind,
            payload: actionActivity.payload,
            createdAt: actionActivity.createdAt,
            actorName: user.name,
            actorEmail: user.email,
          })
          .from(actionActivity)
          .leftJoin(user, eq(user.id, actionActivity.actorUserId))
          .where(eq(actionActivity.actionId, input.actionId))
          .orderBy(desc(actionActivity.createdAt))
          .limit(input.limit);
        return rows;
      }),
  }),

  comments: router({
    list: tenantProcedure
      .use(requirePermission('actions.view'))
      .input(listCommentsInput)
      .query(async ({ ctx, input }) => {
        await loadActionOrThrow(ctx.db, ctx.tenantId, input.actionId);
        const rows = await ctx.db
          .select({
            id: actionComments.id,
            actionId: actionComments.actionId,
            authorUserId: actionComments.authorUserId,
            body: actionComments.body,
            createdAt: actionComments.createdAt,
            updatedAt: actionComments.updatedAt,
            authorName: user.name,
            authorEmail: user.email,
          })
          .from(actionComments)
          .leftJoin(user, eq(user.id, actionComments.authorUserId))
          .where(eq(actionComments.actionId, input.actionId))
          .orderBy(actionComments.createdAt);
        return rows;
      }),

    create: tenantProcedure
      .use(requirePermission('actions.view'))
      .input(createCommentInput)
      .mutation(async ({ ctx, input }) => {
        const action = await loadActionOrThrow(ctx.db, ctx.tenantId, input.actionId);
        const id = newId();
        await ctx.db.insert(actionComments).values({
          id,
          tenantId: ctx.tenantId,
          actionId: action.id,
          authorUserId: ctx.auth.userId,
          body: input.body,
        });
        await writeActivity(ctx.db, {
          tenantId: ctx.tenantId,
          actionId: action.id,
          actorUserId: ctx.auth.userId,
          kind: 'commented',
          payload: { commentId: id },
        });
        return { commentId: id };
      }),

    update: tenantProcedure
      .use(requirePermission('actions.view'))
      .input(updateCommentInput)
      .mutation(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(actionComments)
          .where(
            and(
              eq(actionComments.tenantId, ctx.tenantId),
              eq(actionComments.id, input.commentId),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (row === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'comment-not-found' });
        }
        if (row.authorUserId !== ctx.auth.userId) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'not-comment-author' });
        }
        await ctx.db
          .update(actionComments)
          .set({ body: input.body, updatedAt: new Date() })
          .where(eq(actionComments.id, row.id));
        return { ok: true as const };
      }),

    delete: tenantProcedure
      .use(requirePermission('actions.view'))
      .input(deleteCommentInput)
      .mutation(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(actionComments)
          .where(
            and(
              eq(actionComments.tenantId, ctx.tenantId),
              eq(actionComments.id, input.commentId),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (row === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'comment-not-found' });
        }
        // Author or anyone with `actions.manage`.
        if (row.authorUserId !== ctx.auth.userId) {
          if (!ctx.permissions.includes('actions.manage')) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'not-comment-author-or-manager',
            });
          }
        }
        await ctx.db.delete(actionComments).where(eq(actionComments.id, row.id));
        return { ok: true as const };
      }),
  }),

  /**
   * Counts grouped by status — used by the list page chips and dashboard
   * tiles. Cheap enough to call on every list view.
   */
  countsByStatus: tenantProcedure
    .use(requirePermission('actions.view'))
    .input(z.object({ includeArchived: z.boolean().default(false) }).default({ includeArchived: false }))
    .query(async ({ ctx, input }) => {
      const where = [eq(actions.tenantId, ctx.tenantId)];
      if (!input.includeArchived) where.push(isNull(actions.archivedAt));
      const rows = await ctx.db
        .select({
          status: actions.status,
          c: count(),
        })
        .from(actions)
        .where(and(...where))
        .groupBy(actions.status);
      const map: Record<string, number> = {};
      for (const r of rows) {
        map[r.status] = Number(r.c);
      }
      return map;
    }),
});

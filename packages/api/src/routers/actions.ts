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
import { assets, incidents, inspections, issues, ramsPacks, user } from '@forma360/db/schema';
import {
  actionActivity,
  actionAssets,
  actionAttachments,
  actionComments,
  actionPriority,
  actionSavedViews,
  actionStatus,
  actionTypes,
  actions,
  tenantActionSettings,
  type Action,
  type ActionActivityKind,
  type ActionType,
} from '@forma360/db/schema';
import { type DependentResolverDeps } from '@forma360/permissions';
import type { Database } from '@forma360/db/client';
import { appLink } from '@forma360/shared/app-link';
import { newId } from '@forma360/shared/id';
import {
  DEFAULT_PRIORITY_DUE_DATE_DAYS,
  recurrenceConfigSchema,
  type ActionCustomQuestion,
  type PriorityDueDateDays,
  type RecurrenceConfig,
  type TransitionRules,
} from '@forma360/shared/actions-schema';
import { TRPCError } from '@trpc/server';
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { loadContractorScope } from '../contractor-scope';
import { loadIssueForCallerOrThrow } from './issues';
import {
  coshhAssessments,
  coshhSubstances,
  fireBuildings,
  fireDoorInspections,
  fireDoors,
  fireLogbookEntries,
  fireRiskAssessments,
  riskAssessments,
} from '@forma360/db/schema';
import { nextReferenceValue } from '../reference-counter';
import { z } from 'zod';
import { boundedRecord } from '../bounded-json';
import { notificationEnabled } from '@forma360/shared/notification-catalogue';
import { notifyInApp } from '../notify';
import { requirePermission, tenantProcedure } from '../procedures';
import {
  assertAssetsInTenant,
  assertSitesInTenant,
  assertStorageKeyInTenant,
  assertUsersInTenant,
} from '../tenant-guards';
import { router } from '../trpc';

type Db = DependentResolverDeps['db'];

const actionIdInput = z.object({ actionId: z.string().length(26) });

const createAttachmentInput = z.object({
  actionId: z.string().length(26),
  filename: z.string().min(1).max(500),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z
    .number()
    .int()
    .min(0)
    .max(100 * 1024 * 1024),
  storageKey: z.string().min(1).max(1024),
});

const ACTION_LIST_LIMIT = 100;

/**
 * Render an "AC-000042"-style reference number. Counts every action ever
 * created in the tenant and adds one — same trade-off as issues
 * (display value, gaps are acceptable).
 */
async function nextActionReferenceNumber(db: Db, tenantId: string): Promise<string> {
  const next = await nextReferenceValue(db, tenantId, 'action');
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

/**
 * Resolve an action for the CALLER, applying the contractor predicate the
 * canonical read applies.
 *
 * The Inspections audit named `actions` as the third router with the
 * identical shape and an unexamined answer: `loadContractorScope` called
 * at `list` and `get`, and every other door resolving by tenant + id. It
 * was right. A portal contractor's `actions` activity grants
 * `actions.view` + `actions.create` tenant-wide, and `actions.view` is the
 * gate on the whole activity/comments surface — so `get` returned
 * NOT_FOUND on another company's action while the same caller could read
 * its activity timeline and its comment thread, and post, edit and delete
 * comments on it.
 *
 * The scope condition mirrors `get` exactly, including the assignee leg:
 * an action ASSIGNED to a contractor is theirs to work even though
 * somebody internal created it.
 *
 * One helper rather than eight copies of a predicate — eight siblings can
 * dissent from `get`; eight call sites of the same helper cannot. It also
 * restores PF-19's server-side induction gate on those paths, since a path
 * that never called `loadContractorScope` never checked induction either.
 */
async function loadActionForCallerOrThrow(
  ctx: { db: Db; tenantId: string; auth: { userId: string } },
  actionId: string,
): Promise<Action> {
  const action = await loadActionOrThrow(ctx.db, ctx.tenantId, actionId);
  const scope = await loadContractorScope(ctx.db, ctx.tenantId, ctx.auth.userId);
  if (scope !== null) {
    const mine =
      scope.userIds.includes(action.createdBy) ||
      (action.assigneeUserId !== null && scope.userIds.includes(action.assigneeUserId));
    // NOT_FOUND rather than FORBIDDEN, matching `get`: a portal user must
    // not learn that an action they cannot see exists.
    if (!mine) throw new TRPCError({ code: 'NOT_FOUND', message: 'action-not-found' });
  }
  return action;
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

/**
 * Loads an action type for the given tenant. Returns null when the type
 * doesn't exist or is archived — callers translate that into a 404 or
 * silently drop the type id as appropriate. Active-only on purpose:
 * we never let a new action be created against an archived type.
 */
async function loadActiveActionType(
  db: Db,
  tenantId: string,
  typeId: string,
): Promise<ActionType | null> {
  const rows = await db
    .select()
    .from(actionTypes)
    .where(
      and(
        eq(actionTypes.tenantId, tenantId),
        eq(actionTypes.id, typeId),
        isNull(actionTypes.archivedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Loads the tenant's priority → due-date-days table. Returns defaults
 * (low=30, medium=7, high=1, critical=1) when no row exists, mirroring
 * the actionTypesRouter.settings.get behaviour.
 */
export async function loadPriorityDueDateDays(
  db: Db,
  tenantId: string,
): Promise<PriorityDueDateDays> {
  const rows = await db
    .select({ days: tenantActionSettings.priorityDueDateDays })
    .from(tenantActionSettings)
    .where(eq(tenantActionSettings.tenantId, tenantId))
    .limit(1);
  return rows[0]?.days ?? DEFAULT_PRIORITY_DUE_DATE_DAYS;
}

/**
 * Computes the auto-due-date for a new action. Returns the user-supplied
 * value when it's set; otherwise looks up the tenant's per-priority
 * default days and adds them to `now`. Returns null when the user didn't
 * pick a priority OR the priority's default is `null` (meaning
 * "leave the due-date empty").
 */
export function computeAutoDueAt(
  now: Date,
  priority: (typeof actionPriority)[number] | null | undefined,
  daysByPriority: PriorityDueDateDays,
  explicit: string | null | undefined,
): Date | null {
  if (explicit !== undefined && explicit !== null) return new Date(explicit);
  if (priority === undefined || priority === null) return null;
  const days = daysByPriority[priority];
  if (days === null || days === undefined) return null;
  const out = new Date(now);
  out.setDate(out.getDate() + days);
  return out;
}

/**
 * Validates the response map against a type's custom-question shape.
 * Required questions must have a non-empty answer; multipleChoice
 * answers must be one of the listed options. Throws BAD_REQUEST on
 * any violation. Returns the cleaned response map (drops keys that
 * aren't in the question list).
 */
function validateCustomResponses(
  questions: ReadonlyArray<ActionCustomQuestion>,
  responses: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  const byId = new Map(questions.map((q) => [q.id, q]));
  for (const q of questions) {
    const value = responses[q.id];
    if (q.required) {
      const isEmpty =
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim().length === 0);
      if (isEmpty) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `custom-question-required:${q.id}`,
        });
      }
    }
    if (value !== undefined && q.type === 'multipleChoice' && (q.options ?? []).length > 0) {
      if (typeof value !== 'string' || !(q.options ?? []).includes(value)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `custom-question-invalid-option:${q.id}`,
        });
      }
    }
    if (value !== undefined) cleaned[q.id] = value;
  }
  // Silently drop response keys that aren't in the question list — the
  // admin removed the question after answers were submitted.
  for (const key of Object.keys(responses)) {
    if (!byId.has(key) && cleaned[key] === undefined) {
      continue;
    }
  }
  return cleaned;
}

/**
 * Checks whether the caller is allowed to move an action of the given
 * type into the given gated status (completed / cancelled). Anyone with
 * `org.settings` (admin) always passes. With `actions.manage` the
 * caller passes if the type's `allowedGroupIds` list is empty OR they
 * belong to one of the listed groups. Throws FORBIDDEN otherwise.
 *
 * `viaAssignee` (UXW2-08): the caller already proved they are the
 * action's assignee completing their own work, so the `actions.manage`
 * requirement is waived — but a type's group gate still binds them:
 * being assigned does not override "only electricians close electrical
 * actions".
 */
async function assertCanTransitionTo(
  db: Db,
  tenantId: string,
  userId: string,
  permissions: readonly string[],
  type: ActionType | null,
  next: 'completed' | 'cancelled',
  viaAssignee = false,
): Promise<void> {
  if (permissions.includes('org.settings')) return;
  if (!viaAssignee && !permissions.includes('actions.manage')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'missing-actions-manage' });
  }
  const rules: TransitionRules = type?.transitionRules ?? {
    completed: { allowedGroupIds: [] },
    cancelled: { allowedGroupIds: [] },
  };
  const allowed = rules[next].allowedGroupIds;
  if (allowed.length === 0) return;
  // Caller must belong to one of the allowed groups. Group membership
  // is materialised in group_members (Phase 1). Lazy import avoided —
  // we only check when the gate is actually configured.
  const { groupMembers } = await import('@forma360/db/schema');
  const rows = await db
    .select({ id: groupMembers.groupId })
    .from(groupMembers)
    .where(and(eq(groupMembers.tenantId, tenantId), eq(groupMembers.userId, userId)));
  const callerGroups = new Set(rows.map((r) => r.id));
  if (!allowed.some((g) => callerGroups.has(g))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `not-in-allowed-group-for:${next}`,
    });
  }
}

/**
 * Light-weight RRULE evaluator — enough for the four frequencies we
 * surface in the UI (DAILY / WEEKLY / MONTHLY / YEARLY). Returns the
 * next occurrence after `from`, or null when the rule can't be parsed.
 * A full RFC 5545 implementation lives in the worker package (Phase 2
 * schedules); we're avoiding the cross-package import here because
 * this path runs inline in a tRPC mutation.
 */
function computeNextRecurrenceDate(from: Date, recurrence: RecurrenceConfig): Date | null {
  const rule = recurrence.rrule.toUpperCase();
  const freqMatch = rule.match(/FREQ=([A-Z]+)/);
  const intervalMatch = rule.match(/INTERVAL=(\d+)/);
  const interval = intervalMatch !== null ? Number.parseInt(intervalMatch[1] ?? '1', 10) : 1;
  const freq = freqMatch?.[1] ?? null;
  const next = new Date(from);
  switch (freq) {
    case 'DAILY':
      next.setDate(next.getDate() + interval);
      return next;
    case 'WEEKLY':
      next.setDate(next.getDate() + 7 * interval);
      return next;
    case 'MONTHLY':
      next.setMonth(next.getMonth() + interval);
      return next;
    case 'YEARLY':
      next.setFullYear(next.getFullYear() + interval);
      return next;
    default:
      return null;
  }
}

void recurrenceConfigSchema; // Imported but only used in input schemas elsewhere.

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

/**
 * Idempotently create an action for an inspection question. Shared by the
 * conduct "raise action" flow and by `requireAction` triggers fired on submit.
 * The unique `(sourceType, sourceId, sourceItemId)` index guarantees one
 * action per question — a conflicting insert resolves to the existing row.
 */
export async function createInspectionActionIfAbsent(
  db: Db,
  args: {
    tenantId: string;
    inspectionId: string;
    sourceItemId: string;
    title: string;
    siteId: string | null;
    createdBy: string;
  },
): Promise<{ actionId: string; created: boolean }> {
  const match = and(
    eq(actions.tenantId, args.tenantId),
    eq(actions.sourceType, 'inspection'),
    eq(actions.sourceId, args.inspectionId),
    eq(actions.sourceItemId, args.sourceItemId),
  );
  const existing = await db.select({ id: actions.id }).from(actions).where(match).limit(1);
  if (existing[0] !== undefined) return { actionId: existing[0].id, created: false };

  const id = newId();
  const referenceNumber = await nextActionReferenceNumber(db, args.tenantId);
  const now = new Date();
  try {
    await db.insert(actions).values({
      id,
      tenantId: args.tenantId,
      sourceType: 'inspection',
      sourceId: args.inspectionId,
      sourceItemId: args.sourceItemId,
      referenceNumber,
      title: args.title,
      description: null,
      status: 'open',
      priority: null,
      label: null,
      assigneeUserId: null,
      dueAt: null,
      siteId: args.siteId,
      actionTypeId: null,
      customQuestionResponses: {},
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const race = await db.select({ id: actions.id }).from(actions).where(match).limit(1);
    if (race[0] === undefined) throw err;
    return { actionId: race[0].id, created: false };
  }
  await writeActivity(db, {
    tenantId: args.tenantId,
    actionId: id,
    actorUserId: args.createdBy,
    kind: 'created',
  });
  return { actionId: id, created: true };
}

const priorityEnum = z.enum(actionPriority);
const statusEnum = z.enum(actionStatus);

const listInput = z
  .object({
    status: statusEnum.optional(),
    sourceType: z
      .enum([
        'inspection',
        'issue',
        'standalone',
        'risk_assessment',
        'coshh_assessment',
        'fire_risk_assessment',
        'fire_logbook_entry',
        'fire_door_inspection',
        'incident',
        'rams',
      ])
      .optional(),
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
    /**
     * PF-9: the list used to hard-stop at 100, newest first — precisely
     * the oldest, most-overdue actions fell off the end with no way to
     * reach them. Offset + total count make every action reachable.
     */
    offset: z.number().int().min(0).max(100_000).default(0),
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
  /** Optional action type. NULL = no type (legacy / quick-create). */
  actionTypeId: z.string().length(26).optional(),
  /** Map of `{ questionId: response }`. Validated against the type. */
  customQuestionResponses: boundedRecord.optional(),
  /** Optional recurrence config (rrule + endDate). */
  recurrence: recurrenceConfigSchema.nullable().optional(),
  /** Asset IDs to link to this action. */
  assetIds: z.array(z.string()).optional(),
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
  /** Optional action type. NULL = no type (legacy / quick-create). */
  actionTypeId: z.string().length(26).optional(),
  /** Map of `{ questionId: response }`. Validated against the type. */
  customQuestionResponses: boundedRecord.optional(),
});

const createFromIssueInput = z.object({
  issueId: z.string().length(26),
  title: z.string().min(1).max(500),
  description: z.string().max(20_000).optional(),
  priority: priorityEnum.optional(),
  /** PF-13: parity with the other create paths. */
  actionTypeId: z.string().length(26).optional(),
  customQuestionResponses: boundedRecord.optional(),
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
  actionTypeId: z.string().length(26).nullable().optional(),
  /**
   * Full replacement of the action's custom-question response map.
   * Validated against the action's current type at the router boundary.
   */
  customQuestionResponses: boundedRecord.optional(),
  recurrence: recurrenceConfigSchema.nullable().optional(),
  /** Asset IDs to link to this action. Replaces existing links when provided. */
  assetIds: z.array(z.string()).optional(),
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

/**
 * Side-channel deps (PF-4 — the Actions hub was the one module that
 * never told anyone anything). Same pattern as the users router: the
 * web server calls `setActionsRouterDeps` once at boot; tests inject a
 * capture. Null deps = silent no-op (worker/CLI callers).
 */
interface ActionsRouterDeps {
  sendEmail:
    | ((input: {
        to: string;
        locale?: string | undefined;
        templateKey: string;
        variables: Record<string, string>;
      }) => Promise<unknown>)
    | null;
  appUrl: string;
  /**
   * Signs download URLs for action attachments. Null in worker/CLI callers,
   * which never read attachments — `attachments.list` then returns the
   * metadata with a null URL rather than throwing.
   */
  signDownloadUrl: ((key: string) => Promise<string>) | null;
}
const actionsDeps: ActionsRouterDeps = { sendEmail: null, appUrl: '', signDownloadUrl: null };

export function setActionsRouterDeps(deps: {
  sendEmail: ActionsRouterDeps['sendEmail'];
  appUrl: string;
  signDownloadUrl?: ActionsRouterDeps['signDownloadUrl'];
}): void {
  actionsDeps.sendEmail = deps.sendEmail;
  actionsDeps.appUrl = deps.appUrl;
  actionsDeps.signDownloadUrl = deps.signDownloadUrl ?? null;
}

/**
 * Email the assignee that an action landed on their plate. Best-effort:
 * a failed send never rolls back the mutation. Self-assignment is not
 * notified — you know what you just did.
 */
export async function notifyAssignment(
  db: Database,
  logger: { warn: (obj: Record<string, unknown>, msg: string) => void },
  input: {
    tenantId: string;
    actionId: string;
    referenceNumber: string | null;
    title: string;
    dueAt: Date | null;
    assigneeUserId: string;
    actorUserId: string;
  },
): Promise<void> {
  const sendEmail = actionsDeps.sendEmail;
  if (input.assigneeUserId === input.actorUserId) return;
  try {
    const rows = await db
      .select({
        name: user.name,
        email: user.email,
        locale: user.locale,
        deactivatedAt: user.deactivatedAt,
        notificationPrefs: user.notificationPrefs,
      })
      .from(user)
      .where(and(eq(user.tenantId, input.tenantId), eq(user.id, input.assigneeUserId)))
      .limit(1);
    const assignee = rows[0];
    if (assignee === undefined || assignee.deactivatedAt !== null || assignee.email.length === 0) {
      return;
    }
    // The bell row is written whether or not an email dispatcher is wired
    // (it used to be skipped when sendEmail was null, which silently lost
    // the in-app record too). notifyInApp checks the inapp pref itself.
    await notifyInApp(
      db,
      {
        tenantId: input.tenantId,
        userId: input.assigneeUserId,
        kind: 'action_assigned',
        title: input.title,
        body: input.referenceNumber ?? '',
        href: `/actions/${input.actionId}`,
      },
      assignee.notificationPrefs,
    );
    if (
      sendEmail === null ||
      !notificationEnabled(assignee.notificationPrefs, 'action_assigned', 'email')
    ) {
      return;
    }
    const actorRows = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, input.actorUserId))
      .limit(1);
    await sendEmail({
      to: assignee.email,
      locale: assignee.locale ?? undefined,
      templateKey: 'action-assigned',
      variables: {
        recipientName: assignee.name,
        assignerName: actorRows[0]?.name ?? 'A colleague',
        title: input.title,
        referenceNumber: input.referenceNumber ?? '',
        dueLine:
          input.dueAt !== null ? ` It is due by ${input.dueAt.toISOString().slice(0, 10)}.` : '',
        viewUrl: appLink(actionsDeps.appUrl, assignee.locale, `/actions/${input.actionId}`),
      },
    });
  } catch (err) {
    logger.warn(
      { actionId: input.actionId, err: err instanceof Error ? err.message : String(err) },
      '[actions] assignment email failed',
    );
  }
}

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
      // External contractor portal users only see actions they created or are
      // assigned (internal users → scope null → unrestricted).
      const listScope = await loadContractorScope(ctx.db, ctx.tenantId, ctx.auth.userId);
      if (listScope !== null) {
        const scopeClause = or(
          inArray(actions.createdBy, listScope.userIds),
          inArray(actions.assigneeUserId, listScope.userIds),
        );
        if (scopeClause !== undefined) where.push(scopeClause);
      }

      // Sort order. Priority sort puts NULL last (NULLS LAST) so blank-
      // priority rows don't crowd the top. `CASE` maps the priority text
      // values to a numeric weight so the SQL is portable to other
      // backends; PG could use an enum here but actions.priority is `text`.
      const sortOrder = (() => {
        switch (input.sortBy) {
          case 'due':
            return [sql`${actions.dueAt} ASC NULLS LAST`, desc(actions.createdAt)];
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
          sourceItemId: actions.sourceItemId,
          actionTypeId: actions.actionTypeId,
          actionTypeName: actionTypes.name,
          actionTypeColor: actionTypes.color,
          recurrence: actions.recurrence,
          createdAt: actions.createdAt,
          updatedAt: actions.updatedAt,
          archivedAt: actions.archivedAt,
          assigneeName: user.name,
        })
        .from(actions)
        .leftJoin(user, eq(user.id, actions.assigneeUserId))
        .leftJoin(actionTypes, eq(actionTypes.id, actions.actionTypeId))
        .where(and(...where))
        .orderBy(...sortOrder)
        .limit(input.limit)
        .offset(input.offset);
      const countRows = await ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(actions)
        .where(and(...where));
      return { rows, totalCount: countRows[0]?.count ?? 0 };
    }),

  /**
   * The caller's own workload — the number the header badge shows so an
   * operative can see "you own 3, 1 overdue" without opening a filter
   * (PF-9).
   */
  myCounts: tenantProcedure.use(requirePermission('actions.view')).query(async ({ ctx }) => {
    const now = new Date();
    const rows = await ctx.db
      .select({ status: actions.status, dueAt: actions.dueAt })
      .from(actions)
      .where(
        and(
          eq(actions.tenantId, ctx.tenantId),
          eq(actions.assigneeUserId, ctx.auth.userId),
          isNull(actions.archivedAt),
          // Active (non-terminal) work assigned to the caller — blocked
          // counts too: it's owed, just stuck.
          inArray(actions.status, ['open', 'in_progress', 'blocked']),
        ),
      );
    return {
      openAssigned: rows.length,
      overdueAssigned: rows.filter((r) => r.dueAt !== null && r.dueAt < now).length,
    };
  }),

  get: tenantProcedure
    .use(requirePermission('actions.view'))
    .input(actionIdInput)
    .query(async ({ ctx, input }) => {
      const action = await loadActionOrThrow(ctx.db, ctx.tenantId, input.actionId);
      // Contractor portal users only see actions they created or are assigned.
      const getScope = await loadContractorScope(ctx.db, ctx.tenantId, ctx.auth.userId);
      if (getScope !== null) {
        const mine =
          getScope.userIds.includes(action.createdBy) ||
          (action.assigneeUserId !== null && getScope.userIds.includes(action.assigneeUserId));
        // Identical to `loadActionOrThrow`'s refusal, deliberately: a
        // portal user must not be able to tell "does not exist" from "not
        // yours".
        if (!mine) throw new TRPCError({ code: 'NOT_FOUND', message: 'action-not-found' });
      }
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
      // PF-2: every writer's source type resolves to a labelled,
      // linkable origin — the golden thread an auditor pulls. `href` is
      // the locale-less app path; the client prefixes the locale.
      let source: {
        type:
          | 'issue'
          | 'inspection'
          | 'standalone'
          | 'risk_assessment'
          | 'coshh_assessment'
          | 'fire_risk_assessment'
          | 'fire_logbook_entry'
          | 'fire_door_inspection'
          | 'incident'
          | 'rams';
        referenceNumber: string | null;
        title: string | null;
        href: string | null;
      } | null = null;
      if (action.sourceType === 'standalone' || action.sourceId === null) {
        source = { type: 'standalone', referenceNumber: null, title: null, href: null };
      } else if (action.sourceType === 'risk_assessment') {
        const rows = await ctx.db
          .select({
            referenceNumber: riskAssessments.referenceNumber,
            title: riskAssessments.title,
          })
          .from(riskAssessments)
          .where(
            and(
              eq(riskAssessments.tenantId, ctx.tenantId),
              eq(riskAssessments.id, action.sourceId),
            ),
          )
          .limit(1);
        source = {
          type: 'risk_assessment',
          referenceNumber: rows[0]?.referenceNumber ?? null,
          title: rows[0]?.title ?? null,
          href: `/risk-assessments/${action.sourceId}`,
        };
      } else if (action.sourceType === 'coshh_assessment') {
        const rows = await ctx.db
          .select({
            referenceNumber: coshhAssessments.referenceNumber,
            taskDescription: coshhAssessments.taskDescription,
            substanceId: coshhAssessments.substanceId,
            substanceName: coshhSubstances.name,
          })
          .from(coshhAssessments)
          .leftJoin(coshhSubstances, eq(coshhSubstances.id, coshhAssessments.substanceId))
          .where(
            and(
              eq(coshhAssessments.tenantId, ctx.tenantId),
              eq(coshhAssessments.id, action.sourceId),
            ),
          )
          .limit(1);
        const row = rows[0];
        source = {
          type: 'coshh_assessment',
          referenceNumber: row?.referenceNumber ?? null,
          title:
            row !== undefined
              ? [row.substanceName, row.taskDescription].filter((v) => v !== null).join(' — ')
              : null,
          href: row !== undefined ? `/coshh/${row.substanceId}` : null,
        };
      } else if (action.sourceType === 'fire_risk_assessment') {
        const rows = await ctx.db
          .select({
            referenceNumber: fireRiskAssessments.referenceNumber,
            title: fireRiskAssessments.title,
          })
          .from(fireRiskAssessments)
          .where(
            and(
              eq(fireRiskAssessments.tenantId, ctx.tenantId),
              eq(fireRiskAssessments.id, action.sourceId),
            ),
          )
          .limit(1);
        source = {
          type: 'fire_risk_assessment',
          referenceNumber: rows[0]?.referenceNumber ?? null,
          title: rows[0]?.title ?? null,
          href: `/fire-safety/fra/${action.sourceId}`,
        };
      } else if (action.sourceType === 'fire_logbook_entry') {
        const rows = await ctx.db
          .select({
            checkType: fireLogbookEntries.checkType,
            buildingId: fireLogbookEntries.buildingId,
            buildingName: fireBuildings.name,
          })
          .from(fireLogbookEntries)
          .leftJoin(fireBuildings, eq(fireBuildings.id, fireLogbookEntries.buildingId))
          .where(
            and(
              eq(fireLogbookEntries.tenantId, ctx.tenantId),
              eq(fireLogbookEntries.id, action.sourceId),
            ),
          )
          .limit(1);
        const row = rows[0];
        source = {
          type: 'fire_logbook_entry',
          referenceNumber: null,
          title:
            row !== undefined
              ? `${row.checkType.replace(/_/g, ' ')}${row.buildingName !== null ? ` — ${row.buildingName}` : ''}`
              : null,
          href: row !== undefined ? `/fire-safety/${row.buildingId}` : null,
        };
      } else if (action.sourceType === 'fire_door_inspection') {
        const rows = await ctx.db
          .select({
            doorId: fireDoorInspections.doorId,
            doorRef: fireDoors.doorRef,
            buildingId: fireDoors.buildingId,
            buildingName: fireBuildings.name,
          })
          .from(fireDoorInspections)
          .leftJoin(fireDoors, eq(fireDoors.id, fireDoorInspections.doorId))
          .leftJoin(fireBuildings, eq(fireBuildings.id, fireDoors.buildingId))
          .where(
            and(
              eq(fireDoorInspections.tenantId, ctx.tenantId),
              eq(fireDoorInspections.id, action.sourceId),
            ),
          )
          .limit(1);
        const row = rows[0];
        source = {
          type: 'fire_door_inspection',
          referenceNumber: null,
          title:
            row !== undefined && row.doorRef !== null
              ? `${row.doorRef}${row.buildingName !== null ? ` — ${row.buildingName}` : ''}`
              : null,
          href: row?.buildingId != null ? `/fire-safety/${row.buildingId}` : null,
        };
      } else if (action.sourceType === 'incident') {
        // Confidential incidents keep their title out of the action's
        // source card — the reference alone is enough to navigate, and
        // detail access is re-checked on the incident page itself.
        const rows = await ctx.db
          .select({
            referenceNumber: incidents.referenceNumber,
            title: incidents.title,
            confidential: incidents.confidential,
          })
          .from(incidents)
          .where(and(eq(incidents.tenantId, ctx.tenantId), eq(incidents.id, action.sourceId)))
          .limit(1);
        const row = rows[0];
        source = {
          type: 'incident',
          referenceNumber: row?.referenceNumber ?? null,
          title: row === undefined || row.confidential ? null : row.title,
          href: `/incidents/${action.sourceId}`,
        };
      } else if (action.sourceType === 'rams') {
        // A RAMS action comes from a rejected client acceptance, a failed
        // review item or a problem raised at briefing — all anchored to
        // the pack, so the back-link is the pack page (RS-E17).
        const rows = await ctx.db
          .select({ referenceNumber: ramsPacks.referenceNumber, title: ramsPacks.title })
          .from(ramsPacks)
          .where(and(eq(ramsPacks.tenantId, ctx.tenantId), eq(ramsPacks.id, action.sourceId)))
          .limit(1);
        const row = rows[0];
        source = {
          type: 'rams',
          referenceNumber: row?.referenceNumber ?? null,
          title: row?.title ?? null,
          href: `/rams/${action.sourceId}`,
        };
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
          href: `/observations/${action.sourceId}`,
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
          href: `/inspections/${action.sourceId}`,
        };
      }
      // Resolve the action type so the detail page can render the
      // type chip + the custom-question definitions (needed to map
      // `customQuestionResponses[questionId]` back to a prompt).
      let actionType: ActionType | null = null;
      if (action.actionTypeId !== null) {
        const tRows = await ctx.db
          .select()
          .from(actionTypes)
          .where(
            and(eq(actionTypes.tenantId, ctx.tenantId), eq(actionTypes.id, action.actionTypeId)),
          )
          .limit(1);
        actionType = tRows[0] ?? null;
      }
      // Assets linked to this action (via `action_assets`). Surfaced on the
      // detail panel so the action shows the asset it belongs to and the
      // user can jump straight to it.
      const linkedAssets = await ctx.db
        .select({ id: assets.id, name: assets.name })
        .from(actionAssets)
        .innerJoin(assets, eq(assets.id, actionAssets.assetId))
        .where(and(eq(actionAssets.tenantId, ctx.tenantId), eq(actionAssets.actionId, action.id)));
      return {
        action,
        actionType,
        assignee: assigneeRows[0] ?? null,
        source,
        assets: linkedAssets,
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
      // Resolve the (optional) action type up-front so we can validate
      // custom-question responses + check that the type isn't archived.
      let type: ActionType | null = null;
      if (input.actionTypeId !== undefined) {
        type = await loadActiveActionType(ctx.db, ctx.tenantId, input.actionTypeId);
        if (type === null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'action-type-not-found-or-archived',
          });
        }
      }
      // Validate custom responses against the type's question set —
      // throws BAD_REQUEST on missing required answers / invalid
      // multipleChoice options.
      const cleanedResponses =
        type !== null
          ? validateCustomResponses(type.customQuestions, input.customQuestionResponses ?? {})
          : {};

      // Auto-compute due date from priority when the caller didn't set
      // one explicitly. Uses the tenant's priority → days table.
      const daysByPriority = await loadPriorityDueDateDays(ctx.db, ctx.tenantId);
      const now = new Date();
      const dueAt = computeAutoDueAt(now, input.priority ?? null, daysByPriority, input.dueAt);

      await assertUsersInTenant(ctx.db, ctx.tenantId, [input.assigneeUserId]);
      await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
      await assertAssetsInTenant(ctx.db, ctx.tenantId, input.assetIds ?? []);

      const id = newId();
      const referenceNumber = await nextActionReferenceNumber(ctx.db, ctx.tenantId);
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
        dueAt,
        siteId: input.siteId ?? null,
        actionTypeId: type?.id ?? null,
        customQuestionResponses: cleanedResponses,
        recurrence: input.recurrence ?? null,
        createdBy: ctx.auth.userId,
        createdAt: now,
        updatedAt: now,
      });
      await writeActivity(ctx.db, {
        tenantId: ctx.tenantId,
        actionId: id,
        actorUserId: ctx.auth.userId,
        kind: 'created',
        payload: { sourceType: 'standalone', actionTypeId: type?.id ?? null },
      });
      if (input.assetIds !== undefined && input.assetIds.length > 0) {
        await ctx.db
          .insert(actionAssets)
          .values(
            input.assetIds.map((assetId) => ({
              id: newId(),
              tenantId: ctx.tenantId,
              actionId: id,
              assetId,
            })),
          )
          .onConflictDoNothing();
      }
      if (input.assigneeUserId !== undefined) {
        await notifyAssignment(ctx.db, ctx.logger, {
          tenantId: ctx.tenantId,
          actionId: id,
          referenceNumber,
          title: input.title,
          dueAt,
          assigneeUserId: input.assigneeUserId,
          actorUserId: ctx.auth.userId,
        });
      }
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

      // Resolve the (optional) action type and validate custom responses.
      let type: ActionType | null = null;
      if (input.actionTypeId !== undefined) {
        type = await loadActiveActionType(ctx.db, ctx.tenantId, input.actionTypeId);
        if (type === null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'action-type-not-found-or-archived',
          });
        }
      }
      const cleanedResponses =
        type !== null
          ? validateCustomResponses(type.customQuestions, input.customQuestionResponses ?? {})
          : {};

      await assertUsersInTenant(ctx.db, ctx.tenantId, [input.assigneeUserId]);
      await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);

      const daysByPriority = await loadPriorityDueDateDays(ctx.db, ctx.tenantId);
      const id = newId();
      const referenceNumber = await nextActionReferenceNumber(ctx.db, ctx.tenantId);
      const now = new Date();
      const dueAt = computeAutoDueAt(now, input.priority ?? null, daysByPriority, input.dueAt);
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
          dueAt,
          siteId: input.siteId ?? null,
          actionTypeId: type?.id ?? null,
          customQuestionResponses: cleanedResponses,
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
      if (input.assigneeUserId !== undefined) {
        await notifyAssignment(ctx.db, ctx.logger, {
          tenantId: ctx.tenantId,
          actionId: id,
          referenceNumber,
          title: input.title,
          dueAt: input.dueAt !== undefined ? new Date(input.dueAt) : null,
          assigneeUserId: input.assigneeUserId,
          actorUserId: ctx.auth.userId,
        });
      }
      return { actionId: id, referenceNumber, created: true as const };
    }),

  /**
   * Issue / Observation raised. No dedup — each call creates a row.
   */
  createFromIssue: tenantProcedure
    .use(requirePermission('actions.create'))
    .input(createFromIssueInput)
    .mutation(async ({ ctx, input }) => {
      // XM-C: the source observation was never loaded at all — not for
      // visibility, not even for tenancy. `actions.create` is granted
      // tenant-wide by the contractor activity, so a portal user could
      // raise an action citing an observation `issues.get` refuses them,
      // and the action then carries its id as `sourceId` into the hub.
      // Same canonical read the Observations fix routed its own siblings
      // through, so the two cannot drift apart.
      await loadIssueForCallerOrThrow(ctx, input.issueId);
      await assertUsersInTenant(ctx.db, ctx.tenantId, [input.assigneeUserId]);
      await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);

      // PF-13: same contract as createStandalone — type validation with
      // required custom questions, and the priority → due-date automation
      // instead of silently dropping both.
      let type: ActionType | null = null;
      if (input.actionTypeId !== undefined) {
        type = await loadActiveActionType(ctx.db, ctx.tenantId, input.actionTypeId);
        if (type === null) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'action-type-not-found-or-archived',
          });
        }
      }
      const cleanedResponses =
        type !== null
          ? validateCustomResponses(type.customQuestions, input.customQuestionResponses ?? {})
          : {};
      const daysByPriority = await loadPriorityDueDateDays(ctx.db, ctx.tenantId);
      const now = new Date();
      const dueAt = computeAutoDueAt(now, input.priority ?? null, daysByPriority, input.dueAt);

      const id = newId();
      const referenceNumber = await nextActionReferenceNumber(ctx.db, ctx.tenantId);
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
        dueAt,
        siteId: input.siteId ?? null,
        actionTypeId: type?.id ?? null,
        customQuestionResponses: cleanedResponses,
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
      if (input.assigneeUserId !== undefined) {
        await notifyAssignment(ctx.db, ctx.logger, {
          tenantId: ctx.tenantId,
          actionId: id,
          referenceNumber,
          title: input.title,
          dueAt,
          assigneeUserId: input.assigneeUserId,
          actorUserId: ctx.auth.userId,
        });
      }
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
      const action = await loadActionForCallerOrThrow(ctx, input.actionId);
      await assertUsersInTenant(ctx.db, ctx.tenantId, [input.assigneeUserId]);
      await assertSitesInTenant(ctx.db, ctx.tenantId, [input.siteId]);
      await assertAssetsInTenant(ctx.db, ctx.tenantId, input.assetIds ?? []);
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
          // A moved deadline earns fresh reminders (PF-4).
          updates.dueSoonRemindedAt = null;
          updates.overdueRemindedAt = null;
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
      if (input.actionTypeId !== undefined) {
        const next = input.actionTypeId;
        if (next !== action.actionTypeId) {
          // Validate that the target type is active.
          if (next !== null) {
            const type = await loadActiveActionType(ctx.db, ctx.tenantId, next);
            if (type === null) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'action-type-not-found-or-archived',
              });
            }
          }
          updates.actionTypeId = next;
          // Changing types clears the response map — the old questions
          // no longer apply. Future enhancement: ask the user to confirm.
          updates.customQuestionResponses = {};
          events.push({
            kind: 'type_changed',
            payload: { from: action.actionTypeId, to: next },
          });
        }
      }
      if (input.customQuestionResponses !== undefined && action.actionTypeId !== null) {
        // Validate against the current type's question set.
        const type = await loadActiveActionType(ctx.db, ctx.tenantId, action.actionTypeId);
        if (type !== null) {
          const cleaned = validateCustomResponses(
            type.customQuestions,
            input.customQuestionResponses,
          );
          updates.customQuestionResponses = cleaned;
          // No activity event for per-question edits to avoid spamming
          // the timeline; a single coarse "edited" event covers it.
        }
      }
      if (input.recurrence !== undefined) {
        const prev = action.recurrence;
        const next = input.recurrence;
        const prevSig = prev === null || prev === undefined ? null : JSON.stringify(prev);
        const nextSig = next === null ? null : JSON.stringify(next);
        if (prevSig !== nextSig) {
          updates.recurrence = next;
          events.push({
            kind: 'recurrence_changed',
            payload: { from: prev, to: next },
          });
        }
      }

      if (
        events.length === 0 &&
        updates.customQuestionResponses === undefined &&
        input.assetIds === undefined
      ) {
        return { ok: true as const };
      }

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
      // PF-4: a reassignment tells the new owner. The activity loop above
      // recorded the change; this delivers it.
      if (
        input.assigneeUserId !== undefined &&
        input.assigneeUserId !== null &&
        input.assigneeUserId !== action.assigneeUserId
      ) {
        await notifyAssignment(ctx.db, ctx.logger, {
          tenantId: ctx.tenantId,
          actionId: action.id,
          referenceNumber: action.referenceNumber,
          title: updates.title ?? action.title,
          dueAt: updates.dueAt !== undefined ? updates.dueAt : action.dueAt,
          assigneeUserId: input.assigneeUserId,
          actorUserId: ctx.auth.userId,
        });
      }
      if (input.assetIds !== undefined) {
        await ctx.db.delete(actionAssets).where(eq(actionAssets.actionId, action.id));
        if (input.assetIds.length > 0) {
          await ctx.db
            .insert(actionAssets)
            .values(
              input.assetIds.map((assetId) => ({
                id: newId(),
                tenantId: ctx.tenantId,
                actionId: action.id,
                assetId,
              })),
            )
            .onConflictDoNothing();
        }
      }
      return { ok: true as const };
    }),

  /**
   * Status transition. `completed` and `cancelled` are terminal — the
   * action stamps `closedAt` / `closedByUserId` and refuses further
   * status transitions until a manager explicitly moves it back.
   *
   * UXW2-08: the ASSIGNEE may work their own action without
   * `actions.manage` — open ↔ in_progress → completed ("complete
   * actions" is the Standard set's own promise, and My work links every
   * assignee here). Everything managerial stays managerial: cancelling,
   * blocking, reopening a terminal action, and anyone else's actions.
   */
  setStatus: tenantProcedure
    .use(requirePermission('actions.view'))
    .input(setStatusInput)
    .mutation(async ({ ctx, input }) => {
      const action = await loadActionForCallerOrThrow(ctx, input.actionId);
      if (action.status === input.status) return { ok: true as const };

      const now = new Date();
      const wasTerminal = action.status === 'completed' || action.status === 'cancelled';
      const willBeTerminal = input.status === 'completed' || input.status === 'cancelled';

      const isManager =
        ctx.permissions.includes('actions.manage') || ctx.permissions.includes('org.settings');
      const viaAssignee = !isManager;
      if (viaAssignee) {
        const assigneeStatuses: ReadonlyArray<string> = ['open', 'in_progress', 'completed'];
        if (
          action.assigneeUserId !== ctx.auth.userId ||
          wasTerminal ||
          !assigneeStatuses.includes(input.status)
        ) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'missing-actions-manage' });
        }
      }

      // Transition gate: per-type rule decides who can move into the
      // gated terminal statuses. Helper throws FORBIDDEN on rejection;
      // admins (org.settings) always pass.
      if (willBeTerminal) {
        let type: ActionType | null = null;
        if (action.actionTypeId !== null) {
          type = await loadActiveActionType(ctx.db, ctx.tenantId, action.actionTypeId);
        }
        await assertCanTransitionTo(
          ctx.db,
          ctx.tenantId,
          ctx.auth.userId,
          ctx.permissions,
          type,
          input.status as 'completed' | 'cancelled',
          viaAssignee,
        );
      }

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

      // Recurrence: when a recurring action moves to `completed`,
      // materialise the next occurrence with a fresh reference number
      // and link it back to this one via `recurrence_parent_id`. We do
      // a simple "due_at + period" computation client-side here rather
      // than full RRULE iteration — the rrule string is stored, and a
      // worker can replace this in the future. The new row inherits the
      // current rrule + endDate so the chain continues indefinitely.
      if (
        input.status === 'completed' &&
        action.recurrence !== null &&
        action.recurrence !== undefined
      ) {
        const next = computeNextRecurrenceDate(action.dueAt ?? now, action.recurrence);
        const endDate =
          action.recurrence.endDate !== null ? new Date(action.recurrence.endDate) : null;
        if (next !== null && (endDate === null || next <= endDate)) {
          const newId_ = newId();
          const referenceNumber = await nextActionReferenceNumber(ctx.db, ctx.tenantId);
          await ctx.db.insert(actions).values({
            id: newId_,
            tenantId: ctx.tenantId,
            sourceType: action.sourceType,
            sourceId: action.sourceId,
            sourceItemId: null,
            referenceNumber,
            title: action.title,
            description: action.description,
            status: 'open',
            priority: action.priority,
            label: action.label,
            assigneeUserId: action.assigneeUserId,
            dueAt: next,
            siteId: action.siteId,
            actionTypeId: action.actionTypeId,
            customQuestionResponses: {},
            recurrence: action.recurrence,
            recurrenceParentId: action.recurrenceParentId ?? action.id,
            createdBy: ctx.auth.userId,
            createdAt: now,
            updatedAt: now,
          });
          await writeActivity(ctx.db, {
            tenantId: ctx.tenantId,
            actionId: newId_,
            actorUserId: ctx.auth.userId,
            kind: 'recurred',
            payload: { parentId: action.id, parentReference: action.referenceNumber },
          });
        }
      }

      return { ok: true as const };
    }),

  archive: tenantProcedure
    .use(requirePermission('actions.manage'))
    .input(actionIdInput)
    .mutation(async ({ ctx, input }) => {
      const action = await loadActionForCallerOrThrow(ctx, input.actionId);
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
      const action = await loadActionForCallerOrThrow(ctx, input.actionId);
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
        await loadActionForCallerOrThrow(ctx, input.actionId);
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

  /**
   * Attachments on an action — photos, videos and files, including anything
   * sent to the WhatsApp assistant and saved with `attach_media_to_action`.
   *
   * `loadActionOrThrow` runs first for the same reason the observations
   * equivalent does: each row carries a signed download URL, so an unscoped
   * read would be working access to another company's site photography, not
   * merely its metadata.
   */
  attachments: router({
    list: tenantProcedure
      .use(requirePermission('actions.view'))
      .input(actionIdInput)
      .query(async ({ ctx, input }) => {
        // Caller-scoped like comments.list — a contractor sees attachments
        // only on actions their scope reaches.
        await loadActionForCallerOrThrow(ctx, input.actionId);
        const rows = await ctx.db
          .select({
            id: actionAttachments.id,
            actionId: actionAttachments.actionId,
            storageKey: actionAttachments.storageKey,
            filename: actionAttachments.filename,
            mimeType: actionAttachments.mimeType,
            sizeBytes: actionAttachments.sizeBytes,
            uploadedByUserId: actionAttachments.uploadedByUserId,
            uploadedAt: actionAttachments.uploadedAt,
            uploadedByName: user.name,
          })
          .from(actionAttachments)
          .leftJoin(user, eq(user.id, actionAttachments.uploadedByUserId))
          .where(
            and(
              eq(actionAttachments.tenantId, ctx.tenantId),
              eq(actionAttachments.actionId, input.actionId),
            ),
          )
          .orderBy(desc(actionAttachments.uploadedAt));

        const out: Array<(typeof rows)[number] & { signedUrl: string | null; isMine: boolean }> =
          [];
        for (const row of rows) {
          let signedUrl: string | null = null;
          if (actionsDeps.signDownloadUrl !== null) {
            try {
              signedUrl = await actionsDeps.signDownloadUrl(row.storageKey);
            } catch {
              // A dead URL is better than a dead page: the row still lists.
              signedUrl = null;
            }
          }
          out.push({ ...row, signedUrl, isMine: row.uploadedByUserId === ctx.auth.userId });
        }
        return out;
      }),

    /**
     * Records an already-uploaded blob against the action. The blob half
     * is `POST /api/upload/action-attachment` (web layer) — same split as
     * observations, so the raw-key write path gets the tenant-prefix
     * guard here.
     */
    create: tenantProcedure
      .use(requirePermission('actions.view'))
      .input(createAttachmentInput)
      .mutation(async ({ ctx, input }) => {
        const action = await loadActionForCallerOrThrow(ctx, input.actionId);
        // The storage key must live under this tenant's R2 prefix, else
        // `attachments.list` would mint a signed URL for another tenant's
        // object.
        assertStorageKeyInTenant(ctx.tenantId, input.storageKey);
        const id = newId();
        await ctx.db.insert(actionAttachments).values({
          id,
          tenantId: ctx.tenantId,
          actionId: action.id,
          storageKey: input.storageKey,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          uploadedByUserId: ctx.auth.userId,
        });
        await writeActivity(ctx.db, {
          tenantId: ctx.tenantId,
          actionId: action.id,
          actorUserId: ctx.auth.userId,
          kind: 'attachment_added',
          payload: {
            attachmentId: id,
            filename: input.filename,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
          },
        });
        return { attachmentId: id };
      }),

    remove: tenantProcedure
      .use(requirePermission('actions.view'))
      .input(z.object({ attachmentId: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(actionAttachments)
          .where(
            and(
              eq(actionAttachments.tenantId, ctx.tenantId),
              eq(actionAttachments.id, input.attachmentId),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (row === undefined) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'attachment-not-found' });
        }
        // The caller must still be able to reach the action itself
        // (contractor scoping), not merely hold actions.view.
        await loadActionForCallerOrThrow(ctx, row.actionId);
        // Authors can always remove their own upload; anyone else needs
        // actions.manage. The R2 object is intentionally not deleted — a
        // future cleanup job reconciles orphaned blobs (same policy as
        // observations).
        if (
          row.uploadedByUserId !== ctx.auth.userId &&
          !ctx.permissions.includes('actions.manage')
        ) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'not-attachment-author-or-manager' });
        }
        await ctx.db.delete(actionAttachments).where(eq(actionAttachments.id, row.id));
        await writeActivity(ctx.db, {
          tenantId: ctx.tenantId,
          actionId: row.actionId,
          actorUserId: ctx.auth.userId,
          kind: 'attachment_removed',
          payload: { attachmentId: row.id, filename: row.filename },
        });
        return { ok: true as const };
      }),
  }),

  comments: router({
    list: tenantProcedure
      .use(requirePermission('actions.view'))
      .input(listCommentsInput)
      .query(async ({ ctx, input }) => {
        await loadActionForCallerOrThrow(ctx, input.actionId);
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
        const action = await loadActionForCallerOrThrow(ctx, input.actionId);
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
            and(eq(actionComments.tenantId, ctx.tenantId), eq(actionComments.id, input.commentId)),
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
            and(eq(actionComments.tenantId, ctx.tenantId), eq(actionComments.id, input.commentId)),
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
    .input(
      z.object({ includeArchived: z.boolean().default(false) }).default({ includeArchived: false }),
    )
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

  /**
   * Per-user saved views for the board/list (To-Do #3). Scoped to the caller —
   * two users in the same tenant keep independent view sets. `config` is the
   * opaque filter/view snapshot the client serialises.
   */
  savedViews: router({
    list: tenantProcedure.use(requirePermission('actions.view')).query(async ({ ctx }) => {
      return ctx.db
        .select({
          id: actionSavedViews.id,
          name: actionSavedViews.name,
          config: actionSavedViews.config,
          createdAt: actionSavedViews.createdAt,
        })
        .from(actionSavedViews)
        .where(
          and(
            eq(actionSavedViews.tenantId, ctx.tenantId),
            eq(actionSavedViews.userId, ctx.auth.userId),
          ),
        )
        .orderBy(desc(actionSavedViews.createdAt));
    }),

    create: tenantProcedure
      .use(requirePermission('actions.view'))
      .input(z.object({ name: z.string().min(1).max(80), config: boundedRecord }))
      .mutation(async ({ ctx, input }) => {
        const id = newId();
        await ctx.db.insert(actionSavedViews).values({
          id,
          tenantId: ctx.tenantId,
          userId: ctx.auth.userId,
          name: input.name,
          config: input.config,
        });
        return { id };
      }),

    delete: tenantProcedure
      .use(requirePermission('actions.view'))
      .input(z.object({ id: z.string().length(26) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(actionSavedViews)
          .where(
            and(
              eq(actionSavedViews.id, input.id),
              eq(actionSavedViews.tenantId, ctx.tenantId),
              eq(actionSavedViews.userId, ctx.auth.userId),
            ),
          );
        return { ok: true as const };
      }),
  }),
});

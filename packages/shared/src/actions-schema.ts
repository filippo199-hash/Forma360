/**
 * Actions module — shared zod schemas.
 *
 * Validators for action types' custom questions, the tenant-level
 * priority-to-due-date table, and recurrence rules. Mirrors the
 * issues-schema.ts pattern so the question builder + answer renderer
 * can be reused (the shape is intentionally identical).
 */
import { z } from 'zod';

/**
 * Custom question on an action type. Identical shape to
 * `IssueCustomQuestion` — when an action of this type is created, the
 * reporter answers each question and the answers are stored in the
 * action's `customQuestionResponses` column.
 */
export const actionCustomQuestionSchema = z.object({
  id: z.string().length(26),
  prompt: z.string().min(1).max(500),
  type: z.enum(['text', 'multipleChoice', 'number']),
  required: z.boolean(),
  options: z.array(z.string().min(1).max(200)).max(20).optional(),
});
export type ActionCustomQuestion = z.infer<typeof actionCustomQuestionSchema>;
export const actionCustomQuestionsSchema = z.array(actionCustomQuestionSchema).max(20);

/**
 * Built-in fields the admin can toggle as "required" per action type.
 * Title is always required. Description / dueDate / assignee / site /
 * priority are optional unless explicitly listed here.
 */
export const ACTION_REQUIRED_FIELDS = [
  'description',
  'assignee',
  'priority',
  'dueDate',
  'site',
] as const;
export const actionRequiredFieldsSchema = z
  .array(z.enum(ACTION_REQUIRED_FIELDS))
  .max(ACTION_REQUIRED_FIELDS.length);
export type ActionRequiredField = (typeof ACTION_REQUIRED_FIELDS)[number];

/**
 * Visibility rule baked into the action type. Defines who can see
 * actions of this type (the server enforces this at list / get time):
 *
 *   - all_users:          every user in the tenant with `actions.view`
 *   - site_members:       only users that belong to the action's site
 *                         (via group/site membership). Falls back to
 *                         all_users if the action has no site set.
 *   - creator_and_assignee:
 *                         only the creator + the current assignee.
 *                         Admins (org.settings) always bypass.
 */
export const ACTION_VISIBILITY_RULES = [
  'all_users',
  'site_members',
  'creator_and_assignee',
] as const;
export const actionVisibilityRuleSchema = z.enum(ACTION_VISIBILITY_RULES);
export type ActionVisibilityRule = (typeof ACTION_VISIBILITY_RULES)[number];

/**
 * Per-priority default due-date days. Used when the user picks a
 * priority but doesn't set a due date explicitly. `0` means "due
 * today (end of day)". A null entry means "no auto-due — leave the
 * field empty".
 */
export const priorityDueDateDaysSchema = z.object({
  low: z.number().int().min(0).max(365).nullable(),
  medium: z.number().int().min(0).max(365).nullable(),
  high: z.number().int().min(0).max(365).nullable(),
  critical: z.number().int().min(0).max(365).nullable(),
});
export type PriorityDueDateDays = z.infer<typeof priorityDueDateDaysSchema>;

export const DEFAULT_PRIORITY_DUE_DATE_DAYS: PriorityDueDateDays = {
  low: 30,
  medium: 7,
  high: 1,
  critical: 1,
};

/**
 * Statuses an action can transition to. We expose `completed` and
 * `cancelled` as gated transitions because SafetyCulture lets admins
 * restrict who can close an action — same idea here. `open` and
 * `in_progress` are always free.
 */
export const ACTION_GATED_STATUSES = ['completed', 'cancelled'] as const;
export type ActionGatedStatus = (typeof ACTION_GATED_STATUSES)[number];

/**
 * Per-action-type rules controlling who can move an action of this
 * type to a gated terminal status. `allowedGroupIds` empty array means
 * "anyone with actions.manage" (the default). Otherwise the caller
 * must belong to one of the listed groups.
 */
export const transitionGroupsSchema = z.object({
  allowedGroupIds: z.array(z.string().length(26)).max(50),
});
export type TransitionGroups = z.infer<typeof transitionGroupsSchema>;

export const transitionRulesSchema = z.object({
  completed: transitionGroupsSchema,
  cancelled: transitionGroupsSchema,
});
export type TransitionRules = z.infer<typeof transitionRulesSchema>;

export const DEFAULT_TRANSITION_RULES: TransitionRules = {
  completed: { allowedGroupIds: [] },
  cancelled: { allowedGroupIds: [] },
};

/**
 * Preset label options per action type. Admins configure these in the
 * action type detail page; the create-action form renders them as a
 * dropdown so reporters pick a structured label instead of free-typing.
 * Max 50 labels per type, each up to 80 chars.
 */
export const actionLabelsSchema = z.array(z.string().min(1).max(80)).max(50);
export type ActionLabels = z.infer<typeof actionLabelsSchema>;

/**
 * Recurrence configuration shape. We keep it small — a single
 * RRULE-RFC5545 string (e.g. `FREQ=WEEKLY;BYDAY=MO`) plus an `endDate`
 * fallback for "stop after". The worker that materialises the next
 * occurrence parses the rule on close. NULL = not recurring.
 */
export const recurrenceConfigSchema = z.object({
  rrule: z.string().min(1).max(500),
  endDate: z.string().datetime().nullable(),
});
export type RecurrenceConfig = z.infer<typeof recurrenceConfigSchema>;

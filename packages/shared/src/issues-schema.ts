/**
 * Issues module — shared zod schemas.
 *
 * Validators for the per-category custom fields / custom questions,
 * GPS coordinates, and the access snapshot we attach to every issue.
 * Used by both the router input layer and the data layer.
 */
import { z } from 'zod';

export const customFieldSchema = z.object({
  id: z.string().length(26),
  label: z.string().min(1).max(200),
  type: z.enum(['text', 'number', 'date', 'select']),
  required: z.boolean(),
  /** Only present (and only meaningful) for `type === 'select'`. */
  options: z.array(z.string().min(1).max(200)).max(20).optional(),
});
export type IssueCustomField = z.infer<typeof customFieldSchema>;

export const customQuestionSchema = z.object({
  id: z.string().length(26),
  prompt: z.string().min(1).max(500),
  type: z.enum(['text', 'multipleChoice']),
  required: z.boolean(),
  options: z.array(z.string().min(1).max(200)).max(20).optional(),
});
export type IssueCustomQuestion = z.infer<typeof customQuestionSchema>;

export const issueCustomFieldsSchema = z.array(customFieldSchema).max(20);
export const issueCustomQuestionsSchema = z.array(customQuestionSchema).max(10);

export const issueGpsSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type IssueGps = z.infer<typeof issueGpsSchema>;

export const issueAccessSnapshotSchema = z.object({
  groupIds: z.array(z.string()),
  siteIds: z.array(z.string()),
  permissions: z.array(z.string()),
  snapshotAt: z.string().datetime(),
});
export type IssueAccessSnapshotShape = z.infer<typeof issueAccessSnapshotSchema>;

export const NOTIFICATION_RULES = ['private', 'summary', 'detailed'] as const;
export type IssueNotificationRule = (typeof NOTIFICATION_RULES)[number];

export const ISSUE_STATUSES = ['open', 'investigation', 'closed'] as const;
export type IssueStatusValue = (typeof ISSUE_STATUSES)[number];

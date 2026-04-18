/**
 * Template content Zod schema.
 *
 * See `docs/adr/0009-template-content-schema.md` for the rationale.
 * Stored at `template_versions.content` and validated at every boundary
 * (JSON import, DB write, API input, PDF/Word render). Schema version
 * travels on the root so we can add v2 without migrating historical
 * rows.
 */
import { z } from 'zod';

// ─── Constants (locked by the ADR) ──────────────────────────────────────────

export const TEMPLATE_SCHEMA_VERSION = '1' as const;
export const TEMPLATE_LIMITS = {
  MAX_NOTIFICATION_RECIPIENTS: 500,
  MAX_LOGIC_NESTING_DEPTH: 40,
  MAX_TABLE_COLUMNS: 20,
  MAX_SIGNATURE_SLOTS: 10,
  MAX_TITLE_FORMAT_LENGTH: 500,
  MAX_INSPECTION_TITLE_LENGTH: 250,
  /** Global response set option count — matches Phase 1 catalogue limit. */
  MAX_RESPONSE_SET_OPTIONS: 200,
} as const;

// ─── Primitives ─────────────────────────────────────────────────────────────

const ulid = z.string().length(26);
const markdown = z.string().max(50_000);
const nonEmptyString = z.string().min(1).max(500);

// ─── Response sets (snapshotted into each template version) ────────────────

/**
 * One option in a multiple-choice / custom response set. Triggers on this
 * option fire when the option is selected during an inspection. Flagging
 * is per-option per T-12.
 */
const responseOptionSchema = z.object({
  id: ulid,
  label: nonEmptyString,
  color: z.string().optional(),
  flagged: z.boolean().default(false),
  triggers: z
    .array(z.lazy(() => triggerSchema))
    .max(20)
    .optional(),
});
export type ResponseOption = z.infer<typeof responseOptionSchema>;

const customResponseSetSchema = z.object({
  id: ulid,
  /** Snapshotted from globalResponseSets.name at publish — may drift from the live name. */
  name: nonEmptyString,
  /** Present when the set was sourced from a Global Response Set. Null for ad-hoc sets. */
  sourceGlobalId: ulid.nullable(),
  options: z.array(responseOptionSchema).min(1).max(TEMPLATE_LIMITS.MAX_RESPONSE_SET_OPTIONS),
  multiSelect: z.boolean().default(false),
});
export type CustomResponseSet = z.infer<typeof customResponseSetSchema>;

// ─── Triggers (fire on response option selection) ───────────────────────────

const askFollowUpTrigger = z.object({
  kind: z.literal('askFollowUp'),
  /** Question ids to show. Must resolve inside the same template. */
  questionIds: z.array(ulid).min(1).max(50),
});

const requireActionTrigger = z.object({
  kind: z.literal('requireAction'),
  /** Free-form title for the action that would be created. */
  actionTitle: nonEmptyString,
});

const requireEvidenceTrigger = z.object({
  kind: z.literal('requireEvidence'),
  mediaKind: z.enum(['photo', 'video', 'any']).default('any'),
  minCount: z.number().int().min(1).max(20).default(1),
});

const requireNoteTrigger = z.object({
  kind: z.literal('requireNote'),
  placeholder: z.string().max(200).optional(),
});

const notifyTrigger = z.object({
  kind: z.literal('notify'),
  /** User ids, group ids, or site ids — routing is resolved at enqueue time. */
  recipients: z
    .object({
      userIds: z.array(ulid).default([]),
      groupIds: z.array(ulid).default([]),
      siteIds: z.array(ulid).default([]),
    })
    .refine((r) => r.userIds.length + r.groupIds.length + r.siteIds.length > 0, {
      message: 'At least one recipient required',
    })
    .refine(
      (r) =>
        r.userIds.length + r.groupIds.length + r.siteIds.length <=
        TEMPLATE_LIMITS.MAX_NOTIFICATION_RECIPIENTS,
      {
        message: `Max ${TEMPLATE_LIMITS.MAX_NOTIFICATION_RECIPIENTS} total recipients`,
      },
    ),
  /** `immediate` fires when the option is selected; `onCompletion` when the inspection submits. */
  timing: z.enum(['immediate', 'onCompletion']).default('onCompletion'),
});

const triggerSchema = z.discriminatedUnion('kind', [
  askFollowUpTrigger,
  requireActionTrigger,
  requireEvidenceTrigger,
  requireNoteTrigger,
  notifyTrigger,
]);
export type Trigger = z.infer<typeof triggerSchema>;

// ─── Visibility (conditional show/hide on a question) ───────────────────────

/**
 * Conditional visibility. Evaluated before required-check (T-E08):
 * a required question inside an untriggered branch is not enforced.
 */
const visibilitySchema = z.object({
  dependsOn: ulid,
  operator: z.enum(['equals', 'notEquals', 'in', 'notIn', 'answered', 'notAnswered']),
  /** Value to compare against. Ignored for answered/notAnswered. */
  value: z.unknown().optional(),
});
export type Visibility = z.infer<typeof visibilitySchema>;

// ─── Base fields shared by every item ───────────────────────────────────────

const baseItemFields = {
  id: ulid,
  prompt: nonEmptyString,
  required: z.boolean().default(false),
  note: markdown.optional(),
  visibility: visibilitySchema.optional(),
};

// ─── Question kinds ─────────────────────────────────────────────────────────

const multipleChoiceQuestion = z.object({
  ...baseItemFields,
  type: z.literal('multipleChoice'),
  /** Refers to a CustomResponseSet id in the template's `customResponseSets` array. */
  responseSetId: ulid,
});

const textQuestion = z.object({
  ...baseItemFields,
  type: z.literal('text'),
  multiline: z.boolean().default(false),
  maxLength: z.number().int().min(1).max(10_000).default(2_000),
});

const numberQuestion = z.object({
  ...baseItemFields,
  type: z.literal('number'),
  min: z.number().optional(),
  max: z.number().optional(),
  decimalPlaces: z.number().int().min(0).max(10).default(2),
  unit: z.string().max(40).optional(),
});

const dateQuestion = z.object({ ...baseItemFields, type: z.literal('date') });
const timeQuestion = z.object({ ...baseItemFields, type: z.literal('time') });
const datetimeQuestion = z.object({ ...baseItemFields, type: z.literal('datetime') });

const mediaQuestion = z.object({
  ...baseItemFields,
  type: z.literal('media'),
  mediaKind: z.enum(['photo', 'video', 'pdf', 'any']).default('any'),
  maxCount: z.number().int().min(1).max(50).default(10),
});

const annotationQuestion = z.object({
  ...baseItemFields,
  type: z.literal('annotation'),
  /** Optional pre-seeded base image (object key in R2 under the tenant namespace). */
  baseImageKey: z.string().optional(),
});

const signatureSlotSchema = z.object({
  slotIndex: z
    .number()
    .int()
    .min(0)
    .max(TEMPLATE_LIMITS.MAX_SIGNATURE_SLOTS - 1),
  /** If set, only this user may sign this slot (pre-assigned). Null = selected at inspection time. */
  assigneeUserId: ulid.nullable(),
  /** Label the slot (e.g. "Site Manager"). Snapshot into the inspection signature row. */
  label: z.string().max(80).optional(),
});

// Zod v3's discriminatedUnion requires raw ZodObjects, so the signature
// cross-slot validations (T-E02 duplicate check + dense slotIndex) live
// in the root superRefine where we can walk every item.
const signatureQuestion = z.object({
  ...baseItemFields,
  type: z.literal('signature'),
  mode: z.enum(['sequential', 'parallel']),
  slots: z.array(signatureSlotSchema).min(1).max(TEMPLATE_LIMITS.MAX_SIGNATURE_SLOTS),
});

const sliderQuestion = z.object({
  ...baseItemFields,
  type: z.literal('slider'),
  min: z.number(),
  max: z.number(),
  step: z.number().min(0.001).default(1),
});

const checkboxQuestion = z.object({
  ...baseItemFields,
  type: z.literal('checkbox'),
  label: nonEmptyString,
});

// Title-page-only question kinds (auto-populated at inspection start).

const sitePickerQuestion = z.object({ ...baseItemFields, type: z.literal('site') });
const conductedByQuestion = z.object({ ...baseItemFields, type: z.literal('conductedBy') });
const inspectionDateQuestion = z.object({ ...baseItemFields, type: z.literal('inspectionDate') });
const documentNumberQuestion = z.object({ ...baseItemFields, type: z.literal('documentNumber') });
const locationQuestion = z.object({ ...baseItemFields, type: z.literal('location') });
const assetPickerQuestion = z.object({ ...baseItemFields, type: z.literal('asset') });
const companyPickerQuestion = z.object({ ...baseItemFields, type: z.literal('company') });

// ─── Non-question items ─────────────────────────────────────────────────────

const instructionItem = z.object({
  id: ulid,
  type: z.literal('instruction'),
  /** Visible as-is to the inspector. Markdown. */
  body: markdown,
  /** Optional media attached to the instruction (object keys). */
  mediaKeys: z.array(z.string()).max(10).default([]),
  visibility: visibilitySchema.optional(),
});

const tableColumnSchema = z.object({
  id: ulid,
  label: nonEmptyString,
  /** Response type for this column's cells. */
  kind: z.enum(['text', 'number', 'date', 'multipleChoice', 'checkbox', 'media', 'slider']),
  /** For multipleChoice columns — the response-set id. */
  responseSetId: ulid.optional(),
  flagged: z.boolean().optional(),
});

const blankTable = z.object({
  ...baseItemFields,
  type: z.literal('table'),
  tableKind: z.literal('blank'),
  columns: z.array(tableColumnSchema).min(1).max(TEMPLATE_LIMITS.MAX_TABLE_COLUMNS),
});

const riskAssessmentTable = z.object({
  ...baseItemFields,
  type: z.literal('table'),
  tableKind: z.literal('risk'),
  /**
   * Risk columns are locked by the spec: Hazard | Risk Description |
   * Likelihood | Severity | Risk Rating (auto) | Control Measures.
   * Additional free columns are appended via `extraColumns`.
   */
  likelihoodScale: z.number().int().min(3).max(10).default(5),
  severityScale: z.number().int().min(3).max(10).default(5),
  extraColumns: z.array(tableColumnSchema).max(10).default([]),
});

const checklistTable = z.object({
  ...baseItemFields,
  type: z.literal('table'),
  tableKind: z.literal('checklist'),
  /** Item | Status (Pass/Fail/N/A) | Comments — fixed. */
  extraColumns: z.array(tableColumnSchema).max(10).default([]),
});

const inventoryTable = z.object({
  ...baseItemFields,
  type: z.literal('table'),
  tableKind: z.literal('inventory'),
  /** Item | Quantity | Condition | Notes — fixed. */
  extraColumns: z.array(tableColumnSchema).max(10).default([]),
});

const tableItem = z.discriminatedUnion('tableKind', [
  blankTable,
  riskAssessmentTable,
  checklistTable,
  inventoryTable,
]);
export type TableItem = z.infer<typeof tableItem>;

// ─── The Item union ─────────────────────────────────────────────────────────

// Two-level discrimination: outer `type` resolves to one of {question,
// instruction, table}; each table kind further discriminates on `tableKind`
// via the `tableItem` inner union. Zod v3's discriminatedUnion doesn't
// allow duplicate outer discriminator values, so tables collapse to one
// branch.
const itemSchema = z.union([
  z.discriminatedUnion('type', [
    multipleChoiceQuestion,
    textQuestion,
    numberQuestion,
    dateQuestion,
    timeQuestion,
    datetimeQuestion,
    mediaQuestion,
    annotationQuestion,
    signatureQuestion,
    sliderQuestion,
    checkboxQuestion,
    sitePickerQuestion,
    conductedByQuestion,
    inspectionDateQuestion,
    documentNumberQuestion,
    locationQuestion,
    assetPickerQuestion,
    companyPickerQuestion,
    instructionItem,
  ]),
  tableItem,
]);
export type Item = z.infer<typeof itemSchema>;

// ─── Section / page ────────────────────────────────────────────────────────

const sectionSchema = z.object({
  id: ulid,
  title: nonEmptyString,
  description: markdown.optional(),
  items: z.array(itemSchema).max(500), // T-29 performance test target
});
export type Section = z.infer<typeof sectionSchema>;

const pageSchema = z.object({
  id: ulid,
  type: z.enum(['title', 'inspection']),
  title: nonEmptyString,
  description: markdown.optional(),
  sections: z.array(sectionSchema).min(1),
});
export type Page = z.infer<typeof pageSchema>;

// ─── Approval page settings ─────────────────────────────────────────────────

const approverSlotSchema = z.object({
  slotIndex: z.number().int().min(0).max(4),
  assigneeUserId: ulid.nullable(),
  label: z.string().max(80).optional(),
});

const approvalPageSchema = z.object({
  title: nonEmptyString,
  instructions: markdown.optional(),
  approverSlots: z.array(approverSlotSchema).min(1).max(5),
});
export type ApprovalPage = z.infer<typeof approvalPageSchema>;

const settingsSchema = z.object({
  titleFormat: z.string().max(TEMPLATE_LIMITS.MAX_TITLE_FORMAT_LENGTH).default('{date}'),
  documentNumberFormat: z.string().max(120).default('{counter:6}'),
  documentNumberStart: z.number().int().min(1).default(1),
  approvalPage: approvalPageSchema.optional(),
});
export type TemplateSettings = z.infer<typeof settingsSchema>;

// ─── Root ───────────────────────────────────────────────────────────────────

const rootSchema = z
  .object({
    schemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
    title: nonEmptyString,
    description: markdown.optional(),
    pages: z.array(pageSchema).min(1),
    settings: settingsSchema,
    customResponseSets: z.array(customResponseSetSchema).default([]),
  })
  .superRefine((content, ctx) => {
    // ── Exactly one title page, first in the list ──
    const titleCount = content.pages.filter((p) => p.type === 'title').length;
    if (titleCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Exactly one title page is required',
        path: ['pages'],
      });
    } else if (content.pages[0]?.type !== 'title') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Title page must be first',
        path: ['pages'],
      });
    }

    // ── Collect every item + response-set id for cross-reference checks ──
    const allItems = new Map<string, Item>();
    const responseSetIds = new Set(content.customResponseSets.map((s) => s.id));
    for (const page of content.pages) {
      for (const section of page.sections) {
        for (const item of section.items) {
          if (allItems.has(item.id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate item id: ${item.id}`,
              path: ['pages'],
            });
          }
          allItems.set(item.id, item);
        }
      }
    }

    // ── Multiple-choice questions must reference a defined response set ──
    for (const item of allItems.values()) {
      if (item.type === 'multipleChoice' && !responseSetIds.has(item.responseSetId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown responseSetId: ${item.responseSetId}`,
          path: ['pages'],
        });
      }
    }

    // ── Visibility must reference an existing question id ──
    for (const item of allItems.values()) {
      const vis = 'visibility' in item ? item.visibility : undefined;
      if (vis !== undefined && !allItems.has(vis.dependsOn)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `visibility.dependsOn points at unknown item: ${vis.dependsOn}`,
          path: ['pages'],
        });
      }
    }

    // ── Title-page-only kinds live only on the title page ──
    const titlePageOnly = new Set([
      'site',
      'conductedBy',
      'inspectionDate',
      'documentNumber',
      'location',
      'asset',
      'company',
    ]);
    for (const page of content.pages) {
      for (const section of page.sections) {
        for (const item of section.items) {
          if (titlePageOnly.has(item.type) && page.type !== 'title') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `"${item.type}" is only allowed on the title page`,
              path: ['pages'],
            });
          }
        }
      }
    }

    // ── Signature cross-slot validation (T-E02 + dense slotIndex) ──
    for (const item of allItems.values()) {
      if (item.type !== 'signature') continue;
      const assigned = item.slots
        .map((s) => s.assigneeUserId)
        .filter((v): v is string => v !== null);
      const seen = new Set<string>();
      for (const id of assigned) {
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate signer pre-assigned on signature ${item.id}: ${id}`,
            path: ['pages'],
          });
          break;
        }
        seen.add(id);
      }
      const indices = item.slots.map((s) => s.slotIndex).sort((a, b) => a - b);
      for (let i = 0; i < indices.length; i++) {
        if (indices[i] !== i) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `slotIndex must be dense 0..${item.slots.length - 1} on signature ${item.id}`,
            path: ['pages'],
          });
          break;
        }
      }
    }

    // ── Logic nesting depth ≤ 40 (T-E07) ──
    // Walk askFollowUp chains rooted at every multipleChoice option trigger.
    // Memoise depth-from-item so complex graphs stay O(n).
    // Depth counts the length of the longest follow-up chain *including*
    // the root — one question alone is depth 1; a question with a
    // follow-up chain of length N is depth N. Matches the spec wording
    // "40 nested levels" (levels, not edges).
    const depthCache = new Map<string, number>();
    function depthFrom(itemId: string, stack: Set<string>): number {
      if (depthCache.has(itemId)) return depthCache.get(itemId) ?? 0;
      if (stack.has(itemId)) {
        return 1; // cycle — treat as a one-level chain
      }
      const item = allItems.get(itemId);
      if (item === undefined) {
        depthCache.set(itemId, 0);
        return 0;
      }
      // Non-multipleChoice items can still be reached from askFollowUp;
      // they count as one level but don't themselves branch.
      if (item.type !== 'multipleChoice') {
        depthCache.set(itemId, 1);
        return 1;
      }
      const set = content.customResponseSets.find((s) => s.id === item.responseSetId);
      if (set === undefined) {
        depthCache.set(itemId, 1);
        return 1;
      }
      let maxChild = 0;
      for (const option of set.options) {
        for (const trigger of option.triggers ?? []) {
          if (trigger.kind === 'askFollowUp') {
            for (const childId of trigger.questionIds) {
              stack.add(itemId);
              const d = depthFrom(childId, stack);
              stack.delete(itemId);
              if (d > maxChild) maxChild = d;
            }
          }
        }
      }
      const depth = 1 + maxChild;
      depthCache.set(itemId, depth);
      return depth;
    }
    for (const item of allItems.values()) {
      if (item.type !== 'multipleChoice') continue;
      const d = depthFrom(item.id, new Set());
      if (d > TEMPLATE_LIMITS.MAX_LOGIC_NESTING_DEPTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Logic nesting exceeds ${TEMPLATE_LIMITS.MAX_LOGIC_NESTING_DEPTH} levels at item ${item.id}`,
          path: ['pages'],
        });
      }
    }
  });

// Public alias — callers use this, not `rootSchema`.
export const templateContentSchema = rootSchema;
export type TemplateContent = z.infer<typeof templateContentSchema>;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse unknown JSON into a typed TemplateContent. Throws ZodError with a
 * friendly per-field message; callers usually want `safeParse` instead.
 */
export function parseTemplateContent(input: unknown): TemplateContent {
  return templateContentSchema.parse(input);
}

/**
 * Count the maximum nesting depth of a content blob. Useful in the
 * editor so the UI can warn the author as they approach the cap.
 */
export function maxLogicDepth(content: TemplateContent): number {
  let max = 0;
  const allItems = new Map<string, Item>();
  for (const p of content.pages)
    for (const s of p.sections) for (const i of s.items) allItems.set(i.id, i);
  const cache = new Map<string, number>();
  function depth(itemId: string, stack: Set<string>): number {
    if (cache.has(itemId)) return cache.get(itemId) ?? 0;
    if (stack.has(itemId)) return 1;
    const item = allItems.get(itemId);
    if (item === undefined) return 0;
    if (item.type !== 'multipleChoice') {
      cache.set(itemId, 1);
      return 1;
    }
    const set = content.customResponseSets.find((s) => s.id === item.responseSetId);
    if (set === undefined) {
      cache.set(itemId, 1);
      return 1;
    }
    let m = 0;
    for (const option of set.options) {
      for (const trigger of option.triggers ?? []) {
        if (trigger.kind === 'askFollowUp') {
          for (const childId of trigger.questionIds) {
            stack.add(itemId);
            const d = depth(childId, stack);
            stack.delete(itemId);
            if (d > m) m = d;
          }
        }
      }
    }
    const answer = 1 + m;
    cache.set(itemId, answer);
    return answer;
  }
  for (const item of allItems.values()) {
    if (item.type !== 'multipleChoice') continue;
    const d = depth(item.id, new Set());
    if (d > max) max = d;
  }
  return max;
}

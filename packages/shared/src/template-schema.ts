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
import { parseVideoEmbed } from './video-embed';

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

/** Hex color validator for branding fields (6-digit form, e.g. "#0F766E"). */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a 6-digit hex color like #0F766E');

// ─── Response sets (snapshotted into each template version) ────────────────

/**
 * One option in a multiple-choice / custom response set. Triggers on this
 * option fire when the option is selected during an inspection.
 *
 * `color` is the option's styling and belongs to the (reusable) set.
 * `flagged` is DEPRECATED here: flagging is now a property of the individual
 * question (`multipleChoiceQuestion.flaggedOptionIds`), because a response
 * set is shared across many questions/templates. The field is kept optional
 * so existing content still parses and legacy consumers can fall back to it
 * until a question's flags are first edited.
 */
const responseOptionSchema = z.object({
  id: ulid,
  label: nonEmptyString,
  color: z.string().optional(),
  /** @deprecated set per-question via `flaggedOptionIds` instead. */
  flagged: z.boolean().optional(),
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
  /** Email address notified when a triggering option is selected (sent on submit). */
  email: z.string().email().max(320).optional(),
  /**
   * Legacy user/group/site routing. Retained optional for back-compat with
   * templates authored before the simple email field; the editor now uses
   * `email`.
   */
  recipients: z
    .object({
      userIds: z.array(ulid).default([]),
      groupIds: z.array(ulid).default([]),
      siteIds: z.array(ulid).default([]),
    })
    .optional(),
  /**
   * Delivery timing. Both values deliver when the inspection SUBMITS —
   * the editor only writes 'onCompletion'; 'immediate' is accepted for
   * back-compat and treated identically (PF-25: documented, not silent).
   */
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

// ─── Jump-to (forward skip logic) ───────────────────────────────────────────

/**
 * Target of a per-option jump. Selecting the option skips every item between
 * the question and the target. Forward-only — `superRefine` rejects a target
 * that is not strictly below the question in document order.
 */
const jumpTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('question'), questionId: ulid }),
  z.object({ type: z.literal('page'), pageId: ulid }),
  z.object({ type: z.literal('end') }),
]);
export type JumpTarget = z.infer<typeof jumpTargetSchema>;

const questionJumpSchema = z.object({
  /** Option (within the question's set) that triggers the jump when selected. */
  optionId: ulid,
  target: jumpTargetSchema,
});
export type QuestionJump = z.infer<typeof questionJumpSchema>;

// ─── Question kinds ─────────────────────────────────────────────────────────

const multipleChoiceQuestion = z.object({
  ...baseItemFields,
  type: z.literal('multipleChoice'),
  /** Refers to a CustomResponseSet id in the template's `customResponseSets` array. */
  responseSetId: ulid,
  /**
   * Option ids (within the referenced set) flagged for THIS question. Flagging
   * lives on the question, not the set, since a set is reused across questions.
   * Optional: when absent (legacy content), consumers fall back to the set
   * options' deprecated `flagged` flag until the question is first edited.
   */
  flaggedOptionIds: z.array(ulid).optional(),
  /**
   * Per-option forward skip logic. Stored on the question (not the shared set)
   * because targets are position-relative. Single-select questions only.
   */
  jumps: z.array(questionJumpSchema).optional(),
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

const sitePickerQuestion = z.object({
  ...baseItemFields,
  type: z.literal('site'),
  /**
   * Which place kind this question accepts during conduct. Absent = both kinds
   * (legacy content + AI-built questions); `'site'` restricts the picker to
   * Sites, `'project'` to Projects. Lets a template tag a Project distinctly
   * from a Site while both live in the one `sites` table.
   */
  siteKind: z.enum(['site', 'project']).optional(),
});
const conductedByQuestion = z.object({ ...baseItemFields, type: z.literal('conductedBy') });
const inspectionDateQuestion = z.object({ ...baseItemFields, type: z.literal('inspectionDate') });
const documentNumberQuestion = z.object({ ...baseItemFields, type: z.literal('documentNumber') });
const locationQuestion = z.object({ ...baseItemFields, type: z.literal('location') });
const assetPickerQuestion = z.object({ ...baseItemFields, type: z.literal('asset') });
const companyPickerQuestion = z.object({ ...baseItemFields, type: z.literal('company') });

// ─── Non-question items ─────────────────────────────────────────────────────

/** A file attached to an instruction (image / PDF / document). */
const instructionAttachment = z.object({
  /** R2 object key (`<tenantId>/templates/<id>/<file>`). */
  key: z.string().min(1),
  /** Original filename, shown for non-previewable docs. */
  filename: z.string().min(1),
  /** MIME type — drives how it renders (image / pdf / download card). */
  mimeType: z.string().min(1),
});
export type InstructionAttachment = z.infer<typeof instructionAttachment>;

const instructionItem = z.object({
  id: ulid,
  type: z.literal('instruction'),
  /** Visible as-is to the inspector. Markdown. May be empty if media-only. */
  body: markdown,
  /** Files (image / PDF / doc) the admin attached at build time. */
  attachments: z.array(instructionAttachment).max(10).default([]),
  /**
   * Optional YouTube/Vimeo link, embedded as a player during conduct.
   * Validated to be an embeddable URL — see `parseVideoEmbed`.
   */
  videoUrl: z
    .string()
    .url()
    .refine((u) => parseVideoEmbed(u) !== null, {
      message: 'Video link must be a YouTube or Vimeo URL',
    })
    .optional(),
  /** Whether this instruction is included in the final report (admin choice). */
  showInReport: z.boolean().default(true),
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

/**
 * Per-template branding. Optional — templates without branding fall back
 * to tenant defaults in rendered output. `logoStorageKey` is an R2 key
 * under `<tenantId>/templates/<templateId>/<filename>`; resolved to a
 * signed URL at render time.
 */
const brandingSchema = z.object({
  logoStorageKey: z.string().max(500).optional(),
  primaryColor: hexColor.optional(),
  accentColor: hexColor.optional(),
});
export type TemplateBranding = z.infer<typeof brandingSchema>;

/**
 * Template-level signature workflow.
 *
 * Independent of the item-level `signature` question type. When enabled,
 * after an inspection is submitted it transitions into
 * `awaiting_signature_workflow` and the listed users sign off in
 * sequential or parallel mode before the inspection is marked completed.
 *
 * `signatoryUserIds` order is significant for sequential mode (position 0
 * signs first). For parallel mode, all signers are notified at once and
 * order does not matter beyond presentation.
 */
const signatureWorkflowSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['sequential', 'parallel']),
  signatoryUserIds: z.array(z.string().min(1)).max(10).default([]),
  notifyOnCompletion: z.boolean(),
});
export type SignatureWorkflow = z.infer<typeof signatureWorkflowSchema>;

const settingsSchema = z.object({
  titleFormat: z.string().max(TEMPLATE_LIMITS.MAX_TITLE_FORMAT_LENGTH).default('{date}'),
  documentNumberFormat: z.string().max(120).default('{counter:6}'),
  documentNumberStart: z.number().int().min(1).default(1),
  approvalPage: approvalPageSchema.optional(),
  branding: brandingSchema.optional(),
  signatureWorkflow: signatureWorkflowSchema.optional(),
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

    // ── Jump-to (forward skip logic) must point strictly below the question ──
    const setById = new Map(content.customResponseSets.map((s) => [s.id, s]));
    const pageOrder = new Map<string, number>();
    const itemPageOrder = new Map<string, number>(); // itemId → its page's order
    const itemGlobalIndex = new Map<string, number>();
    let order = 0;
    let gidx = 0;
    for (const page of content.pages) {
      if (page.type !== 'inspection') continue;
      pageOrder.set(page.id, order);
      for (const section of page.sections) {
        for (const item of section.items) {
          itemPageOrder.set(item.id, order);
          itemGlobalIndex.set(item.id, gidx++);
        }
      }
      order++;
    }
    for (const item of allItems.values()) {
      if (item.type !== 'multipleChoice' || item.jumps === undefined) continue;
      const set = setById.get(item.responseSetId);
      if (set !== undefined && set.multiSelect && item.jumps.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Jump-to is only allowed on single-select questions',
          path: ['pages'],
        });
      }
      const optionIds = new Set(set?.options.map((o) => o.id) ?? []);
      const fromIndex = itemGlobalIndex.get(item.id) ?? -1;
      const fromPage = itemPageOrder.get(item.id) ?? -1;
      for (const jump of item.jumps) {
        if (set !== undefined && !optionIds.has(jump.optionId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Jump references an option not in the question's set: ${jump.optionId}`,
            path: ['pages'],
          });
        }
        if (jump.target.type === 'question') {
          const toIndex = itemGlobalIndex.get(jump.target.questionId);
          if (toIndex === undefined || toIndex <= fromIndex) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Jump target question must be below the question',
              path: ['pages'],
            });
          }
        } else if (jump.target.type === 'page') {
          const toPage = pageOrder.get(jump.target.pageId);
          if (toPage === undefined || toPage <= fromPage) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'Jump target page must be below the question',
              path: ['pages'],
            });
          }
        }
        // type 'end' is always a valid forward target.
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
    // Note: 'site' and 'asset' are intentionally excluded here — both are
    // allowed on the title page AND as regular question response types.
    // 'site' auto-populates the inspection's site; 'asset' lets inspectors
    // multi-select assets they inspected.
    const titlePageOnly = new Set([
      'conductedBy',
      'inspectionDate',
      'documentNumber',
      'location',
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
 * Effective set of flagged option ids for a multipleChoice question.
 *
 * Flagging lives on the question (`flaggedOptionIds`). When that's absent
 * (legacy content authored before per-question flagging), fall back to the
 * set options' deprecated per-option `flagged` flag so old templates and
 * in-flight inspections keep highlighting the same responses.
 */
export function effectiveFlaggedOptionIds(
  item: { flaggedOptionIds?: readonly string[] | undefined },
  set: { options: ReadonlyArray<{ id: string; flagged?: boolean | undefined }> } | undefined,
): string[] {
  if (item.flaggedOptionIds !== undefined) return [...item.flaggedOptionIds];
  return (set?.options ?? []).filter((o) => o.flagged === true).map((o) => o.id);
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

/**
 * Validate the template-level signature workflow settings.
 *
 * Catches the configuration mistake where workflow is enabled but no
 * signatories are listed — that would leave a submitted inspection
 * stranded in `awaiting_signature_workflow` with nobody able to sign.
 * Called at the templates router publish boundary.
 */
export function validateSignatureWorkflow(content: TemplateContent): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const sw = content.settings.signatureWorkflow;
  if (sw !== undefined && sw.enabled) {
    if (sw.signatoryUserIds.length < 1) {
      errors.push('Signature workflow is enabled but has no signatories.');
    }
  }
  return { valid: errors.length === 0, errors };
}

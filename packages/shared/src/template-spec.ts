/**
 * AI-facing "template spec" — a deliberately small, forgiving schema the
 * generation agent (chat / PDF / Excel) emits. It is NOT the real template
 * content: `buildTemplateContentFromSpec` (template-builder.ts) expands it into
 * a schema-valid `TemplateContent` (ids, response-set snapshots, dense
 * slotIndex, forward-only jumps, triggers, title page, settings).
 *
 * Keeping the AI's output tiny is the whole point — the model handles wording
 * and structure; the deterministic builder guarantees correctness.
 */
import { z } from 'zod';

/** Question types the AI may use. Maps 1:1 onto supported template item types. */
export const SPEC_QUESTION_TYPES = [
  'multipleChoice',
  'text',
  'number',
  'date',
  'datetime',
  'time',
  'checkbox',
  'slider',
  'media',
  'instruction',
  'signature',
] as const;
export type SpecQuestionType = (typeof SPEC_QUESTION_TYPES)[number];

/** Preset colours (must match the response-colour palette keys). */
export const SPEC_COLORS = [
  'green',
  'amber',
  'orange',
  'red',
  'blue',
  'teal',
  'purple',
  'grey',
] as const;

/**
 * One answer option for a multiple-choice question. Logic hints here are
 * resolved by the builder into per-question flags, forward jumps and option
 * triggers.
 */
const specOptionSchema = z.object({
  label: z.string().min(1).max(200),
  color: z.enum(SPEC_COLORS).optional(),
  /** Flag this response for the question (surfaces at the top of the report). */
  flag: z.boolean().optional(),
  /**
   * Forward skip: the `key` of a later question, or the literal "finish".
   * Backward / unknown targets are dropped by the builder. Single-select only.
   */
  jumpTo: z.string().max(80).optional(),
  /** Require a photo/file/video when this option is chosen. */
  requireEvidence: z.boolean().optional(),
  /** Auto-create a corrective action with this title when chosen. */
  requireAction: z.string().max(500).optional(),
  /** Email to notify on submit when this option is chosen. */
  notifyEmail: z.string().email().max(320).optional(),
});
export type SpecOption = z.infer<typeof specOptionSchema>;

const specQuestionSchema = z.object({
  /** Stable key used as a `jumpTo` target. Optional; generated if absent. */
  key: z.string().min(1).max(80).optional(),
  prompt: z.string().min(1).max(1000),
  type: z.enum(SPEC_QUESTION_TYPES).default('multipleChoice'),
  required: z.boolean().optional(),
  /** Multiple-choice: allow multiple answers (disables jumps for this question). */
  multiSelect: z.boolean().optional(),
  options: z.array(specOptionSchema).max(40).optional(),
  /** Instruction body (markdown). Falls back to `prompt`. */
  body: z.string().max(5000).optional(),
  /** Number / slider extras. */
  unit: z.string().max(40).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
});
export type SpecQuestion = z.infer<typeof specQuestionSchema>;

const specSectionSchema = z.object({
  title: z.string().max(200).default('Section'),
  questions: z.array(specQuestionSchema).max(200).default([]),
});

const specPageSchema = z.object({
  title: z.string().max(200).default('Page'),
  sections: z.array(specSectionSchema).min(1).max(50),
});

export const templateSpecSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  pages: z.array(specPageSchema).min(1).max(40),
});
export type TemplateSpec = z.infer<typeof templateSpecSchema>;

/** Parse unknown JSON (e.g. an AI tool call) into a typed spec. */
export function parseTemplateSpec(input: unknown): TemplateSpec {
  return templateSpecSchema.parse(input);
}

/**
 * Pure evaluation helpers for a conducted inspection.
 *
 * Given the (immutable, pinned) template content and the response map, these
 * compute the things every surface needs and must agree on:
 *   - human-readable answer labels for multiple-choice responses,
 *   - which answered responses are FLAGGED (for the report's flagged summary),
 *   - which option TRIGGERS are currently active (askFollowUp / requireAction /
 *     requireEvidence / requireNote / notify),
 *   - which follow-up questions an `askFollowUp` trigger reveals.
 *
 * Everything here is pure and JSON-only so it can run in the browser (conduct
 * UI), the worker (submit side-effects) and the renderer (report) alike.
 */
import type {
  CustomResponseSet,
  ResponseOption,
  TemplateContent,
  Trigger,
} from './template-schema';
import { effectiveFlaggedOptionIds } from './template-schema';

// ─── Selection helpers ──────────────────────────────────────────────────────

/** Selected option ids for a multiple-choice response value (single or multi). */
export function selectedOptionIds(value: unknown): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

interface McItem {
  id: string;
  type: 'multipleChoice';
  prompt: string;
  responseSetId: string;
  flaggedOptionIds?: readonly string[] | undefined;
}

function isMcItem(item: { type?: string }): item is McItem {
  return item.type === 'multipleChoice';
}

/** Index every response set by id for O(1) lookup. */
function setsById(content: TemplateContent): Map<string, CustomResponseSet> {
  const m = new Map<string, CustomResponseSet>();
  for (const s of content.customResponseSets) m.set(s.id, s);
  return m;
}

// ─── Answer labels ──────────────────────────────────────────────────────────

/**
 * Resolve the selected option labels for a multiple-choice item. Returns the
 * option labels in template order (not selection order). Unknown ids are
 * skipped. Non-MC items return `null` so the caller can stringify their value.
 */
export function multipleChoiceLabels(
  content: TemplateContent,
  item: { type?: string; responseSetId?: string },
  value: unknown,
): string[] | null {
  if (item.type !== 'multipleChoice' || typeof item.responseSetId !== 'string') return null;
  const set = setsById(content).get(item.responseSetId);
  if (set === undefined) return [];
  const selected = new Set(selectedOptionIds(value));
  return set.options.filter((o) => selected.has(o.id)).map((o) => o.label);
}

// ─── Flagged answers (for the report's "Flagged items" summary) ─────────────

export interface FlaggedAnswer {
  itemId: string;
  prompt: string;
  pageTitle: string;
  sectionTitle: string;
  /** The flagged option(s) the inspector actually selected. */
  options: Array<{ id: string; label: string }>;
}

/**
 * Every answered multiple-choice question where the selected option(s) include
 * a response that is flagged FOR THAT QUESTION. Returned in template order so
 * the report can list them at the top deterministically.
 */
export function collectFlaggedAnswers(
  content: TemplateContent,
  responses: Record<string, unknown>,
): FlaggedAnswer[] {
  const sets = setsById(content);
  const out: FlaggedAnswer[] = [];
  for (const page of content.pages) {
    if (page.type === 'title') continue;
    for (const section of page.sections) {
      for (const item of section.items) {
        if (!isMcItem(item)) continue;
        const set = sets.get(item.responseSetId);
        if (set === undefined) continue;
        const flagged = new Set(effectiveFlaggedOptionIds(item, set));
        if (flagged.size === 0) continue;
        const selected = new Set(selectedOptionIds(responses[item.id]));
        const hitOptions = set.options.filter((o) => selected.has(o.id) && flagged.has(o.id));
        if (hitOptions.length === 0) continue;
        out.push({
          itemId: item.id,
          prompt: item.prompt,
          pageTitle: page.title,
          sectionTitle: section.title,
          options: hitOptions.map((o) => ({ id: o.id, label: o.label })),
        });
      }
    }
  }
  return out;
}

/** True if the inspector selected a flagged option for this specific item. */
export function isAnswerFlagged(
  content: TemplateContent,
  item: { id: string; type?: string; responseSetId?: string; flaggedOptionIds?: readonly string[] },
  value: unknown,
): boolean {
  if (item.type !== 'multipleChoice' || typeof item.responseSetId !== 'string') return false;
  const set = setsById(content).get(item.responseSetId);
  if (set === undefined) return false;
  const flagged = new Set(effectiveFlaggedOptionIds(item, set));
  if (flagged.size === 0) return false;
  return selectedOptionIds(value).some((id) => flagged.has(id));
}

// ─── Triggers ───────────────────────────────────────────────────────────────

export interface ActiveTrigger {
  /** The multiple-choice question whose selected option carries the trigger. */
  itemId: string;
  /** The selected option id that activated it. */
  optionId: string;
  optionLabel: string;
  trigger: Trigger;
}

function optionTriggers(option: ResponseOption): ReadonlyArray<Trigger> {
  return option.triggers ?? [];
}

/**
 * Every trigger that is currently active: i.e. attached to an option the
 * inspector has selected on a visible-or-not question (visibility is handled
 * by the caller; this walks the raw response map). Order is template order.
 */
export function collectActiveTriggers(
  content: TemplateContent,
  responses: Record<string, unknown>,
): ActiveTrigger[] {
  const sets = setsById(content);
  const out: ActiveTrigger[] = [];
  for (const page of content.pages) {
    for (const section of page.sections) {
      for (const item of section.items) {
        if (!isMcItem(item)) continue;
        const set = sets.get(item.responseSetId);
        if (set === undefined) continue;
        const selected = new Set(selectedOptionIds(responses[item.id]));
        for (const option of set.options) {
          if (!selected.has(option.id)) continue;
          for (const trigger of optionTriggers(option)) {
            out.push({ itemId: item.id, optionId: option.id, optionLabel: option.label, trigger });
          }
        }
      }
    }
  }
  return out;
}

// ─── askFollowUp reveal ─────────────────────────────────────────────────────

/**
 * Map of follow-up target question id → the (question, option) pairs that
 * reveal it. A question listed in some option's `askFollowUp.questionIds` is a
 * "follow-up": it stays hidden until one of those options is selected.
 */
export function followUpTargetMap(
  content: TemplateContent,
): Map<string, Array<{ itemId: string; optionId: string }>> {
  const sets = setsById(content);
  const map = new Map<string, Array<{ itemId: string; optionId: string }>>();
  for (const page of content.pages) {
    for (const section of page.sections) {
      for (const item of section.items) {
        if (!isMcItem(item)) continue;
        const set = sets.get(item.responseSetId);
        if (set === undefined) continue;
        for (const option of set.options) {
          for (const trigger of optionTriggers(option)) {
            if (trigger.kind !== 'askFollowUp') continue;
            for (const targetId of trigger.questionIds) {
              const entry = map.get(targetId) ?? [];
              entry.push({ itemId: item.id, optionId: option.id });
              map.set(targetId, entry);
            }
          }
        }
      }
    }
  }
  return map;
}

/**
 * True when a follow-up question should be revealed: either it is not a
 * follow-up target at all, or at least one of the options that reference it is
 * currently selected. Independent of the item's own `visibility` block, which
 * the caller still applies.
 */
export function isFollowUpRevealed(
  targetItemId: string,
  followUps: Map<string, Array<{ itemId: string; optionId: string }>>,
  responses: Record<string, unknown>,
): boolean {
  const sources = followUps.get(targetItemId);
  if (sources === undefined || sources.length === 0) return true;
  return sources.some(({ itemId, optionId }) =>
    selectedOptionIds(responses[itemId]).includes(optionId),
  );
}

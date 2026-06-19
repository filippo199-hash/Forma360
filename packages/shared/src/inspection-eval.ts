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
  Item,
  JumpTarget,
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
  /** The question prompt (for notification copy / audit). */
  prompt: string;
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
            out.push({
              itemId: item.id,
              prompt: item.prompt,
              optionId: option.id,
              optionLabel: option.label,
              trigger,
            });
          }
        }
      }
    }
  }
  return out;
}

// ─── requireEvidence ────────────────────────────────────────────────────────

/**
 * Reserved response-map key holding the evidence (R2 object keys) uploaded to
 * satisfy a question's `requireEvidence` trigger. Distinct from the question's
 * own answer key; never collides with a real item id (ULID).
 */
export function evidenceKey(itemId: string): string {
  return `evidence:${itemId}`;
}

/** Evidence object keys captured for a question (empty when none). */
export function getEvidenceKeys(responses: Record<string, unknown>, itemId: string): string[] {
  const v = responses[evidenceKey(itemId)];
  return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
}

/**
 * Minimum evidence count an item currently requires given the selected
 * option(s). 0 when no selected option carries a requireEvidence trigger.
 * Drives whether the conduct UI shows an evidence uploader for the item.
 */
export function requiredEvidenceCount(
  content: TemplateContent,
  itemId: string,
  responses: Record<string, unknown>,
): number {
  let need = 0;
  for (const active of collectActiveTriggers(content, responses)) {
    if (active.itemId === itemId && active.trigger.kind === 'requireEvidence') {
      need = Math.max(need, active.trigger.minCount);
    }
  }
  return need;
}

/**
 * Questions whose selected option requires evidence but which don't yet have
 * enough uploaded. Each entry carries the minimum required count so the UI can
 * show "1 of 2". Used to gate submit on both the client and the server.
 */
export interface MissingEvidence {
  itemId: string;
  prompt: string;
  have: number;
  need: number;
}

export function missingEvidence(
  content: TemplateContent,
  responses: Record<string, unknown>,
): MissingEvidence[] {
  const byItem = new Map<string, { prompt: string; need: number }>();
  // Build a prompt lookup for the multiple-choice items.
  const prompts = new Map<string, string>();
  for (const page of content.pages) {
    for (const section of page.sections) {
      for (const item of section.items) {
        if (isMcItem(item)) prompts.set(item.id, item.prompt);
      }
    }
  }
  for (const active of collectActiveTriggers(content, responses)) {
    if (active.trigger.kind !== 'requireEvidence') continue;
    const need = active.trigger.minCount;
    const prev = byItem.get(active.itemId);
    // If multiple selected options require evidence, take the strictest count.
    byItem.set(active.itemId, {
      prompt: prompts.get(active.itemId) ?? active.itemId,
      need: prev ? Math.max(prev.need, need) : need,
    });
  }
  const out: MissingEvidence[] = [];
  for (const [itemId, { prompt, need }] of byItem) {
    const have = getEvidenceKeys(responses, itemId).length;
    if (have < need) out.push({ itemId, prompt, have, need });
  }
  return out;
}

// ─── Jump-to (forward skip logic) ───────────────────────────────────────────

interface FlatItem {
  itemId: string;
  pageId: string;
  globalIndex: number;
  jumps?: ReadonlyArray<{ optionId: string; target: JumpTarget }>;
}

interface Flattened {
  list: FlatItem[];
  /** itemId → its global index. */
  indexOf: Map<string, number>;
  /** inspection pageId → the global index its first item would occupy. */
  pageStart: Map<string, number>;
}

/** Flatten inspection-page items into document order (title pages excluded). */
function flattenInspection(content: TemplateContent): Flattened {
  const list: FlatItem[] = [];
  const indexOf = new Map<string, number>();
  const pageStart = new Map<string, number>();
  let gidx = 0;
  for (const page of content.pages) {
    if (page.type !== 'inspection') continue;
    pageStart.set(page.id, gidx);
    for (const section of page.sections) {
      for (const item of section.items) {
        const jumps =
          item.type === 'multipleChoice'
            ? (item as { jumps?: FlatItem['jumps'] }).jumps
            : undefined;
        list.push({
          itemId: item.id,
          pageId: page.id,
          globalIndex: gidx,
          ...(jumps ? { jumps } : {}),
        });
        indexOf.set(item.id, gidx);
        gidx++;
      }
    }
  }
  return { list, indexOf, pageStart };
}

/**
 * The global index a question's active jump skips *up to* (exclusive), or null
 * when the question has no active forward jump. Jump-to is single-select, so
 * the selected option (if any) decides; defensively we take the nearest target
 * if more than one option is somehow selected, and ignore non-forward targets.
 */
function activeJumpBoundary(
  flat: Flattened,
  entry: FlatItem,
  responses: Record<string, unknown>,
): number | null {
  if (entry.jumps === undefined || entry.jumps.length === 0) return null;
  const selected = new Set(selectedOptionIds(responses[entry.itemId]));
  if (selected.size === 0) return null;
  let boundary: number | null = null;
  for (const jump of entry.jumps) {
    if (!selected.has(jump.optionId)) continue;
    let to: number | undefined;
    if (jump.target.type === 'end') to = flat.list.length;
    else if (jump.target.type === 'question') to = flat.indexOf.get(jump.target.questionId);
    else to = flat.pageStart.get(jump.target.pageId);
    // Forward-only: ignore a target at/above this question.
    if (to === undefined || to <= entry.globalIndex) continue;
    boundary = boundary === null ? to : Math.min(boundary, to);
  }
  return boundary;
}

/**
 * Item ids skipped by active forward jumps, given the live responses. A single
 * forward pass: when a question's selected option jumps ahead, every item up to
 * the target is skipped (and a skipped question's own jump never fires).
 */
export function computeSkippedItemIds(
  content: TemplateContent,
  responses: Record<string, unknown>,
): Set<string> {
  const flat = flattenInspection(content);
  const skipped = new Set<string>();
  let skipUntil = -1;
  for (let i = 0; i < flat.list.length; i++) {
    const entry = flat.list[i];
    if (entry === undefined) continue;
    if (i < skipUntil) {
      skipped.add(entry.itemId);
      continue;
    }
    const boundary = activeJumpBoundary(flat, entry, responses);
    if (boundary !== null && boundary > i + 1) {
      skipUntil = Math.max(skipUntil, boundary);
    }
  }
  return skipped;
}

/** Inspection page ids that are fully skipped (have items, all skipped). */
export function skippedInspectionPageIds(
  content: TemplateContent,
  responses: Record<string, unknown>,
): Set<string> {
  const skipped = computeSkippedItemIds(content, responses);
  const out = new Set<string>();
  for (const page of content.pages) {
    if (page.type !== 'inspection') continue;
    const items = page.sections.flatMap((s) => s.items);
    if (items.length > 0 && items.every((i) => skipped.has(i.id))) out.add(page.id);
  }
  return out;
}

/**
 * Valid forward jump targets for a question (for the editor's target picker):
 * questions physically below it and pages below its page. Excludes the
 * "Finish inspection" pseudo-target, which the caller always offers.
 */
export function forwardJumpTargets(
  content: TemplateContent,
  questionId: string,
): {
  questions: Array<{ id: string; prompt: string }>;
  pages: Array<{ id: string; title: string }>;
} {
  const flat = flattenInspection(content);
  const fromIndex = flat.indexOf.get(questionId);
  if (fromIndex === undefined) return { questions: [], pages: [] };
  const questions = flat.list
    .filter((e) => e.globalIndex > fromIndex)
    .map((e) => {
      const item = findItem(content, e.itemId);
      return {
        id: e.itemId,
        prompt: (item && 'prompt' in item ? item.prompt : e.itemId) ?? e.itemId,
      };
    });
  const fromPageStart = flat.pageStart.get(flat.list[fromIndex]?.pageId ?? '');
  const pages: Array<{ id: string; title: string }> = [];
  for (const page of content.pages) {
    if (page.type !== 'inspection') continue;
    const start = flat.pageStart.get(page.id) ?? -1;
    if (fromPageStart !== undefined && start > fromPageStart) {
      pages.push({ id: page.id, title: page.title });
    }
  }
  return { questions, pages };
}

function findItem(content: TemplateContent, itemId: string): Item | undefined {
  for (const page of content.pages) {
    for (const section of page.sections) {
      for (const item of section.items) {
        if (item.id === itemId) return item;
      }
    }
  }
  return undefined;
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

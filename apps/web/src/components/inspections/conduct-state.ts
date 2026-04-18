/**
 * Inspection conduct reducer + helpers.
 *
 * Mirrors the template editor reducer pattern (see
 * `components/templates/editor-state.ts`). One reducer owns the full
 * in-flight response map, the autosave status, and the currently-selected
 * page. Visibility and required-completeness are derived as pure helpers
 * so both the render layer and the submit-gate can compute them cheaply.
 */
import type {
  Item,
  Section,
  TemplateContent,
  Visibility,
} from '@forma360/shared/template-schema';

// ─── Response value shapes ──────────────────────────────────────────────────

/**
 * Responses are keyed by item id. The shape of each value depends on the
 * item type; we store them as `unknown` because the backend round-trips
 * them as JSON and validates at render time — not at write time.
 *   - text/number/date/time/datetime: string (number uses string for free-form input)
 *   - multipleChoice single: string (option id)
 *   - multipleChoice multi: string[] (option ids)
 *   - checkbox: boolean
 *   - slider: number
 *   - media: string[] (object keys)
 *   - signature: stored via the signatures endpoint; responses map never holds them.
 */
export type Responses = Record<string, unknown>;

export type SaveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'offline' }
  | { kind: 'conflict' };

export interface ConductState {
  /** The pinned template content — immutable for the life of the inspection. */
  content: TemplateContent;
  inspectionId: string;
  title: string;
  documentNumber: string | null;
  inspectionStatus: string;
  startedAt: string;
  conductedByUserId: string;
  /** Responses keyed by item id. */
  responses: Responses;
  /** updatedAt of the inspection at the time we loaded it; bumped on every save. */
  loadedUpdatedAt: string;
  saveStatus: SaveStatus;
  /** Currently-visible page id. */
  selectedPageId: string;
}

export type ConductAction =
  | { type: 'LOAD_INSPECTION'; state: Omit<ConductState, 'saveStatus'> }
  | { type: 'SET_RESPONSE'; itemId: string; value: unknown }
  | { type: 'SET_PAGE'; pageId: string }
  | { type: 'MARK_SAVING' }
  | { type: 'MARK_SAVED'; updatedAt: string }
  | { type: 'MARK_CONFLICT' }
  | { type: 'MARK_OFFLINE' }
  | { type: 'MERGE_RESPONSES'; responses: Responses };

export function conductReducer(state: ConductState, action: ConductAction): ConductState {
  switch (action.type) {
    case 'LOAD_INSPECTION':
      return { ...action.state, saveStatus: { kind: 'idle' } };
    case 'SET_RESPONSE': {
      if (state.inspectionStatus !== 'in_progress') return state;
      return {
        ...state,
        responses: { ...state.responses, [action.itemId]: action.value },
      };
    }
    case 'SET_PAGE':
      return { ...state, selectedPageId: action.pageId };
    case 'MARK_SAVING':
      return { ...state, saveStatus: { kind: 'saving' } };
    case 'MARK_SAVED':
      return {
        ...state,
        loadedUpdatedAt: action.updatedAt,
        saveStatus: { kind: 'saved', at: action.updatedAt },
      };
    case 'MARK_CONFLICT':
      return { ...state, saveStatus: { kind: 'conflict' } };
    case 'MARK_OFFLINE':
      return { ...state, saveStatus: { kind: 'offline' } };
    case 'MERGE_RESPONSES':
      return { ...state, responses: { ...state.responses, ...action.responses } };
    default:
      return state;
  }
}

// ─── Visibility evaluation ──────────────────────────────────────────────────

/**
 * Pure evaluation of a visibility block against the current response map.
 *
 * Returns true when the item should render. If the dependency hasn't been
 * answered yet the rule behaves like `isEmpty/isPresent`:
 *   - `answered`: false until the response exists
 *   - `notAnswered`: true until the response exists
 *   - any comparator: false (no value to compare)
 *
 * Any item referenced by visibility should exist in the template —
 * schema-side validation guarantees that. If a stale reference slips
 * through (e.g. a migration bug), we fall through to "show it" rather
 * than hiding the field silently.
 */
export function evaluateVisibility(visibility: Visibility, responses: Responses): boolean {
  const current = responses[visibility.dependsOn];
  const hasResponse =
    current !== undefined &&
    current !== null &&
    current !== '' &&
    !(Array.isArray(current) && current.length === 0);

  switch (visibility.operator) {
    case 'answered':
      return hasResponse;
    case 'notAnswered':
      return !hasResponse;
    case 'equals':
      return hasResponse && deepEquals(current, visibility.value);
    case 'notEquals':
      return !hasResponse || !deepEquals(current, visibility.value);
    case 'in': {
      if (!hasResponse) return false;
      const target = Array.isArray(visibility.value) ? visibility.value : [visibility.value];
      if (Array.isArray(current)) {
        return current.some((c) => target.some((t) => deepEquals(c, t)));
      }
      return target.some((t) => deepEquals(current, t));
    }
    case 'notIn': {
      if (!hasResponse) return true;
      const target = Array.isArray(visibility.value) ? visibility.value : [visibility.value];
      if (Array.isArray(current)) {
        return !current.some((c) => target.some((t) => deepEquals(c, t)));
      }
      return !target.some((t) => deepEquals(current, t));
    }
  }
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEquals(v, b[i]));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

// ─── Item visibility walk ───────────────────────────────────────────────────

/**
 * True when an item is currently visible given the live response map.
 * Items without a visibility block are always visible.
 */
export function isItemVisible(item: Item, responses: Responses): boolean {
  const visibility = 'visibility' in item ? item.visibility : undefined;
  if (visibility === undefined) return true;
  return evaluateVisibility(visibility, responses);
}

// ─── Required-completeness ──────────────────────────────────────────────────

/**
 * Does every visible required item have a response? Signature / media /
 * stub types that do NOT round-trip through `responses` are exempt here
 * — signatures are gated at submit time by the server, and stubs are
 * explicitly "coming soon" in the UI copy.
 *
 * Types included in the required check:
 *   text, number, date, time, datetime, multipleChoice, checkbox, slider.
 *
 * Media: requires at least one key in the responses entry.
 */
export function findUnansweredRequired(
  content: TemplateContent,
  responses: Responses,
): string[] {
  const missing: string[] = [];
  for (const page of content.pages) {
    for (const section of page.sections) {
      for (const item of section.items) {
        if (!isItemVisible(item, responses)) continue;
        if (!('required' in item) || !item.required) continue;
        if (!isResponseRequirable(item)) continue;
        const v = responses[item.id];
        if (!hasValue(v)) missing.push(item.id);
      }
    }
  }
  return missing;
}

function isResponseRequirable(item: Item): boolean {
  switch (item.type) {
    case 'text':
    case 'number':
    case 'date':
    case 'time':
    case 'datetime':
    case 'multipleChoice':
    case 'checkbox':
    case 'slider':
    case 'media':
      return true;
    // Signatures are enforced by the signatures router; autopopulated
    // fields (conductedBy/inspectionDate/documentNumber) don't need a
    // response. Stubs/tables/location/etc. are not yet supported so we
    // don't block submission on them.
    default:
      return false;
  }
}

function hasValue(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

// ─── Initial state ──────────────────────────────────────────────────────────

export function initialConductState(seed: Omit<ConductState, 'saveStatus'>): ConductState {
  return { ...seed, saveStatus: { kind: 'idle' } };
}

// ─── Sections helper ────────────────────────────────────────────────────────

/** List all sections for a given page, preserving order. */
export function pageSections(content: TemplateContent, pageId: string): Section[] {
  const page = content.pages.find((p) => p.id === pageId);
  return page?.sections ?? [];
}

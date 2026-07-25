/**
 * Deterministic builder: a small AI `TemplateSpec` → a schema-valid
 * `TemplateContent`. This is where all the fiddly invariants are guaranteed so
 * the model never has to: ULIDs on every node, response sets snapshotted into
 * `customResponseSets`, per-question flags + forward-only jumps resolved from
 * option `key`s, option triggers, a standard title page, and settings defaults.
 *
 * Anything the model gets slightly wrong (a backward jump, an unknown jump
 * target, a jump on a multi-select question) is DROPPED, not fatal — the result
 * always passes `templateContentSchema.parse()`.
 */
import { newId } from './id';
import {
  TEMPLATE_SCHEMA_VERSION,
  templateContentSchema,
  type CustomResponseSet,
  type Item,
  type QuestionJump,
  type ResponseOption,
  type TemplateContent,
  type Trigger,
} from './template-schema';
import type { SpecOption, SpecQuestion, TemplateSpec } from './template-spec';

/**
 * Item types the schema only permits on the title page. If the AI emits one of
 * these as a normal question, the builder relocates it onto the title page.
 * Mirrors the `titlePageOnly` set in template-schema.ts.
 */
const TITLE_PAGE_ONLY = new Set<Item['type']>([
  'conductedBy',
  'inspectionDate',
  'documentNumber',
  'location',
  'company',
]);

interface BuildCtx {
  customResponseSets: CustomResponseSet[];
  /** question key → assigned item id (for jump targets). */
  keyToId: Map<string, string>;
  /** question key → global document index (for forward-only validation). */
  keyToGlobal: Map<string, number>;
  /**
   * Dedup index: a canonical signature of a response set's options
   * (labels + colours + triggers + multiSelect) → the set id and its option
   * ids. Identical option lists across questions share ONE set so the client
   * isn't flooded with duplicate "OK / Defect" sets — see the user feedback.
   */
  setBySignature: Map<string, { id: string; optionIds: string[] }>;
}

/** The shared part of an option (lives on the response set, so it dedupes). */
interface SetOption {
  label: string;
  color: ResponseOption['color'];
  triggers?: Trigger[];
}

function optionTriggers(opt: SpecOption): Trigger[] {
  const triggers: Trigger[] = [];
  if (opt.requireEvidence === true)
    triggers.push({ kind: 'requireEvidence', mediaKind: 'any', minCount: 1 });
  if (opt.requireAction !== undefined && opt.requireAction.trim().length > 0)
    triggers.push({ kind: 'requireAction', actionTitle: opt.requireAction.trim() });
  if (opt.notifyEmail !== undefined)
    triggers.push({ kind: 'notify', email: opt.notifyEmail, timing: 'onCompletion' });
  return triggers;
}

/** Get or create a deduplicated response set, returning its id + option ids. */
function resolveResponseSet(
  setOptions: SetOption[],
  multiSelect: boolean,
  ctx: BuildCtx,
): { id: string; optionIds: string[] } {
  // Dedup key is the option *scale* (labels + colors) only — NOT the triggers.
  // Triggers (requireAction title, requireEvidence, notify) vary per question,
  // and if they were part of the key the AI would spawn a near-duplicate
  // "Yes / No / N/A" set for every question that scored the same scale with a
  // slightly different action title. Keying on {label,color} collapses those
  // into one shared set; the first question's triggers are the ones kept (the
  // generation agent is prompted to use a uniform trigger per repeated scale).
  const signature = JSON.stringify({
    multiSelect,
    options: setOptions.map((o) => ({ label: o.label, color: o.color })),
  });
  const existing = ctx.setBySignature.get(signature);
  if (existing !== undefined) return existing;

  const optionIds = setOptions.map(() => newId());
  const options: ResponseOption[] = setOptions.map((o, i) => ({
    id: optionIds[i] ?? newId(),
    label: o.label,
    color: o.color,
    ...(o.triggers !== undefined && o.triggers.length > 0 ? { triggers: o.triggers } : {}),
  }));
  const name =
    options
      .slice(0, 3)
      .map((o) => o.label)
      .join(' / ')
      .slice(0, 60) || 'Responses';
  const id = newId();
  ctx.customResponseSets.push({ id, name, sourceGlobalId: null, multiSelect, options });
  const resolved = { id, optionIds };
  ctx.setBySignature.set(signature, resolved);
  return resolved;
}

/** Build response options + the flag/jump/trigger projections for an MC question. */
function buildMultipleChoice(
  q: SpecQuestion,
  itemId: string,
  globalIndex: number,
  ctx: BuildCtx,
): Extract<Item, { type: 'multipleChoice' }> {
  const multiSelect = q.multiSelect === true;
  const rawOptions: SpecOption[] =
    q.options !== undefined && q.options.length > 0
      ? q.options
      : [
          { label: 'Yes', color: 'green' },
          { label: 'No', color: 'red', flag: true },
          { label: 'N/A', color: 'grey' },
        ];

  // Set-level content (shared / dedup key) excludes per-question flag + jump.
  const setOptions: SetOption[] = rawOptions.map((opt) => {
    const triggers = optionTriggers(opt);
    return {
      label: opt.label,
      color: opt.color ?? (opt.flag === true ? 'red' : 'grey'),
      ...(triggers.length > 0 ? { triggers } : {}),
    };
  });

  const { id: responseSetId, optionIds } = resolveResponseSet(setOptions, multiSelect, ctx);

  // Per-question flags + forward-only jumps, mapped onto the (shared) option ids.
  const flaggedOptionIds: string[] = [];
  const jumps: QuestionJump[] = [];
  rawOptions.forEach((opt, i) => {
    const optionId = optionIds[i];
    if (optionId === undefined) return;
    if (opt.flag === true) flaggedOptionIds.push(optionId);
    if (!multiSelect && opt.jumpTo !== undefined) {
      if (opt.jumpTo === 'finish') {
        jumps.push({ optionId, target: { type: 'end' } });
      } else {
        const targetGlobal = ctx.keyToGlobal.get(opt.jumpTo);
        const targetId = ctx.keyToId.get(opt.jumpTo);
        if (targetGlobal !== undefined && targetId !== undefined && targetGlobal > globalIndex) {
          jumps.push({ optionId, target: { type: 'question', questionId: targetId } });
        }
        // backward / unknown target → dropped
      }
    }
  });

  return {
    id: itemId,
    type: 'multipleChoice',
    prompt: q.prompt,
    required: q.required === true,
    responseSetId,
    ...(flaggedOptionIds.length > 0 ? { flaggedOptionIds } : {}),
    ...(jumps.length > 0 ? { jumps } : {}),
  };
}

/** Build a single item from a spec question. */
function buildItem(q: SpecQuestion, itemId: string, globalIndex: number, ctx: BuildCtx): Item {
  const base = { id: itemId, prompt: q.prompt, required: q.required === true };
  switch (q.type) {
    case 'multipleChoice':
      return buildMultipleChoice(q, itemId, globalIndex, ctx);
    case 'text':
      return { ...base, type: 'text', multiline: false, maxLength: 2000 };
    case 'number':
      return {
        ...base,
        type: 'number',
        decimalPlaces: 2,
        ...(q.unit !== undefined ? { unit: q.unit } : {}),
        ...(q.min !== undefined ? { min: q.min } : {}),
        ...(q.max !== undefined ? { max: q.max } : {}),
      };
    case 'date':
      return { ...base, type: 'date' };
    case 'datetime':
      return { ...base, type: 'datetime' };
    case 'time':
      return { ...base, type: 'time' };
    case 'checkbox':
      return { ...base, type: 'checkbox', label: q.prompt };
    case 'slider':
      return {
        ...base,
        type: 'slider',
        min: q.min ?? 0,
        max: q.max ?? 10,
        step: q.step ?? 1,
      };
    case 'media':
      return { ...base, type: 'media', mediaKind: 'any', maxCount: 10 };
    case 'signature':
      return {
        ...base,
        type: 'signature',
        mode: 'parallel',
        slots: [{ slotIndex: 0, assigneeUserId: null, label: q.prompt.slice(0, 80) }],
      };
    case 'instruction':
      return {
        id: itemId,
        type: 'instruction',
        body: (q.body ?? q.prompt).slice(0, 5000),
        attachments: [],
        showInReport: true,
      };
    // Smart pickers: a person who is a system user, a tracked asset, a site or a
    // location. The AI should reach for these instead of free text.
    case 'user':
      return { ...base, type: 'conductedBy' };
    case 'asset':
      return { ...base, type: 'asset' };
    case 'site':
      return { ...base, type: 'site' };
    case 'location':
      return { ...base, type: 'location' };
  }
}

/** A standard title page (auto-populated fields), matching the default scaffold. */
function buildTitlePage(): TemplateContent['pages'][number] {
  return {
    id: newId(),
    type: 'title',
    title: 'Title Page',
    sections: [
      {
        id: newId(),
        title: 'Details',
        items: [
          { id: newId(), type: 'site', prompt: 'Site conducted', required: false },
          { id: newId(), type: 'inspectionDate', prompt: 'Conducted on', required: false },
          { id: newId(), type: 'conductedBy', prompt: 'Prepared by', required: false },
          { id: newId(), type: 'location', prompt: 'Location', required: false },
        ],
      },
    ],
  };
}

/**
 * Expand an AI template spec into a validated `TemplateContent`. Throws only if
 * the result somehow fails schema validation (a builder bug — covered by tests).
 */
export function buildTemplateContentFromSpec(spec: TemplateSpec): TemplateContent {
  // Pass 1: assign an id + global index to every question and record key maps.
  const keyToId = new Map<string, string>();
  const keyToGlobal = new Map<string, number>();
  const ids: string[] = [];
  let gi = 0;
  for (const page of spec.pages) {
    for (const section of page.sections) {
      for (const q of section.questions) {
        const id = newId();
        ids.push(id);
        if (q.key !== undefined) {
          keyToId.set(q.key, id);
          keyToGlobal.set(q.key, gi);
        }
        gi++;
      }
    }
  }

  const ctx: BuildCtx = {
    customResponseSets: [],
    keyToId,
    keyToGlobal,
    setBySignature: new Map(),
  };

  // Pass 2: build items in the same order, assembling the page tree.
  let idx = 0;
  const inspectionPages = spec.pages.map((page) => ({
    id: newId(),
    type: 'inspection' as const,
    title: page.title,
    sections: page.sections.map((section) => ({
      id: newId(),
      title: section.title,
      items: section.questions.map((q) => {
        const itemId = ids[idx] ?? newId();
        const item = buildItem(q, itemId, idx, ctx);
        idx++;
        return item;
      }),
    })),
  }));

  // A few item types (conductedBy/user, location, …) are only valid on the title
  // page. If the AI placed them on an inspection page, relocate them onto the
  // title page rather than failing validation — they become proper pickers.
  const titlePage = buildTitlePage();
  const relocated: Item[] = [];
  for (const page of inspectionPages) {
    for (const section of page.sections) {
      const keep: Item[] = [];
      for (const item of section.items) {
        if (TITLE_PAGE_ONLY.has(item.type)) relocated.push(item);
        else keep.push(item);
      }
      section.items = keep;
    }
  }
  if (relocated.length > 0) titlePage.sections[0]?.items.push(...relocated);

  const content = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    title: spec.title,
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    pages: [titlePage, ...inspectionPages],
    settings: {
      titleFormat: '{date}',
      documentNumberFormat: '{counter:6}',
      documentNumberStart: 1,
    },
    customResponseSets: ctx.customResponseSets,
  };

  return templateContentSchema.parse(content);
}

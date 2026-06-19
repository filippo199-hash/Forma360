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

interface BuildCtx {
  customResponseSets: CustomResponseSet[];
  /** question key → assigned item id (for jump targets). */
  keyToId: Map<string, string>;
  /** question key → global document index (for forward-only validation). */
  keyToGlobal: Map<string, number>;
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

  const options: ResponseOption[] = [];
  const flaggedOptionIds: string[] = [];
  const jumps: QuestionJump[] = [];

  for (const opt of rawOptions) {
    const optionId = newId();
    const triggers: Trigger[] = [];
    if (opt.requireEvidence === true)
      triggers.push({ kind: 'requireEvidence', mediaKind: 'any', minCount: 1 });
    if (opt.requireAction !== undefined && opt.requireAction.trim().length > 0)
      triggers.push({ kind: 'requireAction', actionTitle: opt.requireAction.trim() });
    if (opt.notifyEmail !== undefined)
      triggers.push({ kind: 'notify', email: opt.notifyEmail, timing: 'onCompletion' });

    options.push({
      id: optionId,
      label: opt.label,
      color: opt.color ?? (opt.flag === true ? 'red' : 'grey'),
      ...(triggers.length > 0 ? { triggers } : {}),
    });
    if (opt.flag === true) flaggedOptionIds.push(optionId);

    // Forward-only jumps, single-select only.
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
  }

  const setName = options
    .slice(0, 3)
    .map((o) => o.label)
    .join(' / ')
    .slice(0, 60);
  const responseSetId = newId();
  ctx.customResponseSets.push({
    id: responseSetId,
    name: setName.length > 0 ? setName : 'Responses',
    sourceGlobalId: null,
    multiSelect,
    options,
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
        mediaKeys: [],
      };
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

  const ctx: BuildCtx = { customResponseSets: [], keyToId, keyToGlobal };

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

  const content = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    title: spec.title,
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    pages: [buildTitlePage(), ...inspectionPages],
    settings: {
      titleFormat: '{date}',
      documentNumberFormat: '{counter:6}',
      documentNumberStart: 1,
    },
    customResponseSets: ctx.customResponseSets,
  };

  return templateContentSchema.parse(content);
}

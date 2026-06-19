import { describe, expect, it } from 'vitest';
import {
  collectActiveTriggers,
  collectFlaggedAnswers,
  followUpTargetMap,
  isAnswerFlagged,
  isFollowUpRevealed,
  multipleChoiceLabels,
  selectedOptionIds,
} from './inspection-eval';
import type { CustomResponseSet, TemplateContent, Trigger } from './template-schema';

// ─── Builders ────────────────────────────────────────────────────────────────

function set(id: string, options: CustomResponseSet['options']): CustomResponseSet {
  return { id, name: id, sourceGlobalId: null, multiSelect: false, options };
}

function mc(
  id: string,
  responseSetId: string,
  extra: { prompt?: string; flaggedOptionIds?: string[] } = {},
) {
  return {
    id,
    type: 'multipleChoice' as const,
    prompt: extra.prompt ?? `Question ${id}`,
    required: false,
    responseSetId,
    ...(extra.flaggedOptionIds ? { flaggedOptionIds: extra.flaggedOptionIds } : {}),
  };
}

function content(
  items: ReturnType<typeof mc>[],
  sets: CustomResponseSet[],
  extraInspectionItems: unknown[] = [],
): TemplateContent {
  return {
    schemaVersion: '1',
    title: 'T',
    pages: [
      {
        id: 'title-pg',
        type: 'title',
        title: 'Title',
        sections: [{ id: 'ts', title: 'Header', items: [] }],
      },
      {
        id: 'pg1',
        type: 'inspection',
        title: 'Page 1',
        sections: [
          { id: 'sec1', title: 'Section 1', items: [...items, ...extraInspectionItems] as never },
        ],
      },
    ],
    settings: {
      titleFormat: '{date}',
      documentNumberFormat: '{counter:6}',
      documentNumberStart: 1,
    },
    customResponseSets: sets,
  } as TemplateContent;
}

// ─── selectedOptionIds ─────────────────────────────────────────────────────────

describe('selectedOptionIds', () => {
  it('handles single (string), multi (array), empty and junk', () => {
    expect(selectedOptionIds('opt1')).toEqual(['opt1']);
    expect(selectedOptionIds(['a', 'b'])).toEqual(['a', 'b']);
    expect(selectedOptionIds('')).toEqual([]);
    expect(selectedOptionIds([])).toEqual([]);
    expect(selectedOptionIds(undefined)).toEqual([]);
    expect(selectedOptionIds(42)).toEqual([]);
    expect(selectedOptionIds([1, 'b', null])).toEqual(['b']);
  });
});

// ─── multipleChoiceLabels ──────────────────────────────────────────────────────

describe('multipleChoiceLabels', () => {
  const s = set('s1', [
    { id: 'yes', label: 'Yes', color: 'green' },
    { id: 'no', label: 'No', color: 'red' },
    { id: 'na', label: 'N/A', color: 'grey' },
  ]);
  const c = content([mc('q1', 's1')], [s]);

  it('resolves single + multi selections to labels in template order', () => {
    expect(multipleChoiceLabels(c, { type: 'multipleChoice', responseSetId: 's1' }, 'no')).toEqual([
      'No',
    ]);
    expect(
      multipleChoiceLabels(c, { type: 'multipleChoice', responseSetId: 's1' }, ['na', 'yes']),
    ).toEqual(['Yes', 'N/A']); // template order, not selection order
  });

  it('returns [] for unknown set, skips unknown option ids', () => {
    expect(multipleChoiceLabels(c, { type: 'multipleChoice', responseSetId: 'nope' }, 'x')).toEqual(
      [],
    );
    expect(
      multipleChoiceLabels(c, { type: 'multipleChoice', responseSetId: 's1' }, ['ghost', 'yes']),
    ).toEqual(['Yes']);
  });

  it('returns null for non-multipleChoice items', () => {
    expect(multipleChoiceLabels(c, { type: 'text' }, 'hi')).toBeNull();
  });
});

// ─── Flagged answers ───────────────────────────────────────────────────────────

describe('collectFlaggedAnswers', () => {
  const s = set('s1', [
    { id: 'safe', label: 'Safe', color: 'green' },
    { id: 'risk', label: 'At Risk', color: 'red' },
    { id: 'na', label: 'N/A', color: 'grey' },
  ]);

  it('includes a question only when a FLAGGED option was selected', () => {
    const c = content([mc('q1', 's1', { flaggedOptionIds: ['risk'] })], [s]);
    expect(collectFlaggedAnswers(c, { q1: 'risk' })).toHaveLength(1);
    expect(collectFlaggedAnswers(c, { q1: 'safe' })).toHaveLength(0);
    expect(collectFlaggedAnswers(c, {})).toHaveLength(0);
  });

  it('reports the prompt, page/section and the flagged option label', () => {
    const c = content([mc('q1', 's1', { prompt: 'Guard rail?', flaggedOptionIds: ['risk'] })], [s]);
    const [hit] = collectFlaggedAnswers(c, { q1: 'risk' });
    expect(hit).toMatchObject({
      itemId: 'q1',
      prompt: 'Guard rail?',
      pageTitle: 'Page 1',
      sectionTitle: 'Section 1',
      options: [{ id: 'risk', label: 'At Risk' }],
    });
  });

  it('handles multi-select: only the flagged selected option is reported', () => {
    const ms: CustomResponseSet = { ...s, multiSelect: true };
    const c = content([mc('q1', 's1', { flaggedOptionIds: ['risk'] })], [ms]);
    const hits = collectFlaggedAnswers(c, { q1: ['safe', 'risk'] });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.options).toEqual([{ id: 'risk', label: 'At Risk' }]);
  });

  it('falls back to legacy set-option flags when the question has no flaggedOptionIds', () => {
    const legacy = set('s2', [
      { id: 'ok', label: 'OK', flagged: false },
      { id: 'bad', label: 'Bad', flagged: true },
    ]);
    const c = content([mc('q1', 's2')], [legacy]); // no flaggedOptionIds on the question
    expect(collectFlaggedAnswers(c, { q1: 'bad' })).toHaveLength(1);
    expect(collectFlaggedAnswers(c, { q1: 'ok' })).toHaveLength(0);
  });

  it('preserves template order across multiple flagged answers', () => {
    const c = content(
      [
        mc('q1', 's1', { flaggedOptionIds: ['risk'] }),
        mc('q2', 's1', { flaggedOptionIds: ['na'] }),
      ],
      [s],
    );
    const hits = collectFlaggedAnswers(c, { q2: 'na', q1: 'risk' });
    expect(hits.map((h) => h.itemId)).toEqual(['q1', 'q2']);
  });
});

describe('isAnswerFlagged', () => {
  const s = set('s1', [
    { id: 'safe', label: 'Safe' },
    { id: 'risk', label: 'At Risk' },
  ]);
  const c = content([mc('q1', 's1', { flaggedOptionIds: ['risk'] })], [s]);

  it('is true only when a flagged option is selected', () => {
    const item = {
      id: 'q1',
      type: 'multipleChoice',
      responseSetId: 's1',
      flaggedOptionIds: ['risk'],
    };
    expect(isAnswerFlagged(c, item, 'risk')).toBe(true);
    expect(isAnswerFlagged(c, item, 'safe')).toBe(false);
    expect(isAnswerFlagged(c, { id: 'q1', type: 'text' }, 'risk')).toBe(false);
  });
});

// ─── Active triggers ───────────────────────────────────────────────────────────

const reqAction: Trigger = { kind: 'requireAction', actionTitle: 'Fix it' };
const reqNote: Trigger = { kind: 'requireNote' };

describe('collectActiveTriggers', () => {
  const s = set('s1', [
    { id: 'safe', label: 'Safe' },
    { id: 'risk', label: 'At Risk', triggers: [reqAction, reqNote] },
  ]);
  const c = content([mc('q1', 's1')], [s]);

  it('returns triggers only for selected options', () => {
    expect(collectActiveTriggers(c, { q1: 'safe' })).toHaveLength(0);
    const active = collectActiveTriggers(c, { q1: 'risk' });
    expect(active).toHaveLength(2);
    expect(active[0]).toMatchObject({ itemId: 'q1', optionId: 'risk', optionLabel: 'At Risk' });
    expect(active.map((a) => a.trigger.kind)).toEqual(['requireAction', 'requireNote']);
  });

  it('returns nothing when unanswered', () => {
    expect(collectActiveTriggers(c, {})).toHaveLength(0);
  });
});

// ─── askFollowUp reveal ────────────────────────────────────────────────────────

describe('followUpTargetMap + isFollowUpRevealed', () => {
  const followUp: Trigger = { kind: 'askFollowUp', questionIds: ['q2'] };
  const s = set('s1', [
    { id: 'yes', label: 'Yes' },
    { id: 'no', label: 'No', triggers: [followUp] },
  ]);
  // q2 (the follow-up target) uses its own plain set — reusing the
  // trigger-bearing set would make it self-reference (triggers live on the
  // shared set, a known limitation).
  const s2 = set('s2', [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ]);
  const c = content([mc('q1', 's1'), mc('q2', 's2', { prompt: 'Why not?' })], [s, s2]);
  const map = followUpTargetMap(c);

  it('maps the follow-up target to its (question, option) source', () => {
    expect(map.get('q2')).toEqual([{ itemId: 'q1', optionId: 'no' }]);
    expect(map.has('q1')).toBe(false);
  });

  it('hides the follow-up until the triggering option is selected', () => {
    expect(isFollowUpRevealed('q2', map, {})).toBe(false);
    expect(isFollowUpRevealed('q2', map, { q1: 'yes' })).toBe(false);
    expect(isFollowUpRevealed('q2', map, { q1: 'no' })).toBe(true);
  });

  it('always reveals questions that are not follow-up targets', () => {
    expect(isFollowUpRevealed('q1', map, {})).toBe(true);
  });
});

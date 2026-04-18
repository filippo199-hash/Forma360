import type { TemplateContent } from '@forma360/shared/template-schema';
import { TEMPLATE_SCHEMA_VERSION } from '@forma360/shared/template-schema';
import { describe, expect, it } from 'vitest';
import {
  conductReducer,
  evaluateVisibility,
  findUnansweredRequired,
  initialConductState,
  isItemVisible,
  type ConductState,
} from './conduct-state';

/**
 * Tests targeting:
 *   - reducer transitions (LOAD, SET_RESPONSE, MARK_*, SET_PAGE)
 *   - visibility evaluator: every operator + missing-dependency case
 *   - required-completeness: hidden required items do NOT block submit
 */

const ITEM_TEXT = 'a'.repeat(26);
const ITEM_MC = 'b'.repeat(26);
const ITEM_CHILD = 'c'.repeat(26);
const OPT_YES = 'd'.repeat(26);
const OPT_NO = 'e'.repeat(26);
const RS = 'f'.repeat(26);
const TITLE_PAGE = 'g'.repeat(26);
const TITLE_SECTION = 'h'.repeat(26);
const INSPECTION_PAGE = 'i'.repeat(26);
const INSPECTION_SECTION = 'j'.repeat(26);
const INSPECTION_ID = 'k'.repeat(26);

function content(): TemplateContent {
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    title: 'Fixture',
    pages: [
      {
        id: TITLE_PAGE,
        type: 'title',
        title: 'Title',
        sections: [{ id: TITLE_SECTION, title: 'Details', items: [] }],
      },
      {
        id: INSPECTION_PAGE,
        type: 'inspection',
        title: 'Inspection',
        sections: [
          {
            id: INSPECTION_SECTION,
            title: 'Section 1',
            items: [
              {
                id: ITEM_MC,
                type: 'multipleChoice',
                prompt: 'Is it OK?',
                required: false,
                responseSetId: RS,
              },
              {
                id: ITEM_TEXT,
                type: 'text',
                prompt: 'Notes',
                required: true,
                multiline: false,
                maxLength: 100,
              },
              {
                id: ITEM_CHILD,
                type: 'text',
                prompt: 'Why no?',
                required: true,
                multiline: false,
                maxLength: 100,
                visibility: {
                  dependsOn: ITEM_MC,
                  operator: 'equals',
                  value: OPT_NO,
                },
              },
            ],
          },
        ],
      },
    ],
    settings: {
      titleFormat: '{date}',
      documentNumberFormat: '{counter:6}',
      documentNumberStart: 1,
    },
    customResponseSets: [
      {
        id: RS,
        name: 'Pass/Fail',
        sourceGlobalId: null,
        multiSelect: false,
        options: [
          { id: OPT_YES, label: 'Yes', flagged: false },
          { id: OPT_NO, label: 'No', flagged: true },
        ],
      },
    ],
  };
}

function seed(): ConductState {
  return initialConductState({
    content: content(),
    inspectionId: INSPECTION_ID,
    title: 'Fixture',
    documentNumber: '000001',
    inspectionStatus: 'in_progress',
    startedAt: '2026-04-18T00:00:00Z',
    conductedByUserId: 'u'.repeat(26),
    responses: {},
    loadedUpdatedAt: '2026-04-18T00:00:00Z',
    selectedPageId: TITLE_PAGE,
  });
}

describe('conductReducer', () => {
  it('LOAD_INSPECTION replaces state and clears saveStatus', () => {
    const s = seed();
    const next = conductReducer(s, {
      type: 'LOAD_INSPECTION',
      state: { ...s, selectedPageId: INSPECTION_PAGE, responses: { [ITEM_TEXT]: 'a' } },
    });
    expect(next.saveStatus).toEqual({ kind: 'idle' });
    expect(next.selectedPageId).toBe(INSPECTION_PAGE);
    expect(next.responses[ITEM_TEXT]).toBe('a');
  });

  it('SET_RESPONSE writes through for in_progress only', () => {
    const s = seed();
    const next = conductReducer(s, { type: 'SET_RESPONSE', itemId: ITEM_TEXT, value: 'hi' });
    expect(next.responses[ITEM_TEXT]).toBe('hi');

    const readonly = conductReducer({ ...s, inspectionStatus: 'completed' }, {
      type: 'SET_RESPONSE',
      itemId: ITEM_TEXT,
      value: 'blocked',
    });
    expect(readonly.responses[ITEM_TEXT]).toBeUndefined();
  });

  it('SET_PAGE updates selected page', () => {
    const s = seed();
    const next = conductReducer(s, { type: 'SET_PAGE', pageId: INSPECTION_PAGE });
    expect(next.selectedPageId).toBe(INSPECTION_PAGE);
  });

  it('MARK_SAVING / MARK_SAVED / MARK_CONFLICT / MARK_OFFLINE', () => {
    const s = seed();
    expect(conductReducer(s, { type: 'MARK_SAVING' }).saveStatus).toEqual({ kind: 'saving' });
    const saved = conductReducer(s, { type: 'MARK_SAVED', updatedAt: '2026-04-18T01:00:00Z' });
    expect(saved.saveStatus.kind).toBe('saved');
    expect(saved.loadedUpdatedAt).toBe('2026-04-18T01:00:00Z');
    expect(conductReducer(s, { type: 'MARK_CONFLICT' }).saveStatus).toEqual({ kind: 'conflict' });
    expect(conductReducer(s, { type: 'MARK_OFFLINE' }).saveStatus).toEqual({ kind: 'offline' });
  });

  it('MERGE_RESPONSES overlays onto the existing map', () => {
    const s = seed();
    const withOne = conductReducer(s, { type: 'SET_RESPONSE', itemId: ITEM_TEXT, value: 'x' });
    const merged = conductReducer(withOne, {
      type: 'MERGE_RESPONSES',
      responses: { [ITEM_MC]: OPT_YES },
    });
    expect(merged.responses[ITEM_TEXT]).toBe('x');
    expect(merged.responses[ITEM_MC]).toBe(OPT_YES);
  });
});

describe('evaluateVisibility', () => {
  it('answered / notAnswered', () => {
    expect(
      evaluateVisibility({ dependsOn: ITEM_MC, operator: 'answered' }, { [ITEM_MC]: OPT_YES }),
    ).toBe(true);
    expect(
      evaluateVisibility({ dependsOn: ITEM_MC, operator: 'answered' }, {}),
    ).toBe(false);
    expect(
      evaluateVisibility({ dependsOn: ITEM_MC, operator: 'notAnswered' }, {}),
    ).toBe(true);
  });

  it('equals / notEquals', () => {
    const v = { dependsOn: ITEM_MC, operator: 'equals' as const, value: OPT_YES };
    expect(evaluateVisibility(v, { [ITEM_MC]: OPT_YES })).toBe(true);
    expect(evaluateVisibility(v, { [ITEM_MC]: OPT_NO })).toBe(false);
    expect(evaluateVisibility(v, {})).toBe(false);
    const nv = { dependsOn: ITEM_MC, operator: 'notEquals' as const, value: OPT_YES };
    expect(evaluateVisibility(nv, { [ITEM_MC]: OPT_NO })).toBe(true);
  });

  it('in / notIn over arrays and scalars', () => {
    const vin = {
      dependsOn: ITEM_MC,
      operator: 'in' as const,
      value: [OPT_YES, OPT_NO],
    };
    expect(evaluateVisibility(vin, { [ITEM_MC]: OPT_NO })).toBe(true);
    expect(evaluateVisibility(vin, { [ITEM_MC]: 'other' })).toBe(false);
    // multi-select array
    expect(evaluateVisibility(vin, { [ITEM_MC]: [OPT_YES, 'zzz'] })).toBe(true);
    const nin = {
      dependsOn: ITEM_MC,
      operator: 'notIn' as const,
      value: [OPT_YES],
    };
    expect(evaluateVisibility(nin, { [ITEM_MC]: OPT_NO })).toBe(true);
    expect(evaluateVisibility(nin, { [ITEM_MC]: OPT_YES })).toBe(false);
  });
});

describe('isItemVisible + required completeness', () => {
  it('hides child until parent answer matches', () => {
    const c = content();
    const section = c.pages[1]?.sections[0];
    if (section === undefined) throw new Error('fixture');
    const child = section.items[2];
    if (child === undefined) throw new Error('fixture');
    expect(isItemVisible(child, {})).toBe(false);
    expect(isItemVisible(child, { [ITEM_MC]: OPT_YES })).toBe(false);
    expect(isItemVisible(child, { [ITEM_MC]: OPT_NO })).toBe(true);
  });

  it('required child does not block submit when hidden', () => {
    const c = content();
    // Answer the required text item. The hidden child is still un-answered
    // but should not appear in missing list.
    const missing = findUnansweredRequired(c, {
      [ITEM_TEXT]: 'ok',
      [ITEM_MC]: OPT_YES,
    });
    expect(missing).toEqual([]);
  });

  it('required child blocks submit when visible and unanswered', () => {
    const c = content();
    const missing = findUnansweredRequired(c, {
      [ITEM_TEXT]: 'ok',
      [ITEM_MC]: OPT_NO,
    });
    expect(missing).toContain(ITEM_CHILD);
  });

  it('empty string / empty array count as missing', () => {
    const c = content();
    const missing = findUnansweredRequired(c, { [ITEM_TEXT]: '' });
    expect(missing).toContain(ITEM_TEXT);
  });
});

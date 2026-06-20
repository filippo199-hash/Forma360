import { describe, expect, it } from 'vitest';
import { buildTemplateContentFromSpec } from './template-builder';
import { collectActiveTriggers, computeSkippedItemIds } from './inspection-eval';
import { effectiveFlaggedOptionIds, templateContentSchema } from './template-schema';
import { parseTemplateSpec, type templateSpecSchema, type TemplateSpec } from './template-spec';
import type { z } from 'zod';

function spec(partial: Partial<z.input<typeof templateSpecSchema>>): TemplateSpec {
  return parseTemplateSpec({
    title: 'Test template',
    pages: [{ title: 'Page 1', sections: [{ title: 'Section 1', questions: [] }] }],
    ...partial,
  });
}

/** Find the first inspection-page item with a given prompt. */
function itemByPrompt(content: ReturnType<typeof buildTemplateContentFromSpec>, prompt: string) {
  for (const page of content.pages) {
    for (const section of page.sections) {
      for (const item of section.items) {
        if ('prompt' in item && item.prompt === prompt) return item;
      }
    }
  }
  return undefined;
}

describe('buildTemplateContentFromSpec', () => {
  it('produces schema-valid content with a title page + inspection pages', () => {
    const content = buildTemplateContentFromSpec(
      spec({
        title: 'Forklift check',
        pages: [
          {
            title: 'Pre-use',
            sections: [
              { title: 'Visual', questions: [{ prompt: 'Tyres OK?', type: 'multipleChoice' }] },
            ],
          },
        ],
      }),
    );
    // Builder already parses; re-validate for the test's sake.
    expect(templateContentSchema.safeParse(content).success).toBe(true);
    expect(content.title).toBe('Forklift check');
    expect(content.pages[0]?.type).toBe('title');
    expect(content.pages.filter((p) => p.type === 'inspection')).toHaveLength(1);
  });

  it('snapshots a response set + resolves flags from option hints', () => {
    const content = buildTemplateContentFromSpec(
      spec({
        pages: [
          {
            title: 'P',
            sections: [
              {
                title: 'S',
                questions: [
                  {
                    prompt: 'Condition?',
                    type: 'multipleChoice',
                    options: [
                      { label: 'Safe', color: 'green' },
                      { label: 'At Risk', color: 'red', flag: true },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const item = itemByPrompt(content, 'Condition?');
    expect(item?.type).toBe('multipleChoice');
    const set = content.customResponseSets.find(
      (s) => item && 'responseSetId' in item && s.id === item.responseSetId,
    );
    expect(set?.options.map((o) => o.label)).toEqual(['Safe', 'At Risk']);
    const flagged = effectiveFlaggedOptionIds(item as never, set);
    expect(flagged).toHaveLength(1);
    expect(set?.options.find((o) => flagged.includes(o.id))?.label).toBe('At Risk');
  });

  it('defaults to Yes/No/N/A when a multiple-choice question has no options', () => {
    const content = buildTemplateContentFromSpec(
      spec({
        pages: [{ title: 'P', sections: [{ title: 'S', questions: [{ prompt: 'Ok?' }] }] }],
      }),
    );
    const item = itemByPrompt(content, 'Ok?');
    const set = content.customResponseSets.find(
      (s) => item && 'responseSetId' in item && s.id === item.responseSetId,
    );
    expect(set?.options.map((o) => o.label)).toEqual(['Yes', 'No', 'N/A']);
  });

  it('resolves a forward jump by key, and a "finish" jump', () => {
    const content = buildTemplateContentFromSpec(
      spec({
        pages: [
          {
            title: 'P',
            sections: [
              {
                title: 'S',
                questions: [
                  {
                    key: 'q1',
                    prompt: 'Heater installed?',
                    type: 'multipleChoice',
                    options: [
                      { label: 'Yes' },
                      { label: 'No', jumpTo: 'q3' },
                      { label: 'N/A', jumpTo: 'finish' },
                    ],
                  },
                  { key: 'q2', prompt: 'Heater detail', type: 'text' },
                  { key: 'q3', prompt: 'Electrical', type: 'text' },
                ],
              },
            ],
          },
        ],
      }),
    );
    const q1 = itemByPrompt(content, 'Heater installed?');
    const q3 = itemByPrompt(content, 'Electrical');
    expect(q1 && 'jumps' in q1 ? q1.jumps : undefined).toEqual([
      { optionId: expect.any(String), target: { type: 'question', questionId: q3?.id } },
      { optionId: expect.any(String), target: { type: 'end' } },
    ]);
    // And the skip engine actually skips q2 when "No" is chosen.
    if (q1 && q1.type === 'multipleChoice') {
      const set = content.customResponseSets.find((s) => s.id === q1.responseSetId);
      const noId = set?.options.find((o) => o.label === 'No')?.id;
      const skipped = computeSkippedItemIds(content, { [q1.id]: noId });
      expect([...skipped]).toEqual([itemByPrompt(content, 'Heater detail')?.id]);
    }
  });

  it('drops backward / unknown jumps and jumps on multi-select questions', () => {
    const content = buildTemplateContentFromSpec(
      spec({
        pages: [
          {
            title: 'P',
            sections: [
              {
                title: 'S',
                questions: [
                  { key: 'a', prompt: 'First', type: 'text' },
                  {
                    key: 'b',
                    prompt: 'Backward?',
                    type: 'multipleChoice',
                    options: [
                      { label: 'Yes', jumpTo: 'a' },
                      { label: 'No', jumpTo: 'ghost' },
                    ],
                  },
                  {
                    key: 'c',
                    prompt: 'Multi',
                    type: 'multipleChoice',
                    multiSelect: true,
                    options: [{ label: 'X', jumpTo: 'finish' }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const b = itemByPrompt(content, 'Backward?');
    const c = itemByPrompt(content, 'Multi');
    expect(b && 'jumps' in b ? b.jumps : undefined).toBeUndefined(); // both dropped
    expect(c && 'jumps' in c ? c.jumps : undefined).toBeUndefined(); // multi-select → dropped
  });

  it('projects option triggers (evidence / action / notify)', () => {
    const content = buildTemplateContentFromSpec(
      spec({
        pages: [
          {
            title: 'P',
            sections: [
              {
                title: 'S',
                questions: [
                  {
                    prompt: 'Spill?',
                    type: 'multipleChoice',
                    options: [
                      { label: 'No' },
                      {
                        label: 'Yes',
                        flag: true,
                        requireEvidence: true,
                        requireAction: 'Clean the spill',
                        notifyEmail: 'safety@example.com',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const item = itemByPrompt(content, 'Spill?');
    if (item?.type !== 'multipleChoice') throw new Error('expected MC');
    const set = content.customResponseSets.find((s) => s.id === item.responseSetId);
    const yesId = set?.options.find((o) => o.label === 'Yes')?.id;
    const active = collectActiveTriggers(content, { [item.id]: yesId });
    expect(active.map((a) => a.trigger.kind).sort()).toEqual([
      'notify',
      'requireAction',
      'requireEvidence',
    ]);
  });

  it('deduplicates identical response sets across questions', () => {
    const okDefect = [
      { label: 'OK', color: 'green' as const },
      { label: 'Defect', color: 'red' as const, flag: true },
    ];
    const content = buildTemplateContentFromSpec(
      spec({
        pages: [
          {
            title: 'Walk-around',
            sections: [
              {
                title: 'Checks',
                questions: [
                  { prompt: 'Tyres OK?', type: 'multipleChoice', options: okDefect },
                  { prompt: 'Forks OK?', type: 'multipleChoice', options: okDefect },
                  { prompt: 'Mast OK?', type: 'multipleChoice', options: okDefect },
                  {
                    prompt: 'Fluid leaks?',
                    type: 'multipleChoice',
                    options: [
                      { label: 'No leaks', color: 'green' as const },
                      { label: 'Leak found', color: 'red' as const, flag: true },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    // Three identical OK/Defect questions share ONE set; the leak question adds one more.
    expect(content.customResponseSets).toHaveLength(2);
    const tyres = itemByPrompt(content, 'Tyres OK?');
    const forks = itemByPrompt(content, 'Forks OK?');
    if (tyres?.type === 'multipleChoice' && forks?.type === 'multipleChoice') {
      expect(tyres.responseSetId).toBe(forks.responseSetId);
      // Per-question flags still reference the shared set's option ids.
      const set = content.customResponseSets.find((s) => s.id === tyres.responseSetId);
      const defectId = set?.options.find((o) => o.label === 'Defect')?.id;
      expect(tyres.flaggedOptionIds).toEqual([defectId]);
      expect(forks.flaggedOptionIds).toEqual([defectId]);
    } else {
      throw new Error('expected MC items');
    }
  });

  it('maps user / asset / site / location questions to picker item types', () => {
    const content = buildTemplateContentFromSpec(
      spec({
        pages: [
          {
            title: 'Details',
            sections: [
              {
                title: 'S',
                questions: [
                  { prompt: 'Operator name', type: 'user', required: true },
                  { prompt: 'Forklift ID', type: 'asset', required: true },
                  { prompt: 'Depot', type: 'site' },
                  { prompt: 'Bay', type: 'location' },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(templateContentSchema.safeParse(content).success).toBe(true);
    expect(itemByPrompt(content, 'Operator name')?.type).toBe('conductedBy');
    expect(itemByPrompt(content, 'Forklift ID')?.type).toBe('asset');
    expect(itemByPrompt(content, 'Depot')?.type).toBe('site');
    expect(itemByPrompt(content, 'Bay')?.type).toBe('location');
  });

  it('builds every non-MC question type as valid content', () => {
    const content = buildTemplateContentFromSpec(
      spec({
        pages: [
          {
            title: 'Types',
            sections: [
              {
                title: 'S',
                questions: [
                  { prompt: 'Notes', type: 'text' },
                  { prompt: 'Count', type: 'number', unit: 'kg' },
                  { prompt: 'When', type: 'date' },
                  { prompt: 'Agree', type: 'checkbox' },
                  { prompt: 'Rating', type: 'slider', min: 1, max: 5 },
                  { prompt: 'Photo', type: 'media' },
                  { prompt: 'Read this', type: 'instruction', body: '# Safety first' },
                  { prompt: 'Sign here', type: 'signature' },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(templateContentSchema.safeParse(content).success).toBe(true);
    expect(itemByPrompt(content, 'Count')?.type).toBe('number');
    expect(itemByPrompt(content, 'Sign here')?.type).toBe('signature');
  });
});

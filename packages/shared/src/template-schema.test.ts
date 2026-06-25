import { describe, expect, it } from 'vitest';
import { newId } from './id';
import {
  effectiveFlaggedOptionIds,
  maxLogicDepth,
  parseTemplateContent,
  TEMPLATE_LIMITS,
  TEMPLATE_SCHEMA_VERSION,
  templateContentSchema,
  type JumpTarget,
  type TemplateContent,
} from './template-schema';

// ─── Tiny builders so tests read like intent ────────────────────────────────

function minimalContent(overrides: Partial<TemplateContent> = {}): TemplateContent {
  const titleSection = {
    id: newId(),
    title: 'Header',
    items: [{ id: newId(), type: 'conductedBy' as const, prompt: 'Conducted by', required: false }],
  };
  const inspectionSection = {
    id: newId(),
    title: 'Body',
    items: [
      {
        id: newId(),
        type: 'text' as const,
        prompt: 'Anything to note?',
        required: false,
        multiline: false,
        maxLength: 2000,
      },
    ],
  };
  const base: TemplateContent = {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    title: 'Sample',
    pages: [
      { id: newId(), type: 'title', title: 'Title', sections: [titleSection] },
      { id: newId(), type: 'inspection', title: 'Inspection', sections: [inspectionSection] },
    ],
    settings: {
      titleFormat: '{date}',
      documentNumberFormat: '{counter:6}',
      documentNumberStart: 1,
    },
    customResponseSets: [],
  };
  return { ...base, ...overrides };
}

// ─── Happy path ─────────────────────────────────────────────────────────────

describe('templateContentSchema — happy path', () => {
  it('parses a minimal template', () => {
    const result = templateContentSchema.safeParse(minimalContent());
    expect(result.success).toBe(true);
  });

  it('round-trips via JSON without losing fields', () => {
    const original = minimalContent();
    const json = JSON.parse(JSON.stringify(original)) as unknown;
    const parsed = parseTemplateContent(json);
    expect(parsed.title).toBe(original.title);
    expect(parsed.pages).toHaveLength(2);
  });
});

// ─── Root-level invariants ──────────────────────────────────────────────────

describe('templateContentSchema — root invariants', () => {
  it('rejects missing schemaVersion', () => {
    const bad = { ...minimalContent() } as unknown as Record<string, unknown>;
    delete bad.schemaVersion;
    expect(templateContentSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects more than one title page', () => {
    const content = minimalContent();
    content.pages.unshift({
      id: newId(),
      type: 'title',
      title: 'Second title',
      sections: [{ id: newId(), title: 's', items: [] }],
    });
    const result = templateContentSchema.safeParse(content);
    expect(result.success).toBe(false);
  });

  it('rejects zero title pages', () => {
    const content = minimalContent();
    content.pages = content.pages.filter((p) => p.type !== 'title');
    const result = templateContentSchema.safeParse(content);
    expect(result.success).toBe(false);
  });

  it('rejects title page not first', () => {
    const content = minimalContent();
    // swap order
    const [first, second] = content.pages;
    if (first !== undefined && second !== undefined) {
      content.pages = [second, first];
    }
    const result = templateContentSchema.safeParse(content);
    expect(result.success).toBe(false);
    // error message tells the author what's wrong
    const errors = (result as { success: false; error: { issues: Array<{ message: string }> } })
      .error.issues;
    expect(errors.some((e) => /title page must be first/i.test(e.message))).toBe(true);
  });

  it('rejects duplicate item ids', () => {
    const sharedId = newId();
    const content: TemplateContent = {
      ...minimalContent(),
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [{ id: sharedId, type: 'conductedBy', prompt: 'x', required: false }],
            },
          ],
        },
        {
          id: newId(),
          type: 'inspection',
          title: 'I',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                {
                  id: sharedId,
                  type: 'text',
                  prompt: 'x',
                  required: false,
                  multiline: false,
                  maxLength: 100,
                },
              ],
            },
          ],
        },
      ],
    };
    const result = templateContentSchema.safeParse(content);
    expect(result.success).toBe(false);
    const errors = (result as { success: false; error: { issues: Array<{ message: string }> } })
      .error.issues;
    expect(errors.some((e) => /duplicate item id/i.test(e.message))).toBe(true);
  });
});

// ─── Per-question flagging ──────────────────────────────────────────────────

describe('effectiveFlaggedOptionIds', () => {
  const set = {
    options: [{ id: 'a', flagged: false }, { id: 'b', flagged: true }, { id: 'c' }],
  };

  it('uses the question flaggedOptionIds when present', () => {
    expect(effectiveFlaggedOptionIds({ flaggedOptionIds: ['a', 'c'] }, set)).toEqual(['a', 'c']);
  });

  it('treats an explicit empty list as "no flags" (not a fallback)', () => {
    expect(effectiveFlaggedOptionIds({ flaggedOptionIds: [] }, set)).toEqual([]);
  });

  it('falls back to the set option flags for legacy questions (no field)', () => {
    expect(effectiveFlaggedOptionIds({}, set)).toEqual(['b']);
  });

  it('returns [] when neither the question nor the set carries flags', () => {
    expect(effectiveFlaggedOptionIds({}, undefined)).toEqual([]);
  });
});

// ─── Question types ─────────────────────────────────────────────────────────

describe('templateContentSchema — question types', () => {
  it('rejects a multiple-choice question referencing an undefined response set', () => {
    const content: TemplateContent = {
      ...minimalContent(),
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [{ id: newId(), title: 's', items: [] }],
        },
        {
          id: newId(),
          type: 'inspection',
          title: 'I',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                {
                  id: newId(),
                  type: 'multipleChoice',
                  prompt: 'Ok?',
                  required: false,
                  responseSetId: newId(), // never declared
                },
              ],
            },
          ],
        },
      ],
    };
    const result = templateContentSchema.safeParse(content);
    expect(result.success).toBe(false);
    const errors = (result as { success: false; error: { issues: Array<{ message: string }> } })
      .error.issues;
    expect(errors.some((e) => /unknown responseSetId/i.test(e.message))).toBe(true);
  });

  it('rejects title-page-only kinds on an inspection page', () => {
    const content: TemplateContent = {
      ...minimalContent(),
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [{ id: newId(), title: 's', items: [] }],
        },
        {
          id: newId(),
          type: 'inspection',
          title: 'I',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                { id: newId(), type: 'conductedBy', prompt: 'Conducted by', required: false },
              ],
            },
          ],
        },
      ],
    };
    const result = templateContentSchema.safeParse(content);
    expect(result.success).toBe(false);
    const errors = (result as { success: false; error: { issues: Array<{ message: string }> } })
      .error.issues;
    expect(errors.some((e) => /only allowed on the title page/i.test(e.message))).toBe(true);
  });
});

// ─── Signature validation (T-E02) ──────────────────────────────────────────

describe('signature questions (T-E02)', () => {
  it('rejects the same user pre-assigned to two slots', () => {
    const userId = newId();
    const content: TemplateContent = {
      ...minimalContent(),
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [{ id: newId(), title: 's', items: [] }],
        },
        {
          id: newId(),
          type: 'inspection',
          title: 'I',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                {
                  id: newId(),
                  type: 'signature',
                  prompt: 'Sign',
                  required: true,
                  mode: 'sequential',
                  slots: [
                    { slotIndex: 0, assigneeUserId: userId, label: 'A' },
                    { slotIndex: 1, assigneeUserId: userId, label: 'B' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = templateContentSchema.safeParse(content);
    expect(result.success).toBe(false);
  });

  it('accepts multiple null slots (select-at-inspection-time)', () => {
    const content: TemplateContent = {
      ...minimalContent(),
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [{ id: newId(), title: 's', items: [] }],
        },
        {
          id: newId(),
          type: 'inspection',
          title: 'I',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                {
                  id: newId(),
                  type: 'signature',
                  prompt: 'Sign',
                  required: true,
                  mode: 'parallel',
                  slots: [
                    { slotIndex: 0, assigneeUserId: null },
                    { slotIndex: 1, assigneeUserId: null },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = templateContentSchema.safeParse(content);
    expect(result.success).toBe(true);
  });

  it('rejects non-dense slotIndex', () => {
    const content: TemplateContent = {
      ...minimalContent(),
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [{ id: newId(), title: 's', items: [] }],
        },
        {
          id: newId(),
          type: 'inspection',
          title: 'I',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                {
                  id: newId(),
                  type: 'signature',
                  prompt: 'Sign',
                  required: true,
                  mode: 'sequential',
                  slots: [
                    { slotIndex: 0, assigneeUserId: null },
                    { slotIndex: 2, assigneeUserId: null }, // skip 1
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(templateContentSchema.safeParse(content).success).toBe(false);
  });
});

// ─── Logic / visibility ────────────────────────────────────────────────────

describe('visibility + triggers', () => {
  it('rejects visibility pointing at unknown item', () => {
    const content: TemplateContent = {
      ...minimalContent(),
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [{ id: newId(), title: 's', items: [] }],
        },
        {
          id: newId(),
          type: 'inspection',
          title: 'I',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                {
                  id: newId(),
                  type: 'text',
                  prompt: 'Why?',
                  required: false,
                  multiline: false,
                  maxLength: 2000,
                  visibility: {
                    dependsOn: newId(), // random unknown
                    operator: 'equals',
                    value: 'yes',
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const result = templateContentSchema.safeParse(content);
    expect(result.success).toBe(false);
    const errors = (result as { success: false; error: { issues: Array<{ message: string }> } })
      .error.issues;
    expect(errors.some((e) => /visibility.dependsOn points at unknown item/i.test(e.message))).toBe(
      true,
    );
  });

  it('notify trigger accepts an email and rejects a malformed one', () => {
    const setId = newId();
    const mcqId = newId();
    const build = (email: string): TemplateContent => ({
      ...minimalContent(),
      customResponseSets: [
        {
          id: setId,
          name: 'yes/no',
          sourceGlobalId: null,
          options: [
            {
              id: newId(),
              label: 'Yes',
              triggers: [{ kind: 'notify', timing: 'onCompletion', email }],
            },
            { id: newId(), label: 'No' },
          ],
          multiSelect: false,
        },
      ],
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [{ id: newId(), title: 's', items: [] }],
        },
        {
          id: newId(),
          type: 'inspection',
          title: 'I',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                {
                  id: mcqId,
                  type: 'multipleChoice',
                  prompt: 'Ok?',
                  required: false,
                  responseSetId: setId,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(templateContentSchema.safeParse(build('safety@example.com')).success).toBe(true);
    expect(templateContentSchema.safeParse(build('not-an-email')).success).toBe(false);
  });
});

// ─── Logic nesting depth (T-E07) ───────────────────────────────────────────

describe('logic nesting depth (T-E07)', () => {
  /** Build a content blob with a chain of N follow-ups. */
  function chain(depth: number): TemplateContent {
    const questions = Array.from({ length: depth }, () => newId());
    const sets = questions.map((_q, i) => ({
      id: newId(),
      name: `set-${i}`,
      sourceGlobalId: null,
      multiSelect: false,
      options: [
        {
          id: newId(),
          label: 'Yes',
          flagged: false,
          triggers:
            i + 1 < depth
              ? ([
                  {
                    kind: 'askFollowUp' as const,
                    questionIds: [questions[i + 1] as string],
                  },
                ] as const)
              : undefined,
        },
      ],
    }));
    const section = {
      id: newId(),
      title: 'chain',
      items: questions.map((q, i) => ({
        id: q,
        type: 'multipleChoice' as const,
        prompt: `Q${i}`,
        required: false,
        responseSetId: sets[i]?.id as string,
      })),
    };
    return {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      title: 'chain',
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [{ id: newId(), title: 's', items: [] }],
        },
        { id: newId(), type: 'inspection', title: 'I', sections: [section] },
      ],
      settings: {
        titleFormat: '{date}',
        documentNumberFormat: '{counter:6}',
        documentNumberStart: 1,
      },
      customResponseSets: sets as TemplateContent['customResponseSets'],
    };
  }

  it('accepts a 40-deep chain', () => {
    const result = templateContentSchema.safeParse(chain(40));
    expect(result.success).toBe(true);
    const parsed = result.success ? result.data : null;
    if (parsed !== null) {
      expect(maxLogicDepth(parsed)).toBeLessThanOrEqual(TEMPLATE_LIMITS.MAX_LOGIC_NESTING_DEPTH);
    }
  });

  it('rejects a 41-deep chain (T-E07)', () => {
    const result = templateContentSchema.safeParse(chain(41));
    expect(result.success).toBe(false);
    const errors = (result as { success: false; error: { issues: Array<{ message: string }> } })
      .error.issues;
    expect(errors.some((e) => /nesting exceeds 40/i.test(e.message))).toBe(true);
  });
});

// ─── Limits ────────────────────────────────────────────────────────────────

describe('limits', () => {
  it('rejects a table with > 20 columns', () => {
    const content: TemplateContent = {
      ...minimalContent(),
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [{ id: newId(), title: 's', items: [] }],
        },
        {
          id: newId(),
          type: 'inspection',
          title: 'I',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                {
                  id: newId(),
                  type: 'table',
                  tableKind: 'blank',
                  prompt: 'T',
                  required: false,
                  columns: Array.from({ length: 21 }, () => ({
                    id: newId(),
                    label: 'col',
                    kind: 'text' as const,
                  })),
                },
              ],
            },
          ],
        },
      ],
    };
    expect(templateContentSchema.safeParse(content).success).toBe(false);
  });

  it('rejects a signature with > MAX_SIGNATURE_SLOTS slots', () => {
    const slots = Array.from({ length: TEMPLATE_LIMITS.MAX_SIGNATURE_SLOTS + 1 }, (_, i) => ({
      slotIndex: i,
      assigneeUserId: null,
    }));
    const content: TemplateContent = {
      ...minimalContent(),
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [{ id: newId(), title: 's', items: [] }],
        },
        {
          id: newId(),
          type: 'inspection',
          title: 'I',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                {
                  id: newId(),
                  type: 'signature',
                  prompt: 'Sign',
                  required: true,
                  mode: 'parallel',
                  slots,
                },
              ],
            },
          ],
        },
      ],
    };
    expect(templateContentSchema.safeParse(content).success).toBe(false);
  });
});

// ─── Global response set snapshot semantics (T-E17) ────────────────────────

describe('custom response set snapshots (T-E17)', () => {
  it('allows a response set sourced from a global id', () => {
    const setId = newId();
    const globalId = newId();
    const mcqId = newId();
    const content: TemplateContent = {
      ...minimalContent(),
      customResponseSets: [
        {
          id: setId,
          name: 'Pass/Fail',
          sourceGlobalId: globalId,
          multiSelect: false,
          options: [
            { id: newId(), label: 'Pass', flagged: false },
            { id: newId(), label: 'Fail', flagged: true },
          ],
        },
      ],
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [{ id: newId(), title: 's', items: [] }],
        },
        {
          id: newId(),
          type: 'inspection',
          title: 'I',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                {
                  id: mcqId,
                  type: 'multipleChoice',
                  prompt: 'Ok?',
                  required: false,
                  responseSetId: setId,
                },
              ],
            },
          ],
        },
      ],
    };
    const result = templateContentSchema.safeParse(content);
    expect(result.success).toBe(true);
  });
});

// ─── maxLogicDepth utility ─────────────────────────────────────────────────

describe('maxLogicDepth', () => {
  it('returns 0 for a template with no logic', () => {
    expect(maxLogicDepth(minimalContent())).toBe(0);
  });
});

// ─── Branding (PR 35) ──────────────────────────────────────────────────────

describe('templateContentSchema — branding', () => {
  it('parses without any branding field', () => {
    const content = minimalContent();
    expect('branding' in content.settings).toBe(false);
    expect(templateContentSchema.safeParse(content).success).toBe(true);
  });

  it('accepts valid hex colors and a storage key', () => {
    const content = minimalContent();
    content.settings.branding = {
      logoStorageKey: '01ARZ3NDEKTSV4RRFFQ69G5FAV/templates/01ARZ3NDEKTSV4RRFFQ69G5FAV/logo.png',
      primaryColor: '#0F766E',
      accentColor: '#abcdef',
    };
    expect(templateContentSchema.safeParse(content).success).toBe(true);
  });

  it('rejects invalid hex colors', () => {
    for (const bad of ['red', '#FFF', '#GGGGGG', '0F766E', '#0F766', '#0F766E0']) {
      const content = minimalContent();
      content.settings.branding = { primaryColor: bad };
      const result = templateContentSchema.safeParse(content);
      expect(result.success, `expected invalid: ${bad}`).toBe(false);
    }
  });

  it('accepts branding with only one color set', () => {
    const content = minimalContent();
    content.settings.branding = { primaryColor: '#123456' };
    expect(templateContentSchema.safeParse(content).success).toBe(true);
  });
});

// ─── Jump-to forward-only validation ────────────────────────────────────────

describe('jump-to (forward skip) validation', () => {
  function withJump(opts: {
    fromId: string;
    target: { type: 'question'; questionId: string } | { type: 'page'; pageId: string };
    multiSelect?: boolean;
  }): TemplateContent {
    const setId = newId();
    const q1 = 'q'.repeat(26);
    const q2 = 'r'.repeat(26);
    const pageB = 'p'.repeat(26);
    const optYes = newId();
    const mkQ = (id: string, jumps?: Array<{ optionId: string; target: JumpTarget }>) => ({
      id,
      type: 'multipleChoice' as const,
      prompt: id,
      required: false,
      responseSetId: setId,
      ...(jumps ? { jumps } : {}),
    });
    const jumps =
      opts.fromId === q1
        ? [{ optionId: optYes, target: opts.target }]
        : [{ optionId: optYes, target: opts.target }];
    return {
      schemaVersion: TEMPLATE_SCHEMA_VERSION,
      title: 'J',
      pages: [
        {
          id: newId(),
          type: 'title',
          title: 'T',
          sections: [{ id: newId(), title: 's', items: [] }],
        },
        {
          id: newId(),
          type: 'inspection',
          title: 'Page A',
          sections: [
            {
              id: newId(),
              title: 's',
              items: [
                opts.fromId === q1 ? mkQ(q1, jumps) : mkQ(q1),
                opts.fromId === q2 ? mkQ(q2, jumps) : mkQ(q2),
              ],
            },
          ],
        },
        {
          id: pageB,
          type: 'inspection',
          title: 'Page B',
          sections: [{ id: newId(), title: 's', items: [mkQ('s'.repeat(26))] }],
        },
      ],
      settings: { titleFormat: '{date}', documentNumberFormat: '{c}', documentNumberStart: 1 },
      customResponseSets: [
        {
          id: setId,
          name: 'YN',
          sourceGlobalId: null,
          multiSelect: opts.multiSelect ?? false,
          options: [
            { id: optYes, label: 'Yes' },
            { id: newId(), label: 'No' },
          ],
        },
      ],
    };
  }

  it('accepts a jump to a question below', () => {
    const c = withJump({
      fromId: 'q'.repeat(26),
      target: { type: 'question', questionId: 'r'.repeat(26) },
    });
    expect(templateContentSchema.safeParse(c).success).toBe(true);
  });

  it('rejects a jump to a question above (backward)', () => {
    const c = withJump({
      fromId: 'r'.repeat(26),
      target: { type: 'question', questionId: 'q'.repeat(26) },
    });
    expect(templateContentSchema.safeParse(c).success).toBe(false);
  });

  it('accepts a jump to a later page', () => {
    const c = withJump({
      fromId: 'q'.repeat(26),
      target: { type: 'page', pageId: 'p'.repeat(26) },
    });
    expect(templateContentSchema.safeParse(c).success).toBe(true);
  });

  it('rejects jumps on a multi-select question', () => {
    const c = withJump({
      fromId: 'q'.repeat(26),
      target: { type: 'question', questionId: 'r'.repeat(26) },
      multiSelect: true,
    });
    expect(templateContentSchema.safeParse(c).success).toBe(false);
  });
});

// ─── Instruction items (media + video + report toggle) ──────────────────────

describe('instruction items', () => {
  function contentWithInstruction(instr: unknown): unknown {
    const content = JSON.parse(JSON.stringify(minimalContent())) as {
      pages: Array<{ type: string; sections: Array<{ items: unknown[] }> }>;
    };
    const insp = content.pages.find((p) => p.type === 'inspection');
    if (insp === undefined || insp.sections[0] === undefined) {
      throw new Error('fixture missing inspection page');
    }
    insp.sections[0].items.push(instr);
    return content;
  }

  it('parses an instruction with attachments, a video link and showInReport', () => {
    const res = templateContentSchema.safeParse(
      contentWithInstruction({
        id: newId(),
        type: 'instruction',
        body: 'Read this before you start',
        attachments: [
          { key: 'tenant/templates/x/diagram.png', filename: 'diagram.png', mimeType: 'image/png' },
        ],
        videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
        showInReport: false,
      }),
    );
    expect(res.success).toBe(true);
  });

  it('defaults attachments to [] and showInReport to true', () => {
    const parsed = parseTemplateContent(
      contentWithInstruction({ id: newId(), type: 'instruction', body: 'hello' }),
    );
    const insp = parsed.pages.find((p) => p.type === 'inspection');
    const last = insp?.sections[0]?.items.at(-1);
    expect(last?.type).toBe('instruction');
    if (last?.type === 'instruction') {
      expect(last.attachments).toEqual([]);
      expect(last.showInReport).toBe(true);
    }
  });

  it('rejects a non-YouTube/Vimeo video link', () => {
    const res = templateContentSchema.safeParse(
      contentWithInstruction({
        id: newId(),
        type: 'instruction',
        body: 'x',
        videoUrl: 'https://evil.example.com/v/1',
      }),
    );
    expect(res.success).toBe(false);
  });
});

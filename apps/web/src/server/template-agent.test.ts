/**
 * The template agent's progress protocol (TA-E01..E06).
 *
 * The reason this file exists: a grounded turn was reported as "stuck". It
 * was not — production timings show the request ran 2 min 53 s and ended in a
 * finished template. What made a working run look broken is that the agent
 * emitted NOTHING for almost all of that time: text deltas stopped after the
 * model's opening sentence, and the next event was the tool call minutes
 * later. Everything in between — thinking, the server-side web search, reading
 * the results — was silent.
 *
 * So these tests pin the property that fixes it, rather than any single
 * symptom: **every phase that produces no text announces itself**. They drive
 * a fake Anthropic stream through the real event sequence a web-search turn
 * produces, and assert on what reaches the browser.
 *
 * Two more failure shapes are pinned here because both end in the same place —
 * a user staring at a panel that will never change:
 *   - a `pause_turn` that never settles (TA-E04), which would loop for ever;
 *   - a turn that researches and then stops without drafting (TA-E05), which
 *     the system prompt asks the model not to do but nothing enforced.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TemplateAgentEvent } from './template-agent';

vi.mock('./env', () => ({ env: { ANTHROPIC_API_KEY: 'test-key' } }));

const streamMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: (...args: unknown[]) => streamMock(...args) as unknown };
  },
}));

/** A scripted turn: the raw events the SDK would emit, then its final message. */
interface ScriptedTurn {
  events: Anthropic.MessageStreamEvent[];
  final: Pick<Anthropic.Message, 'content' | 'stop_reason'>;
}

type Handler = (...args: never[]) => void;

/**
 * Stand-in for `MessageStream`. Records the handlers the agent registers, then
 * replays the scripted events when `finalMessage()` is awaited — the same
 * order the real SDK uses (handlers fire during the stream, final resolves
 * after).
 */
function fakeStream(turn: ScriptedTurn) {
  const handlers = new Map<string, Handler[]>();
  const fire = (name: string, ...args: unknown[]): void => {
    for (const h of handlers.get(name) ?? []) (h as (...a: unknown[]) => void)(...args);
  };
  return {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return this;
    },
    async finalMessage() {
      for (const event of turn.events) {
        fire('streamEvent', event);
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') fire('text', event.delta.text);
          if (event.delta.type === 'thinking_delta') fire('thinking', event.delta.thinking);
        }
        if (event.type === 'content_block_stop') {
          const block = blockFor(turn, event.index);
          if (block !== undefined) fire('contentBlock', block);
        }
      }
      return turn.final;
    },
  };
}

/** The completed block at `index`, reconstructed from the block-start event. */
function blockFor(turn: ScriptedTurn, index: number): unknown {
  for (const event of turn.events) {
    if (event.type === 'content_block_start' && event.index === index) return event.content_block;
  }
  return undefined;
}

function script(turns: ScriptedTurn[]): void {
  streamMock.mockReset();
  for (const turn of turns) streamMock.mockImplementationOnce(() => fakeStream(turn));
  // Any turn beyond the script repeats the last one, so a runaway loop shows up
  // as a call-count assertion rather than an undefined crash.
  const last = turns.at(-1);
  if (last !== undefined) streamMock.mockImplementation(() => fakeStream(last));
}

// ─── Event builders ─────────────────────────────────────────────────────────

const textBlockStart = (index: number) =>
  ({
    type: 'content_block_start',
    index,
    content_block: { type: 'text', text: '', citations: null },
  }) as unknown as Anthropic.MessageStreamEvent;

const textDelta = (index: number, text: string) =>
  ({
    type: 'content_block_delta',
    index,
    delta: { type: 'text_delta', text },
  }) as unknown as Anthropic.MessageStreamEvent;

const thinkingDelta = (index: number, thinking: string) =>
  ({
    type: 'content_block_delta',
    index,
    delta: { type: 'thinking_delta', thinking },
  }) as unknown as Anthropic.MessageStreamEvent;

const searchStart = (index: number, query: string) =>
  ({
    type: 'content_block_start',
    index,
    content_block: {
      type: 'server_tool_use',
      id: `srvtoolu_${index}`,
      name: 'web_search',
      input: { query },
    },
  }) as unknown as Anthropic.MessageStreamEvent;

const searchResultStart = (index: number) =>
  ({
    type: 'content_block_start',
    index,
    content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [] },
  }) as unknown as Anthropic.MessageStreamEvent;

const proposeStart = (index: number) =>
  ({
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id: 'toolu_1', name: 'proposeTemplate', input: {} },
  }) as unknown as Anthropic.MessageStreamEvent;

const blockStop = (index: number) =>
  ({ type: 'content_block_stop', index }) as unknown as Anthropic.MessageStreamEvent;

const searchBlock = (query: string) => ({
  type: 'server_tool_use' as const,
  id: 'srvtoolu_1',
  name: 'web_search' as const,
  input: { query },
});

const VALID_SPEC = {
  title: 'EU office fire exit check',
  pages: [
    {
      title: 'Escape routes',
      sections: [{ title: 'Doors', questions: [{ prompt: 'Are exit routes clear?' }] }],
    },
  ],
};

const proposeBlock = () => ({
  type: 'tool_use' as const,
  id: 'toolu_1',
  name: 'proposeTemplate',
  input: VALID_SPEC,
});

/** The turn from the bug report: a sentence, then a search, then the template. */
function groundedTurn(): ScriptedTurn {
  return {
    events: [
      textBlockStart(0),
      textDelta(0, 'Great — let me ground this in current EU fire-exit requirements.'),
      blockStop(0),
      searchStart(1, 'EU workplace fire exit requirements'),
      blockStop(1),
      searchResultStart(2),
      blockStop(2),
      proposeStart(3),
      blockStop(3),
    ],
    final: {
      content: [
        { type: 'text', text: 'Great — …', citations: null },
        searchBlock('EU workplace fire exit requirements'),
        proposeBlock(),
      ] as unknown as Anthropic.ContentBlock[],
      stop_reason: 'tool_use',
    },
  };
}

async function run(messages = [{ role: 'user' as const, content: 'fire exit assessment' }]) {
  const { runTemplateAgentTurn } = await import('./template-agent');
  const events: TemplateAgentEvent[] = [];
  await runTemplateAgentTurn({ messages, onEvent: (e) => events.push(e) });
  return events;
}

const phases = (events: TemplateAgentEvent[]) =>
  events.filter((e) => e.type === 'progress').map((e) => e.phase);

describe('runTemplateAgentTurn progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TA-E01: narrates the search — the silent minutes that read as a crash', async () => {
    script([groundedTurn()]);
    const events = await run();

    // Two `searching` events on purpose: the query streams in as JSON deltas,
    // so the phase is announced the moment the call starts and named as soon
    // as the query is known. Waiting for the query would leave the gap unlabelled.
    expect(events.filter((e) => e.type === 'progress')).toEqual([
      { type: 'progress', phase: 'searching' },
      { type: 'progress', phase: 'searching', detail: 'EU workplace fire exit requirements' },
      { type: 'progress', phase: 'reading' },
      { type: 'progress', phase: 'writing' },
    ]);
    // And the UI still gets the signal it uses to take over the whole panel.
    expect(events.some((e) => e.type === 'building_started')).toBe(true);
  });

  it('TA-E02: reports extended thinking, which also emits no text', async () => {
    script([
      {
        events: [
          thinkingDelta(0, 'Considering the'),
          thinkingDelta(0, ' structure…'),
          blockStop(0),
        ],
        final: { content: [], stop_reason: 'end_turn' },
      },
    ]);

    expect(phases(await run())).toEqual(['thinking']);
  });

  it('TA-E03: repeats no phase — a thinking block is one event, not one per delta', async () => {
    script([
      {
        events: Array.from({ length: 25 }, (_, i) => thinkingDelta(0, `token ${i}`)),
        final: { content: [], stop_reason: 'end_turn' },
      },
    ]);

    expect(phases(await run())).toEqual(['thinking']);
  });

  it('TA-E04: stops resuming a pause_turn that never settles', async () => {
    script([
      {
        events: [],
        final: { content: [], stop_reason: 'pause_turn' },
      },
    ]);

    const events = await run();
    expect(events.at(-1)?.type).toBe('assistant_done');
    // Bounded, and the bound is what stops this being an infinite loop.
    expect(streamMock.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it('TA-E05: nudges a turn that researched and then stopped without drafting', async () => {
    const stalled: ScriptedTurn = {
      events: [
        textBlockStart(0),
        textDelta(0, 'Let me look up the current EU rules first.'),
        blockStop(0),
        searchStart(1, 'EU fire exit rules'),
        blockStop(1),
        searchResultStart(2),
        blockStop(2),
      ],
      final: {
        content: [
          { type: 'text', text: 'Let me look up…', citations: null },
          searchBlock('EU fire exit rules'),
        ] as unknown as Anthropic.ContentBlock[],
        // Ended its turn having promised to do the work — the shape the system
        // prompt warns about and nothing used to catch.
        stop_reason: 'end_turn',
      },
    };
    script([stalled, groundedTurn()]);

    const events = await run();

    // It does not leave the user on the promise: it goes round again and the
    // turn ends in a template.
    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(events.at(-1)?.type).toBe('proposal');
  });

  it('TA-E06: a plain question still ends the turn — the nudge is not universal', async () => {
    script([
      {
        events: [textBlockStart(0), textDelta(0, 'What kind of premises is this?'), blockStop(0)],
        final: {
          content: [
            { type: 'text', text: 'What kind of premises is this?', citations: null },
          ] as unknown as Anthropic.ContentBlock[],
          stop_reason: 'end_turn',
        },
      },
    ]);

    const events = await run();
    expect(streamMock).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({
      type: 'assistant_done',
      text: 'What kind of premises is this?',
    });
  });
});

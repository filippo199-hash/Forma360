/**
 * AI template-generation agent.
 *
 * A skilled inspection-template designer that runs a SHORT guided interview
 * (2–3 questions, including a region/jurisdiction follow-up when relevant) and
 * then emits a {@link TemplateSpec} via the `proposeTemplate` tool. The tiny
 * spec is expanded deterministically by `buildTemplateContentFromSpec` (server
 * side, inside the `templates.createFromSpec` mutation) into schema-valid
 * template content — the model never has to get ids, response-set snapshots,
 * forward-only jumps or triggers exactly right.
 *
 * Unlike the data-assistant agent, this conversation is ephemeral: the client
 * holds the message history and sends it back each turn, so nothing is
 * persisted. Each turn the agent either streams a follow-up question (`text`
 * deltas, then `assistant_done`) or emits a `proposal` and stops.
 *
 * Phase C slots a `web_search` tool in alongside `proposeTemplate` to ground
 * regional regulations; the loop below already tolerates extra tool calls.
 *
 * A grounded turn is SLOW — measured in production at 2 min 53 s for "fire
 * exit assessment / office / EU" — and almost all of it emits no text: the
 * model thinks, then the search runs server-side inside the API, then the
 * proposeTemplate call streams. The only two events this file used to send
 * were text deltas and `building_started`, so the browser received nothing at
 * all between the model's opening sentence and the tool call minutes later.
 * That is indistinguishable from a crash, and it was reported as one. Every
 * silent phase now emits a `progress` event; the rule for anything added here
 * later is that no phase may be silent.
 */
import Anthropic from '@anthropic-ai/sdk';
import { parseTemplateSpec, type TemplateSpec } from '@forma360/shared/template-spec';
import { activeBrand } from '../lib/brand';
import { env } from './env';

const SYSTEM_PROMPT = `You are an expert inspection-template designer for ${activeBrand.name}, an operational-excellence platform (a SafetyCulture-style tool). Your job is to turn a short conversation into a ready-to-use inspection template.

How you work:
1. The user tells you what they want to inspect. Ask AT MOST 2–3 short, high-value follow-up questions — never a long questionnaire. Good things to clarify: the kind of asset/site/activity being inspected, how often it runs, and who fills it in. Ask them together in one message, not one at a time.
2. If the inspection is the kind governed by regulations (fire safety, food hygiene, electrical, working at height, vehicles, healthcare, childcare, etc.), ask whether it should follow a specific region's or country's regulations (e.g. "UK", "California", "EU"). If the user opts in to a region, use the web_search tool to ground the current legal requirements for that domain and jurisdiction BEFORE proposing — search for the specific standard/regulation and reflect its real checklist points in the structure. Only search when the user has asked for regional regulations; otherwise rely on your own knowledge. Phrase everything generated as a practical draft to verify, never as legal advice.
3. As soon as you have enough to draft something useful, call the proposeTemplate tool. Do NOT keep asking questions once you can produce a solid first draft — the user can refine everything in the editor afterwards. Lean toward proposing early. CRITICAL: when you decide to build, call proposeTemplate in the SAME turn. You may write one short sentence first (e.g. "Building that now…"), but you MUST then call the tool in that same message — never end your turn promising to build and then stop, or the user is left waiting with nothing to do.

When you build the template (the proposeTemplate call):
- Organise it into logical pages and sections. A realistic inspection has 10–30 questions.
- Default question type is multipleChoice. Use response options that fit the question; give risky/unsafe options a "flag" and an appropriate colour (red/amber for bad, green for good). Use a mix of types where it helps: text for notes, number for readings, media for "take a photo", signature to sign off, instruction for guidance, date/checkbox/slider where natural.
- Pick the RIGHT response type, not just text. A question asking for a person who is a system user (operator, driver, inspector, technician, supervisor) → type "user" (searchable user picker). A question asking for a tracked asset/vehicle/machine/equipment, e.g. by ID, serial or fleet number → type "asset". A site/branch/depot → "site"; an area/location → "location". Only use "text" for genuinely free-form text that isn't a user, asset, site or location.
- Keep response sets to a MINIMUM and reuse them. Every pass/fail-style question that shares the same scale MUST use the EXACT same options (identical labels, colours and order — e.g. always "OK" / "Defect"), so they collapse into one shared response set. Do not invent slightly different wordings for the same idea ("OK/Defect" vs "Good/Fault" vs "Pass/Fail") — pick one and reuse it everywhere. Only create a different option set when the answers genuinely differ.
- Add smart logic where it clearly helps:
  - On an option, set requireEvidence:true when a photo/proof should be mandatory (e.g. a defect found).
  - On an option, set requireAction with a short corrective-action title when a failure should raise a follow-up task.
  - On an option, set notifyEmail when a specific failure should alert someone — only if the user named an email.
  - Use jumpTo on an option to skip ahead to a later question's key (forward only) or to "finish" when a "No / Not applicable" answer makes the rest irrelevant. Give those questions a stable "key" so you can target them.
- IMPORTANT — triggers must NOT break set reuse. Two questions share a response set ONLY when their options are byte-identical, INCLUDING any triggers. So on a repeated pass/fail scale, do NOT write a different requireAction title per question (e.g. "Rectify tyre defect" vs "Rectify brake defect") — that creates a separate set for every question and floods the account. For a repeated scale, keep the options identical: attach requireEvidence to the shared "fail" option if you want proof, and either omit requireAction or use ONE generic title used on every question (e.g. "Raise a corrective action for this defect"). Reserve unique requireAction titles for genuinely one-off questions that don't reuse a scale.
- Keep prompts concise and field-ready. Write in the user's language.

Be warm and efficient. Don't narrate what the tool does; just ask your questions, then propose.`;

/**
 * The single tool the generation/import agents emit. Shared with the file-import
 * path (`template-import.ts`) so the AI contract is defined in exactly one place.
 */
export const PROPOSE_TEMPLATE_TOOL: Anthropic.Tool = {
  name: 'proposeTemplate',
  description:
    'Emit the finished inspection template. Call this once you have enough information to produce a solid first draft. The platform expands your spec into a full template the user reviews in the editor.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Template title, e.g. "Forklift Pre-Use Inspection".' },
      description: {
        type: 'string',
        description: 'One-line description of what this template covers.',
      },
      pages: {
        type: 'array',
        description: 'Pages of the inspection (each a logical part of the workflow).',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Page title, e.g. "Pre-use checks".' },
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Section title.' },
                  questions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        key: {
                          type: 'string',
                          description:
                            'Optional stable key (e.g. "q_brakes") so other questions can jumpTo this one. Only needed when it is a jump target.',
                        },
                        prompt: {
                          type: 'string',
                          description: 'The question text shown to the inspector.',
                        },
                        type: {
                          type: 'string',
                          enum: [
                            'multipleChoice',
                            'text',
                            'number',
                            'date',
                            'datetime',
                            'time',
                            'checkbox',
                            'slider',
                            'media',
                            'instruction',
                            'signature',
                            'user',
                            'asset',
                            'site',
                            'location',
                          ],
                          description: `Question type (default multipleChoice). Use "user" for a person who is a ${activeBrand.name} user (operator, inspector, driver) — a searchable user picker, NOT text. Use "asset" for a tracked piece of equipment/vehicle (by ID, serial or fleet number). Use "site" for a site/branch/depot and "location" for an area/location.`,
                        },
                        required: {
                          type: 'boolean',
                          description: 'Whether an answer is mandatory.',
                        },
                        multiSelect: {
                          type: 'boolean',
                          description:
                            'Multiple-choice only: allow several answers (disables jumps for this question).',
                        },
                        options: {
                          type: 'array',
                          description: 'Multiple-choice answer options.',
                          items: {
                            type: 'object',
                            properties: {
                              label: {
                                type: 'string',
                                description: 'Option label, e.g. "Pass", "Fail", "N/A".',
                              },
                              color: {
                                type: 'string',
                                enum: [
                                  'green',
                                  'amber',
                                  'orange',
                                  'red',
                                  'blue',
                                  'teal',
                                  'purple',
                                  'grey',
                                ],
                                description:
                                  'Swatch colour. Use green for good, red/amber for bad.',
                              },
                              flag: {
                                type: 'boolean',
                                description:
                                  'Flag this answer — flagged responses surface at the top of the report.',
                              },
                              jumpTo: {
                                type: 'string',
                                description:
                                  'Forward skip when chosen: the key of a LATER question, or the literal "finish". Backward/unknown targets are ignored.',
                              },
                              requireEvidence: {
                                type: 'boolean',
                                description:
                                  'Require a photo/file/video before submit when this option is chosen.',
                              },
                              requireAction: {
                                type: 'string',
                                description:
                                  'Auto-create a corrective action with this title when this option is chosen.',
                              },
                              notifyEmail: {
                                type: 'string',
                                description:
                                  'Email to notify on submit when this option is chosen.',
                              },
                            },
                            required: ['label'],
                          },
                        },
                        body: {
                          type: 'string',
                          description: 'Instruction questions: markdown guidance text.',
                        },
                        unit: {
                          type: 'string',
                          description: 'Number questions: unit label, e.g. "kg", "°C".',
                        },
                        min: { type: 'number', description: 'Number/slider minimum.' },
                        max: { type: 'number', description: 'Number/slider maximum.' },
                        step: { type: 'number', description: 'Slider step.' },
                      },
                      required: ['prompt'],
                    },
                  },
                },
                required: ['title', 'questions'],
              },
            },
          },
          required: ['title', 'sections'],
        },
      },
    },
    required: ['title', 'pages'],
  },
};

/**
 * Server-side web search (Anthropic-hosted; dynamic filtering on Opus 4.8). The
 * agent uses it only when the user opts into a region's regulations — see the
 * system prompt. Bounded so a single turn can't run away.
 */
const WEB_SEARCH_TOOL: Anthropic.Messages.WebSearchTool20260209 = {
  type: 'web_search_20260209',
  name: 'web_search',
  max_uses: 5,
};

/**
 * What the agent is doing during a stretch that produces no text. Every one of
 * these can last tens of seconds on a grounded turn, so each gets its own
 * label rather than a generic spinner — "Searching the web" that names the
 * query is the difference between waiting and giving up.
 */
export type TemplateAgentPhase =
  /** Extended thinking — the model is reasoning, no output yet. */
  | 'thinking'
  /** A web_search call is running inside the API. The longest silent phase. */
  | 'searching'
  /** Search results came back and the model is reading them. */
  | 'reading'
  /** The proposeTemplate tool call is streaming. */
  | 'writing';

/** Events streamed to the browser over SSE while a turn runs. */
export type TemplateAgentEvent =
  | { type: 'text'; delta: string }
  /** The assistant finished a turn by asking follow-up question(s); await the user's reply. */
  | { type: 'assistant_done'; text: string }
  /**
   * The agent moved into a phase that emits nothing the user can see. Sent on
   * every change so the UI can name the current step; `detail` carries the
   * search query when there is one.
   */
  | { type: 'progress'; phase: TemplateAgentPhase; detail?: string }
  /**
   * The model has STARTED writing the template (the proposeTemplate tool call
   * began streaming). Fired well before `proposal` so the UI can show a "building"
   * animation during the long tool-call stream instead of looking stalled.
   */
  | { type: 'building_started' }
  /** The assistant produced a finished, validated spec; the client creates the template. */
  | { type: 'proposal'; spec: TemplateSpec; note: string };

export interface TemplateAgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Ceiling on `pause_turn` resumes in one turn. Each resume is a fresh request,
 * so an unbounded loop would bill and stream for ever. A real grounded turn
 * pauses at most once or twice.
 */
const MAX_RESUMES = 6;

/** Pull the query out of a web_search call so the UI can name what it's looking up. */
function readSearchQuery(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const query = (input as Record<string, unknown>)['query'];
  return typeof query === 'string' && query.trim().length > 0 ? query.trim() : undefined;
}

/** Did this assistant turn run a web search? */
function usedWebSearch(content: readonly Anthropic.ContentBlock[]): boolean {
  return content.some((b) => b.type === 'server_tool_use' && b.name === 'web_search');
}

/**
 * Run one user turn of the template-generation interview. Streams the
 * assistant's follow-up question (if any) and emits a `proposal` once the model
 * produces a valid spec. Invalid specs are fed back to the model to self-correct
 * (bounded retries) so the user never sees a schema error.
 */
export async function runTemplateAgentTurn(input: {
  messages: TemplateAgentMessage[];
  onEvent: (event: TemplateAgentEvent) => void;
  /**
   * Per-tenant overlay (AI Agents): admin-taught knowledge + settings,
   * appended after the base prompt so the cacheable prefix stays stable.
   */
  systemSuffix?: string;
  /** AI Agents webSearch setting — `false` drops the web_search tool. */
  webSearch?: boolean;
}): Promise<void> {
  const { onEvent } = input;
  const useWebSearch = input.webSearch !== false;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const messages: Anthropic.MessageParam[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let assistantText = '';
  let corrections = 0;
  // The proposeTemplate tool call can stream for tens of seconds; signal the UI
  // the instant it begins so it can animate progress rather than appear stuck.
  let signalledBuilding = false;
  // `pause_turn` is resumed by re-sending the turn, so the loop below could in
  // principle be driven round for ever by a model that never settles. Bounded
  // well above any real turn (a turn is capped at 5 searches).
  let resumes = 0;
  // One automatic nudge when the model researches and then stops without
  // drafting — see the guard at the bottom of the loop.
  let nudged = false;

  // Phase is deduped: the raw stream fires thinking deltas continuously, and
  // repeating an unchanged phase down the SSE pipe is pure noise.
  let lastPhase = '';
  const emitPhase = (phase: TemplateAgentPhase, detail?: string): void => {
    const key = `${phase}:${detail ?? ''}`;
    if (key === lastPhase) return;
    lastPhase = key;
    onEvent({ type: 'progress', phase, ...(detail === undefined ? {} : { detail }) });
  };

  while (true) {
    assistantText = '';
    const stream = client.messages.stream({
      model: 'claude-opus-4-8',
      // Streaming, so no HTTP-timeout concern — give room for adaptive thinking
      // plus a full multi-page spec (a large template can be a sizeable tool call).
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      system:
        SYSTEM_PROMPT +
        (useWebSearch
          ? ''
          : '\n\nWeb search is switched off for this workspace: rely on your own knowledge and never promise to look regulations up online; remind the user to double-check anything date-sensitive.') +
        (input.systemSuffix ?? ''),
      tools: useWebSearch ? [PROPOSE_TEMPLATE_TOOL, WEB_SEARCH_TOOL] : [PROPOSE_TEMPLATE_TOOL],
      messages,
    });

    stream.on('text', (text) => {
      assistantText += text;
      onEvent({ type: 'text', delta: text });
    });

    stream.on('thinking', () => {
      emitPhase('thinking');
    });

    // Fires once a block is complete. For a web_search call that is the moment
    // the query is fully known and the (long, silent) search is about to run —
    // exactly when the user needs to be told what is being looked up.
    stream.on('contentBlock', (block) => {
      if (block.type !== 'server_tool_use' || block.name !== 'web_search') return;
      emitPhase('searching', readSearchQuery(block.input));
    });

    stream.on('streamEvent', (event) => {
      if (event.type !== 'content_block_start') return;
      const block = event.content_block;
      if (block.type === 'server_tool_use' && block.name === 'web_search') {
        // The query streams in as JSON deltas, so it isn't known yet; say what
        // is happening now and let `contentBlock` above add the query.
        emitPhase('searching');
      } else if (block.type === 'web_search_tool_result') {
        emitPhase('reading');
      } else if (block.type === 'tool_use' && block.name === 'proposeTemplate') {
        emitPhase('writing');
        if (!signalledBuilding) {
          signalledBuilding = true;
          onEvent({ type: 'building_started' });
        }
      }
    });

    const finalMsg = await stream.finalMessage();

    if (finalMsg.stop_reason === 'pause_turn') {
      // The server-side web_search loop hit its per-request limit. Re-send the
      // assistant turn verbatim and the server resumes where it left off.
      resumes += 1;
      if (resumes > MAX_RESUMES) {
        onEvent({ type: 'assistant_done', text: assistantText });
        return;
      }
      messages.push({ role: 'assistant', content: finalMsg.content });
      continue;
    }

    if (finalMsg.stop_reason !== 'tool_use') {
      // Researching is only ever a prelude to drafting (see the system
      // prompt), so a turn that searched the web and then ended without
      // calling proposeTemplate has stopped half-way — the user is left
      // looking at "let me look that up" and an idle box. Nudge it once.
      // A model that searched and then asked a question would be nudged into
      // proposing instead; that trade is deliberate, since the product's own
      // bias is to propose early and let the user refine in the editor.
      if (!nudged && usedWebSearch(finalMsg.content)) {
        nudged = true;
        messages.push({ role: 'assistant', content: finalMsg.content });
        messages.push({
          role: 'user',
          content:
            'You have the research you needed. Call proposeTemplate now with the finished template — do not ask anything further.',
        });
        continue;
      }
      // The model asked a follow-up question (or replied conversationally).
      onEvent({ type: 'assistant_done', text: assistantText });
      return;
    }

    const proposeBlock = finalMsg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'proposeTemplate',
    );

    if (proposeBlock === undefined) {
      // No recognised tool — treat as a conversational turn.
      onEvent({ type: 'assistant_done', text: assistantText });
      return;
    }

    try {
      const spec = parseTemplateSpec(proposeBlock.input);
      onEvent({ type: 'proposal', spec, note: assistantText });
      return;
    } catch (err) {
      corrections += 1;
      if (corrections > 2) {
        throw err instanceof Error ? err : new Error('Failed to generate a valid template');
      }
      // Feed the validation error back so the model fixes its spec.
      messages.push({ role: 'assistant', content: finalMsg.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: proposeBlock.id,
            content: `The template spec was invalid: ${
              err instanceof Error ? err.message : 'unknown error'
            }. Please call proposeTemplate again with a corrected spec.`,
            is_error: true,
          },
        ],
      });
    }
  }
}

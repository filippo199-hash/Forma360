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
 */
import Anthropic from '@anthropic-ai/sdk';
import { parseTemplateSpec, type TemplateSpec } from '@forma360/shared/template-spec';
import { env } from './env';

const SYSTEM_PROMPT = `You are an expert inspection-template designer for Forma360, an operational-excellence platform (a SafetyCulture-style tool). Your job is to turn a short conversation into a ready-to-use inspection template.

How you work:
1. The user tells you what they want to inspect. Ask AT MOST 2–3 short, high-value follow-up questions — never a long questionnaire. Good things to clarify: the kind of asset/site/activity being inspected, how often it runs, and who fills it in. Ask them together in one message, not one at a time.
2. If the inspection is the kind governed by regulations (fire safety, food hygiene, electrical, working at height, vehicles, healthcare, childcare, etc.), ask whether it should follow a specific region's or country's regulations (e.g. "UK", "California", "EU"). If the user opts in to a region, use the web_search tool to ground the current legal requirements for that domain and jurisdiction BEFORE proposing — search for the specific standard/regulation and reflect its real checklist points in the structure. Only search when the user has asked for regional regulations; otherwise rely on your own knowledge. Phrase everything generated as a practical draft to verify, never as legal advice.
3. As soon as you have enough to draft something useful, call the proposeTemplate tool. Do NOT keep asking questions once you can produce a solid first draft — the user can refine everything in the editor afterwards. Lean toward proposing early.

When you build the template (the proposeTemplate call):
- Organise it into logical pages and sections. A realistic inspection has 10–30 questions.
- Default question type is multipleChoice. Use response options that fit the question; give risky/unsafe options a "flag" and an appropriate colour (red/amber for bad, green for good). Use a mix of types where it helps: text for notes, number for readings, media for "take a photo", signature to sign off, instruction for guidance, date/checkbox/slider where natural.
- Add smart logic where it clearly helps:
  - On an option, set requireEvidence:true when a photo/proof should be mandatory (e.g. a defect found).
  - On an option, set requireAction with a short corrective-action title when a failure should raise a follow-up task.
  - On an option, set notifyEmail when a specific failure should alert someone — only if the user named an email.
  - Use jumpTo on an option to skip ahead to a later question's key (forward only) or to "finish" when a "No / Not applicable" answer makes the rest irrelevant. Give those questions a stable "key" so you can target them.
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
                          ],
                          description: 'Question type. Defaults to multipleChoice.',
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

/** Events streamed to the browser over SSE while a turn runs. */
export type TemplateAgentEvent =
  | { type: 'text'; delta: string }
  /** The assistant finished a turn by asking follow-up question(s); await the user's reply. */
  | { type: 'assistant_done'; text: string }
  /** The assistant produced a finished, validated spec; the client creates the template. */
  | { type: 'proposal'; spec: TemplateSpec; note: string };

export interface TemplateAgentMessage {
  role: 'user' | 'assistant';
  content: string;
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
}): Promise<void> {
  const { onEvent } = input;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const messages: Anthropic.MessageParam[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let assistantText = '';
  let corrections = 0;

  while (true) {
    assistantText = '';
    const stream = client.messages.stream({
      model: 'claude-opus-4-8',
      // Streaming, so no HTTP-timeout concern — give room for adaptive thinking
      // plus a full multi-page spec (a large template can be a sizeable tool call).
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      tools: [PROPOSE_TEMPLATE_TOOL, WEB_SEARCH_TOOL],
      messages,
    });

    stream.on('text', (text) => {
      assistantText += text;
      onEvent({ type: 'text', delta: text });
    });

    const finalMsg = await stream.finalMessage();

    if (finalMsg.stop_reason === 'pause_turn') {
      // The server-side web_search loop hit its per-request limit. Re-send the
      // assistant turn verbatim and the server resumes where it left off.
      messages.push({ role: 'assistant', content: finalMsg.content });
      continue;
    }

    if (finalMsg.stop_reason !== 'tool_use') {
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

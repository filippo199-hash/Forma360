/**
 * Per-widget AI chat (ADR 0018 follow-up).
 *
 * A focused Q&A assistant scoped to ONE dashboard widget: the user asks
 * about that specific chart or number and the model answers strictly from
 * the widget's definition and its CURRENT data (passed in by the route,
 * already permission-gated). Unlike the builder agent it emits no tool
 * call — it is a grounded conversation, streamed as text over SSE.
 *
 * The conversation is ephemeral (client-held), same contract as the
 * builder chat.
 */
import Anthropic from '@anthropic-ai/sdk';
import { activeBrand } from '../lib/brand';
import { env } from './env';

/** Everything the model may reason about — one widget, its data, its filters. */
export interface WidgetChatContext {
  dashboardTitle: string;
  widgetTitle: string;
  sourceLabel: string;
  /** The widget's kind + references, for the model to describe accurately. */
  widgetJson: unknown;
  /** The widget's current computed data (KPI/timeseries/breakdown/table). */
  dataJson: unknown;
  /** Human summary of the applied filters (range + sites). */
  filtersSummary: string;
}

function buildSystemPrompt(ctx: WidgetChatContext): string {
  return `You are a safety & operations analyst for ${activeBrand.name}, helping a user understand ONE widget on their dashboard "${ctx.dashboardTitle}".

The widget is titled "${ctx.widgetTitle}" and draws on the ${ctx.sourceLabel} data. ${ctx.filtersSummary}

This is the widget's definition:
${JSON.stringify(ctx.widgetJson, null, 2)}

This is the widget's CURRENT data (exactly what the user is looking at):
${JSON.stringify(ctx.dataJson, null, 2)}

Rules:
- Answer ONLY from this widget's data above. It is the single source of truth — do not invent numbers, and quote the actual values when relevant.
- If the user asks about something this widget does not contain (another module, a different metric, a longer time range), say so briefly and suggest they adjust the dashboard's filters or ask the dashboard builder — do not guess.
- Be concise and concrete: lead with the number or the trend, then a short interpretation. Plain language, no jargon dumps.
- You may point out what stands out (a spike, an outlier category, zero data), but never give medical, legal, or formal compliance advice — frame observations as things to look into.
- Reply in the user's language.`;
}

export type WidgetChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'done'; text: string }
  | { type: 'error'; message: string };

export interface WidgetChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function runWidgetChatTurn(input: {
  messages: WidgetChatMessage[];
  context: WidgetChatContext;
  onEvent: (event: WidgetChatEvent) => void;
}): Promise<void> {
  const { onEvent, context } = input;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const messages: Anthropic.MessageParam[] = input.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let text = '';
  const stream = client.messages.stream({
    model: 'claude-opus-5',
    max_tokens: 1500,
    system: buildSystemPrompt(context),
    messages,
  });
  stream.on('text', (delta) => {
    text += delta;
    onEvent({ type: 'text', delta });
  });
  await stream.finalMessage();
  onEvent({ type: 'done', text });
}

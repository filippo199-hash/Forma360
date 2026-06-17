/**
 * Shared AI assistant agent loop.
 *
 * The same tool-calling agent powers two surfaces:
 *   - the web chat route (`/api/ai/chat`), which streams deltas over SSE; and
 *   - the WhatsApp webhook (`/api/whatsapp/webhook`), which only needs the
 *     final assistant text to send back as a single message.
 *
 * Both call {@link runAiAgentTurn}. The web route passes an `onEvent` callback
 * to forward `conversation` / `text` / `tool_call` events to the browser; the
 * WhatsApp route omits it and just reads the returned `assistantText`.
 *
 * All conversation persistence (conversation row, user message, assistant
 * message, `updatedAt` bump) lives here so the two surfaces stay identical.
 */
import Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq } from 'drizzle-orm';
import {
  type ActionStatus,
  actions,
  aiConversations,
  aiMessages,
  assets,
  documents,
  headsUps,
  type InspectionStatus,
  inspections,
  type IssueStatus,
  issues,
  templateSchedules,
} from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { db } from './db';
import { env } from './env';

const SYSTEM_PROMPT = `You are an AI assistant for Forma360, an operational-excellence platform.
You have access to this company's data via tools. Always use tools to look up real data before answering questions about inspections, issues, actions, assets, documents, or heads-up items.
Be concise and helpful. Format lists clearly. Always scope your responses to the data you retrieve — never invent data.
Today's date context is provided when you call tools. Times are UTC.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_inspections',
    description:
      'List recent inspections for this company. Use to answer questions about inspection status, history, or activity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results (default 10, max 50)' },
        status: {
          type: 'string',
          enum: ['in_progress', 'submitted', 'completed', 'rejected'],
          description: 'Filter by status',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_issues',
    description: 'List recent observations/issues for this company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results (default 10, max 50)' },
        status: {
          type: 'string',
          enum: ['open', 'investigation', 'closed'],
          description: 'Filter by status',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_actions',
    description: 'List actions/corrective tasks for this company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results (default 10, max 50)' },
        status: {
          type: 'string',
          enum: ['open', 'in_progress', 'completed', 'cancelled'],
          description: 'Filter by status',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_assets',
    description: 'List assets registered for this company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results (default 10, max 50)' },
      },
      required: [],
    },
  },
  {
    name: 'list_headsup',
    description: 'List heads-up announcements/notices for this company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results (default 10, max 50)' },
      },
      required: [],
    },
  },
  {
    name: 'list_documents',
    description: 'List documents and policies for this company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results (default 10, max 50)' },
      },
      required: [],
    },
  },
  {
    name: 'list_schedules',
    description: 'List upcoming or recent inspection schedules for this company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results (default 10, max 50)' },
      },
      required: [],
    },
  },
];

type ToolName =
  | 'list_inspections'
  | 'list_issues'
  | 'list_actions'
  | 'list_assets'
  | 'list_headsup'
  | 'list_documents'
  | 'list_schedules';

async function executeTool(
  name: ToolName,
  input: Record<string, unknown>,
  tenantId: string,
): Promise<unknown> {
  const limit = Math.min(Number(input['limit'] ?? 10), 50);

  switch (name) {
    case 'list_inspections': {
      const statusFilter =
        typeof input['status'] === 'string' ? (input['status'] as InspectionStatus) : undefined;
      const rows = await db
        .select({
          id: inspections.id,
          title: inspections.title,
          status: inspections.status,
          createdAt: inspections.createdAt,
          submittedAt: inspections.submittedAt,
          completedAt: inspections.completedAt,
        })
        .from(inspections)
        .where(
          and(
            eq(inspections.tenantId, tenantId),
            statusFilter ? eq(inspections.status, statusFilter) : undefined,
          ),
        )
        .orderBy(desc(inspections.createdAt))
        .limit(limit);
      return { total: rows.length, inspections: rows };
    }

    case 'list_issues': {
      const statusFilter =
        typeof input['status'] === 'string' ? (input['status'] as IssueStatus) : undefined;
      const rows = await db
        .select({
          id: issues.id,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
          createdAt: issues.createdAt,
        })
        .from(issues)
        .where(
          and(eq(issues.tenantId, tenantId), statusFilter ? eq(issues.status, statusFilter) : undefined),
        )
        .orderBy(desc(issues.createdAt))
        .limit(limit);
      return { total: rows.length, issues: rows };
    }

    case 'list_actions': {
      const statusFilter =
        typeof input['status'] === 'string' ? (input['status'] as ActionStatus) : undefined;
      const rows = await db
        .select({
          id: actions.id,
          title: actions.title,
          status: actions.status,
          priority: actions.priority,
          dueAt: actions.dueAt,
          createdAt: actions.createdAt,
        })
        .from(actions)
        .where(
          and(
            eq(actions.tenantId, tenantId),
            statusFilter ? eq(actions.status, statusFilter) : undefined,
          ),
        )
        .orderBy(desc(actions.createdAt))
        .limit(limit);
      return { total: rows.length, actions: rows };
    }

    case 'list_assets': {
      const rows = await db
        .select({
          id: assets.id,
          name: assets.name,
          description: assets.description,
          createdAt: assets.createdAt,
        })
        .from(assets)
        .where(eq(assets.tenantId, tenantId))
        .orderBy(desc(assets.createdAt))
        .limit(limit);
      return { total: rows.length, assets: rows };
    }

    case 'list_headsup': {
      const rows = await db
        .select({
          id: headsUps.id,
          title: headsUps.title,
          status: headsUps.status,
          publishAt: headsUps.publishAt,
          createdAt: headsUps.createdAt,
        })
        .from(headsUps)
        .where(eq(headsUps.tenantId, tenantId))
        .orderBy(desc(headsUps.createdAt))
        .limit(limit);
      return { total: rows.length, headsUps: rows };
    }

    case 'list_documents': {
      const rows = await db
        .select({
          id: documents.id,
          name: documents.name,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .where(eq(documents.tenantId, tenantId))
        .orderBy(desc(documents.createdAt))
        .limit(limit);
      return { total: rows.length, documents: rows };
    }

    case 'list_schedules': {
      const rows = await db
        .select({
          id: templateSchedules.id,
          name: templateSchedules.name,
          timezone: templateSchedules.timezone,
          paused: templateSchedules.paused,
          createdAt: templateSchedules.createdAt,
        })
        .from(templateSchedules)
        .where(eq(templateSchedules.tenantId, tenantId))
        .orderBy(desc(templateSchedules.createdAt))
        .limit(limit);
      return { total: rows.length, schedules: rows };
    }
  }
}

/** Events emitted during a turn, forwarded to the browser by the SSE route. */
export type AgentEvent =
  | { type: 'conversation'; conversationId: string; isNew: boolean }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; toolName: string };

export interface RunAgentInput {
  tenantId: string;
  userId: string;
  message: string;
  /** Existing conversation to continue, or null/undefined to start a new one. */
  conversationId?: string | null | undefined;
  /** Optional sink for streaming events (web SSE). WhatsApp omits this. */
  onEvent?: (event: AgentEvent) => void;
}

export interface RunAgentResult {
  conversationId: string;
  isNew: boolean;
  assistantText: string;
}

/**
 * Run one user turn through the tool-calling agent and persist both the user
 * message and the final assistant message. Streams `text` / `tool_call` events
 * to `onEvent` as they happen. Returns the full assistant text so non-streaming
 * callers (WhatsApp) can send it as one message.
 */
export async function runAiAgentTurn(input: RunAgentInput): Promise<RunAgentResult> {
  const { tenantId, userId, message, conversationId: incomingConvId, onEvent } = input;

  let conversationId: string;
  let isNew = false;

  if (incomingConvId) {
    const [existing] = await db
      .select({ id: aiConversations.id })
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.id, incomingConvId),
          eq(aiConversations.tenantId, tenantId),
          eq(aiConversations.userId, userId),
        ),
      )
      .limit(1);
    conversationId = existing ? incomingConvId : newId();
    if (!existing) isNew = true;
  } else {
    conversationId = newId();
    isNew = true;
  }

  if (isNew) {
    const title = message.slice(0, 80).trim();
    await db.insert(aiConversations).values({
      id: conversationId,
      tenantId,
      userId,
      title: title.length > 60 ? `${title.slice(0, 60)}…` : title,
    });
  }

  await db.insert(aiMessages).values({
    id: newId(),
    conversationId,
    role: 'user',
    content: message,
  });

  onEvent?.({ type: 'conversation', conversationId, isNew });

  const history = await db
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(aiMessages.createdAt);

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let fullAssistantText = '';

  while (true) {
    const sdkStream = client.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    sdkStream.on('text', (text) => {
      fullAssistantText += text;
      onEvent?.({ type: 'text', delta: text });
    });

    const finalMsg = await sdkStream.finalMessage();

    if (finalMsg.stop_reason !== 'tool_use') break;

    const toolUseBlocks = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolBlock of toolUseBlocks) {
      onEvent?.({ type: 'tool_call', toolName: toolBlock.name });
      try {
        const result = await executeTool(
          toolBlock.name as ToolName,
          toolBlock.input as Record<string, unknown>,
          tenantId,
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result),
        });
      } catch {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify({ error: 'Tool execution failed' }),
          is_error: true,
        });
      }
    }

    messages.push({ role: 'assistant', content: finalMsg.content });
    messages.push({ role: 'user', content: toolResults });
  }

  if (fullAssistantText.length > 0) {
    await db.insert(aiMessages).values({
      id: newId(),
      conversationId,
      role: 'assistant',
      content: fullAssistantText,
    });
    await db
      .update(aiConversations)
      .set({ updatedAt: new Date() })
      .where(eq(aiConversations.id, conversationId));
  }

  return { conversationId, isNew, assistantText: fullAssistantText };
}

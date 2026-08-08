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
  headsUps,
  incidents,
  type InspectionStatus,
  inspections,
  type IssueStatus,
  issues,
  templateSchedules,
} from '@forma360/db/schema';
import type { IncidentStatus } from '@forma360/shared/incidents';
import { newId } from '@forma360/shared/id';
import { db } from './db';
import { env } from './env';
import {
  type AgentImage,
  buildUserContent,
  CALLER_TOOL_NAMES,
  TOOLS,
  type ToolName,
  toToolError,
  WRITE_INSTRUCTIONS,
} from './agent-tools';
import { activeBrand } from '../lib/brand';
import { createServerCaller, type ServerCaller } from './server-caller';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import type { PermissionKey } from '@forma360/permissions/catalogue';

const SYSTEM_PROMPT = `You are an AI assistant for ${activeBrand.name}, an operational-excellence platform.
You have access to this company's data via tools. Always use tools to look up real data before answering questions about inspections, issues, actions, assets, documents, heads-up items, permits, COSHH substances, risk assessments, fire safety, or contractors.
Be concise and helpful. Format lists clearly. Always scope your responses to the data you retrieve — never invent data.
Safety guardrail: you are an information assistant, not a competent person under health-and-safety law. Never declare an activity, workplace, substance or piece of equipment "safe", never authorise work to proceed, and never provide improvised emergency-response or first-aid instructions — in an emergency tell the user to follow their site's emergency procedures and call the local emergency number. When asked for a safety judgement, report what the company's own records (risk assessments, permits, COSHH assessments, fire safety checks) say, flag anything overdue or failed, and direct the user to the responsible competent person.
Today's date context is provided when you call tools. Times are UTC.`;

/**
 * Appended for the in-app (web) channel only: tells the agent to make entity
 * names clickable Markdown links to their detail pages (rendered as in-app
 * links by MarkdownMessage). Omitted on WhatsApp, where Markdown links would
 * show as raw, untappable text.
 */
const WEB_LINK_INSTRUCTIONS = `

When you list or reference an entity (inspection, observation, action, asset, document, heads-up item), make its name/title a clickable Markdown link to its detail page so the user can open it directly — this includes the first column of any table. Build the link target from the entity's "id" returned by the tools, using these URL patterns:
- inspection: /inspections/{id}
- observation (issue): /observations/{id}
- action: /actions/{id}
- asset: /assets/{id}
- document: /documents/{id}
- heads-up: /heads-up/{id}
Do not print raw ids in the text — put the id only inside the link target. Example table row: | [Full service — car 1](/actions/01ABCDEF...) | Medium | 18 Jun 2027 |`;

interface AgentToolCtx {
  tenantId: string;
  /** Authoritative tRPC caller — enforces permissions + reuses all real logic. */
  caller: ServerCaller;
  /** The acting user's live permissions — gates the direct-db read tools. */
  permissions: readonly PermissionKey[];
}

/**
 * The module `.view` permission each direct-db read tool requires. The
 * caller-backed tools (users, observation categories, all writes) enforce
 * permissions through tRPC already; these plain reads bypass tRPC, so they are
 * gated here against the same permission the equivalent tRPC list procedure
 * uses. Without this a user with no `inspections.view` could ask the assistant
 * to "list all inspections" and receive tenant data the UI hides from them.
 */
const READ_TOOL_PERMISSION: Partial<Record<ToolName, PermissionKey>> = {
  list_inspections: 'inspections.view',
  list_issues: 'issues.view',
  list_actions: 'actions.view',
  list_assets: 'assets.view',
  list_headsup: 'headsUp.view',
  list_documents: 'documents.view',
  list_schedules: 'templates.schedules.manage',
  list_incidents: 'incidents.view',
  get_incident: 'incidents.view',
};

async function executeTool(
  name: ToolName,
  input: Record<string, unknown>,
  ctx: AgentToolCtx,
): Promise<unknown> {
  const { tenantId, caller } = ctx;
  const limit = Math.min(Number(input['limit'] ?? 10), 50);

  // Permission gate for the direct-db read tools (server is the source of
  // truth for permissions — the UI hiding a module must not be bypassable via
  // the assistant).
  const requiredPerm = READ_TOOL_PERMISSION[name];
  if (requiredPerm !== undefined && !ctx.permissions.includes(requiredPerm)) {
    return {
      error: `You do not have permission to view this data (${requiredPerm}). Ask an administrator for access.`,
    };
  }

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
          and(
            eq(issues.tenantId, tenantId),
            statusFilter ? eq(issues.status, statusFilter) : undefined,
          ),
        )
        .orderBy(desc(issues.createdAt))
        .limit(limit);
      return { total: rows.length, issues: rows };
    }

    case 'list_incidents': {
      // Confidential incidents are counted-not-readable: without the key
      // the assistant never sees their titles or details (IN-E14).
      const holdsKey = ctx.permissions.includes('incidents.confidential.view');
      const statusFilter =
        typeof input['status'] === 'string' ? (input['status'] as IncidentStatus) : undefined;
      const rows = await db
        .select({
          id: incidents.id,
          referenceNumber: incidents.referenceNumber,
          title: incidents.title,
          kind: incidents.kind,
          severity: incidents.severity,
          status: incidents.status,
          confidential: incidents.confidential,
          occurredAt: incidents.occurredAt,
          riddorCategory: incidents.riddorCategory,
          riddorDeadlineAt: incidents.riddorDeadlineAt,
        })
        .from(incidents)
        .where(
          and(
            eq(incidents.tenantId, tenantId),
            statusFilter ? eq(incidents.status, statusFilter) : undefined,
            holdsKey ? undefined : eq(incidents.confidential, false),
          ),
        )
        .orderBy(desc(incidents.occurredAt))
        .limit(limit);
      return { total: rows.length, incidents: rows };
    }

    case 'get_incident': {
      const incidentId = typeof input['incidentId'] === 'string' ? input['incidentId'] : '';
      const rows = await db
        .select({
          id: incidents.id,
          referenceNumber: incidents.referenceNumber,
          title: incidents.title,
          description: incidents.description,
          kind: incidents.kind,
          severity: incidents.severity,
          status: incidents.status,
          confidential: incidents.confidential,
          occurredAt: incidents.occurredAt,
          reportedAt: incidents.reportedAt,
          locationText: incidents.locationText,
          investigationLevel: incidents.investigationLevel,
          riddorCategory: incidents.riddorCategory,
          riddorDeadlineAt: incidents.riddorDeadlineAt,
          riddorSubmittedAt: incidents.riddorSubmittedAt,
          effectivenessDueAt: incidents.effectivenessDueAt,
          effectivenessVerdict: incidents.effectivenessVerdict,
        })
        .from(incidents)
        .where(and(eq(incidents.tenantId, tenantId), eq(incidents.id, incidentId)))
        .limit(1);
      const row = rows[0];
      if (row === undefined) return { error: 'Incident not found.' };
      if (row.confidential && !ctx.permissions.includes('incidents.confidential.view')) {
        return {
          error:
            'This incident is confidential. Only the reporter, the investigation team and confidential-access holders can view it.',
        };
      }
      return { incident: row };
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
      // Documents carry per-folder / group / site visibility (unlike the other
      // list_* reads). Route through the caller so `documents.list` applies the
      // same non-manager visibility filter the UI does — a direct db read would
      // leak restricted documents' names to users who can't see them.
      const rows = (await caller.documents.list({})).documents;
      const trimmed = rows.slice(0, limit).map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.createdAt,
      }));
      return { total: trimmed.length, documents: trimmed };
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

    // ── Write tools — delegate to the real procedures via the caller ──────────

    case 'list_observation_categories': {
      return caller.issues.categories.list();
    }

    case 'list_users': {
      return caller.users.list({});
    }

    case 'create_observation': {
      try {
        const res = await caller.issues.issues.create({
          categoryId: String(input['categoryId']),
          title: String(input['title']),
          ...(input['description'] !== undefined
            ? { description: String(input['description']) }
            : {}),
          ...(input['siteId'] !== undefined ? { siteId: String(input['siteId']) } : {}),
        });
        return { ok: true, ...res };
      } catch (err) {
        return toToolError(err);
      }
    }

    case 'create_action': {
      try {
        const priority = input['priority'];
        const res = await caller.actions.createStandalone({
          title: String(input['title']),
          ...(input['description'] !== undefined
            ? { description: String(input['description']) }
            : {}),
          ...(typeof priority === 'string'
            ? { priority: priority as 'low' | 'medium' | 'high' | 'critical' }
            : {}),
          ...(input['assigneeUserId'] !== undefined
            ? { assigneeUserId: String(input['assigneeUserId']) }
            : {}),
          ...(input['dueAt'] !== undefined ? { dueAt: String(input['dueAt']) } : {}),
          ...(input['siteId'] !== undefined ? { siteId: String(input['siteId']) } : {}),
        });
        return { ok: true, ...res };
      } catch (err) {
        return toToolError(err);
      }
    }

    case 'comment_on_action': {
      try {
        const res = await caller.actions.comments.create({
          actionId: String(input['actionId']),
          body: String(input['body']),
        });
        return { ok: true, ...res };
      } catch (err) {
        return toToolError(err);
      }
    }

    case 'comment_on_observation': {
      try {
        const res = await caller.issues.comments.create({
          issueId: String(input['observationId']),
          body: String(input['body']),
        });
        return { ok: true, ...res };
      } catch (err) {
        return toToolError(err);
      }
    }

    case 'record_asset_reading': {
      try {
        const res = await caller.assets.readings.add({
          assetId: String(input['assetId']),
          fieldName: String(input['fieldName']),
          value: Number(input['value']),
          ...(input['unit'] !== undefined ? { unit: String(input['unit']) } : {}),
        });
        return { ok: true, ...res };
      } catch (err) {
        return toToolError(err);
      }
    }

    case 'create_headsup': {
      try {
        const res = await caller.headsUps.create({
          title: String(input['title']),
          description: String(input['description']),
        });
        return { ok: true, ...res };
      } catch (err) {
        return toToolError(err);
      }
    }

    // PF-24: brand-module reads — routed through the real routers so brand
    // gating (FreeHS-only modules) and permission checks apply untouched.
    case 'list_permits': {
      try {
        const rawStatus = typeof input['status'] === 'string' ? input['status'] : 'open';
        const allowed = [
          'open',
          'draft',
          'issued',
          'active',
          'suspended',
          'closed',
          'cancelled',
          'all',
        ] as const;
        const status = (allowed as readonly string[]).includes(rawStatus)
          ? (rawStatus as (typeof allowed)[number])
          : 'open';
        const rows = await caller.permits.list({
          status,
          ...(typeof input['search'] === 'string' && input['search'].length > 0
            ? { search: input['search'] }
            : {}),
        });
        return { permits: rows.slice(0, limit) };
      } catch (err) {
        return toToolError(err);
      }
    }

    case 'list_coshh_substances': {
      try {
        const rows = await caller.coshh.substances.list({});
        return { substances: rows.slice(0, limit) };
      } catch (err) {
        return toToolError(err);
      }
    }

    case 'list_risk_assessments': {
      try {
        const rawStatus = typeof input['status'] === 'string' ? input['status'] : 'all';
        const allowed = ['all', 'draft', 'active', 'archived'] as const;
        const status = (allowed as readonly string[]).includes(rawStatus)
          ? (rawStatus as (typeof allowed)[number])
          : 'all';
        const rows = await caller.riskAssessments.list({ status, type: 'all' });
        return { riskAssessments: rows.slice(0, limit) };
      } catch (err) {
        return toToolError(err);
      }
    }

    case 'list_rams_packs': {
      try {
        const rawStatus = typeof input['status'] === 'string' ? input['status'] : undefined;
        const allowed = ['draft', 'issued', 'superseded', 'withdrawn', 'cancelled'] as const;
        const status =
          rawStatus !== undefined && (allowed as readonly string[]).includes(rawStatus)
            ? (rawStatus as (typeof allowed)[number])
            : undefined;
        const search = typeof input['search'] === 'string' ? input['search'] : undefined;
        const rows = await caller.rams.packs.list({
          limit,
          ...(status !== undefined ? { status } : {}),
          ...(search !== undefined ? { search } : {}),
        });
        return { ramsPacks: rows };
      } catch (err) {
        return toToolError(err);
      }
    }

    case 'get_rams_pack': {
      try {
        const packId = typeof input['packId'] === 'string' ? input['packId'] : '';
        const detail = await caller.rams.packs.get({ packId });
        // Trim to what the assistant can actually reason about — the raw
        // detail carries signature blobs and the full event log.
        return {
          pack: {
            referenceNumber: detail.pack.referenceNumber,
            title: detail.pack.title,
            status: detail.pack.status,
            clientName: detail.pack.clientName,
            site: detail.site?.name ?? null,
            locationText: detail.pack.locationText,
            plannedFrom: detail.pack.plannedFrom,
            plannedTo: detail.pack.plannedTo,
            currentVersion: detail.pack.currentVersion,
            supervisorName: detail.pack.supervisorName,
            scopeOfWorks: detail.pack.draftContent.scopeOfWorks,
          },
          steps: detail.pack.draftContent.steps.map((s) => ({
            sequence: s.sequence,
            title: s.title,
            description: s.description,
            holdPoint: s.holdPoint?.description ?? null,
            ppe: s.ppe,
          })),
          emergency: detail.pack.draftContent.emergency,
          riskAssessments: detail.riskAssessments.map((r) => ({
            title: r.title,
            reference: r.referenceNumber,
            version: r.versionNumber,
            hazardCount: r.hazards.length,
          })),
          coshh: detail.coshh.map((c) => ({
            substance: c.substanceName,
            task: c.taskDescription,
          })),
          briefings: detail.briefings.map((b) => ({
            name: b.briefeeName,
            briefedAt: b.briefedAt,
            onCurrentVersion: b.current,
          })),
          clientAcceptance: detail.clientLinks.map((l) => ({
            decision: l.decision,
            acceptedByName: l.acceptedByName,
            decidedAt: l.decidedAt,
          })),
          issueGate: detail.issueGate,
        };
      } catch (err) {
        return toToolError(err);
      }
    }

    case 'fire_safety_overview': {
      try {
        const overview = await caller.fireSafety.overview();
        return overview;
      } catch (err) {
        return toToolError(err);
      }
    }

    case 'list_contractors_on_site': {
      try {
        const rows = await caller.contractors.visits.onSiteNow();
        return { contractors: rows.slice(0, limit) };
      } catch (err) {
        return toToolError(err);
      }
    }

    case 'list_sites': {
      try {
        const rows = await caller.sites.list();
        return { sites: rows.slice(0, limit) };
      } catch (err) {
        return toToolError(err);
      }
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
  /** Delivery channel. 'web' enables clickable entity links; defaults to 'web'. */
  channel?: 'web' | 'whatsapp';
  /** Images attached to this turn — shown to Claude's vision (not persisted). */
  images?: ReadonlyArray<AgentImage>;
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
  // Write tools apply on every channel; clickable entity links only make sense
  // in the web app (WhatsApp shows Markdown links as raw text).
  const base = SYSTEM_PROMPT + WRITE_INSTRUCTIONS;
  const systemPrompt = (input.channel ?? 'web') === 'web' ? base + WEB_LINK_INSTRUCTIONS : base;

  // Built lazily on first tool call (one email lookup) — turns that don't call
  // a tool never pay for it.
  // The acting user's live permissions — loaded once and used to gate the
  // direct-db read tools (H1). Written and caller-backed tools re-check
  // through tRPC regardless.
  const permissions = await loadUserPermissions(db, tenantId, userId);

  let cachedCaller: ServerCaller | null = null;
  const getCaller = async (): Promise<ServerCaller> => {
    cachedCaller ??= await createServerCaller({ tenantId, userId });
    return cachedCaller;
  };

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

  // Attach any images to the current (last) user turn so Claude's vision sees
  // them alongside the caption. Images are not persisted to history, so they're
  // not replayed on later turns — the agent acts on the photo when it arrives.
  if (input.images && input.images.length > 0) {
    const lastIdx = messages.length - 1;
    const last = messages[lastIdx];
    if (last && last.role === 'user' && typeof last.content === 'string') {
      messages[lastIdx] = { role: 'user', content: buildUserContent(last.content, input.images) };
    }
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let fullAssistantText = '';

  while (true) {
    const sdkStream = client.messages.stream({
      model: 'claude-opus-4-8',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
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
        // Only the caller-backed tools build a caller; the plain db reads pass a
        // placeholder they never touch (keeps one executeTool signature).
        const caller = CALLER_TOOL_NAMES.has(toolBlock.name as ToolName)
          ? await getCaller()
          : (undefined as unknown as ServerCaller);
        const result = await executeTool(
          toolBlock.name as ToolName,
          toolBlock.input as Record<string, unknown>,
          { tenantId, caller, permissions },
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

/**
 * Server-side registry of task-agent definitions.
 *
 * The shared catalogue (`@forma360/shared/ai-agents`) is the UI-facing
 * half — ids, gates, settings vocabularies. This registry is the
 * runtime half: base prompts, propose tools, validators and tenant
 * context builders live server-only so prompt text never ships to the
 * client bundle.
 *
 * The three legacy agents (template-drafter, dashboard-builder,
 * sds-importer) run on their own pre-existing endpoints and have no
 * entry here — `getTaskAgentServerDef` returns null and the agent-chat
 * route refuses them.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Database } from '@forma360/db/client';
import type { AiAgentId } from '@forma360/shared/ai-agents';
import { DEFINITIONS } from './definitions';

export interface TaskAgentContextInput {
  db: Database;
  tenantId: string;
  userId: string;
  /** Panel-supplied anchors (e.g. packId, incidentId), already validated. */
  params: Record<string, string>;
}

export interface TaskAgentServerDef {
  agentId: AiAgentId;
  /** Tenant-independent base system prompt. */
  basePrompt: string;
  proposeTool: Anthropic.Tool;
  /** Zod gate over the propose tool input; throws readable messages. */
  parseProposal: (input: unknown) => unknown;
  /**
   * Render the tenant's validated settings as plain prompt lines
   * ("Draft detail: thorough"). Empty string when nothing applies.
   */
  settingsBlock: (settings: Record<string, string>) => string;
  /**
   * Server-fetched tenant context for this request — the module data the
   * draft builds on (hazard libraries, the anchored record, catalogues).
   * Everything read here is tenant-scoped by construction: the route
   * passes the session tenant, never client input.
   */
  buildContext: (input: TaskAgentContextInput) => Promise<string>;
}

export function getTaskAgentServerDef(agentId: AiAgentId): TaskAgentServerDef | null {
  return DEFINITIONS.find((d) => d.agentId === agentId) ?? null;
}

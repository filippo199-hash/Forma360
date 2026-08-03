/**
 * AI assistant tool definitions + pure helpers.
 *
 * Kept free of side-effectful imports (no env, db, redis, or server-caller) so
 * it can be unit-tested in isolation — `ai-agent.ts` wires these to the real
 * runtime. Read tools (`list_*`) are served straight from the db; the
 * caller-backed tools (writes + two permission-gated reads) go through the
 * tRPC server caller. See WRITE_INSTRUCTIONS for the confirm-before-write
 * contract the model must follow.
 */
import type Anthropic from '@anthropic-ai/sdk';

export type ToolName =
  | 'list_inspections'
  | 'list_issues'
  | 'list_actions'
  | 'list_assets'
  | 'list_headsup'
  | 'list_documents'
  | 'list_schedules'
  | 'list_observation_categories'
  | 'list_users'
  | 'list_incidents'
  | 'get_incident'
  | 'create_observation'
  | 'create_action'
  | 'comment_on_action'
  | 'comment_on_observation'
  | 'record_asset_reading'
  | 'create_headsup'
  | 'list_permits'
  | 'list_coshh_substances'
  | 'list_risk_assessments'
  | 'fire_safety_overview'
  | 'list_contractors_on_site'
  | 'list_sites';

/**
 * Tools that go through the tRPC caller (writes + the reads backed by
 * permission-gated procedures). `list_documents` is caller-backed too: unlike
 * the other `list_*` reads, documents carry per-folder / group / site
 * visibility, so it must reuse `documents.list` (which filters for
 * non-managers) rather than read the db directly — a plain tenant-scoped read
 * would surface restricted documents' names to users who can't see them.
 * The remaining `list_*` reads have no per-row visibility, so they query the
 * db directly.
 */
export const CALLER_TOOL_NAMES = new Set<ToolName>([
  // PF-24: the four brand modules + contractors + sites — routed through
  // the real routers so brand gating and permissions apply untouched.
  'list_permits',
  'list_coshh_substances',
  'list_risk_assessments',
  'fire_safety_overview',
  'list_contractors_on_site',
  'list_sites',
  'list_observation_categories',
  'list_users',
  'list_documents',
  'create_observation',
  'create_action',
  'comment_on_action',
  'comment_on_observation',
  'record_asset_reading',
  'create_headsup',
]);

/** The six write (mutation) tools — used by tests + the confirm-before-write gate. */
export const WRITE_TOOL_NAMES = new Set<ToolName>([
  'create_observation',
  'create_action',
  'comment_on_action',
  'comment_on_observation',
  'record_asset_reading',
  'create_headsup',
]);

/**
 * Appended to the system prompt on every channel. Governs the write tools.
 * The confirm-before-write contract is enforced here at the prompt level; the
 * tools themselves perform the commit when called, and the server still
 * enforces permissions independently.
 */
export const WRITE_INSTRUCTIONS = `

You can also take actions on the user's behalf using the write tools: create an observation, create a corrective action, comment on an action or observation, record an asset meter reading (which feeds maintenance scheduling), and draft a heads-up announcement.

Rules for write actions — follow these exactly:
- ALWAYS confirm with the user BEFORE calling any create / comment / record tool. First summarise what you're about to do (the type, the title, and the key fields), then ask the user to confirm. Only call the tool after they clearly say yes.
- If the request is ambiguous — e.g. it's unclear whether they want an observation or an action, which asset they mean, or which item to comment on — ask one short clarifying question first.
- To create an observation you must pick a category: call list_observation_categories and choose the best match (ask the user if it's unclear). To assign an action to someone, call list_users to resolve the person to their id.
- After a successful write, confirm it's done and include the reference number returned (e.g. "Done — created action AC-000123").
- You can only do what the user's permissions allow. If a tool returns a permission error, tell the user plainly that they don't have permission for that action — do not retry.
- A drafted heads-up is created as a DRAFT only; it is not published or sent to anyone. Make that clear to the user.`;

/** Image media types Claude's vision accepts. WhatsApp photos are jpeg. */
export const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export interface AgentImage {
  /** Base64-encoded image bytes (no data: prefix). */
  base64: string;
  /** One of SUPPORTED_IMAGE_MEDIA_TYPES. */
  mediaType: string;
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * Build the content for a user turn that may carry images. With no images it's
 * a plain string (the existing path). With images it's a content-block array:
 * the image blocks followed by the text, so Claude sees the photo alongside
 * the caption. Callers guarantee each mediaType is in SUPPORTED_IMAGE_MEDIA_TYPES.
 */
export function buildUserContent(
  text: string,
  images: ReadonlyArray<AgentImage>,
): string | Anthropic.ContentBlockParam[] {
  if (images.length === 0) return text;
  const blocks: Anthropic.ContentBlockParam[] = images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType as ImageMediaType, data: img.base64 },
  }));
  if (text.length > 0) blocks.push({ type: 'text', text });
  return blocks;
}

/** Map a thrown tRPC error into a structured tool result the model can relay. */
export function toToolError(err: unknown): { error: string; message: string } {
  const e = err as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code : undefined;
  const message =
    err instanceof Error ? err.message : typeof e.message === 'string' ? e.message : String(err);
  if (code === 'FORBIDDEN') return { error: 'permission_denied', message };
  if (code === 'NOT_FOUND') return { error: 'not_found', message };
  if (code === 'BAD_REQUEST') return { error: 'invalid_input', message };
  return { error: 'failed', message };
}

export const TOOLS: Anthropic.Tool[] = [
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
    name: 'list_incidents',
    description:
      'List recent workplace safety incidents (injuries, dangerous occurrences, near misses). Confidential records are excluded unless the user holds the confidential-access permission.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results (default 10, max 50)' },
        status: {
          type: 'string',
          enum: [
            'reported',
            'triaged',
            'investigating',
            'actions_outstanding',
            'closed',
            'reopened',
            'cancelled',
          ],
          description: 'Filter by lifecycle status',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_incident',
    description:
      'Get one incident by id: record, RIDDOR determination and deadline, investigation state. Confidential records require the confidential-access permission.',
    input_schema: {
      type: 'object' as const,
      properties: {
        incidentId: { type: 'string', description: 'The incident id (26-char ULID)' },
      },
      required: ['incidentId'],
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
  // ── Write tools (mutations) — see WRITE_INSTRUCTIONS. Confirm before use. ──
  {
    name: 'list_observation_categories',
    description:
      'List the observation/issue categories defined for this company. Call before create_observation to choose the right categoryId.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_users',
    description:
      'List users in this company (id + name + email). Use to resolve who to assign an action to.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'create_observation',
    description:
      'Create a new observation (a reported hazard, defect, or incident). Confirm details with the user first. Requires a categoryId from list_observation_categories.',
    input_schema: {
      type: 'object' as const,
      properties: {
        categoryId: { type: 'string', description: 'Category id from list_observation_categories' },
        title: { type: 'string', description: 'Short title for the observation' },
        description: { type: 'string', description: 'Optional fuller description' },
        siteId: { type: 'string', description: 'Optional site id this observation relates to' },
      },
      required: ['categoryId', 'title'],
    },
  },
  {
    name: 'create_action',
    description:
      'Create a corrective action/task. Confirm details with the user first. Due date is auto-set from priority if omitted.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short title for the action' },
        description: { type: 'string', description: 'Optional fuller description' },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Optional priority',
        },
        assigneeUserId: {
          type: 'string',
          description: 'Optional user id to assign (see list_users)',
        },
        dueAt: { type: 'string', description: 'Optional ISO 8601 due date/time' },
        siteId: { type: 'string', description: 'Optional site id' },
      },
      required: ['title'],
    },
  },
  {
    name: 'comment_on_action',
    description: 'Add a comment to an existing action. Get the actionId from list_actions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        actionId: { type: 'string', description: 'The action id' },
        body: { type: 'string', description: 'The comment text' },
      },
      required: ['actionId', 'body'],
    },
  },
  {
    name: 'comment_on_observation',
    description:
      'Add a comment to an existing observation. Get the observationId from list_issues.',
    input_schema: {
      type: 'object' as const,
      properties: {
        observationId: { type: 'string', description: 'The observation (issue) id' },
        body: { type: 'string', description: 'The comment text' },
      },
      required: ['observationId', 'body'],
    },
  },
  {
    name: 'record_asset_reading',
    description:
      'Record a meter/usage reading for an asset (e.g. odometer km, engine hours). Feeds the asset maintenance schedule. Get the assetId from list_assets.',
    input_schema: {
      type: 'object' as const,
      properties: {
        assetId: { type: 'string', description: 'The asset id (see list_assets)' },
        fieldName: {
          type: 'string',
          description: 'What is being measured, e.g. "odometer" or "hours"',
        },
        value: { type: 'number', description: 'The numeric reading' },
        unit: { type: 'string', description: 'Optional unit, e.g. "km" or "hours"' },
      },
      required: ['assetId', 'fieldName', 'value'],
    },
  },
  {
    name: 'create_headsup',
    description:
      'Create a Heads-Up announcement as a DRAFT (not published or sent to anyone). Confirm details with the user first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'The announcement title' },
        description: { type: 'string', description: 'The announcement body' },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'list_permits',
    description:
      'List permits to work (hot work, confined space, working at height, …). Answers "which permits are open / expiring", "find PTW-0123".',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'all'],
          description: 'open (default) = currently live permits; all includes closed/cancelled',
        },
        search: { type: 'string', description: 'Match on title or reference (e.g. PTW-0123)' },
      },
      required: [],
    },
  },
  {
    name: 'list_coshh_substances',
    description:
      'List hazardous substances on the COSHH register, with assessment status. Answers "do we hold acetone", "which substances need assessment review".',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_risk_assessments',
    description:
      'List risk assessments with status and review dates. Answers "which risk assessments are due for review", "find the manual handling RA".',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['all', 'draft', 'active', 'archived'] },
      },
      required: [],
    },
  },
  {
    name: 'fire_safety_overview',
    description:
      'Fire safety needs-attention summary: failed checks awaiting re-test, overdue checks and door inspections, FRA reviews due, PEEP reviews due, marshal gaps.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_contractors_on_site',
    description: 'Contractors currently checked in on site right now.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_sites',
    description: 'List the company sites / projects.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
];

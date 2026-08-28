/**
 * The AI agent catalogue (AI Agents feature).
 *
 * One entry per task agent, in the tile order the AI page shows them.
 * Definitions are code and identical for every tenant — what varies per
 * company lives in `ai_agent_settings` (enabled / knowledge / settings)
 * and is merged over these defaults by the `aiAgents` tRPC router. That
 * split is the isolation story: nothing here carries tenant data, and a
 * tenant's customization rows are ordinary ADR 0002 scoped rows.
 *
 * Gating mirrors the nav model's doctrine: an agent is visible when its
 * `module` passes `brandHasModule` (or is `null` — both brands) AND the
 * viewer holds `usePermission` (admins implicitly hold everything) AND
 * the per-tenant `enabled` flag is on. `manage` (editing knowledge and
 * settings) is `org.settings` — admins only, everywhere, decided with the
 * product owner.
 *
 * Settings are deliberately data, not code: every setting is a select
 * with a fixed option list, so the settings page renders generically, the
 * router validates generically (value must be one of `options`), and the
 * i18n keys derive from the ids
 * (`aiAgents.agents.<agentId>.settings.<key>.label` / `.options.<option>`).
 * Non-technical users get at most three plain-worded dropdowns per agent.
 */
import type { BrandOnlyModule } from './brand';

export const AI_AGENT_IDS = [
  'template-drafter',
  'dashboard-builder',
  'sds-importer',
  'ra-drafter',
  'coshh-drafter',
  'rams-drafter',
  'fra-assistant',
  'investigation-assistant',
  'briefing-writer',
  'permit-preparer',
] as const;

export type AiAgentId = (typeof AI_AGENT_IDS)[number];

export function isAiAgentId(value: string): value is AiAgentId {
  return (AI_AGENT_IDS as readonly string[]).includes(value);
}

export interface AiAgentSettingDef {
  /** Key inside the settings jsonb; i18n label derives from it. */
  readonly key: string;
  /** Allowed values; the first is the default. i18n labels per option. */
  readonly options: readonly string[];
}

export interface AiAgentDef {
  readonly id: AiAgentId;
  /** Brand-only module gate, or null when both brands ship it. */
  readonly module: BrandOnlyModule | null;
  /** Permission needed to USE the agent (see the permission catalogue). */
  readonly usePermission: string;
  /** Entitlement key gating the agent's underlying feature, if any. */
  readonly entitlement?: string;
  /** Where the agent's work surface lives (locale-relative route). */
  readonly workRoute: string;
  /**
   * True while the agent runs on its own pre-existing endpoint (the three
   * originals). Their tiles and settings pages work like everyone else's —
   * knowledge and settings are injected into their prompts — but the panel
   * runner does not serve them.
   */
  readonly legacyRuntime?: boolean;
  readonly settings: readonly AiAgentSettingDef[];
}

/** Caps shared by the router (write time) and the runner (prompt build). */
export const AI_KNOWLEDGE_LIMITS = {
  textChars: 8_000,
  maxFiles: 5,
  fileBytes: 10 * 1024 * 1024,
  /** Per extracted file, truncated at prompt build. */
  fileChars: 12_000,
  /** Across all files for one agent at prompt build. */
  totalFileChars: 36_000,
} as const;

/**
 * The shared "how much detail" dial every drafting agent offers. Kept to
 * one vocabulary so the label translates once.
 */
const DETAIL_SETTING: AiAgentSettingDef = {
  key: 'detail',
  options: ['standard', 'concise', 'thorough'],
};

export const AI_AGENTS: readonly AiAgentDef[] = [
  {
    id: 'template-drafter',
    module: null,
    usePermission: 'templates.create',
    workRoute: '/templates',
    legacyRuntime: true,
    settings: [
      // "Which country's rules apply" — the interview's most repeated
      // question, answered once. 'ask' keeps today's behaviour.
      { key: 'defaultRegion', options: ['ask', 'uk', 'ireland', 'eu', 'us', 'other'] },
      // Grounded turns are the slowest, priciest AI path (~3 min) — an
      // admin may trade currency for speed.
      { key: 'webSearch', options: ['on', 'off'] },
    ],
  },
  {
    id: 'dashboard-builder',
    module: null,
    usePermission: 'analytics.create',
    entitlement: 'customDashboards',
    workRoute: '/dashboards/new',
    legacyRuntime: true,
    settings: [{ key: 'defaultDateRange', options: ['last30d', 'last7d', 'last12m', 'thisQuarter'] }],
  },
  {
    id: 'sds-importer',
    module: 'coshh',
    usePermission: 'coshh.create',
    workRoute: '/coshh/new',
    legacyRuntime: true,
    settings: [{ key: 'sdsReviewMonths', options: ['36', '12', '24', '60'] }],
  },
  {
    id: 'ra-drafter',
    module: 'riskAssessments',
    usePermission: 'riskAssessments.create',
    workRoute: '/risk-assessments',
    settings: [DETAIL_SETTING],
  },
  {
    id: 'coshh-drafter',
    module: 'coshh',
    usePermission: 'coshh.manage',
    workRoute: '/coshh',
    settings: [DETAIL_SETTING],
  },
  {
    id: 'rams-drafter',
    module: 'rams',
    usePermission: 'rams.manage',
    workRoute: '/rams',
    settings: [DETAIL_SETTING],
  },
  {
    id: 'fra-assistant',
    module: 'fireSafety',
    usePermission: 'fireSafety.manage',
    workRoute: '/fire-safety',
    settings: [DETAIL_SETTING],
  },
  {
    id: 'investigation-assistant',
    module: 'incidents',
    usePermission: 'incidents.investigate',
    workRoute: '/incidents',
    settings: [DETAIL_SETTING],
  },
  {
    id: 'briefing-writer',
    module: null,
    usePermission: 'headsUp.manage',
    workRoute: '/briefings',
    settings: [
      DETAIL_SETTING,
      { key: 'readingLevel', options: ['everyday', 'simple', 'technical'] },
    ],
  },
  {
    id: 'permit-preparer',
    module: 'permits',
    usePermission: 'permits.create',
    workRoute: '/permits/new',
    settings: [],
  },
];

export function getAiAgent(id: AiAgentId): AiAgentDef {
  const def = AI_AGENTS.find((a) => a.id === id);
  if (def === undefined) throw new Error(`Unknown agent: ${id}`);
  return def;
}

/** Default settings object for an agent: first option of every setting. */
export function defaultAgentSettings(def: AiAgentDef): Record<string, string> {
  return Object.fromEntries(def.settings.map((s) => [s.key, s.options[0] ?? '']));
}

/**
 * Validate a settings object against the agent's defs: unknown keys and
 * out-of-vocabulary values are refused (the router's write gate).
 */
export function validateAgentSettings(
  def: AiAgentDef,
  settings: Record<string, string>,
): string | null {
  for (const [key, value] of Object.entries(settings)) {
    const setting = def.settings.find((s) => s.key === key);
    if (setting === undefined) return `unknown-setting:${key}`;
    if (!setting.options.includes(value)) return `invalid-value:${key}`;
  }
  return null;
}

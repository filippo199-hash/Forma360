# 0020 — Task-specific AI agents with per-tenant knowledge

## Status

Accepted (2026-08-28). Decided with the product owner: ten agents, admins-only
customization, knowledge = written instructions **plus uploaded documents**.

## Context

The AI section was a generalist chat, while three task-shaped AI features
(template drafting, dashboard building, SDS import) had grown as bespoke
endpoints, invisible in the AI section and each hand-wired into its module.
The product direction (Lightdash-style) is task agents users can find,
switch on and off, and teach about their company — with every agent doing
one job.

## Decision

**One catalogue, one overlay table, one runner.**

- `packages/shared/src/ai-agents.ts` defines the ten agents — id, brand
  module gate, use-permission, entitlement, work route, and a settings
  vocabulary that is *data* (selects with fixed options), so the settings
  UI renders generically, the router validates generically, and i18n keys
  derive from ids (guarded by `ai-agents-i18n.test.ts`, the sanctioned
  variable-key pattern).
- `ai_agent_settings` (tenantId+agentId PK) + `ai_agent_knowledge_files`
  hold everything a company may customize: enabled, knowledge text,
  settings, uploaded documents. Absence means defaults. **This is the
  entire isolation story**: agent definitions are code and carry no tenant
  data; customization rows are ordinary ADR 0002 tenant-scoped rows; and
  at runtime an agent acts only through the signed-in user's session, so
  it can never read or write beyond that person.
- `apps/web/src/server/task-agent.ts` is the shared runner for the seven
  new agents, generalizing the template-agent contract (SSE, progress
  events — no silent phase — forced propose tool, Zod validation with a
  bounded `is_error` correction loop, heartbeats). Per-agent runtime
  definitions live in `apps/web/src/server/task-agents/` (prompts stay
  server-only). The three originals keep their endpoints
  (`legacyRuntime`) but honour the same overlay via
  `agent-overlay.ts` — enabled gate + knowledge/settings prompt suffix —
  so the two runtimes cannot drift on how tenant knowledge is treated.

**Drafts only — agents never sign.** Every deliverable is a *proposal*;
"Apply" calls the module's ordinary tRPC mutations as the signed-in user
and lands a DRAFT record the person reviews in the module's own editor.
No agent output is published, issued, submitted or signed by the agent,
and deterministic gates (permit gate, RAMS issue gate, FRA publish gates)
are untouched. Review deliberately happens in the editor, not the panel:
the panel is brief → draft → apply.

**Knowledge is taught by admins, injected with limits, and disclosed.**
`org.settings` holders edit; everyone may read (it shapes drafts they
will sign). Documents are extracted to text ONCE at upload (Claude reads
PDFs/photos natively — the coshh-ai pattern); runtime turns read stored
text only. Injection caps live in `AI_KNOWLEDGE_LIMITS`; the settings
page marks truncated documents rather than truncating silently, and
states plainly that knowledge is sent to the model on every run. The
prompt frames knowledge as reference material that never overrides
safety-critical judgement or the agent's role.

**Cost containment is layered**: per-user burst limits per route plus a
shared per-tenant daily budget (`ai:tenant-day:*`,
`TENANT_DAILY_AI_LIMIT`) across all AI routes.

## Consequences

- A new agent is: a catalogue entry, a server definition (prompt + propose
  tool + Zod + context builder), a module mount of the shared
  `AgentDraftTrigger`, and i18n copy — no new endpoint, no new tables.
- The agent-chat route re-enforces brand, permission and the enabled flag
  on every turn; the tiles/settings surfaces are UX, not gates.
- Folding the originals in closed a pre-existing gap: `template-chat` now
  checks `templates.create` and the enabled flag (it used to check only
  session + tenant), and `createFromSpec` strips notify addresses that are
  not active tenant users — the model writes the tool input, so a prompt
  rule alone was not a boundary.
- Deferred, recorded here so they are not re-litigated: SDS extraction
  coherence checks (confidence downgrade on internally-incoherent
  extractions), provenance stamps (`createdVia: 'ai-agent'`) on applied
  records, the create-template dialog's unguarded close during a
  3-minute grounded turn, and per-agent conversation persistence.

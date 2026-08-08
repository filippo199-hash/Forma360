# 0018 — AI-built dashboards, the entitlement gate, and tenant theming

- **Status**: accepted
- **Date**: 2026-08-08
- **Deciders**: Filippo + Claude
- **Phases locked**: analytics (paid tier), entitlements, theming

## Context

The fixed `/analytics` overview (PF-5) answers "what needs attention
today?" with the same page for every user. The product decision is to
add its paid counterpart: dashboards the user *describes* — "build me a
dashboard about our permits", "one dashboard for the Bristol site" —
and the AI composes, with a refine chat ("use columns instead of a
line") instead of a widget-editor UI. Alongside it: scheduled PDF
delivery to free-text recipients, per-widget Excel export, voice input,
and tenant theming derived from the customer's own website.

Four decisions were locked with the user before building:

1. The fixed overview stays, free, for everyone. Custom dashboards are
   **paid-tier** — the first plan-gated feature in the codebase.
2. Scheduled emails **attach the PDF** and recipients are **free text
   (external allowed)**, with guard rails: the schedules permission,
   a recipient cap, and logged sends.
3. The website-derived palette + logo re-skin the **whole app and the
   PDFs** for that tenant.
4. Speech-to-text is **server-side Whisper**, reusing the existing
   WhatsApp transcription pipeline.

## Decision 1 — a spec, not queries

A dashboard is a versioned, Zod-validated **spec** (ADR 0009 pattern:
`version` travels on the root; `dashboards.spec` jsonb; every boundary
runs `parseDashboardSpec`). Widgets are `(source, metric, dimension)`
**references into a bounded catalogue**
(`packages/shared/src/dashboard-sources.ts`) plus presentation hints
(chart kind, bucket, span, top-N). The AI never writes a query; the
query engine (`packages/api/src/dashboards/executor.ts`) is the only
place references become SQL, and every predicate is copied from the
module's own register or the analytics router **so the dashboard and
the register never disagree** on what "open" or "overdue" means.

Two consequences worth naming:

- **flow vs stock.** Flow metrics count events in the date range on a
  declared event column; stock metrics are point-in-time state and
  ignore the range (the result says which applied, and the UI says so
  too — a "live count" chip, not a silent lie). Timeseries refuse stock
  metrics at spec-validation time.
- **Tables are grouped aggregates, never record rows.** That single
  choice keeps per-record access control (confidential incidents,
  unpublished packs) out of the dashboard layer entirely; drill-down
  goes through links into the registers, which enforce their own gates.

The catalogue is a promise, and promises are enforced: DH-E21 walks
every metric × widget kind × allowed dimension through the executor
against pglite — a catalogue entry with no implementation fails CI (the
sandbox-seed lesson, applied to analytics).

## Decision 2 — the entitlement gate

`packages/shared/src/entitlements.ts` is ADR 0010's fourth place
("entitlement defaults") made real: plans (`free` | `paid`) grant
entitlement keys; the plan lives at `tenants.settings.plan` (absent or
corrupt ⇒ free — a bad settings row must never lock a tenant out of
the app); features gate on `requireEntitlement(key)` in
`packages/api/src/procedures.ts`, which refuses with
**`PAYMENT_REQUIRED`** — a code nothing else uses, so the web client
can render the upgrade surface rather than a generic error. There is
deliberately **no admin bypass**: the tenant's plan lacks the feature,
not the person's permission set. Billing itself is out of scope; the
flag is the hook a billing integration will set. A downgrade keeps all
rows and regains them on re-upgrade.

Authorisation inside the module consumes the four analytics keys
forward-declared in Phase 1: `analytics.view` (read),
`analytics.create`, `analytics.manage` (others' dashboards),
`analytics.schedules.manage` (PDF delivery). Widget **data** is
additionally gated per source on the **viewer's** permission — a
tenant-visible dashboard must not leak incident counts to someone who
cannot open the incidents register; refused widgets return a marker
(`forbidden` / `module-disabled`) and render as a lock tile, not a hole.

## Decision 3 — the builder is a correction-looped tool call

`dashboard-agent.ts` follows the template-agent contract exactly:
streaming SSE, one forced tool (`proposeDashboard`), Zod validation,
`is_error` tool-result corrections (bounded), `claude-opus-5`. The
route assembles the context server-side — brand-gated,
permission-filtered catalogue; the tenant's sites for name → id
resolution; the current spec when refining — so the model cannot see or
reference what the caller may not use, and an out-of-catalogue source in
a proposal is a validation error, not a data leak. Refinement always
emits the **full** replacement spec with stable widget ids; the
conversation is ephemeral (client-held), with `dashboards.conversationId`
reserved for future server-side persistence.

## Decision 4 — delivery, statuses, visibility

Lifecycle `draft → published → archived` (+ restore to draft), and
visibility `private | selected | tenant` are orthogonal: **non-owners
only ever see published dashboards**, whatever the visibility; drafts
are the owner's (and managers') workspace; unpublishing hides a shared
dashboard again. Archive pauses every delivery schedule **in the same
transaction** (the T-E05 pattern) so a tick between two writes cannot
email an archived dashboard; restore leaves schedules paused — resuming
delivery is an explicit choice.

Schedules are rrule-driven (same validation floor as template
schedules), carry free-text recipients (≤ 20, deduped, format-checked),
stamp `lastSentAt` **after** the send (notify-then-stamp, the IN-A1
lesson) and log who configured delivery to whom — the accountability
anchor for tenant data leaving the platform. The PDF rides the ADR 0008
pipeline (HMAC-tokened print route → Puppeteer → R2) with a
server-rendered, hydration-free print page; the email dispatcher gains
its first attachment support.

## Decision 5 — tenant theming

Company settings accepts the customer's website URL; the server fetches
it behind an SSRF guard, extracts candidate colours, and Claude picks a
palette that the admin previews and saves into the tenant branding the
settings page already stored (and nothing previously consumed). The
saved palette re-skins the app via CSS-variable overrides with a WCAG
contrast guard (an unusable primary falls back to the default theme
wholesale), defines `--chart-1..8` consumed by dashboard charts, and
brands PDFs — closing the template-schema comment that promised tenant
fallback branding with no code behind it.

## Consequences

- The first plan-gated module establishes the pattern every future paid
  feature follows: an entitlement key, `requireEntitlement`, a
  `PAYMENT_REQUIRED` client surface, no admin bypass.
- The executor's predicate-parity rule means module changes that alter
  register semantics must update the executor in the same PR — DH-E21
  and the register-parity tests (DH-E20d et al.) are the tripwire.
- The AI's capability surface grows exactly as fast as the catalogue —
  adding a source is a catalogue entry + executor mapping + tests, not
  prompt work.
- Widget ids are user-visible (Excel filenames, refine references) and
  must stay stable across refinements; the agent is instructed
  accordingly and the spec enforces the slug shape.

## Edge cases

DH-E01..E10 (spec schema, `dashboard-spec.test.ts`), DH-E11..E22
(router + executor, `dashboards.test.ts`), DH-J01..J03 (delivery
workers), NAV-E16 (entitlement-gated nav). See `docs/edge-cases.html`.

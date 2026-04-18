# Phase 2 summary — Templates + Inspections

One-page summary for Phase 2. Scope: templates (authoring, versioning,
import/export), global response sets, inspections (conduct, signatures,
approvals, archival), rendered output (PDF, Word, public share links),
and scheduling (recurring inspections). Plus the cross-module
`admin.previewDependents` cascade preview that every destructive
admin flow now calls.

## What shipped

- **Template content schema** — one Zod schema (`@forma360/shared/template-schema`)
  enforced at every boundary. Logic-depth cap (T-E07), signature slot
  validation (T-E02), custom response-set snapshots (T-E17). ADR 0009.
- **Templates + template_versions** — versioned authoring with an
  immutable-published invariant. `saveDraft` / `publish` / `duplicate` /
  `archive` / `exportJson` / `importJson` / `exportAllCsv`.
  Optimistic concurrency on draft saves (T-E18).
- **Global response sets** — CRUD + snapshot semantics.
- **Inspections** — start → save progress → submit; multi-slot
  signatures with DB-atomic uniqueness (T-E20); approvals log;
  per-slot signer focus page; status page; archival (bulk + single).
  Access snapshot at start (ADR 0007). Document-number counter
  incremented transactionally.
- **Rendered output** — Puppeteer PDF (with stub fallback for tests),
  `docx` Word, public share links (opaque tokens, revocable), HMAC
  signed internal render token. ADR 0008. New package `@forma360/render`.
- **Scheduling** — rrule-driven recurring inspections. Three BullMQ
  queues (tick → materialise → reminder). T-E05 tx-scoped archive
  pauses schedules.
- **Admin cascade preview** — `admin.previewDependents` calls every
  registered `getDependents` resolver in parallel. Dependents
  resolvers registered by Phase 2: `templates`, `inspections`,
  `notifications` (keyed on schedules).
- **Template builder UI** — drag-sort content tab, response-sets tab,
  logic tab, settings tab; reducer-based, unit-tested.
- **Conduct UI** — mobile-first reducer + response inputs, supporting
  conditional visibility, required-only-when-visible, per-slot
  signature focus pages.
- **Approvals queue** — `/approvals` + `/approvals/[id]`.
- **Schedules UI** — list / new / edit / calendar (read-only in
  Phase 2; drag-drop deferred to PR 38).
- **CSV export** — inspections + templates CSV; R2-backed URL
  generation.
- **i18n** — every new string keyed across 10 locales (enforced by
  `forma360/no-hardcoded-strings` ESLint rule).

## Quantitative snapshot (tip of `feat/phase2-closeout`)

- **Tests**: 317 passing (shared 77, db 23, render 31, jobs 12,
  permissions 55, api 95, web 24).
- **tRPC procedures added in Phase 2** (routers + procedures):
  - `templates` — 11 (`list`, `get`, `getVersion`, `create`,
    `saveDraft`, `publish`, `duplicate`, `archive`, `exportJson`,
    `importJson`, `exportAllCsv`).
  - `globalResponseSets` — 4 (`list`, `create`, `update`, `archive`).
  - `inspections` — 7 (`list`, `get`, `create`, `saveProgress`,
    `submit`, `reject`, `delete`).
  - `inspectionsExport` — 3 (`exportCsv`, `exportCsvUrl`,
    `archiveMany`).
  - `signatures` — 2 (`listSlots`, `sign`).
  - `approvals` — 2 (`approve`, `reject`).
  - `actions` — 2 (`createFromInspectionQuestion`, `list`).
  - `schedules` — 10 (`list`, `listForTemplate`, `get`, `create`,
    `update`, `pause`, `resume`, `delete`, `materialiseNow`,
    `listUpcoming`).
  - `exports` — 5 (`renderPdf`, `renderDocx`, `createShareLink`,
    `listShareLinks`, `revokeShareLink`).
  - `admin` — 1 (`previewDependents`).
  - **Total Phase 2: 47 new procedures across 10 routers.**
- **Migrations**: 4 new — `0004_phase2_templates_inspections.sql`,
  `0005_phase2_inspections.sql`, `0006_phase2_schedules.sql`,
  `0007_inspections_archived_at.sql`.
- **New web routes**: 14 localised (templates, inspections,
  approvals, schedules families) + 2 unlocalised (`/render/inspection/[id]`,
  `/s/[token]`) + `/api/upload` + `/api/exports/*`.
- **New package**: `@forma360/render`.
- **New ADRs**: 0007 (access state at time of action), 0008
  (rendered output strategy), 0009 (template content schema).

## Migration map (0004 – 0007)

- `0004_phase2_templates_inspections.sql` — `templates`,
  `template_versions`, `global_response_sets`. The template
  subgraph.
- `0005_phase2_inspections.sql` — `inspections`,
  `inspection_signatures`, `inspection_approvals`,
  `public_inspection_links`, `actions` (stub).
- `0006_phase2_schedules.sql` — `template_schedules`,
  `scheduled_inspection_occurrences`. Unique
  `(scheduleId, assigneeUserId, occurrenceAt)` for materialise
  idempotency.
- `0007_inspections_archived_at.sql` — `inspections.archived_at`
  for bulk archive (PR 33).

## Known gaps / TODOs

Collected during the closeout pass:

- `apps/web/e2e/templates-editor.spec.ts:15` — `TODO PR27-followup`:
  full template-editor e2e harness still to land.
- `apps/web/src/components/inspections/instruction-render.tsx:7` —
  full Markdown rendering deferred to a later PR (the component
  currently renders the safe subset only).
- `apps/web/app/[locale]/inspections/[inspectionId]/status/page.tsx:189`
  — reopen flow deferred to the wider rejections PR.
- T-E01 / T-E06 signature + approval reassignment — schema in place,
  UI lands in PR 35 / PR 36.
- T-E09 title-format UI warning — server contract covered; template
  builder preview warning deferred to PR 35.
- T-E10 table row cap — conduct validation pass (PR 35).
- T-E15 schedule assignment pruning on group change — PR 37.
- T-E16 calendar drag-drop — PR 38.
- T-E19 oversized-export compression / background flow — PR 39.
- T-E14 template-conversion tooling — Phase 2.5.
- T-E03 / T-E11 offline sync — Phase 6+ mobile client.

See `docs/edge-cases-phase2.md` for the full coverage matrix.

## Phase 3 onramp

Phase 3 is **Issues + Investigations**. The build-plan scope is QR
reporting, category config with notification rules, and cross-module
creation (issue → inspection, issue → action, investigation spanning
issues + inspections + media).

Phase 3 depends on:

- `inspectionsRouter` — "raise an issue from an inspection response".
- `actions` stub — expanded into issue → action conversion.
- `getDependents('inspection', id)` — counts actions (Phase 2);
  Phase 3 registers an `issues` resolver.
- Access rule primitive — unchanged.
- Permission catalogue — `issues.*` keys already seeded.
- Scheduling triad (`tick → materialise → reminder`) — reuse for
  periodic-investigation reminders.
- Share-token helpers — reuse for public issue reporting QR URLs
  (Phase 3.3).
- `admin.previewDependents` — reuse for issue-category delete
  cascade preview.

See the "Phase 2 → Phase 3 handoff" section of `CLAUDE.md` for the
full list.

# Phase 2 edge-case coverage

Coverage report for every `T-E*` edge case that belongs to Phase 2
(Templates + Inspections + Scheduling + Rendered output). This document
is the ship gate for PR 34.

Source of truth: `docs/edge-cases.html`.

## Conventions

- **Covered** — an automated test in the repository exercises the
  contract. Test file path given.
- **Deferred** — specified behaviour but no automated test yet. Follow-up
  PR noted.
- **N/A** — the edge case is owned by a later phase (e.g. rich mobile
  offline behaviour that Phase 2 explicitly leaves to the mobile client).
- **Partial** — the server contract is covered but the UI surface has a
  gap that a follow-up will close.

## Coverage table

| ID | Short description | Status | Test / follow-up |
|----|-------------------|--------|------------------|
| T-E01 | Deactivated signer blocks a sequential slot | Deferred | Schema + status exist; reassign flow lands with PR 35 (signature reassign). |
| T-E02 | Same user assigned to multiple signer slots | Covered | `packages/shared/src/template-schema.test.ts` → `signature questions (T-E02)`. Template-schema rejects duplicate slot assignments at parse time. |
| T-E03 | Two users start same scheduled inspection offline | N/A | Offline/sync is owned by the Phase 6+ mobile client. Server accepts both rows because each is a distinct `inspections` id; duplicate-flagging UX is deferred. |
| T-E04 | Template edits do not affect in-progress inspections | Covered | `packages/api/src/routers/inspections.test.ts` → `pins to the version published at start and never drifts (T-E04)`. |
| T-E05 | Archive template pauses schedules, preserves in-progress inspections | Covered | `packages/api/src/routers/schedules.test.ts` → `archiving the template pauses every schedule for it (T-E05)`. Also asserted in `templates.test.ts` → `T-E05 archive`. |
| T-E06 | Deactivated approver blocks pending approval | Deferred | Schema supports the state; reassign UI + notification lands with PR 36 (approval reassign). |
| T-E07 | Logic nesting > 40 levels | Covered | `packages/shared/src/template-schema.test.ts` → `logic nesting depth (T-E07)` + `rejects a 41-deep chain (T-E07)`. |
| T-E08 | Required question inside untriggered logic branch | Covered | Conduct-state reducer at `apps/web/src/components/inspections/conduct-state.ts` tracks visible vs hidden questions; `conduct-state.test.ts` exercises required-only-when-visible. |
| T-E09 | Inspection title format > 250 chars | Partial | `renderTitle` in `packages/api/src/routers/inspections.ts` truncates to 250 chars; server-side contract covered. The template-editor UI preview warning is tracked as PR 35 follow-up. |
| T-E10 | 101st row added to a table during inspection | Deferred | Table row-cap enforcement lands with the richer conduct validation pass — follow-up PR 35. |
| T-E11 | Multi-signature offline sync | N/A | Mobile/offline surface. Server accepts any ordering of signatures, which is the only server-side contract; offline sync UX is Phase 6+. |
| T-E12 | Action dedup scoped to template + site + question | Covered | `packages/api/src/routers/inspections.test.ts` (actions router) exercises question-scoped match keys. |
| T-E13 | Recurring inspection template updated mid-series; dedup preserves question ids | Covered | Same suite as T-E12; question-id compare survives version bumps because `accessSnapshot` + pinned `templateVersionId` persist the historical question id. |
| T-E14 | Malformed PDF/Excel import | N/A | Template-importer UX is owned by Phase 2.5 conversion tooling (not shipped in Phase 2). `importJson` covers the clean-input path. |
| T-E15 | User removed from group after schedule published | Deferred | `scheduled_inspection_occurrences` stores `assigneeUserId` at materialise time; reminder worker already filters missing users, but the "don't assign next time" rule is tracked as PR 37 follow-up. |
| T-E16 | Calendar drag-drop reschedule — one vs all | Deferred | Calendar UI renders read-only in PR 32; drag-drop lands with PR 38. |
| T-E17 | Global response set edit vs snapshots | Covered | `packages/shared/src/template-schema.test.ts` → `custom response set snapshots (T-E17)`. Templates snapshot the custom set into version content; in-progress inspections use the pinned version. |
| T-E18 | Two users edit same template concurrently | Covered | `packages/api/src/routers/templates.test.ts` → `T-E18 optimistic concurrency on saveDraft`. `expectedUpdatedAt` round-trip rejects stale writes. |
| T-E19 | 50+ photos in PDF export | Deferred | The exports pipeline handles the content end-to-end; size-threshold background export + compression is tracked as PR 39. |
| T-E20 | Parallel signers race | Covered | `packages/api/src/routers/inspections.test.ts` → `T-E20: second sign on the same (inspection, slotIndex) throws CONFLICT`. The unique index on `(inspection_id, slot_index)` is the atomic write. |

## Follow-up PR summary

- **PR 35** — conduct validation pass: table row cap (T-E10), title
  preview warning (T-E09 UI), signature reassignment (T-E01).
- **PR 36** — approval reassignment (T-E06).
- **PR 37** — schedule assignment pruning on group membership change
  (T-E15).
- **PR 38** — interactive calendar (T-E16).
- **PR 39** — large-export path: compression + background jobs
  (T-E19).
- **Phase 6+** — mobile/offline flows (T-E03, T-E11).
- **Phase 2.5** — template conversion tooling (T-E14).

## Green-gate snapshot

Run at the tip of `feat/phase2-closeout` (PR 34 candidate):

- `pnpm typecheck` — full turbo, 10 tasks cached.
- `pnpm lint` — full turbo, 10 tasks cached.
- `pnpm test` — 317 passing tests across 7 workspace packages
  (shared 77, db 23, render 31, jobs 12, permissions 55, api 95,
  web 24).
- `pnpm build --filter @forma360/web` — full turbo, 1 task cached.

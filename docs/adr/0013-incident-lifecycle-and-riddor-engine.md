# ADR 0013 — Incident lifecycle, investigation model and RIDDOR deadline engine

- **Status**: accepted
- **Date**: 2026-08-03
- **Module**: Incident & Accident Management (FreeHS module B5)
- **Spec**: `docs/specs/incident-management-module-spec.md` (four-practitioner
  gap analysis — the unanimous top gap)

## Context

The platform owned both ends of the safety loop and neither middle:
observations capture near misses, the actions engine carries corrective
work, and the RA/FRA modules shipped `'incident'` / `'post_incident'`
review triggers with nothing to fire them. ISO 45001 clause 10.2
(incident → investigation → root cause → corrective action →
effectiveness) was not auditable on the platform. Three of four
practitioners rated the absence a Blocker.

Decisions below lock in the shapes future phases must not casually
change. Brand scope: the spec recommended a core module; the product
decision at build time was **FreeHS-only** (`BRAND_ONLY_MODULES`), with
the ADR 0010 `{ enabled }` router pattern keeping a future brand or
entitlement switch a one-line change.

## Decision 1 — One strict lifecycle, shared-helper enforced

`reported → triaged → investigating → actions_outstanding → closed`,
`closed → reopened → investigating`, any pre-closed state → `cancelled`
(reason required). `canTransition` in `@forma360/shared/incidents` is the
single matrix; the router refuses anything else. Closure additionally
demands every linked action terminal and the RIDDOR duty discharged.
Late reporting is legal but visible: `occurredAt` and `reportedAt` are
both stored and a > 24 h gap is chip-flagged, never blocked — blocking
late reports suppresses the statistics that make the module worthwhile.

## Decision 2 — Kind-specific detail in one validated jsonb column

Eight kinds (injury, ill health, dangerous occurrence, sharps/splash,
violence & aggression, damage, environmental, escalated near miss). Per
§4.1 of the spec, kind-specific detail lives in one `details` jsonb
column validated by a per-kind Zod schema (the permits gas/attachments
pattern), not in per-kind tables. Injury substance lives on
`incident_persons` (per-person injury block + the lost-time record) —
a dangerous occurrence has zero persons, a minibus crash has several.
Sharps and V&A records default to **confidential**.

## Decision 3 — Confidential = counted, not readable

`confidential` restricts *detail*, never *existence*: register rows show
reference/kind/severity/status only (title nulled), the detail page
requires reporter ∨ lead investigator ∨ `incidents.confidential.view` ∨
administrator, and search/AI/CSV exclude or redact. Enforced in the
router on every read — the UI hides nothing the server would serve.
This is the NHS condition (Aisha, S3): a needlestick must appear in the
aggregate counts without exposing the nurse.

## Decision 4 — Versioned investigations, separated-duty signatures

One row per **revision**; approval freezes the revision's content
permanently. Reopening (recurrence / new information) creates revision
n+1 pre-filled from n; every revision keeps its own signatures and stays
readable "as concluded" — signed history is never rewritten (the RA
review A-1/M-3 lesson applied from day one). Two signatures with
separated duties: the **lead investigator submits** (attestation), a
*different* `incidents.manage` holder **approves** — `approver ≠ lead ∧
approver ≠ submitter` is router-enforced (`approver-is-investigator`),
not UI-hinted. Investigation depth is proportionate: `basic` (one
screen, minutes on a phone) vs `full` (RCA method + root cause
mandatory), defaulting to `full` when severity ≥ serious or the incident
is RIDDOR-reportable.

## Decision 5 — Findings generate actions exactly once, configured at approval

`requiresAction` findings generate actions in the approval transaction
with `sourceType 'incident'`, `sourceId` = incident, `sourceItemId` =
finding id. Once-only is a **layered guard**: the `actionId` stamp on
the finding (app-level) plus the actions table's source unique index
(DB-level), with a savepoint-wrapped insert so a unique-violation race
adopts the existing row instead of aborting the approval. Assignee and
due date are set **per finding in the approval call**, defaulting via
the tenant's priority→days table (`computeAutoDueAt`) — never
hard-coded (the RA review P-3 lesson). The same change extended the
actions hub end to end (source union, list filter, `get` resolution,
web chips/links) so incident actions are first-class, not "Standalone".

## Decision 6 — RIDDOR: guided determination, computed clock, never auto-decision

The platform computes what the answers imply and tracks the clock; a
named human owns the judgement (the SIMOPs acknowledge-don't-block
philosophy). The determination — including **not reportable, with
reasoning** — is itself the defensible record. Deadlines:
death/specified/dangerous-occurrence/gas → 10 days, over-7-day → 15
days from occurrence. The over-7-day **tripwire** re-reads the
lost-time record on every absence write: accumulated absence crossing 7
days against a not-reportable determination flags `riddorRescreenRequired`
(and blocks closure until re-screened) — the trap a small contractor
falls into. A submission record (route, HSE reference) discharges the
duty; the determination freezes once submitted. Closure is blocked
while a reportable determination has no submission record.

The `forma360-incident-riddor-watch` worker (15 min) warns at T-5 and
T-2 days and escalates past the deadline — **notify-then-stamp**, so a
failed send retries next tick instead of going silent (the PF-1 lesson;
the opposite ordering to the permit expiry watch, deliberately: a
duplicate email is acceptable, a silently lost statutory warning is
not). Re-screening clears all three stamps so a fresh determination
restarts the ladder.

## Decision 7 — Effectiveness review closes the clause-10.2 loop

Closing an incident that generated actions schedules an effectiveness
review (default +90 days, clamped 30–365): "controls implemented and
holding? any recurrence?" with a three-value verdict. `not_effective`
prompts the reopen path. The daily `forma360-incident-chase` digest
chases idle investigations (> 14 days), overdue incident actions and
due effectiveness reviews — one email per owner, silent when clean.

## Decision 8 — Cross-module surfaces owned by the incidents router

- **Observation promotion**: `createFromObservation` pre-fills from the
  issue, links both ways (FK + `issue_activity` row + `forObservation`
  lookup) and carries photo attachments over **by reference** (same
  storage keys, no blob copy). Near-miss reporting stays in
  observations — this is the bridge, not a merge.
- **Review prompts**: `promptReviews` pulls selected RA / COSHH / FRA
  `nextReviewAt` to now (their "due" state is purely derived from that
  column) and writes a `review_prompted` event row in each module's
  event log citing the incident reference. Skipping requires a logged
  reason. This fires the trigger enums that had been waiting since the
  RA/FRA modules shipped.
- **Email registry made permanent**: the IN-J04 test walks
  `packages/i18n/emails/en/` and asserts every file is registered in
  `EMAIL_TEMPLATES` and schema-valid — which surfaced and fixed four
  templates (fire digest, FRA alert, both permit expiry mails) that
  were throwing `Unknown email template` in production.

## Consequences

- Every incident mutation writes an `incident_events` row; evidence and
  witness statements have **no update or delete surface** — corrections
  are new rows. The audit trail is append-only end to end.
- `IN-` references are 6-digit padded and grow past IN-999999 without
  truncation (permits PW-13 lesson).
- The alert fan-out (`forma360-incident-alert`) fires for serious+
  severity or the always-alert kinds, resolves site-scoped
  `incidents.manage` holders with a tenant-wide fallback, and sends
  **confidential-safe** content (reference/kind/severity/site — never
  the title).
- Migration `0063_incidents.sql` backfills the five `incidents.*` keys
  onto existing tenants' system permission sets (the PF-8 mechanism:
  seed for new tenants, SQL backfill for old ones) — Standard gets
  view+report because *everyone must be able to report*.
- Severity freezes once an investigation is approved; `potentialSeverity`
  captures "nearly much worse" separately.

## Amendment (3 Aug 2026) — practitioner-review hardening (IN-A findings)

The four-practitioner review of the shipped module
(`docs/reviews/incidents-hse-expert-review.md`) drove two decisions
significant enough to live here; the full disposition is in
`docs/reviews/incidents-hse-review-response.md`.

### Decision 9 — Investigation depth binds to severity, both directions

`defaultInvestigationLevel(severity, riddorReportable)` is now an
enforced **floor**, not advice: triage refuses a level below it,
submission re-checks it, and the level is no longer write-once —
`setInvestigationLevel` upgrades any time before terminal status, and
raising the severity or recording a reportable RIDDOR determination
**auto-raises** a `basic` level to `full` (event-logged as
`investigation_level_changed`). Downgrades are only possible while no
investigation revision exists and never below the floor. Rationale: the
depth of inquiry must not be discretionary at exactly the moments it
matters (a fatality investigated at `basic` with no recorded root cause
was possible before this).

### Decision 10 — Separation of duties with a sole-manager escape hatch

The approver still may not be the lead investigator or submitter — but
when the server can prove no other active `incidents.manage` (or admin)
holder exists in the tenant, the conflicted approver may proceed with a
**mandatory justification**, recorded permanently on the
`investigation_approved` event (`soleManagerOverride: true` + text) and
printed in the PDF signature block. Rationale: a 40-person firm with one
safety advisor otherwise deadlocks in `investigating`, which also blocks
closure and the RIDDOR discharge; an audited, server-verified exception
is honest where an unusable rule would be routed around. The eligibility
check runs server-side against the live permission holders — the moment
a second manager exists, the escape hatch closes itself.

### Also locked in by the same review

- The immediate alert is **notify-then-stamp with retries**: total
  delivery failure throws (BullMQ backoff, 5 attempts) instead of
  stamping `alertSentAt` over a lost fan-out (IN-A1 — the PF-1 failure
  mode, eliminated in the one worker that cannot self-heal).
- `create` derives a provisional severity from reporter judgement +
  per-person hospitalisation (`provisionalSeverity`), so a serious
  injury alerts at report time; untriaged reports get an overview
  counter and a 48-hour chase to the manage holders.
- The IN-J04 registry test asserts exact 1:1 between the template
  directory and `EMAIL_TEMPLATES` in both directions.

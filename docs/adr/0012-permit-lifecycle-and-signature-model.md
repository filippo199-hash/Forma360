# ADR 0012 — Permit-to-work lifecycle, signature model and expiry escalation

- **Status**: accepted
- **Date**: 2026-08-02

## Context

FreeHS module B3 (Permit to Work & High-Risk Activities) digitises the
permit that authorises the work most likely to kill someone: hot work,
confined space entry, work at height, electrical isolation and live
working, excavation, roof work, asbestos-related work, lifting
operations and pressure system work.

Paper permits fail in known ways: they get lost, forged, copied from
last week, issued to people whose training expired, and left open
overnight with nobody noticing until an audit. A digital permit is only
better if the controls are *conditional* (the permit cannot exist
without them), every signature is timestamped, and an unclosed permit
past its window makes noise on its own.

The design questions that needed deciding:

1. What is the lifecycle, and where do signatures fit in it?
2. How are per-type controls (checklists, gas tests, isolation
   certificates, rescue plans, authorising signatures) modelled so
   tenants can tune them without code changes?
3. How do we handle simultaneous operations (SIMOPs) — two permits
   authorising clashing work in the same place at the same time?
4. What happens when a permit expires without being closed?

## Decision

**1. A strict state machine with signatures as timestamps.**
`draft → issued → active ⇄ suspended → closed / cancelled`, encoded in
one transition matrix (`canTransition` in `@forma360/shared/permits`)
that the router enforces on every lifecycle mutation. Signatures are
row-level `(userId, timestamp)` pairs — `authorisedAt` / `issuedAt` /
`acceptedAt` — plus an append-only `permit_events` row per action.
Separation of duties is structural: the issuer can never be the
acceptor, and the acceptor can never authorise their own permit. Only
the *named acceptor* can accept — acceptance requires no special
permission key because being named on the permit **is** the
authorisation.

Shift handover re-points `acceptorUserId` and drops the permit from
`active` back to `issued` with `acceptedAt` cleared: work does not
continue on a permit the incoming shift has not signed onto. Extension
is re-authorisation — for types that require an authorising engineer,
only the permit's authoriser can extend, and one extension may add at
most one further `maxDurationHours` window.

**2. Permit types are per-tenant data seeded from a code catalogue.**
`DEFAULT_PERMIT_TYPES` ships the nine standard high-risk types with
sensible UK-practice preconditions, signature and evidence flags, and
duration caps. They seed idempotently per tenant on first use
(serialised on the tenant row lock) and are fully editable thereafter;
tenants can also add custom types. The permit **snapshots** the type's
precondition checklist at creation — editing a type never rewrites a
live permit (same snapshot stance as ADR 0007). The issue gate then
enforces, in order: window valid and not already past, acceptor named,
every precondition confirmed, gas readings where required, isolation
certificate where required, rescue plan where required, authorising
signature where required.

Seeded names and checklist labels are tenant *data* (English defaults,
editable), like the risk-matrix defaults — the i18n rule applies to UI
chrome, not to tenant-editable records.

**3. SIMOPs conflicts warn and require acknowledgement, not a block.**
A conflict is another open permit at the *same site* with an
*overlapping validity window* (strict overlap — back-to-back windows
are the normal shift pattern, not a clash), with a same-area flag when
the normalised location text matches. Conflicts surface on the draft,
in the new-permit form, and at issue; issuing over a conflict requires
an explicit `acknowledgeConflicts` confirmation which is recorded in
the event log. We warn rather than block because SIMOPs are sometimes
legitimate (that judgement belongs to the issuer) — but the
acknowledgement makes the judgement auditable.

**4. Expiry escalates automatically.** The
`forma360-permit-expiry-watch` worker runs every 15 minutes: any open
permit (issued / active / suspended) past `validTo` gets
`expiryEscalatedAt` stamped exactly once, a system event appended, and
an email to every signature party (issuer, acceptor, authoriser —
deduplicated, deactivated users skipped). The stamp is written *before*
the notifications so a failing email provider can never re-escalate the
same permit; extension clears the stamp so a re-authorised window gets
a fresh watch. There is no stored `expired` status — overdue is derived
(`open AND validTo < now`) so the state machine stays small and the
live board / overview compute it consistently.

## Consequences

- The transition matrix, overlap arithmetic and precondition helpers
  are pure and shared (`packages/shared/src/permits.ts`), so the
  router, web UI and worker cannot disagree about what is legal.
- Verifying competence against Training records is a precondition
  checklist line for now; it becomes a hard check when the Training
  module (Phase 10) lands. Documented v1 gaps: extension does not
  re-run the SIMOPs check for the lengthened window, and the web UI
  records isolation certificates / rescue plans as references and text
  (the attachment API exists and is tested; the upload UI follows).
- Edge-case IDs: PW-E01..E05 (shared helpers), PW-E10..E24 (router),
  PW-J01/J02 (expiry watch) — each maps to a test in
  `packages/shared/src/permits.test.ts`,
  `packages/api/src/routers/permits.test.ts` and
  `packages/jobs/src/workers/permit-expiry-watch.test.ts`.

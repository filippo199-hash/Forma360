# Incident & Accident Management — HSE expert review response

**Review:** [`incidents-hse-expert-review.md`](./incidents-hse-expert-review.md)
(four practitioners, 3 August 2026)
**Disposition date:** 3 August 2026
**Scope note:** per product direction, the offline-capability findings
(IN-A2b and IN-A12, plus the offline-retry aspects of IN-A4) are
**deferred to the next stage** and not addressed here. Everything else is
fixed in this pass.

## Per-finding disposition

| ID | Sev | Disposition | What changed |
|----|-----|-------------|--------------|
| IN-A1 | Critical | **Fixed** | `incident-alert.ts` now implements true notify-then-stamp: zero deliveries with ≥1 addressable recipient leaves `alertSentAt` and the `alert_sent` event unwritten and **throws**, so BullMQ retries. The enqueue (`incidents-deps.ts`) gained `attempts: 5` + exponential backoff from 60 s (~31 min of cover). Partial delivery stamps (a blanket re-send would duplicate). Tests IN-J02d (total failure → no stamp → retry delivers → stamp) and IN-J02e (partial delivery stamps) close the test gap the reviewers called out. |
| IN-A2 | High | **Fixed** | Three-part fix. (1) `create` accepts an optional reporter severity and derives a provisional severity from the per-person hospitalisation facts (`provisionalSeverity` in the shared lib: admission floors `serious`, A&E floors `moderate`, floors only lift) — an admitted-injury report now alerts at create, before any triage. The report form gained an optional severity chip row. (2) `overview` returns an `untriaged` counter and the register leads with a clickable *awaiting triage* chip. (3) The chase digest gained an untriaged bucket: reports still in `reported` after 48 h (`UNTRIAGED_CHASE_HOURS`) are chased to the `incidents.manage` holders, site-scoped with the alert worker's fallback semantics. Tests: shared (provisional severity), router (alert at create, overview counter), worker IN-J03c. |
| IN-A2b | High | **Deferred (offline)** | Online-listener / retry-timer / beforeunload on the report form and offline photo capture are the next stage's offline work, per product direction. The localStorage draft remains. |
| IN-A3 | High | **Fixed** | `defaultInvestigationLevel` is now wired everywhere via a router-level `investigationLevelFloor(severity, riddorCategory)`: `triage` refuses a level below the floor (`investigation-level-below-floor`); `submitInvestigation` re-checks the floor as a belt-and-braces gate; the web triage dialog auto-bumps and disables `basic` when the floor is `full`, with explanatory copy. |
| IN-A3b | High | **Fixed** | The level is no longer write-once. New `setInvestigationLevel` procedure: upgrades allowed any time before terminal status; downgrades only while **no** investigation revision exists and never below the floor (`investigation-content-exists`). `setSeverity` auto-raises a `basic` level when the new severity demands `full`; a reportable RIDDOR screening does the same. Every change writes an `investigation_level_changed` event (new event kind). The incident page shows an *Upgrade to full* affordance. |
| IN-A4 | High | **Fixed** (error surfacing; offline retry deferred) | Both upload paths (report form photo step, investigation workspace) wrap each file in try/catch, collect per-file failures, and render a red banner naming the failed files ("the files are NOT attached"); no more silent `continue`, no unhandled rejections. The same handling backs the new incident-page evidence upload. |
| IN-A5 | High | **Fixed** | The investigation workspace registers a `beforeunload` guard while dirty and autosaves the open draft 30 s after the last edit (same eligibility as the Save button; the server still re-checks). A stray back-gesture can no longer cost a write-up. |
| IN-A6 | Med | **Fixed** | `approveInvestigation` refuses unless **every** pending action-bearing finding has an assignee (`finding-assignee-required`) and a resolvable due date (`finding-due-date-required` when the tenant's priority default is disabled and no explicit date given). The dialog lists every pending finding, marks assignee required, notes the auto due-date rule, and keeps confirm disabled until complete. |
| IN-A7 | Med | **Fixed** | All six procedures now have UI. Incident page: *Edit details* dialog (`update` — title, when, site, location, description; available to managers and to the reporter while `reported`), severity corrector next to the chip (`setSeverity`, with the freeze explained), lead-investigator reassignment (`assignInvestigator`), person removal and absence removal with confirm dialogs (`removePerson`, `removeAbsence` — both event-logged). Investigation workspace: per-finding edit (`updateFinding`) pre-approval. |
| IN-A8 | Med | **Fixed** | Documented sole-manager path: when the approver is the lead/submitter **and** the server can prove no other active `incidents.manage`/admin holder exists, approval proceeds with a mandatory justification, recorded on the `investigation_approved` event (`soleManagerOverride: true` + text) and printed in the PDF signature block. If an independent approver exists the conflict is refused exactly as before. The dialog surfaces the justification field only to a conflicted approver. Covered by a dedicated router test; ADR 0013 amended. |
| IN-A9 | Med | **Fixed** | The incident page now carries an *Evidence & statements* card from the moment the record exists — scene photos, references and witness statements are visible (and photos addable) pre-triage, pre-investigation. |
| IN-A9b | Med | **Fixed** | Frozen (approved / superseded) revisions render in full on screen: RCA method, why-chain with root-cause marker, causal factors, sequence of events, contributing factors, conclusion, root-cause statement, recurrence likelihood, lessons learned, that revision's findings, and the signature block. Nothing the PDF prints is hidden any more. |
| IN-A10 | Med | **Fixed** | The five incident templates are translated in all five translated email locales (de/es/fr/it/pt), placeholder-parity enforced by the PF-20 test. All three worker wirings now pass the resolved recipient `locale` to the templated sender (the chase worker resolves and forwards the owner's locale too). |
| IN-A11 | Med | **Fixed** | The timeline renders each event's `detail` payload as a translated second line: severity/level transitions, assigned investigator names, RIDDOR category and submission route, revision numbers, action/notification counts, effectiveness verdicts, witness names — and every free-text reason (reopen, cancellation, rejection note, review-prompt skip, sole-manager justification). |
| IN-A12 | Med | **Deferred (offline)** | Per product direction. |
| IN-A13 | Low | **Fixed** | Restricted register rows are no longer styled clickable (muted, no pointer, no hover tint); mobile cards show the confidential chip for readable-but-confidential rows; the attention chips apply the matching filter on click; free-text search is debounced (300 ms); `exportCsv` failures show an error line instead of ending the spinner silently. |
| IN-A14 | Low | **Fixed** | Raw enum leaks replaced with translated labels (finding priority on both pages, revision status in the workspace selector). The chase worker gained the platform's cap discipline (`MAX_ROWS_PER_BUCKET` 500 per query, `MAX_DIGESTS_PER_RUN` 200, over-cap logged). The IN-J04 registry test now asserts **exact 1:1** between disk and registry in both directions, so a deleted template fails CI too. The PDF footer prints the closed line only for closed incidents. The upload `accept` attribute includes the video types the API accepts. `/incidents/new` gates on `incidents.report` up front. Injury and body-part chips meet the 44 px tap target. |

## What was protected (per the review's "protect these" list)

No changes were made to the confidentiality read-surface enforcement, the
RIDDOR counting rule or tripwire, the once-only findings→actions
machinery (the savepoint pattern and unique index are untouched — the new
IN-A6 validation runs before the transaction), the append-only
evidence/witness/event model, versioned-frozen investigations, the
effectiveness review, the review prompts, or the IN-J04 registry test
(strengthened, not weakened).

## Verification

- New/updated tests: IN-J02d/e (alert failure paths), IN-J03c (untriaged
  chase), shared `provisionalSeverity` suite, router IN-A2 (create-time
  severity + alert + overview), IN-A3 (triage floor), IN-A3b (auto-raise
  + explicit level change), IN-A6 (assignee/due enforcement), IN-A8
  (sole-manager override), strengthened IN-J04.
- Full workspace suite green before deploy (see PR/commit for counts);
  typecheck + lint clean; i18n parity across 10 locales verified.

# Incident & Accident Management — module specification

**Module id:** `incidents` (proposed core module — see §2.3 on brand scope)
**Status:** Draft for review
**Sources:** `docs/reviews/freehs-module-gap-analysis-hse-expert-review.md`
(the four-practitioner gap analysis — unanimous top gap), the whole-platform
review (`freehs-platform-hse-expert-review.md`, PF-findings referenced
throughout), and the four module reviews whose lessons this spec bakes in.
**Companion ADR (to be written with the implementation):**
*Incident lifecycle, investigation model and RIDDOR deadline engine* —
the next ADR number at merge time.

---

## 1 · Why this module exists

From the gap analysis, verbatim in spirit:

- It is **the module HSE platforms are bought around**. Three of the four
  practitioners rated its absence a **Blocker**; the fourth
  (Whitfield) a strong Major. Without it, whatever product holds the
  accident book becomes the customer's system of record — not FreeHS.
- The platform already owns **both ends** of the loop and neither middle:
  observations capture near misses, the actions engine carries corrective
  work, and the RA/FRA modules already ship `'incident'` /
  `'post_incident'` **review triggers with nothing to fire them**
  (`risk-assessments.ts:70`, `fire-safety.ts:262`).
- ISO 45001 **clause 10.2** (incident → investigation → root cause →
  corrective action → effectiveness) is not auditable on the platform
  today (Lindqvist).

**One sentence:** record any workplace safety event involving people, run a
proportionate investigation to a defensible conclusion, discharge the
statutory reporting duty (RIDDOR), drive corrective actions through the
existing engine, and prove afterwards that they worked.

---

## 2 · Scope

### 2.1 In scope
- Incident recording: injuries, ill health, dangerous occurrences,
  property/equipment damage, near misses **escalated from observations**,
  and the two NHS-priority kinds — **sharps/splash exposures** and
  **violence & aggression** (Bello).
- Triage: severity, investigation level, confidentiality, RIDDOR screening.
- Investigation: evidence, witness statements, timeline, root-cause
  analysis, findings → actions, signed conclusion with separation of
  duties, effectiveness review.
- RIDDOR duty management: guided determination, deadline computation and
  chasing, submission record.
- Lost-time / absence tracking per injured person (LTIFR inputs).
- Cross-module triggers: prompt RA / COSHH / FRA reviews after relevant
  incidents; link back to permits, contractors, assets, sites.
- Notifications (worker-based, following the platform's dedup pattern),
  PDF outputs, register CSV export, search + AI + analytics registration.

### 2.2 Explicitly out of scope (unanimous "don't build")
- **Patient-safety / clinical incident management** (Datix-class, national
  ecosystems). Staff H&S incidents only. The UI copy must say so.
- Insurance **claims management** (record a claim reference, nothing more).
- First-aid **treatment/clinical records** beyond "first aid administered
  by X" (medical records belong to OH — future module).
- Automatic electronic submission to the HSE (no public API; we record
  the duty, the determination and the completed submission).
- HR absence management (we track incident-related lost time only).

### 2.3 Brand scope — decision required
Nothing about incidents is FreeHS-specific, and every competitor of both
brands ships it. **Recommendation: core module for both brands** (like
inspections/actions), not a `BRAND_ONLY_MODULES` entry. If commercial
packaging demands gating, do it via the future entitlements work, not the
brand catalogue. The router still takes `{ enabled }` deps so a brand or
entitlement switch stays one line (ADR 0010 pattern).

---

## 3 · The four practitioners' acceptance scenarios

These are the tests the module must pass, drawn from the reports. Each
maps to requirements in §5–§9 (traceability table in §14).

**S1 — Priya (engineering).** A machinist's hand is caught in an unguarded
nip point; 9 days off work. Priya's team records the injury with body
part/injury kind, RIDDOR screening flags it *reportable — over-7-day
injury* with the 15-day clock running and reminders firing; a full
investigation captures photos, two witness statements, a 5-why chain
ending in "guard interlock defeated + no PUWER inspection"; findings raise
two actions (guarding modification — engineering; toolbox retraining —
admin) through the existing actions engine **with working source links**;
the machine-shop RA is prompted for an `'incident'`-triggered review; 90
days later the effectiveness review asks "has it recurred / are controls
holding?" and closes the loop. The whole record exports as one PDF for the
insurer.

**S2 — Tom (contractor SME).** An apprentice cuts his arm on site — 3
days off, not reportable. Tom records it from his phone in under three
minutes (basic investigation level: what/where/photo/immediate cause/one
action), and the RIDDOR screen documents *why it is not reportable* —
the negative determination is itself the defensible record. When a client
asks for his accident stats, the register export answers.

**S3 — Aisha (NHS trust).** (a) A nurse sustains a needlestick from a
used cannula: the sharps kind captures device/procedure/source-exposure
risk assessed, flags OH follow-up, and the record is **confidential** —
visible only to the reporter, the investigation team and
`incidents.confidential.view` holders. (b) A porter is assaulted by a
visitor: V&A kind captures physical/verbal, police involvement, support
offered; equally confidential. Both appear in aggregate counts for
everyone with `incidents.view`, but their detail pages do not. Recording
scales to a trust: any staff member can report; triage routes to the
right team.

**S4 — Marcus (auditor).** He samples five incidents and can follow each
from event → determination → investigation → root cause → actions →
effectiveness verdict without leaving the platform, sees who signed the
conclusion (and that the approver ≠ lead investigator), confirms closed
investigations are immutable with an append-only event trail, and pulls
the clause-10.2 story from one screen.

---

## 4 · Domain model

### 4.1 Incident kinds
```
INCIDENT_KINDS = [
  'injury',                -- physical injury to a person
  'ill_health',            -- occupational disease / work-related ill health
  'dangerous_occurrence',  -- RIDDOR schedule-2-type event, no injury needed
  'sharps_exposure',       -- needlestick / splash (Bello)
  'violence_aggression',   -- physical or verbal V&A (Bello)
  'damage',                -- property / equipment / vehicle, no injury
  'environmental',         -- spill / release (thin v1; grows with env module)
  'near_miss',             -- normally lives in observations; exists here for
                           -- escalated near misses (see §8.1)
]
```
Kind-specific detail lives in **one `details` jsonb column validated by a
per-kind Zod schema** in `@forma360/shared/incidents` (the permits
gas/attachments pattern — ADR 0012). v1 kind schemas:

- `injury` / `ill_health`: injured-person block (see 4.2), body parts
  (multi, enum of ~20 standard HSE body-part codes), injury kinds (multi,
  enum of ~15: fracture, laceration, burn, amputation, sprain/strain,
  crush, …), first aid given (bool + by whom), hospitalisation
  (none / A&E / admitted), treatment note.
- `sharps_exposure`: device, procedure, source known (bool),
  source-exposure risk assessed (bool + note), contamination status
  unknown/low/high, **ohFollowUpRequired** (bool, default true), washed/
  first-aid step confirmed.
- `violence_aggression`: nature (physical / verbal / threat / sexual),
  perpetrator type (patient-or-service-user / visitor / member of public /
  colleague / other), weapon involved, police notified (+ crime ref),
  support offered to the person affected (bool + note).
- `dangerous_occurrence`: category (the common Schedule 2 list as an enum
  + `other` with free text — collapse of lifting equipment, scaffold
  collapse, electrical fire/explosion, pressure-system failure,
  accidental release, structural collapse, …).
- `damage` / `environmental`: what was damaged/released, estimated cost
  band (enum), containment/immediate mitigation.

### 4.2 People on an incident
An incident references **zero or more affected persons** (a dangerous
occurrence has none; a minibus incident has several):

- Person may be a platform user (`userId`) **or** a non-user (name +
  category) — contractors' operatives, visitors and members of the public
  get hurt too (Tom; and the contractors module can link the company).
- Category: `employee | contractor | agency | visitor | member_of_public |
  work_experience`.
- Per person: the kind-specific injury block, plus the **lost-time
  record**: absence periods (`fromDate`, `toDate|null`), computed
  `daysLost` (calendar days per RIDDOR counting rule: exclude the day of
  the accident, count weekends), `returnedToWork` flag,
  `onRestrictedDuties` flag. Over-7-day RIDDOR screening reads this.

### 4.3 Severity
`SEVERITY = ['negligible','minor','moderate','serious','major']` — actual
outcome severity, set at triage, editable until the investigation is
approved (then frozen with the record). A separate optional
`potentialSeverity` (same scale) captures "it was nearly much worse" —
what Priya's near-miss escalations and Marcus's risk profile need.
Severity ≥ `serious` drives the immediate-alert fan-out (§9.1) and
defaults the investigation level to `full`.

### 4.4 Lifecycle
One strict state machine, shared-helper enforced (`canTransition`, the
permits pattern — the router refuses anything else):

```
reported → triaged → investigating → actions_outstanding → closed
                                                        ↘ reopened → investigating
   any-pre-closed → cancelled          (duplicate / raised in error;
                                        requires reason; log survives)
```

- `reported` — anyone with `incidents.report` (see §10) creates it with
  the minimum viable record (what/when/where/kind/people). **Late
  reporting is legal but visible**: `occurredAt` vs `reportedAt` are both
  stored; a gap > 24 h is chip-flagged (auditors look for this).
  `occurredAt` may not be in the future (the fire-module rule).
- `triaged` — a manager confirms kind/severity, sets **investigation
  level** (§5.1), confidentiality (§10.3), completes **RIDDOR screening**
  (§6), and appoints the lead investigator.
- `investigating` → `actions_outstanding` happens when the investigation
  is **approved** (§5.5); the state waits on linked actions closing.
- `closed` — allowed only when every linked action is terminal
  (closed/cancelled) **and** the RIDDOR duty is discharged (submitted, or
  determined not reportable). Closing schedules the **effectiveness
  review** (§5.6).
- `reopened` — recurrence or new information; requires a reason; prior
  investigation stays immutable and a new investigation revision starts
  (§5.5). This is the RA-review lesson: never rewrite signed history.

---

## 5 · Investigation

### 5.1 Proportionate by design (Tom vs Priya, reconciled)
Investigation **level** chosen at triage:

- **`basic`** — one screen: immediate cause (free text), underlying cause
  (free text), contributing factors (checklist), findings/actions,
  conclusion + sign-off. Target: completable on a phone in minutes (S2).
- **`full`** — everything below. Mandatory when severity ≥ `serious` or
  the incident is RIDDOR-reportable; optional upgrade any time (never a
  downgrade once evidence exists).

### 5.2 Evidence & witnesses (append-only)
- **Evidence items**: photos/files via the existing upload path
  (`<tenantId>/incidents/<incidentId>/…` per the storage-key convention),
  each with kind (`photo | document | cctv_ref | physical_ref | other`),
  caption, collectedBy/At. CCTV is a *reference* (location, clip window,
  retention deadline warning) — we don't ingest video.
- **Witness statements**: one row per witness (user or named non-user),
  free-text statement, takenBy/At, optional signature via the existing
  signature-pad component. **Append-only**: corrections are new
  statements; nothing is edited or deleted (Marcus).
- **Timeline entries**: optional ordered "what happened when" rows the
  report renders as a sequence.

### 5.3 Root-cause analysis
Method field per investigation: `five_whys | causal_factors | other`.
- `five_whys`: an ordered why-chain (2–7 entries), last entry markable as
  the root cause.
- `causal_factors`: categorised factors — the standard HSG245-flavoured
  set as an enum (equipment/guarding, procedure absent/inadequate,
  training/competence, supervision, human factors, environment,
  maintenance, management-system), each with narrative.
- Both available on `full`; `basic` gets immediate/underlying cause fields
  only. Free-text `other` keeps external investigators (Tom's insurer)
  happy.

### 5.4 Findings → actions (the clause-10.2 hinge)
Findings are first-class child rows (the FRA significant-findings
pattern): description, category (reuse the causal-factor enum), priority,
`requiresAction`. On investigation approval, each `requiresAction` finding
**generates one action exactly once** (`actionId` once-only guard +
source unique index), with:
- `sourceType: 'incident'`, `sourceId`, `sourceItemId: findingId`;
- **assignee and due date settable per finding in the approval dialog**
  (the P-3 lesson from the RA review — no more "publisher / 7 days"
  hard-coding), defaulting from priority via the tenant's existing
  priority→days settings (`computeAutoDueAt`).

**Hard precondition (PF-2/PF-4, Marcus's condition):** the same PR that
introduces `sourceType: 'incident'` MUST extend `actions.get` source
resolution, the list/board source-chip labels, the source filter enum,
and ship i18n for them — and the actions-notification gap (PF-4) must be
fixed no later than this module's release, or incident actions inherit
the silence.

### 5.5 Conclusion, sign-off, immutability
- Conclusion block: summary, root cause statement, `recurrenceLikelihood`
  (low/medium/high), lessons learned.
- **Two signatures, separated duties** (Marcus; the M-2/C-6 lessons):
  the **lead investigator submits** (attestation text shown, explicit
  confirm), then a holder of `incidents.manage` **approves** — and the
  approver must not be the lead investigator; the router enforces it
  (`approver-is-investigator` error), not just the UI.
- On approval the investigation content is **frozen**. Reopening creates
  investigation **revision n+1** pre-filled from n; every revision keeps
  its own signatures and remains readable ("as concluded on {date}") —
  the RA-versioning lesson (A-1/M-3) applied from day one.

### 5.6 Effectiveness review (clause 10.2's forgotten step)
Closing an incident with actions schedules an effectiveness review at
+90 days (tenant-configurable 30–365): a worker-chased task asking the
approver "controls implemented and holding? any recurrence?" with verdict
`effective | partially_effective | not_effective` + note. `not_effective`
prompts reopening or a new action. Stored append-only; surfaced in
analytics. This is what makes Marcus's audit sample complete.

---

## 6 · RIDDOR duty engine

Design stance: **guided determination, never auto-decision** — the
platform computes what the answers imply and tracks the clock; a named
human owns the judgement (same philosophy as SIMOPs acknowledge-don't-block).

### 6.1 Screening (at triage, editable until submission/closure)
A checklist walk producing a stored determination:

- Outcome category: `not_reportable | death | specified_injury |
  over_7_day | occupational_disease | dangerous_occurrence | gas_incident`
  (the specified-injuries list and disease list as guided checkboxes with
  plain-English help text).
- The **over-7-day computation reads the lost-time record** (§4.2) and
  re-prompts automatically if accumulating absence crosses 7 days after
  an initial "not reportable" determination — the trap Tom would fall into.
- **Negative determinations are records too** (S2): "screened on {date}
  by {name}: not reportable because …" renders in the register and PDF.

### 6.2 Deadlines & chasing
- Deadline computed per category: death/specified/dangerous-occurrence →
  notify without delay + report within **10 days**; over-7-day → within
  **15 days** of the incident. Stored as `riddorDeadlineAt`.
- A **`riddor-deadline-watch` worker** (permit-expiry-watch clone):
  warning at T-5 and T-2 days to the incident owner + `incidents.manage`
  holders, escalation past deadline — **notify-then-stamp** ordering and
  a registry test for its email templates (the PF-1 lesson, twice over).
- Submission record: who submitted, when, via which route (HSE online
  form / phone), HSE reference, PDF/print of what was submitted attached
  as evidence. Closure is blocked while a reportable determination has no
  submission record.

---

## 7 · Data model (proposed tables — migration `0063_incidents.sql`)

All tables: `tenant_id` NOT NULL → `tenants.id` ON DELETE RESTRICT,
ULID PKs via `newId()`, timestamptz. Following schema conventions from
permits/fire.

| Table | Purpose / key columns |
|---|---|
| `incidents` | header: `reference_number` (**`IN-` + 6-digit pad** — the M-5/PW-13 overflow lesson), kind, severity, potential_severity, status, occurred_at, reported_at, reported_by, site_id (SET NULL) + location_text, description, `details` jsonb (per-kind, Zod-validated), confidential flag, riddor_* columns (category, determination note, screenedBy/At, deadline_at, submitted_at/by/route/hse_ref), investigation_level, lead_investigator_user_id, closed_at/by, effectiveness_due_at/verdict/note, linked `observation_id`, `permit_id`, `contractor_id`, asset link |
| `incident_persons` | per §4.2: user_id nullable, name, category, injury jsonb block, ohFollowUp flag |
| `incident_absences` | person_id FK, from_date, to_date nullable, computed days-lost helper in shared lib |
| `incident_investigations` | one row per **revision**: revision int, method, immediate/underlying cause, why-chain jsonb, causal-factors jsonb, conclusion block, submittedBy/At, approvedBy/At, status (`draft → submitted → approved`) |
| `incident_findings` | investigation_id FK, category, priority, description, requires_action, `action_id` once-only |
| `incident_evidence` | kind, storage_key, caption, collected_by/at — append-only |
| `incident_witness_statements` | witness (user or name), statement, taken_by/at, signature_data nullable — append-only |
| `incident_events` | the append-only audit log (the `permit_events` pattern): every lifecycle move, screening change, signature, notification, reopen — actor + kind + detail; worker writes as `'system'` |

Indexes: `(tenant_id, status)`, `(tenant_id, occurred_at)`,
`(tenant_id, riddor_deadline_at)`, `(site_id)`, events
`(tenant_id, incident_id, created_at)`.

---

## 8 · Integrations (each one is a report finding, not a nice-to-have)

### 8.1 Observations → incidents (promotion)
"Escalate to incident" on an observation (permission-gated): creates a
linked incident pre-filled from the observation (description, site,
category→kind suggestion, photos carried over), stamps both records with
the cross-link, and leaves the observation in place (it may close as
superseded). The reverse link renders on both detail pages. Near-miss
reporting *stays* in observations — this is the bridge, not a merge.

### 8.2 RA / COSHH / FRA post-incident reviews (the waiting hooks)
On investigation approval (or closure for `basic`), the module surfaces a
**"prompt reviews"** step: pick the affected risk assessments / COSHH
assessments / FRAs (pre-filtered by site) and one click records the
prompt on the incident and pushes each selected record into its module's
due-review state citing this incident — firing the RA `'incident'` and
FRA `'post_incident'` triggers that already exist. Skippable with a
reason (logged). This is Priya's S1 loop-closer.

### 8.3 Actions hub
§5.4's hard precondition. Additionally the incident detail page lists its
actions live (status chips) since closure depends on them.

### 8.4 Permits, contractors, assets, sites
- An incident during permitted work links the permit (and shows on the
  permit page — an incident on an open permit is a suspension prompt).
- An injured contractor's operative links the contractor company; the
  contractor page gains an incidents tab (feeds Tom's prequal story and
  the compliance picture).
- Equipment involvement links the asset (shows in the asset's linked
  history alongside inspections/actions — the existing pattern).
- Site linkage drives the site hub roll-up and per-site rates.

### 8.5 Search, AI, analytics, exports (the PF-6/PF-24/PF-5 lessons — launch criteria, not follow-ups)
- `search.global` gains an incidents section (title, reference) gated on
  `incidents.view` — in the same PR as the module.
- The AI agent gains `list_incidents` / `get_incident` read tools
  (permission-gated server-side like the existing tools), *excluding
  confidential incidents unless the caller holds the key*.
- Emit the countable facts analytics will need: incidents by
  site/month/kind/severity, days-since-last (per site), days lost
  (LTIFR/AFR numerators), RIDDOR count, action closure rate,
  effectiveness verdicts. Even before the analytics module exists, ship
  the register **CSV export** (fire-logbook pattern) and a per-site
  needs-attention strip (open investigations, RIDDOR clocks running,
  overdue effectiveness reviews).
- **PDF**: full incident report (record + investigation + signatures) via
  the existing render pipeline (`/render/incident/[id]` + session-gated
  export route) — Tom's insurer pack, Marcus's audit sample, day one.

---

## 9 · Notifications (workers)

All follow the established discipline: dedup stamps, per-run caps,
quiet-when-clean, **templates registered in `EMAIL_TEMPLATES` with a
registry-completeness test in the same PR** (PF-1 must never recur), and
notify-then-stamp ordering.

| Worker / trigger | Behaviour |
|---|---|
| `incident-alert` (event-driven on create/triage) | severity ≥ `serious` or kind ∈ {dangerous_occurrence, sharps_exposure, violence_aggression} → immediate email to `incidents.manage` holders (site-scoped where the incident has a site) via `usersHoldingPermission`. Confidential-safe content: reference + site + kind, no detail. |
| `riddor-deadline-watch` (15 min) | §6.2 warnings + escalation |
| `incident-chase` (daily digest) | one email per owner: investigations idle > 14 days (configurable), incidents in `actions_outstanding` with overdue actions, effectiveness reviews due — the fire-due-digest shape, silent when clean |
| Assignment emails | investigator appointed; finding-action assigned (rides the PF-4 fix) |

No new notification *model*: recipients resolve via permission holders +
named parties, consistent with fire/permits.

---

## 10 · Permissions & confidentiality

### 10.1 Keys (append to the catalogue; extend `PERMISSION_MODULES`)
```
incidents.view                -- register + non-confidential detail
incidents.report              -- create/report an incident
incidents.investigate         -- run investigations: evidence, statements,
                                 RCA, findings, submit conclusion
incidents.manage              -- triage, RIDDOR screening/submission,
                                 approve investigations, close/reopen,
                                 effectiveness verdicts
incidents.confidential.view   -- detail access to confidential incidents
```
The dedicated `investigate` key follows the `fireSafety.record` lesson
(competent-person ≠ manager) that the permits review demanded and the
fire module got right.

### 10.2 Seeding & backfill
Administrator: all five. Manager: all five. Standard:
`incidents.view` + `incidents.report` (**everyone must be able to report**
— reporting friction suppresses the statistics that make the module
worthwhile). **Ship the seed change together with the permission-set
backfill mechanism** flagged in PF-8 — this module must not strand
pre-existing tenants the way the FreeHS keys did, and the permission
matrix i18n (labels for the new module/keys, all locales) lands in the
same PR.

### 10.3 Confidentiality model (Aisha's condition)
- `confidential: boolean`, defaulted **on** for `sharps_exposure` and
  `violence_aggression`, settable at triage for any incident.
- Confidential incidents: **counted for everyone, readable by few** —
  list/register rows show reference, site, kind, severity, status only;
  the detail page requires reporter ∨ named investigation team ∨
  `incidents.confidential.view`. Enforced in the router on every read
  (`get`, sub-entities, search, AI, exports) — server-side, never
  UI-hidden-only (the platform review's recurring lesson).
- Affected-person identity on **non**-confidential incidents is still
  minimised in list views (name on detail, not in the register).

---

## 11 · Web surfaces

| Route | Purpose |
|---|---|
| `[locale]/incidents` | Register: needs-attention strip (RIDDOR clocks, open investigations, overdue effectiveness), filter row (status/kind/severity/site/RIDDOR/date-range), desktop table + mobile cards (the permits register pattern), CSV export |
| `[locale]/incidents/new` | **Mobile-first** report form: the S2 three-minute test is the acceptance bar. Progressive: minimum viable record first, kind-specific block second, photos via camera capture. Works with the conduct-flow's offline localStorage pattern (PF-10: this is one of the flows that must not require signal) |
| `[locale]/incidents/[incidentId]` | The incident page, top-to-bottom like a worked file (the permit-page pattern): header + chips (severity, RIDDOR clock countdown — the CountdownChip), people & lost time, RIDDOR panel, investigation (current revision), findings & actions, linked records, prompt-reviews step, event timeline |
| `[locale]/incidents/[incidentId]/investigation` | Full-level investigation workspace: evidence, statements (+ signature pad), timeline, RCA, findings, conclusion & signatures |
| `render/incident/[incidentId]` + `/api/exports/incident-pdf` | HMAC print route + session-gated download (existing render conventions) |

Navigation: `incidents` enters the sidebar between **Observations and
Actions** (the found→recorded→fixed reading order), **with its `nav`
i18n key present in all 10 locales in the same PR** (the PF-22 lesson).

i18n: full `incidents` namespace shipped translated in all 10 locales at
launch (PF-21) — not English-mirrored.

---

## 12 · Shared library (`packages/shared/src/incidents.ts`)

Pure, side-effect-free, imported by schema/router/UI/workers (the permits
model): kind/severity/status enums + `canTransition`; per-kind `details`
Zod schemas; body-part & injury-kind catalogues; RIDDOR category enum +
`riddorDeadlineFor(category, occurredAt)`; lost-days calculator
(RIDDOR counting rule); `overSevenDayTripwire(absences)`; causal-factor
catalogue; effectiveness scheduling helper. Every helper unit-tested.

---

## 13 · Edge-case IDs (test-first, per the house rule)

`IN-E01..` in `packages/shared/src/incidents.test.ts` (shared) and
`packages/api/src/routers/incidents.test.ts` (router); `IN-J01..` for
workers. The must-have set:

- **IN-E01** lifecycle matrix — every illegal transition refused.
- **IN-E02** `occurredAt` in the future refused; late-report flag at >24 h.
- **IN-E03** per-kind details Zod round-trip; unknown kind refused.
- **IN-E04** lost-days calculator vs RIDDOR counting rule (day-of excluded,
  weekends counted, multi-period accumulation).
- **IN-E05** over-7-day tripwire flips a not-reportable determination to
  re-screen-required when accumulated absence crosses 7 days.
- **IN-E06** RIDDOR deadline computation per category.
- **IN-E10** closure blocked: open actions / undischarged RIDDOR duty.
- **IN-E11** finding→action idempotency (unique-index race re-read).
- **IN-E12** approver ≠ lead investigator enforced server-side.
- **IN-E13** approved investigation immutable; reopen creates revision 2;
  revision 1 unchanged and readable.
- **IN-E14** confidential incident: register row minimal; `get` refused
  without team-membership/key; search and AI exclude it.
- **IN-E15** cross-tenant scoping on every loader (site, person, permit,
  contractor, observation links).
- **IN-E16** evidence/witness rows append-only (no update/delete surface).
- **IN-E17** promotion from observation carries links both ways.
- **IN-E18** review-prompt fires RA/FRA due states; skip requires reason.
- **IN-E19** reference-number continuity past IN-999999.
- **IN-E20** effectiveness `not_effective` prompts reopen path.
- **IN-J01** riddor-watch: warn/escalate ordering, notify-then-stamp,
  dedup, cap.
- **IN-J02** incident-alert: severity/kind routing, confidential-safe
  payload, site-scoped recipients.
- **IN-J03** chase digest: quiet when clean.
- **IN-J04** every email template used by the module exists in
  `EMAIL_TEMPLATES` (the registry-completeness test — and make it global
  while there: assert every file in `emails/en/` is registered).

---

## 14 · Requirements traceability

| Requirement (§) | Source finding / persona |
|---|---|
| Module exists at all; injury record, RIDDOR, investigation, lost time | Gap analysis — Priya/Aisha/Marcus **Blocker**, Tom Major |
| Proportionate basic/full investigation (§5.1) | Tom S2 vs Priya S1 |
| Sharps + V&A kinds, confidentiality (§4.1, §10.3) | Aisha |
| Staff-only scope; no patient safety (§2.2) | Aisha, Marcus |
| Separation of duties on sign-off (§5.5) | Marcus; platform PF-30, permits M-2/C-6 lessons |
| Immutable approved investigations, revisions (§5.5) | RA review A-1/M-3 lesson |
| Effectiveness review (§5.6) | Marcus (clause 10.2) |
| Per-finding assignee/due at approval (§5.4) | RA review P-3 lesson |
| Actions-hub label/link/filter precondition (§5.4) | Platform PF-2/PF-4 |
| RA/COSHH/FRA review prompts (§8.2) | Priya S1; existing trigger enums |
| Guided RIDDOR + negative determinations recorded (§6.1) | Tom S2, Marcus |
| Deadline worker, notify-then-stamp, registry test (§6.2, §9, IN-J04) | Platform PF-1 |
| Everyone can report; seed + backfill + matrix i18n (§10.2) | Platform PF-7/PF-8 |
| Mobile-first + offline report form (§11) | Tom; platform PF-10 |
| Search/AI/analytics/CSV/PDF at launch (§8.5) | Platform PF-5/PF-6/PF-24 |
| nav key + full i18n at launch (§11) | Platform PF-21/PF-22 |
| 6-digit references (§7) | RA M-5 / permits PW-13 |
| Append-only events + evidence (§7, §5.2) | Marcus; house pattern |

---

## 15 · Delivery plan (suggested)

1. **PR 1 — foundations:** shared lib + tests (IN-E01..06), schema +
   migration 0063, permission keys + seed + backfill, event log.
2. **PR 2 — router:** report/triage/lifecycle, people & absences, RIDDOR
   screening, confidentiality enforcement (IN-E10..18).
3. **PR 3 — investigation:** evidence/witnesses/RCA/findings/sign-off/
   revisions; actions integration **including the actions-hub source-type
   fix (PF-2)**.
4. **PR 4 — web:** register, report form (mobile+offline), incident page,
   investigation workspace; nav + full i18n.
5. **PR 5 — workers + outputs:** three workers + templates + registry
   test (IN-J01..04), PDF render, CSV, search + AI registration,
   review-prompt integration.
6. **ADR** alongside PR 1; edge-case IDs land in `docs/edge-cases`
   alongside each PR per the house checklist.

Dependencies to fix before or with launch: PF-1 (email registry — PR 5's
test makes it permanent), PF-2 (actions source types — inside PR 3),
PF-4 (action notifications — required for finding-action assignment
emails), PF-8 (backfill mechanism — inside PR 1).

---

*Spec drafted from the four-practitioner gap analysis and the six prior
review reports; every design constraint above traces to a named finding
so the review panel can verify the module answers the feedback that asked
for it.*

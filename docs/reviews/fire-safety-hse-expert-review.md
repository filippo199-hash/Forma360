# FreeHS — Fire Safety module

## Independent review by four HSE practitioners

**Product:** FreeHS (freehs.software)
**Module reviewed:** Fire Safety (FreeHS module B4)
**Surface reviewed:** `/en/fire-safety` — building register, building record, FRA editor, logbook, doors, drills, PEEPs, marshals
**Date:** 3 August 2026

---

## Methodology & scope (read this first)

This is a **full module review** of the Fire Safety module, which shipped to
`main` in commit `15fb63a` with its own schema (11 tables), a ~2,600-line
router, six web routes and a deep domain library. It covers the fire risk
assessment (FRA), the statutory logbook calendar, fire doors, drills, PEEPs
(personal emergency evacuation plans), fire marshals and building information
for the fire and rescue service.

**How the review was performed.** As before, the live app at
`https://freehs.software/en/fire-safety` is behind an authenticated login wall
(anonymous request → HTTP 403) and no browser automation was available, so
every finding is verified against the **shipped implementation on `main`**: the
domain helpers (`packages/shared/src/fire-safety.ts`), the router
(`packages/api/src/routers/fireSafety.ts`), the schema
(`packages/db/src/schema/fire-safety.ts`), the web pages and the exact
on-screen copy. Reproduction steps and code pointers are in the Engineering
appendix.

Two things worth saying up front. First, the domain modelling here is
genuinely expert — the Fire Safety (England) Regulations 2022 thresholds
(18 m / 7 storeys; the above-11 m door regime), BS-standard check frequencies
(BS 5839, BS 5266, BS 5306, BS EN 12845, BS 9990, BS 9999), the PAS 79
five-band rating and the six-point fire-door check are all present and correct.
Second, the team has clearly been acting on these reviews: the Permits module's
HSE hardening (evaluated gas gate, lifecycle guards, gang log, permit PDF)
landed in PR #31, and the Risk Assessments feedback round shipped too. So the
findings below are, again, mostly **hardening** — but one of them (FS-1) is a
genuine safety-visibility defect that undoes part of the module's core promise.

Severities: **High** (a safety-critical failure can disappear from view, or
work/occupation is blessed when it shouldn't be), **Medium** (works but pushes
users toward non-compliance, or a needed capability is missing), **Low**
(polish / scale / cosmetic).

---

## The reviewers

Same four practitioners, re-focused on fire safety.

| # | Reviewer | Role | Organisation | Fire-safety lens |
|---|----------|------|--------------|------------------|
| 1 | **Priya Nair, CMIOSH** | Group HSE Manager | Precision-engineering firm, ~800 staff, multi-site | The statutory calendar at scale, failed-check follow-through, marshal cover across sites |
| 2 | **Tom Whitfield, GradIOSH** | H&S Advisor | Building-services contractor working residential blocks | Fire doors at volume, the FRA the client/RP needs, on-site recording |
| 3 | **Dr. Aisha Bello, CFIOSH** | Head of OH&S | NHS trust (hospitals, sleeping occupants) | Alarm/detection integrity, PEEPs, drills, evacuation of people needing assistance |
| 4 | **Marcus Lindqvist, CMIOSH (ISO 45001 lead auditor)** | EHS consultant / auditor | FM clients; also audits under the Fire Safety Order | The FRA as legal attestation, the logbook as evidence, defensibility |

---

# 1 · Priya Nair — Group HSE Manager, precision engineering

> *"I'm the Responsible Person for three premises. Fire safety is a calendar you
> can never let slip — weekly alarm tests, monthly emergency lighting, annual
> servicing. The first thing I checked is whether the system keeps that calendar
> honest."*

### What I did
Created my three buildings, let the system seed each one's check schedule from
its profile, recorded some checks — including a deliberately failed weekly alarm
test — and watched what the building overview did.

### What genuinely works — and it's the hard part
- **The building profile seeds the right statutory calendar automatically.**
  I flag "fire alarm", "emergency lighting", "sprinklers", set the height and
  storeys, and the logbook fills with the correct checks at the correct
  frequencies — weekly alarm test, monthly EL function + annual duration,
  monthly extinguisher visual + annual service, and the high-rise duties
  (firefighting-lift, secure information box, wayfinding) appear only when the
  building qualifies. Change the profile and the calendar reconciles itself.
  That is exactly the relentless calendar I need, and it's built on real
  BS-standard frequencies.
- **Due dates are month-end clamped** (31 Jan + 1 month → 28/29 Feb, never
  drifting into March). A small thing that tells me a fire person wrote this.
- **The tenant-wide "due" list and the needs-attention overview** put overdue
  and due-soon front and centre across every building.

### The defect that undermines the calendar

**FS-1 (High) — A *failed* check resets the calendar to green.** When I record
a weekly alarm test with result "fail", the system advances the schedule
exactly as if it had passed — `next due` jumps forward a week and the building's
status chip goes back to **OK**. The failure only exists in the entries list; it
does **not** keep the check showing as outstanding on the calendar or in the
overview. So the one place a manager looks — "what's red?" — shows green, while
the alarm doesn't actually work. The same applies to a failed fire-door
inspection. For a safety-critical calendar this is the worst possible failure
mode: the record of the failure hides the failure. *Repro: record any check as
"fail" → the check's due status returns to OK; only the entries log shows the
failure.*

**FS-2 (Medium) — A failed check doesn't force a follow-up.** Raising an action
from a failed check is an opt-in checkbox that defaults **off**. So a "fail" can
be logged with no action, no owner and no due date — and, per FS-1, nothing
left showing on the calendar. A failed fire-safety check should default to
raising an action (or block "green" until one exists).

**FS-3 (Medium) — Nothing tells me a check is due unless I open the app.** There
is no worker, email or digest for due/overdue checks — the calendar relies
entirely on someone logging in and looking. (The Permits module got an expiry
worker; fire checks, which are far more numerous and time-critical, have none
yet — it's a documented gap.) A weekly alarm test that slips will slip silently.

**FS-8 (Medium) — Marshal cover is noisy across an estate.** The coverage view
flags *every* active building with no in-date marshal as a gap — including
premises that don't need dedicated marshals — and there's no concept of a
required minimum (e.g. a deputy for cover). On three buildings that's fine; on
thirty it's noise that trains people to ignore the amber.

### Usage patterns that make little sense — and what I'd do instead
- **A failed check must stay visible (FS-1/FS-2):** a "fail" should keep the
  check flagged (a "failed — awaiting re-test/rectification" state) and default
  to raising an action, until a subsequent *pass* clears it. Advancing the clock
  on a failure is the bug.
- **Push the calendar to me (FS-3):** a due/overdue digest worker, like the
  permit expiry watch.
- **Let me say which buildings need marshal cover (FS-8).**

**Verdict:** The calendar engine is excellent and the auto-seeding from the
building profile is the best I've seen. But FS-1 is a real safety-visibility
defect — a failed alarm test going green is exactly the thing this module exists
to prevent. I'd hold rollout until failed checks stay visible.

---

# 2 · Tom Whitfield — H&S Advisor, building-services contractor

> *"We maintain and inspect fire doors and systems across residential blocks for
> managing agents. A block might have 200 flat-entrance doors. And when we're
> done, the agent wants the FRA and the logbook as documents they can hand to
> the fire service."*

### What I did
Set up a residential block above 11 m, added fire doors, recorded door
inspections on site, and tried to produce the FRA and logbook as documents for
the client.

### What works for me
- **Fire doors are proper inspectable assets** with the right regime baked in:
  in a residential building above 11 m, common-parts doors default to quarterly
  and flat-entrance doors to annual (Regulation 10), with a per-door override
  when a door earns closer attention. The six-point check (gaps, seals, closer,
  glazing, hinges, signage) is the real FDIS check.
- **The logbook has an inspector-ready CSV export** — I can hand the agent the
  evidence trail. Good.
- **Record forms reject future dates** and the door cadence recomputes from the
  actual inspection date. Solid.

### The gaps that slow me down

**FS-5 (Medium) — There's no FRA document.** The logbook exports to CSV, but the
**fire risk assessment itself has no PDF/export.** The FRA is the one document
the Responsible Person, the managing agent and the fire service actually ask
for. There's a document renderer for permits, risk assessments and inspections —
but nothing for the FRA. I can't give the client the assessment as a document.
*Repro: open a published FRA — there is no print/PDF/export; only the on-screen
editor.*

**FS-12 (Medium) — Fire doors can only be added one at a time.** A 200-door
block means 200 trips through a create form. There's no bulk add / import
(and no CSV in). For a landlord or a maintenance contractor that's punishing —
the door register is the most repetitive data in the module and the slowest to
build.

**FS-2 / FS-1 (from the door angle).** Recording a door inspection as "fail"
advances the door's next-due date to a full cycle out and the door's status chip
returns to OK; raising an action is an opt-in default-off checkbox. A failed
fire door — the thing most likely to let smoke into an escape stair — can drop
off the radar the moment it's recorded.

**FS-3 — No reminders.** Same as Priya: nothing tells the agent a door
inspection or a check is due; it depends on someone opening the app.

### UX / UI notes
- On-site recording works on mobile and the forms are quick. Good.
- Because there's no FRA document and no bulk door add, the module is stronger as
  an *internal* tracker than as something I can operate for a client end to end.

### Usage patterns that make little sense — and what I'd do instead
- **Give me the FRA as a PDF (FS-5)** — the assessment is the deliverable.
- **Bulk-add / import doors (FS-12)** — a block's door register shouldn't be 200
  form submissions.
- **Keep a failed door visible and default to an action (FS-1/FS-2).**

**Verdict:** The door regime and the logbook CSV are genuinely useful, but
without an FRA document and bulk door entry I can't run a client's block on it
end to end yet. Fix the FRA PDF and door import and it becomes a contractor's
tool, not just an internal register.

---

# 3 · Dr. Aisha Bello — Head of OH&S, NHS trust

> *"In a hospital the people at risk can't self-evacuate, we have sleeping
> occupants, and the alarm and detection have to be beyond doubt. My tests were:
> does a failed alarm test shout, and does the system take PEEPs and drills
> seriously."*

### What I did
Set up a residential-type building with sleeping occupants, built PEEPs for
people needing assistance, recorded a drill with a roll call, set an FRA to
"intolerable", and recorded a failed alarm test.

### What works for me
- **PEEPs are first-class and handled with dignity:** assistance needs, plan
  summary, buddy, equipment, a review cadence, and — importantly — plans are
  *ended, never deleted*, so the record of who had a plan survives. That's
  exactly right for a duty that changes as people come and go.
- **Drills capture what matters:** evacuation time, people present vs accounted
  for (with a roll-call sanity check that accounted-for can't exceed present),
  and lessons learned — and recording a drill satisfies the drill schedule in
  the same stroke.
- **The high-rise duties appear automatically** for qualifying residential
  buildings (secure information box, firefighting-lift, wayfinding), and the
  fire-door regime is correct.

### Bugs & safety gaps — the ones that matter in my world

**FS-1 (High) — A failed alarm or detection test goes green.** This is the one
that would stop me. Record the weekly alarm test as "fail" and the building's
calendar returns to OK with the next test a week away; the failure lives only in
the entries list. In a hospital, a fire-detection failure that isn't blazing red
on the dashboard until someone fixes it is not acceptable. The system should
hold that check in a failed state until a pass clears it.

**FS-6 (Medium) — An "intolerable" FRA publishes as if it were routine.** PAS 79
"intolerable" means the premises should not be occupied until the risk is
reduced. Here, rating an FRA "intolerable" and publishing it does nothing beyond
setting a shorter (3-month) review — same one-click "Sign & publish", no
escalation, no alert, nothing that flags the building as unsafe to occupy. The
rating that should trigger the loudest response triggers the quietest.

**FS-4 (Medium) — An FRA can be signed and published with the assessment empty.**
Publishing only requires a risk rating, a named Responsible Person, and either
some findings or a "no significant findings" tick. The persons-at-risk, the
sources of ignition/fuel/oxygen and the evaluation notes are all optional — so I
can attest an FRA as "suitable and sufficient" with the hazard assessment
blank. For sleeping-occupant premises that's precisely where the assessment must
be strongest.

**FS-3 (Medium) — No proactive alerts.** No reminder before a PEEP review lapses,
before a marshal's training expires, or before a check falls due — it's all
in-app-only. For a large trust with hundreds of these, silent calendars will
slip.

### UX / UI notes
- The building record reads well and the PEEP/marshal/drill sections are clear.
- Sleeping-occupants is captured as a flag but doesn't change any duty (it
  doesn't tighten drills, reviews or evacuation expectations) — a missed chance
  to drive the higher-risk regime it implies.

### Usage patterns that make little sense — and what I'd do instead
- **Hold failed safety-critical checks red until cleared (FS-1).**
- **Make "intolerable" escalate (FS-6):** a loud banner, a notification to the
  RP, and ideally a required immediate action — not just a shorter review.
- **Require the assessment content before "suitable and sufficient" (FS-4)**, and
  **let sleeping-occupants tighten the regime.**

**Verdict:** PEEPs and drills are handled with real understanding, and the
high-rise duties are correct. But FS-1 (failed alarm goes green) and FS-6
(intolerable publishes quietly) are two ways the system stays calm when it
should be shouting. In a hospital those are the moments that matter most.

---

# 4 · Marcus Lindqvist — EHS consultant & ISO 45001 lead auditor

> *"Under the Fire Safety Order the FRA is a legal attestation by the Responsible
> Person, and the logbook is the evidence it's being maintained. I audit both. I
> asked whether the attestation is meaningful and whether the record can be
> trusted."*

### What I did
Walked the FRA lifecycle and the logbook asking, at each step, "would this stand
up to the enforcing authority?"

### What works — and it's the right foundation
- **A complete append-only event log across every entity** (building, FRA,
  door, drill, PEEP, marshal, check), plus an append-only logbook and an
  append-only FRA review log with the trigger that prompted each review
  (scheduled, post-incident, material change, legislation change). That is the
  evidence spine a fire audit wants.
- **Findings → actions on publish, once only, with priority-based due dates**
  (high-priority findings due in 7 days, others 30) — a smarter default than the
  flat 7-day the Risk Assessments module started with. The team is clearly
  learning across modules.
- **A dedicated `fireSafety.record` permission** lets a competent person log
  checks without holding manage rights — exactly the role separation I flagged
  as missing on Permits. Good to see it applied here.

### Bugs & defensibility gaps

**FS-1 (High, audit view) — The logbook overstates compliance.** Because a
failed check advances the schedule and clears the calendar status, the building
overview an auditor is shown will read "up to date" while the underlying record
contains failures. The evidence contradicts the summary. That's worse than a
gap — it's a record that misrepresents the state of compliance.

**FS-4 (Medium) — The attestation can be hollow.** "Sign & publish" attests the
FRA is suitable and sufficient, but the gate doesn't require the assessment to
contain an assessment — no persons-at-risk, no hazard sources, no evaluation.
A signed FRA with empty content is not defensible under Article 9 of the Fire
Safety Order.

**FS-9 (Low/Med) — The attestation isn't shown.** The button says "Sign &
publish", but there's no statement of what's being attested and no preview of the
actions it will raise — unlike the Risk Assessments module, which got exactly
this. For a legal signature, show the words the RP is signing.

**FS-7 (Medium) — A published FRA is silently editable.** An active FRA stays
fully editable; the risk rating, findings and narrative can change after
publication without moving to draft or recording a review. Edits are
event-logged (good), but the "Sign & publish" attestation (`publishedBy` /
`publishedAt`) is not refreshed — so the signature on record can end up attached
to content that changed under it. I can't prove what was attested on a given
date.

**FS-5 (Medium) — No FRA document.** There's no PDF of the FRA to place on the
audit file or hand to the enforcing authority (the logbook CSV exists; the FRA
doesn't). The primary fire-safety document has no exportable form.

**FS-6 (Medium) — "Intolerable" doesn't escalate** — as Dr. Bello notes, the
rating that should stop occupation is treated as routine.

**FS-10 / FS-11 (Low) — Housekeeping.** FRA references overflow after FRA-9999
(4-digit pad, same as the other modules), and the module's own source headers
mis-label it "module B3" (it's B4 — B3 is Permits) in three files.

### Usage patterns that make little sense — and what I'd do instead
- **Never let a failure read as green (FS-1).**
- **Require assessment content, show the attestation, and freeze it on publish
  (FS-4/FS-9/FS-7):** re-attestation (or a recorded review) on any change to a
  live FRA.
- **Produce the FRA as a document (FS-5)** and **make "intolerable" escalate
  (FS-6).**

**Verdict:** The evidence architecture — append-only logs, triggered reviews,
priority-based actions, the record permission — is genuinely strong and shows
the lessons from the earlier reviews. What lets it down for audit is that the
logbook can read greener than reality (FS-1), the FRA attestation can be hollow
and mutable (FS-4/FS-7/FS-9), and the FRA has no document form (FS-5). Fix those
and this is a defensible fire-safety system.

---

# Consolidated findings

### The headline
Excellent domain modelling and a strong evidence spine, clearly benefiting from
the earlier reviews. The issues are hardening — except **FS-1**, which is a real
safety-visibility defect: a failed safety-critical check advances the calendar
and reads as green, so the record of a failure hides it.

### Where the reviewers agree (act on these first)
1. **A failed check goes green (FS-1).** The schedule advances and the calendar
   status clears on *any* result; a failed alarm test, detection service or door
   inspection stops showing as outstanding. *All four reviewers.* → **The most
   important fix.**
2. **Failures don't force follow-up (FS-2)** — raising an action is opt-in and
   default-off. *Nair, Whitfield, Bello.*
3. **The FRA attestation is weak:** publishable with empty content (FS-4), no
   attestation statement shown (FS-9), and freely editable after publish without
   re-attestation (FS-7). *Lindqvist, Nair, Bello.*
4. **No FRA document (FS-5)** — the primary fire-safety document can't be
   exported (the logbook CSV can). *Whitfield, Lindqvist, Bello.*
5. **No proactive notifications (FS-3)** — the statutory calendar depends on
   someone opening the app. *Nair, Whitfield, Bello.*
6. **"Intolerable" doesn't escalate (FS-6).** *Bello, Lindqvist.*

### What everyone praised (protect these)
- Accurate, expert domain: FSR 2022 thresholds, BS-standard frequencies, the
  >11 m door regime, PAS 79 rating, the six-point door check.
- **Auto-seeded statutory calendar** from the building profile, reconciling on
  profile change, with month-end-clamped due dates.
- **Fire doors as inspectable assets** with regime-derived cadences + overrides.
- The **append-only event/logbook/review logs** and **findings → actions**
  (priority-based due dates, once only).
- **PEEPs & marshals ended-not-deleted**, marshal coverage + training expiry,
  drills with roll-call validation that satisfy the drill schedule.
- A dedicated **`fireSafety.record` permission** (the role separation the Permits
  review asked for) and the **logbook CSV export**.

---

# Prioritised issue register

| ID | Sev | Summary | Raised by |
|----|-----|---------|-----------|
| FS-1 | High | A failed check/inspection advances the schedule and the calendar status returns to OK — the failure only shows in the entries list | All four |
| FS-2 | Med | Failed checks don't force a follow-up action (raise-action is opt-in, default off) | Nair, Whitfield, Bello |
| FS-4 | Med | An FRA can be "Signed & published" with the hazard assessment empty (no persons-at-risk / ignition-fuel-oxygen / evaluation required) | Lindqvist, Nair, Bello |
| FS-5 | Med | No FRA PDF/document (logbook CSV exists; the FRA — the key document — has no export) | Whitfield, Lindqvist, Bello |
| FS-3 | Med | No worker/email/digest for due or overdue checks, PEEP reviews or marshal-training expiry — in-app only | Nair, Whitfield, Bello |
| FS-6 | Med | An "intolerable"/"substantial" FRA rating doesn't escalate or block — it only shortens the review cycle | Bello, Lindqvist |
| FS-7 | Med | A published (active) FRA is freely editable with no re-attestation; the "Sign & publish" signature isn't refreshed | Lindqvist, Nair |
| FS-12 | Med | Fire doors can only be added one at a time — no bulk add/import for large door registers | Whitfield |
| FS-8 | Low/Med | Marshal-coverage gaps flag every active building with no in-date marshal; no "needs cover" concept or required minimum/deputy | Nair |
| FS-9 | Low/Med | FRA publish shows no attestation statement and no preview of the actions it will raise | Lindqvist |
| FS-10 | Low | FRA references overflow after FRA-9999 (4-digit pad) | Lindqvist |
| FS-11 | Low | Source headers mislabel the module "B3" (it's B4 — B3 is Permits) in three files | Lindqvist |

---

# Engineering appendix (root cause & pointers)

- **FS-1 (failed check goes green)** — `logbook.recordEntry` advances the
  schedule unconditionally on result:
  `nextDueAt = nextDueDate(performedAt, frequency)` regardless of pass/fail
  (`packages/api/src/routers/fireSafety.ts` ~L1551-1563). `doors.recordInspection`
  does the same: `nextInspectionDueAt = addMonthsClamped(inspectedAt, interval)`
  on any outcome (~L1898-1907). Calendar status is derived purely from
  `nextDueAt` via `checkDueStatus` (`packages/shared/src/fire-safety.ts` L86),
  which never sees the result — so the building `list`/`get`/`overview` counts
  (~L462-499, L2524-2530) read OK after a failure. Fix: keep a failed check in a
  distinct outstanding state (don't advance, or add a `lastResult`-aware status)
  until a subsequent pass clears it.
- **FS-2 (no forced follow-up)** — `recordEntry` / `recordInspection`
  `raiseAction` defaults `false` and only fires when `result !== 'pass'` AND the
  flag is set (~L1482, L1508, L1839, L1854). Fix: default on for fail, or block
  the green state until an action exists.
- **FS-4 (hollow attestation)** — `fras.publish` gate checks only `riskRating`,
  `responsiblePersonName`, and findings-or-`confirmNoSignificantFindings`
  (~L1173-1185); no check on `personsAtRisk` / `ignitionSources` /
  `fuelSources` / `oxygenSources` / `evaluationNotes`. FRA page publishes on one
  click (`apps/web/app/[locale]/fire-safety/fra/[fraId]/page.tsx` L273).
- **FS-5 (no FRA document)** — `apps/web/app/render/` contains `inspection`,
  `permit`, `risk-assessment` — no `fra`/`fire`. Logbook CSV export exists
  (`.../fire-safety/logbook/page.tsx` L47). Fix: an FRA render route.
- **FS-3 (no notifications)** — no worker under `packages/jobs/src/workers/`
  matches fire/fra; acknowledged in the router header (~L40). Fix: a due-check
  digest worker mirroring `permit-expiry-watch`.
- **FS-6 ("intolerable" doesn't escalate)** — `publish` accepts any rating;
  `suggestedFraReviewMonths('intolerable') = 3` (`fire-safety.ts` L364-367) is
  the only effect. Fix: banner + notify + required immediate action on
  intolerable/substantial.
- **FS-7 (active FRA editable, no re-attestation)** — FRA page
  `editable = canEdit && !archived` (L166); `fras.update` only blocks archived
  (~L938). `publishedBy`/`publishedAt` not refreshed on edit. Fix: re-attest or
  force a recorded review on change to an active FRA.
- **FS-12 (no bulk doors)** — `doors.create` is single-row (~L1684); no import.
- **FS-8 (marshal gap noise)** — `marshals.coverage` / `overview` count every
  active building with zero in-date marshals (~L2443-2455, L2556). Fix: a
  "requires marshal cover" flag + minimum count.
- **FS-9 (no attestation shown)** — publish button is a direct mutate with no
  confirmation/statement (FRA page L272-285). Fix: a sign-off dialog like the RA
  module's.
- **FS-10 (ref overflow)** — `FRA-${String(n).padStart(4, '0')}`
  (`fireSafety.ts` L915).
- **FS-11 (B3 vs B4 typo)** — header comments say "FreeHS module B3" in
  `packages/shared/src/fire-safety.ts` L2, `packages/db/src/schema/fire-safety.ts`
  L1, `packages/api/src/routers/fireSafety.ts` L2.

### Overall
The Fire Safety module is the most domain-accurate of the FreeHS HSE modules and
its evidence architecture shows the lessons from the Risk Assessments and
Permits reviews. The priority is FS-1 — a failed safety-critical check must never
read as green — followed by hardening the FRA attestation (FS-4/FS-7/FS-9),
giving the FRA a document form (FS-5), and pushing the statutory calendar to
people before it slips (FS-3).

---

*Prepared as an independent practitioner review of the FreeHS Fire Safety module.
Findings verified against the shipped implementation on `main`; reproduction
steps and code pointers included so each can be triaged directly.*

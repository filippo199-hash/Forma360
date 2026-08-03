# FreeHS — Incident & Accident Management module

## Independent review by four HSE practitioners

**Product:** FreeHS (freehs.software)
**Module reviewed:** Incident & Accident Management, incl. investigations (FreeHS module B5)
**Surface reviewed:** `/en/incidents` — register, report form, incident page, investigation workspace, PDF pack, three workers, cross-module integrations
**Date:** 3 August 2026

---

## Methodology & scope (read this first)

This is a full module review, the seventh in the series and the first of a
module built directly from a practitioner specification
(`docs/specs/incident-management-module-spec.md`, itself written from the
four-practitioner gap analysis that rated this module's absence the
platform's unanimous top gap).

**How the review was performed.** As with every prior review, the live app is
behind an authenticated login wall and no browser automation was available, so
findings are verified against the **shipped implementation on `main`**: the
domain library, schema, ADR 0013, the 2,813-line router, all three workers and
their tests, the four web routes, the PDF pipeline, the email registry, and the
search/AI/actions/nav integrations. The single most serious finding (IN-A1) was
re-verified line by line by hand, against its correctly-implemented sibling
worker, before being written up.

**Headline.** This is the most faithful spec-to-implementation the platform has
produced, and in several respects the best-engineered module in the codebase.
Every one of the spec's 20 edge cases has a test; the confidentiality model is
enforced on **every** read surface; the separation-of-duties approval, the
savepoint-wrapped once-only action generation, the RIDDOR counting rule and the
permission backfill for existing tenants are all correct. The IN-J04
email-registry test the spec demanded now exists — and, per ADR 0013, it
surfaced and fixed the four templates that had been silently throwing in
production (the platform review's PF-1). That is a systemic fix, and it is the
best outcome any of these reviews has produced.

Which makes the headline finding painful: **the one worker that cannot
self-heal reintroduces exactly the PF-1 failure mode it was written to
prevent.** The immediate serious-incident alert stamps itself as sent even when
every delivery failed, and never retries. Its sibling worker, fifty lines away,
has the correct guard.

Severities: **Critical** (a safety notification or record is silently lost),
**High** (defeats a core duty of the module or loses practitioner work),
**Medium** (pushes users into bad practice / a real capability is missing),
**Low** (polish).

---

## The reviewers

| # | Reviewer | Role | Organisation | What they tested |
|---|----------|------|--------------|------------------|
| 1 | **Priya Nair, CMIOSH** | Group HSE Manager | Precision engineering, ~800 staff | Her S1 scenario end-to-end: machinery injury → RIDDOR → full investigation → CAPA → RA review → effectiveness |
| 2 | **Tom Whitfield, GradIOSH** | H&S Advisor | Building-services contractor, ~40 staff | His S2 scenario: minor injury reported from a phone in 3 minutes, with a documented *negative* RIDDOR determination |
| 3 | **Dr. Aisha Bello, CFIOSH** | Head of OH&S | NHS trust | Her S3 scenarios: confidential needlestick and violence & aggression; alerting at scale |
| 4 | **Marcus Lindqvist, CMIOSH** | EHS consultant / ISO 45001 lead auditor | FM & logistics clients | His S4 scenario: sample five incidents and follow clause 10.2 end to end |

---

# 1 · Priya Nair — Group HSE Manager, precision engineering

> *"I wrote the machinery-injury scenario that this module was specced
> against, so I ran exactly that: hand caught in a nip point, nine days off,
> full investigation, two corrective actions, RA re-review, effectiveness
> check ninety days later. I wanted to know whether the loop actually
> closes."*

### It closes. All of it.
For the first time in this series I can follow a safety event from report to
proven effectiveness without leaving the platform:

- **The RIDDOR engine is right.** Nine days off produced an *over-7-day*
  determination with a 15-day clock; the deadline is computed from the
  occurrence, warnings ladder at T-5 and T-2, and escalation past it. Better:
  the **over-7-day tripwire** re-reads the lost-time record on every absence
  write, so when absence accumulated past seven days against an earlier "not
  reportable" screening, the incident flagged itself for re-screening *and
  blocked closure until it was redone*. I have watched real organisations miss
  exactly that. The lost-time calculator implements the counting rule properly
  — day of accident excluded, weekends counted, overlapping periods merged so
  no day is double-counted.
- **Findings → actions is the best CAPA hand-off on the platform.** Each
  `requiresAction` finding generates exactly one action, guarded at two levels
  (the finding's `actionId` stamp plus the actions source unique index) with a
  savepoint so a race adopts the existing row instead of aborting my approval.
  Crucially, **assignee and due date are set per finding in the approval
  dialog** — the fix to the complaint I made about risk assessments hard-coding
  "publisher / 7 days". And assignment now emails the assignee.
- **The effectiveness review closes clause 10.2.** Ninety days after closure I
  am asked whether the controls held, with a three-value verdict, and
  `not_effective` offers the reopen path.
- **Post-incident review prompts fire the triggers that had been waiting.**
  Selecting my machine-shop RA pulled its next-review date to now and wrote an
  event citing the incident. That `'incident'` trigger enum had been sitting
  unused since the RA module shipped.

### What I'd send back

**IN-A3 (High) — A fatality can be investigated at "basic" level.** The spec
and ADR 0013 both say the `full` investigation level is *mandatory* when
severity is serious-or-above or the incident is RIDDOR-reportable. The shared
library even provides `defaultInvestigationLevel(severity, riddorReportable)`
to compute it — and **that function is never called anywhere in the router or
the web app.** `triage` accepts whatever level the client sends with no
validation against severity. Choose `basic` for a major injury and the
submission gate then requires only an immediate cause and a conclusion — **no
RCA method, no root-cause statement**. The guard was written and never wired.

**IN-A3b (High, same root) — and the level can never be changed afterwards.**
`investigationLevel` is written only by `triage`, which only runs once (from
`reported`). There is no procedure and no UI to change it. So a `basic`
investigation that turns out to be serious can never be upgraded — while
`setSeverity` *can* still raise the severity, producing a permanent
severity=major / level=basic record. The spec asked for upgrades any time and
no downgrade once evidence exists; we have neither.

**IN-A6 (Medium) — Approval can complete leaving actions unassigned and
undated.** The approval dialog submits only the findings the approver actually
touched. Scroll past one and its action is created with no assignee and no due
date — which also means the chase digest cannot chase it (it filters on
`dueAt < now`). The confirm button is enabled regardless. For a module whose
whole point is that corrective actions get done, the approval step should
refuse until every action-bearing finding has an owner.

**IN-A7 (Medium) — Six shipped procedures have no UI, and the record can never
be corrected.** `update`, `setSeverity`, `assignInvestigator`, `removePerson`,
`removeAbsence` and `updateFinding` exist in the router and appear nowhere in
the web app. Consequences I hit inside an hour: a wrong site typed at the scene
is permanent; a person added by mistake (the add control is a bare input and a
button, no confirmation) cannot be removed — permanent personal injury data; an
absence entered with the wrong start date cannot be corrected, and absences
drive the RIDDOR re-screen; and if my lead investigator goes on leave, the
incident is stranded because only triage can appoint one.

**Verdict:** The engine is excellent — this is the module I asked for. But the
proportionality guard is missing in both directions (IN-A3), and a record I
cannot correct is a record my auditors will not trust (IN-A7). Fix those and I
would move my accident book onto this tomorrow.

---

# 2 · Tom Whitfield — H&S Advisor, building-services contractor

> *"My test was the one I set in the gap analysis: apprentice cuts his arm,
> three days off, not reportable. Can I record it on a phone, on site, in
> three minutes — and does the system let me document *why* it isn't
> reportable?"*

### Both, comfortably — and the RIDDOR panel is the best thing in the module
Minimum path is title → Submit. The date-time prefills to now, kind-specific
blocks only appear for the kinds that need them, the injury detail sits in a
collapsed section that costs nothing when I skip it, and the photo step opens
the camera directly. Well under three minutes.

And the negative determination is treated as a first-class record, exactly as I
asked: the "not reportable" option **requires a reason before it will confirm**,
with the on-screen line *"Record why — the negative determination is the
record."* The whole panel is framed as *"The platform computes the deadline; you
own the judgement"* — the right division of labour, and the category help text
is legally accurate against RIDDOR 2013 (the specified-injury list is the real
Regulation 4 list, the over-7-day text correctly says "not counting the day of
the accident"). When my client asks why an injury wasn't reported, the answer
prints on the PDF.

### Where it lets me down on site

**IN-A4 (High) — A failed photo upload is completely silent.** Both upload
paths — the report form and the investigation workspace — do the same thing: if
the response isn't OK, `continue`. No toast, no error, no change to the counter.
The spinner stops and the screen looks identical to success. A file over the
25 MB cap, an unsupported type, or an R2 blip, and I walk away believing the
photo of the unguarded blade is attached. There's no `catch` around the fetch
either, so offline it fails as an unhandled rejection. On the one screen whose
own copy says *"Photos taken now are worth ten statements later"*, silently
dropping them is the worst possible failure.

**IN-A2b (High) — Offline is half-built.** There *is* a localStorage draft:
every keystroke persists, it restores on return, it survives a failed submit
with a "saved on this device — retry when you have signal" banner. Genuinely
good. But compared with the inspection conduct flow the spec told it to copy,
there's no `online` listener, no retry timer, and no `beforeunload` — so the
reporter has to notice they're back in signal and tap Submit again. And
**photos are strictly online-only and only after the record is created**, so in
a basement plant room I get no photo capture at all.

**IN-A5 (High) — The investigation workspace loses my work.** RCA state lives
in component state and only reaches the server when I tap Save. There is no
autosave, no `beforeunload` handler, no navigation guard — the page tracks
`dirty` purely to style the button. A full write-up (why-chain, timeline,
conclusion, lessons learned) is gone on a tab close or a back-tap. Its sibling
flow was explicitly built to survive signal loss; this one drops an hour's work
to a stray gesture.

**IN-A8 (Medium) — In a firm my size, an investigation can never be
approved.** Separation of duties is right in principle — the approver must be
neither the lead investigator nor the submitter, server-enforced. But I am a
40-person contractor: I am the safety advisor, the lead investigator and the
only holder of `incidents.manage`. There is no escape hatch, no configuration,
no "sole-manager" path. My investigations are stuck in `investigating`
permanently, which also blocks closure, which blocks the RIDDOR duty being
marked discharged. The principle needs a documented path for micro-tenants —
a second approver role, an owner override with a logged justification, or a
tenant setting that acknowledges the risk explicitly.

**Minor but daily:** the injury-kind and body-part chips are about 20px tall
with 21 body parts in a wrap grid — well under a 44px tap target on the screen
designed for a phone at a scene. And `/incidents/new` doesn't check
`incidents.report`, so a user without it fills the whole form and fails at
submit.

**Verdict:** The fastest, best-written report form on the platform, and the
RIDDOR panel is genuinely excellent. But it silently eats my photos (IN-A4),
loses my investigation write-up (IN-A5), and — in a firm my size — can never
be signed off at all (IN-A8).

---

# 3 · Dr. Aisha Bello — Head of OH&S, NHS trust

> *"I set two conditions in the gap analysis: sharps and violence & aggression
> as first-class kinds, and a confidentiality model where the incident is
> counted for everyone but readable by almost nobody. Then I tested whether the
> alert that matters actually arrives."*

### The confidentiality model is exactly right — and it is enforced everywhere
I could not fault it, and I tried:

- Sharps exposures and V&A records **default to confidential** at creation.
- Restricted records appear in the register with the title **nulled** and a
  `restricted` flag — counted, not readable.
- The CSV export writes "Confidential" in place of the title. Global search
  will match the reference for everyone but the title only for
  `incidents.confidential.view` holders. The AI assistant excludes them
  entirely (stricter than the router — fail-closed, which I approve of). The
  PDF export runs the same check before rendering. The detail page refuses
  with a specific error.
- Even the investigator-assignment email substitutes the reference for the
  title when the record is confidential.

That is the same rule applied on six independent surfaces without a gap. The
sharps block captures device, procedure, source-risk assessment, contamination
status and an OH-follow-up flag defaulted on; the V&A block captures nature,
perpetrator type, weapon, police notification and — the detail that tells me a
practitioner wrote this — **support offered to the affected staff member**.

### The alert layer is where it breaks, twice

**IN-A1 (Critical) — The immediate serious-incident alert marks itself sent
even when every delivery failed, and never retries.** This is a regression of
the exact platform bug (PF-1) this module's spec was written to prevent, and it
is in the one worker that cannot self-heal.

The alert worker loops over recipients, catches and logs every send failure,
then writes `alertSentAt` **unconditionally** — followed by an `alert_sent`
event recording `{notified: 0}`. Because the function never throws, BullMQ does
not retry; and because every re-enqueue path checks `alertSentAt !== null`
first, no later trigger can ever resurrect it. A two-second mail-provider blip
during that loop means the serious-incident fan-out is **lost permanently**, with
an audit event that says an alert was sent.

Its sibling, the RIDDOR watch, gets this exactly right fifty lines away:
*"with zero deliveries (every send failed AND there was someone to tell) leave
the stamp clear so the next tick retries"*. That guard is simply missing here.
And unlike the RIDDOR watch — a 15-minute cron that would recover on the next
tick — the alert worker is **event-driven and fires once**. It is the only
place where losing the notification is unrecoverable, and it is the only one
with the wrong ordering. The worker's own docstring claims notify-then-stamp
semantics it does not implement; the test file never injects a failing send,
while the RIDDOR watch's test does exactly that.

**IN-A2 (High) — A serious injury raises no alert at all until someone
triages it.** The report form has no severity control and `create` hard-codes
`severity: 'minor'`. The alert predicate is "always-alert kind OR severity
serious-or-above", and the always-alert kinds are only dangerous occurrence,
sharps and V&A. So an `injury` report — an amputation, a fatality — **notifies
nobody**. It sits in the register showing a "Minor" chip until a human opens it.
The alert then fires on triage, which means the notification designed to summon
the manager depends on that manager having already arrived.

It compounds: there is **no "awaiting triage" counter** in the needs-attention
overview (which counts open, investigating, RIDDOR due/overdue, rescreen and
effectiveness), and the daily chase digest covers only `investigating`,
`actions_outstanding` and `closed`. An incident reported at 2am on Saturday is
therefore in no alert, no counter and no digest. It is invisible to every
notification path the module has.

The form already collects the signal needed to fix it: hospitalisation
(`A&E` / `admitted`) is captured per person and submitted on create — and never
read anywhere in the router. Deriving a provisional severity from it, or simply
adding it to the alert predicate, closes the gap.

**IN-A9 (Medium) — Evidence and witness statements are invisible until an
investigation starts.** Both live only in the investigation workspace, and only
inside the "investigation exists and is editable" branch. So the photos the
reporter attached at the scene cannot be seen from the incident page at all
until someone triages and starts an investigation. For a sharps case where OH
needs to see the record immediately, that is the wrong order.

**IN-A10 (Medium) — Every incident email is English-only, for everyone.** The
five incident templates exist only in English (the other five locale folders
have none), and — more frustrating — the workers *resolve* each recipient's
locale and then drop it: the three incident wirings omit it from the send call
while every other worker on the platform passes it. My Portuguese-speaking
domestics get an English RIDDOR escalation. The UI namespace, by contrast, is
translated to a standard I'd hold up as exemplary (see Marcus).

**Verdict:** The confidentiality model is the best-executed requirement in this
whole review series, and the sharps/V&A modelling shows real clinical
understanding. But the alerting layer has a permanent-loss bug (IN-A1) and a
structural hole for serious injuries (IN-A2). Until both are fixed I cannot
rely on this module to tell anyone that something bad has happened — which is
the first thing an incident system must do.

---

# 4 · Marcus Lindqvist — EHS consultant & ISO 45001 lead auditor

> *"I sampled five incidents and asked the clause-10.2 question at each step:
> can I follow event → determination → investigation → root cause → actions →
> effectiveness, and can I see who signed what, when?"*

### For the first time on this platform: yes
- **The audit trail is append-only end to end.** Thirty event kinds cover every
  lifecycle move, screening change, signature and notification; workers write
  as actor `system`. Evidence and witness statements have **no update or delete
  surface at all** — corrections are new rows, which is what I ask for and
  rarely get.
- **Investigations are versioned properly.** Approval freezes the revision;
  reopening creates revision n+1 **pre-filled from n** while n stays readable
  with its own signatures. This is the risk-assessment lesson (signed content
  that could silently change) applied from day one rather than retrofitted.
- **Separation of duties is real.** The approver may be neither the lead
  investigator nor the submitter, enforced in the router with a specific error,
  and covered by a test. The lead investigator submits; managers must reassign
  the lead before taking over, which keeps the signature honest.
- **The RIDDOR determination is a record, not a decision the software made** —
  including the negative one, with its reasoning, on the PDF.
- **The PDF is a genuine evidence artefact**: every revision with its signature
  blocks, the determination and its note, the days-lost counting rule spelled
  out, and a fully translated event timeline.
- **The permission backfill was done.** New tenants get the five `incidents.*`
  keys from the seed; existing tenants get them from a guarded SQL backfill in
  the migration. That was my PF-8 complaint and it has been answered
  mechanically rather than promised.
- **The IN-J04 registry test exists**, walks the template directory, loads and
  schema-validates every entry, and even asserts no template leaks the wrong
  brand. Its failure message tells the next engineer what to do. Per ADR 0013
  it caught the four templates that had been throwing in production. **That is
  the single most valuable thing produced by this entire review series** — a
  systemic fix that makes a class of failure impossible rather than fixing four
  instances of it.

Which is why IN-A1 stings: the discipline that test enshrines was not applied to
the one new worker whose failure is unrecoverable.

### Audit gaps

**IN-A9b (Medium) — Frozen revisions are shown in drastically reduced form.**
The approved revision is the legally significant artefact, and the workspace
renders it as immediate cause, underlying cause, conclusion and signatures
only — hiding the RCA method, why-chain, causal factors, sequence of events,
root-cause statement, recurrence likelihood, lessons learned **and its
findings**. The data is all there (the PDF prints it), so this is a rendering
choice, and it's the wrong one: on screen, the superseded analysis I most want
to compare against revision 2 is the part that's hidden.

**IN-A11 (Medium) — The timeline shows no detail.** The event log stores a
`detail` payload — reopen reasons, cancellation reasons, the review-prompt skip
reason, who was assigned — and the page renders only timestamp, label and
actor. On a page whose docstring promises "everything the auditor follows", I
can see *that* an incident was reopened but not *why*, without going to the
database.

**IN-A3, from my seat.** Priya's proportionality finding is my clause-10.2
finding: an investigation level that doesn't bind to severity means the depth of
inquiry is discretionary at exactly the moment it should not be. A
RIDDOR-reportable event concluded with no root cause recorded would be a
non-conformity in my report — and today the software permits it.

**Smaller:** the chase digest applies no per-run cap to its three queries (the
only worker missing the platform's cap discipline); the registry test's file
count floor is weak enough to miss a *deleted* template; and two screens print
raw enum values (`· medium`) where translated labels exist.

**Verdict:** This is the first module I could certify against clause 10.2 —
the loop is complete, versioned, signed and append-only. Fix the alert worker
(IN-A1), bind investigation depth to severity (IN-A3), and render frozen
revisions in full (IN-A9b), and I would hold this up as the reference
implementation for the rest of the platform.

---

# Consolidated findings

### Where the reviewers agree
1. **IN-A1 is the fix-today item.** The immediate alert stamps on total
   delivery failure and never retries — PF-1's failure mode, in the one worker
   that cannot self-heal, with the correct guard visible in its sibling fifty
   lines away and no test covering the case. *Bello, Lindqvist.*
2. **The alerting model has a structural hole even when it works** (IN-A2): no
   severity at report means a serious injury notifies nobody until triage, and
   untriaged incidents appear in no counter and no digest. *Bello, with Nair
   and Lindqvist on the blind spot.*
3. **Investigation depth isn't bound to severity** (IN-A3) — and can never be
   upgraded. `defaultInvestigationLevel` is dead code. *Nair, Lindqvist.*
4. **The field flows lose work silently**: photo uploads fail with no message
   (IN-A4), and the investigation workspace has no unsaved-work protection
   (IN-A5). *Whitfield.*
5. **The record cannot be corrected** — six procedures shipped without UI
   (IN-A7). *Nair.*
6. **Small-tenant approval deadlock** (IN-A8) — separation of duties with no
   path for a one-manager firm. *Whitfield.*

### What everyone praised (protect these)
- The **confidentiality model**, enforced identically on list, get, search,
  CSV, PDF, AI and email.
- The **RIDDOR engine**: correct counting rule, the over-7-day tripwire that
  blocks closure, guided determination with legally accurate help text, and the
  negative determination as a first-class record.
- **Findings → actions**: once-only at two levels with a savepoint, per-finding
  assignee/due at approval, assignment notifications.
- **Versioned, frozen, separately-signed investigations** and the
  **append-only** evidence/witness/event model.
- The **effectiveness review** closing clause 10.2, and the **post-incident
  review prompts** firing trigger enums that had been dormant since the RA
  module shipped.
- The **IN-J04 email-registry test** — a systemic fix that retired PF-1
  permanently and caught four live broken templates.
- **i18n**: 474 keys, all 10 locales complete, every enum covered, and a 1:1
  error-slug contract between router, UI and translations with no orphans on
  either side.
- The **permission backfill migration** for existing tenants (PF-8 answered).

---

# Prioritised issue register

| ID | Sev | Summary | Raised by |
|----|-----|---------|-----------|
| IN-A1 | **Critical** | Alert worker stamps `alertSentAt` even when every send failed → serious-incident fan-out lost permanently; never retries; no test for the failing-send case (PF-1 regression) | Bello, Lindqvist |
| IN-A2 | High | No severity at report (`create` hard-codes `minor`) → serious injury alerts nobody until triage; **and** untriaged incidents are in no counter and no digest | Bello, Nair |
| IN-A3 | High | Investigation level not bound to severity/RIDDOR — a fatality can be investigated at `basic` with no RCA or root cause; `defaultInvestigationLevel` never called | Nair, Lindqvist |
| IN-A3b | High | `investigationLevel` is write-once at triage — no upgrade path, while severity can still be raised | Nair |
| IN-A4 | High | Photo upload failure completely silent on both paths (no toast, no catch, unhandled rejection offline) | Whitfield |
| IN-A5 | High | Investigation workspace has no autosave, `beforeunload` or nav guard — a full write-up is lost on tab close | Whitfield |
| IN-A6 | Med | Approval completes with unassigned/undated actions, which the chase digest then cannot chase | Nair |
| IN-A7 | Med | Six procedures shipped with no UI (`update`, `setSeverity`, `assignInvestigator`, `removePerson`, `removeAbsence`, `updateFinding`) — records can't be corrected | Nair |
| IN-A8 | Med | Separation of duties has no path for a single-manager tenant — investigations can never be approved | Whitfield |
| IN-A9 | Med | Evidence + witness statements invisible until an investigation is started | Bello |
| IN-A9b | Med | Frozen (approved) revisions rendered in drastically reduced form — RCA, findings, lessons hidden on screen | Lindqvist |
| IN-A10 | Med | Incident emails English-only; recipient `locale` resolved then dropped in all three wirings (PF-20 regression) | Bello |
| IN-A11 | Med | Event timeline renders no `detail` — reopen/cancel/skip reasons invisible | Lindqvist |
| IN-A12 | Med | Offline: no `online` listener, retry timer or `beforeunload` on the report form; photos strictly online-only and post-create | Whitfield |
| IN-A13 | Low | Register polish: confidential rows look clickable but aren't; no confidential chip on mobile cards; attention chips not clickable; no search debounce; `exportCsv` has no `catch` | All |
| IN-A14 | Low | Raw enum leaks (`finding.priority`, revision status); chase digest has no per-run cap; registry test's file-count floor too weak to catch a deletion; PDF prints "Closed —" on open incidents; `accept` omits the video types the API allows; `/incidents/new` doesn't check `incidents.report` | All |

---

# Engineering appendix (root cause & pointers)

- **IN-A1** — `packages/jobs/src/workers/incident-alert.ts:116-135`: the send
  loop catches every error (`:121-126`), then `:131-135` writes `alertSentAt`
  unconditionally and `:136-143` logs `alert_sent` with `{notified: 0}`.
  `runIncidentAlert` never throws → no BullMQ retry; `:97`
  (`alertSentAt !== null`) makes every re-enqueue a no-op. Correct pattern in
  the sibling: `incident-riddor-watch.ts:208-211`
  (`if (delivered === 0 && recipients.length > 0) continue;`). Test gap:
  `incident-alert.test.ts:55-57` — `notify` can never fail; contrast
  `incident-riddor-watch.test.ts:164-174`. *Fix: port the guard; add the
  failing-send test.*
- **IN-A2** — `incidents.ts:956` hard-codes `severity: 'minor'` at create;
  `maybeEnqueueAlert` (`:501-513`) gates on `needsImmediateAlert`
  (`shared/src/incidents.ts:92-94`) whose `ALERT_KINDS` (`:86-90`) excludes
  `injury`. `overview` (`incidents.ts:864-917`) returns open / investigating /
  riddorDueSoon / riddorOverdue / rescreenRequired / effectivenessOverdue —
  **no untriaged counter**. `incident-chase.ts:69-96` covers `investigating`,
  `actions_outstanding`, `closed` only. Unused signal: per-person
  `hospitalisation` is stored and never read.
- **IN-A3 / A3b** — `triageInput` (`incidents.ts:452`) accepts any level;
  `triage` (`:1090`) writes it unvalidated; `submitInvestigation:1895` gates RCA
  only on `investigationLevel === 'full'`. `defaultInvestigationLevel`
  (`shared/src/incidents.ts:514-519`) has zero call sites. `investigationLevel`
  is written only at `:1090`.
- **IN-A4** — `incidents/new/page.tsx:186-187` and
  `incidents/[incidentId]/investigation/page.tsx:235-236`: `if (!res.ok)
  continue;` with no catch; caller `void uploadFiles(...)` at `new:219`.
- **IN-A5** — `investigation/page.tsx:250-265` (save on tap), `:79` (`dirty`
  used only for styling/submit-block); no `beforeunload`. Reference
  implementation: `inspections/conduct-shell.tsx:277-287`.
- **IN-A6** — `investigation/page.tsx:1090-1108` submits only touched
  assignments; confirm `disabled` only on pending. Chase filter:
  `incident-chase.ts:116` (`lt(actions.dueAt, now)`).
- **IN-A7** — router procedures `update` (`incidents.ts:998`), `setSeverity`
  (`:1126`), `assignInvestigator` (`:1156`), `removePerson` (`:1286`),
  `removeAbsence` (`:1419`), `updateFinding` (`:1759`) — no references in
  `apps/web`.
- **IN-A8** — `incidents.ts:1995-2000` (`approver-is-investigator`), no
  override path or tenant setting.
- **IN-A9 / A9b** — evidence + witnesses rendered only in
  `investigation/page.tsx` inside the `latest !== undefined && !viewingFrozen`
  branch (`:346`); frozen view `:312-343`; `findingsForViewed` computed
  (`:224`) but consumed only in the editable branch. Full data present in
  `incident-print-layout.tsx:323-464`.
- **IN-A10** — templates exist only under `packages/i18n/emails/en/`;
  `packages/jobs/src/worker.ts:465-483, 503-526, 548-567` omit `locale` while
  `:374, :414, :587, :639, :676` pass it; `PermissionHolder.locale` is selected
  in `incident-riddor-watch.ts:147,159` then unused.
- **IN-A11** — `[incidentId]/page.tsx:1150-1162` renders timestamp + label +
  actor only; `incident_events.detail` jsonb never surfaced.
- **IN-A12** — `new/page.tsx:123-145` (draft persist/restore), `:179`
  (`uploadFiles` returns when `createdId === null`); missing the `online`
  listener / retry / `beforeunload` of `conduct-shell.tsx:256-287`.
- **Verified correct (no action):** confidentiality on every surface
  (`incidents.ts:590-600` list, `:629` get, `:2782` renderPdf, CSV redaction
  `~:2740`, `search.ts:349-353`, `agent-tools.ts:191`); approval separation +
  savepoint (`:1995-2151`); closure preconditions (`:2432-2456`); revision
  pre-fill (`:1636-1663`); evidence storage-key scoping (`:1555-1560`);
  `assertRecordAuthority` inner guard on the view-gated writes (`:2804-2811`);
  permission backfill (`migrations/0068_incidents.sql:273-279`); IN-J04
  (`packages/shared/src/email.test.ts:117-151`).

### Suggested sequencing
1. **Today:** IN-A1 (three-line guard + the missing test). It is a
   lost-safety-alert bug in the module's most important notification.
2. **This week:** IN-A4 (surface upload errors), IN-A5 (`beforeunload`), IN-A2
   (derive provisional severity from hospitalisation; add an untriaged counter
   and include `reported` in the chase digest).
3. **This sprint:** IN-A3/A3b (bind level to severity via the existing helper;
   add an upgrade path), IN-A6 (require assignee+due before approve), IN-A7
   (wire the six procedures — `update`, `removePerson`, `removeAbsence` first).
4. **Next:** IN-A8 (documented micro-tenant approval path), IN-A9/A9b (surface
   evidence pre-investigation; render frozen revisions in full), IN-A10
   (translate the five templates; pass `locale`), IN-A11 (timeline detail).

---

*Prepared as an independent practitioner review of the FreeHS Incident &
Accident Management module, following six prior reviews. Findings verified
against the shipped implementation on `main`; the Critical finding was
re-verified by hand against its correctly-implemented sibling worker.
Reproduction pointers included so each item can be triaged directly.*

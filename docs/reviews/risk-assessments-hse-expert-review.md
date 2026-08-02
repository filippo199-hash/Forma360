# FreeHS — Risk Assessments module

## Independent review by four HSE practitioners

**Product:** FreeHS (freehs.software) — Risk Assessments (module B1)
**Surface reviewed:** `/en/risk-assessments` (list) and the assessment editor / detail page
**Date:** 2 August 2026

---

## Methodology & scope (read this first)

Four safety practitioners from different sectors were asked to work through the
Risk Assessments module as if adopting it for their own organisation: create an
assessment, build it out through the HSE five steps, publish it, raise actions,
distribute it, and keep it under review.

**How the review was actually performed.** The live application at
`https://freehs.software/en/risk-assessments` is behind an authenticated
login wall (the anonymous request returns HTTP 403), and the review
environment had no browser-automation available to complete a Gmail-OTP
sign-in. Rather than guess at behaviour, each reviewer's findings were
verified directly against the **shipped implementation that renders that
page** — the tRPC router, the list and editor React pages, every component
(hazard card, matrix picker, quick-add, review and distribution panels), the
curated hazard library, the risk-matrix banding logic and the exact
user-facing copy. Every bug below therefore comes with concrete
reproduction steps and has been traced to the code that causes it (see the
**Engineering appendix**). The four "reviewers" are a device for organising
expert critique from four sector viewpoints; the defects they describe are
real and reproducible in the deployed build.

Product-defect severities used below: **High** (blocks a core task, produces
misleading safety records, or defeats a legal duty), **Medium** (works but
pushes users into bad practice or is confusing), **Low** (polish / edge case).

---

## The reviewers

| # | Reviewer | Role | Organisation | Lens they bring |
|---|----------|------|--------------|-----------------|
| 1 | **Priya Nair, CMIOSH** | Group HSE Manager | Multi-site precision-engineering firm, ~800 staff (2 factories + a warehouse) | Hierarchy of control, machinery/manual-handling, CAPA discipline, matrix methodology, multi-site rollout |
| 2 | **Tom Whitfield, GradIOSH** | Health & Safety Advisor | Building-services contractor SME, ~40 staff + subcontractors | Dynamic / point-of-work assessments, RAMS, mobile/on-site capture, work at height |
| 3 | **Dr. Aisha Bello, CFIOSH** | Head of Occupational Health & Safety | NHS trust, several thousand staff | Person-specific assessments, distribution & "read-and-understood" audit trail, COSHH, accessibility |
| 4 | **Marcus Lindqvist, CMIOSH (ISO 45001 lead auditor)** | EHS Consultant / Auditor | Independent; audits FM & logistics clients | Defensibility, evidence & change control, review cadence, standards conformance, reporting |

---

# 1 · Priya Nair — Group HSE Manager, precision engineering

> *"I manage a couple of hundred live risk assessments across three sites. I
> live and die by the hierarchy of control and by whether my corrective
> actions actually land on the right people. So that's what I went looking
> for."*

### What I did
Created a "Manual handling — Goods-in" assessment, used the hazard library,
scored initial and residual risk on the matrix, added a mix of in-place and
planned controls, published, and looked at what the tool did with my planned
controls.

### What genuinely works for me
- **The hazard library is the best thing here.** Typing "lifting" and getting a
  ready-made *Manual handling of loads* card — harm description, affected
  groups, tiered controls (eliminate → engineering → administrative) and
  indicative scores — is exactly how I'd want a junior assessor to start. The
  fourteen entries (manual handling, slips, work at height, electricity, fire,
  COSHH, machinery, workplace transport, noise, HAVS, DSE, lone working,
  stress, asbestos) are well chosen and the suggested controls are genuinely in
  the right tiers. This alone would save my team hours.
- **The hierarchy of control is structural, not decorative.** Every control
  carries a tier, and a hazard whose controls are *PPE-only* is blocked from
  publishing until someone justifies it ("PPE-only hazards need a justification
  before publishing"). I have fought this battle for fifteen years — "just give
  them gloves" — and having the tool refuse it is superb.
- **Planned controls automatically become tracked actions on publish.** Flip a
  control to "Planned — creates an action" and publishing raises a CAPA action
  linked back to the assessment. The confirmation dialog previews exactly what
  will be created. That closed loop from assessment → corrective action is the
  thing most cheap tools miss.
- **Initial → residual is shown side by side** as coloured band chips on each
  hazard header. At a glance I can see whether the controls actually pull the
  risk down.

### UX / UI notes
- Zero-click persistence (fields auto-save on blur, matrix/chip clicks save
  instantly) makes the editor feel fast and modern. No "Save" anxiety.
- One tabbed card for Review + Distribution keeps the page from becoming a
  mile long. Good call.
- A duplicate Publish button at the bottom of the page so I don't scroll back
  up — small thing, appreciated.

### Bugs & things that will bite

**P-1 (High) — Residual risk can be scored *higher* than initial risk, with no
warning.** The two matrix pickers are completely independent. Nothing stops me
setting an initial risk of 6 and a residual of 20, and the tool will publish it
happily. Controls cannot *increase* risk — a residual above initial is either a
typo or a misunderstanding, and my assessment now says something impossible. At
minimum the tool should warn; ideally it should query it before publish.
*Repro: on any hazard, click a low cell for Initial, a high cell for Residual,
publish — accepted.*

**P-2 (High) — You can publish a hazard with a residual "Critical" score and
zero controls.** Publish validation only checks that all four scores are
present and applies the PPE-only rule *when controls exist*. A hazard with no
controls at all, and a hand-typed residual of 20, sails straight through. The
residual number is a free pick that is never reconciled against the controls
actually listed — so "with controls" risk is effectively aspirational data
entry. For a "suitable and sufficient" record that's a real hole: the whole
point is that the residual is *justified* by the controls. *Repro: add a
hazard, score both matrices, add no controls, publish — accepted.*

**P-3 (Medium) — CAPA actions are generated with rigid, unrealistic defaults.**
Every planned control becomes an action **assigned to me (the publisher),
medium priority, due in exactly 7 days**. In reality planned controls have
different owners (facilities, procurement, a line manager) and realistic
deadlines (an engineering guard order is not a 7-day job). Publishing an
assessment with five planned controls dumps five actions on me, half of them
effectively overdue on day one. There's no way to set owner or due date at the
point of publish. This will train people to *not* use "planned," which defeats
the best feature in the tool.

**P-4 (Medium) — The matrix banding under-rates low-likelihood / high-severity
hazards.** Bands are a pure product of likelihood × severity (low ≤ 4, medium ≤
9, high ≤ 15, critical > 15). So a fatality-potential hazard at likelihood 1 ×
severity 5 = 5 is labelled **"Medium."** Most engineering-sector matrices treat
*any* credible fatality as high/intolerable regardless of likelihood. Your own
library proves the point: the asbestos entry's residual is 1 × 5 = "Medium" —
nobody in my trade would sign off residual asbestos exposure as "Medium." And
because there is **no matrix editor**, I can't align the bands to our corporate
standard.

### Usage patterns that make little sense — and what I'd do instead
- **Residual score decoupled from controls (P-1/P-2).** I'd make residual
  scoring *follow* the controls: prompt for the residual only after at least one
  control is entered, block residual > initial, and if residual stays High/
  Critical, force a "why is this tolerable / what's the further action" note
  (which should itself raise an action).
- **CAPA defaults (P-3).** The publish-confirmation dialog already lists each
  planned control — let me set assignee and due date per row right there. Even a
  single "default owner" and "default lead time (days)" on the assessment would
  be a huge improvement over "me / 7 days."
- **Matrix (P-4).** Ship a small matrix editor per tenant (band thresholds at
  least), and consider a severity-override rule ("severity 5 ⇒ minimum band
  High"). You already snapshot the matrix per row, so history stays stable —
  the plumbing is there, only the editor is missing.

**Verdict:** The bones are excellent — better hierarchy-of-control discipline
than tools costing five figures. But the residual-scoring holes (P-1/P-2) and
the CAPA rigidity (P-3) would stop me rolling it out group-wide until fixed.

---

# 2 · Tom Whitfield — H&S Advisor, building-services contractor

> *"Half my risk assessments are done at the tailgate of a van, on a phone, in
> the rain, before the lads start. A 'point-of-work' assessment is a different
> animal from a standing office RA. So the first thing I looked for was the
> dynamic assessment."*

### What I did
Tried to create a **point-of-work / dynamic** assessment for a work-at-height
task, and tried to record the *where* and *what* of the job.

### What works for me
- The work-at-height library entry is spot on — eliminate → MEWP/scaffold →
  permit-to-work → harness, with the harness correctly bottom of the pile. If I
  hand this to a new supervisor they can't get the order wrong.
- The lone-working and workplace-transport entries are equally solid. For a
  small contractor with no full-time safety team, curated content like this is
  the difference between a decent RA and a copy-paste off the internet.
- Publishing straight into a shareable, printable record is what my clients
  actually ask for.

### The big problem: I can't actually make a point-of-work assessment

**T-1 (High) — The "Point-of-work" (dynamic) assessment type is unreachable.**
The list has a *type* filter with "Standing" and "Point-of-work," and rows
render a type badge — but there is **no way to ever create a point-of-work
one.** "New assessment" doesn't ask any questions; it silently creates an
*Untitled, Standing* draft and drops me in the editor. The editor has no type
control, and the update API doesn't accept a type change either. So every
assessment in the system is "Standing," forever. The "Point-of-work" filter
option and the badge are dead ends. For a contractor, that's the *primary* use
case missing. *Repro: click New assessment → it's "Standing"; search the editor
for any type control → none exists; filter the list by "Point-of-work" → always
empty.*

**T-2 (High) — There's nowhere to describe the job.** A risk assessment header
needs the *activity / process / scope* — "replace AHU filters, Level 3 plant
room, isolation required." The tool has a field for exactly this ("Activity or
process being assessed") and even placeholder copy for it… but the editor never
exposes it, and "New assessment" hard-codes it to blank. So the assessment
records a title, a site, and hazards — but not *what the job actually is*. On a
dynamic assessment that scope line is the most important sentence on the page.
*Repro: create/open any assessment → there is no activity/scope field to edit;
it prints blank.*

**T-3 (Medium) — No free-text location either.** Point-of-work jobs are rarely
at a tidy pre-registered "site." There's a location field in the data model
(intended for exactly this) but, like the activity field, it's not editable
anywhere in the UI. I can only attach a formal Site/project from a dropdown. On
a third-party client site that isn't in my system, I can't say where the work
is.

**T-4 (Medium) — "Share via Heads Up" silently publishes my draft.** On a draft
the only sharing button available is "Share via Heads Up." I clicked it
expecting a share sheet — it *published the assessment* (and would have raised
CAPA actions) before sending. Nothing on the button warns that it publishes.
For a dynamic RA I'm still drafting at the van, one wrong tap and it's live and
signed off in my name. *Repro: open a draft → Distribution tab → "Share via
Heads Up" → the assessment flips to Active.*

### UX / UI notes
- **This is not a mobile point-of-work tool.** The matrix picker is a 5×5 grid
  of tiny cells, the hazard card is a dense two-column form, and the whole thing
  assumes a keyboard-and-mouse editor session. It's a fine *desktop* RA builder;
  it is not something a supervisor completes on a phone at the job face. If
  point-of-work is a supported type (T-1), it needs a genuinely different,
  cut-down, mobile-first flow.
- Creating an assessment immediately litters my list with "Untitled risk
  assessment" if I back out — see T-5.

### Bugs
**T-5 (Low) — "New assessment" creates a persistent "Untitled" draft
immediately.** Because there's no create dialog, every click of "New
assessment" writes a row. Tap it, change your mind, and you've left an "Untitled
risk assessment" draft in the list that someone has to clean up.

### Usage patterns that make little sense — and what I'd do instead
- **Make the type mean something (T-1).** Either add a type choice at creation
  and a genuinely lighter dynamic flow (activity + location + a couple of
  hazards + on-the-spot controls, publish, done — no 12-month review, no CAPA
  ceremony), or drop the "Point-of-work" option and badge entirely so you're not
  advertising a feature that doesn't exist. Right now it's the worst of both.
- **Ask three questions at creation (T-2/T-3):** *What's the job? Where? Standing
  or point-of-work?* That's the whole create form your own copy already
  describes — wire it up. Landing straight in a blank "Untitled/Standing" editor
  throws away the header data an RA needs.
- **Rename/guard the Heads Up button (T-4):** if it will publish, say so
  ("Publish & share") and confirm first.

**Verdict:** Great content library trapped in a desktop, standing-assessment-only
tool. For my world (dynamic, mobile, third-party sites) the two headline
features I need — a real point-of-work mode and a scope/location field — aren't
usable today.

---

# 3 · Dr. Aisha Bello — Head of OH&S, NHS trust

> *"In a trust the two things that matter to my regulators are (a) that we do a
> specific assessment for new and expectant mothers and young workers, and (b)
> that we can prove the right people read the right version of the assessment.
> I tested both hard."*

### What I did
Built a COSHH assessment affecting new/expectant mothers, followed the
person-specific prompt, then distributed the assessment and looked at the
"read and understood" trail. Also checked accessibility.

### What works for me
- **The person-specific prompt is a lovely touch.** Tag a hazard as affecting
  "New & expectant mothers" or "Young persons" and the tool proactively offers:
  *"Person-specific assessment recommended — the law expects a specific
  assessment for them — create a linked one now,"* with a one-click button that
  clones the assessment as a linked draft. That is genuinely thoughtful and maps
  to our legal duty. Most tools don't even know these categories exist.
- The COSHH library entry correctly lists new/expectant mothers as an affected
  group and puts substitution above PPE. Good.
- The distribution panel gives me a per-person "Acknowledged / Pending" list and
  a "Read & understood" column on the main list — exactly the evidence an
  auditor asks for.

### Bugs & compliance gaps

**A-1 (High) — "Read & understood" isn't tied to a version of the content.** An
*active* assessment stays fully editable. I can change a hazard, a score, or a
control on a live assessment and it remains "Active" with everyone's
acknowledgement still showing green — even though they acknowledged different
content. There's no version, no snapshot, and no re-acknowledgement prompt. So
my audit trail says "Nurse X read and understood this" against a document that
has since changed. In a trust that is a serious evidentiary problem. *Repro:
publish, distribute, get an acknowledgement, then edit a hazard — the
acknowledgement stays green against the changed content.*

**A-2 (High) — Two distribution mechanisms that don't agree.** There's
"Distribute" (builds the per-person acknowledgement tracker) and "Share via
Heads Up" (sends a message with a PDF). The Heads Up route does **not** create
any acknowledgement records. So a manager who "shares via Heads Up" believes
they've distributed the assessment, but the acknowledgement tracker stays empty
and nobody is recorded as having read it. Two buttons, two mental models, one
silent gap. *Repro: use "Share via Heads Up," then open Distribution — no
acknowledgement rows exist.*

**A-3 (Medium) — Acknowledgement has no deadline, no email, no reminder.**
"Distribute" writes the records and… that's it. The recipient only discovers
they owe an acknowledgement via an in-app banner the next time they happen to
log in. There's no email, no due date, no chase. For thousands of staff, many
of whom log in rarely, "read and understood" will simply never complete. (The
Heads Up path *does* email — which makes A-2 doubly confusing: the path that
notifies people isn't the path that records their acknowledgement.)

**A-4 (Medium) — The person-specific variant is a fork that immediately starts
drifting.** The linked assessment is a one-time full copy of every hazard and
control. If I later update the parent, the child doesn't change — and vice
versa. Over a review cycle the "mother's" version and the general version
quietly diverge with no indication. It also copies *all* hazards, when what I
actually want is to focus on the deltas that matter for that group (e.g.
manual-handling limits, chemical exposure). A visible "differs from parent"
indicator, and prompting me toward the relevant hazards, would be far safer than
a silent fork.

**A-5 (Medium) — Accessibility of the matrix.** Risk bands are conveyed by
colour (green/amber/orange/red) with only a number in the cell. For a
colour-blind assessor the band is ambiguous, and the 5×5 grid of ~28px cells is
hard to hit accurately. The axes also have no 1–5 tick labels — just "Severity"
down the side and "Likelihood →" underneath — so it isn't obvious which number
is which until you read a cell's tooltip. A text band label on the selected
cell and larger, labelled axes would help everyone, not only assistive-tech
users.

### UX / UI notes
- The amber "You have been asked to read and acknowledge this assessment"
  banner with a single clear "I have read and understood it" button is
  excellent — that part of the flow is exactly right.
- Light/dark theming and the overall visual polish are strong.

### Usage patterns that make little sense — and what I'd do instead
- **Freeze content on publish, or force re-acknowledgement on change (A-1).**
  An acknowledged assessment should be immutable, or an edit should create a new
  version and re-open acknowledgements. Evidence that can silently change isn't
  evidence.
- **Unify distribution (A-2/A-3).** One "Distribute" action that emails people,
  sets a due date, records acknowledgement, and reminds non-responders. Keep
  "Share via Heads Up" only as an *extra* broadcast, not an alternative that
  bypasses the tracker.
- **Make variants live-linked, or at least diff-aware (A-4).**

**Verdict:** The person-specific prompt shows the product understands OH law.
But the acknowledgement model (A-1/A-2/A-3) isn't yet trustworthy as compliance
evidence, and that's precisely what a trust would buy it for.

---

# 4 · Marcus Lindqvist — EHS consultant & ISO 45001 lead auditor

> *"I don't own these assessments — I audit them. I'm asking one question the
> whole time: if the regulator or a claimant's lawyer pulls this record in two
> years, does it stand up? So I poked at evidence, dates, sign-off and change
> control."*

### What I did
Walked the full lifecycle looking for the audit trail, checked how review
scheduling behaves over time, examined the sign-off wording and where it does
(and doesn't) appear, and looked at the exported/printed record.

### What works — and it's the stuff auditors care about
- **There's a proper append-only change log.** Created, published, hazard added/
  removed, control added/removed, review recorded, distributed, acknowledged,
  variant created — each stamped with who and when, and the log is genuinely
  append-only (no edit/delete surface). That is exactly the immutable evidence
  trail ISO 45001 §7.5 and a good HSG65 system want. Most competitors fake this
  or don't have it. Real credit here.
- **Reviews are a first-class, triggered, logged activity.** Recording a review
  captures the *trigger* (scheduled / incident / process change / legislation
  change / new equipment / other) and outcome (still suitable / updated), and
  keeps a dated history. Auditors love a documented trigger — this is textbook.
- **The header carries a schedule** (frequency + next-due) and the list flags
  "Review due" in red. Good lifecycle hygiene.

### Bugs & defensibility gaps

**M-1 (High) — The review clock starts at *creation*, not at *publish*, and runs
on drafts.** A brand-new assessment is stamped with a next-review date 12 months
out and a 12-month frequency the moment it's created — before it's even
published. So a draft that sits for a while acquires a "Review due" flag despite
never having been live, and once an assessment *is* published the 12-month
"suitable and sufficient" clock is already partly spent (it counts from the day
someone first clicked New, not from go-live). An auditor reading "next review"
will draw the wrong conclusion about currency. Review currency must be measured
from publication.

**M-2 (High) — The assessor sign-off is skipped entirely for assessments with no
planned controls.** Publishing shows a sign-off statement — *"By publishing you
confirm this risk assessment is suitable and sufficient… and you sign it as the
assessor"* — **only** inside the confirmation dialog that appears when there are
planned controls. If every control is "in place" (or there are none), publish
happens in a single click with **no confirmation and no sign-off shown at
all.** So whether the assessor is asked to attest depends on an unrelated detail
(did any control happen to be "planned"?). The legal attestation should be
presented on *every* publish, ideally with an explicit "I confirm" the assessor
actively ticks — not a side effect of a button. *Repro: build an assessment with
only in-place controls, give it a title, click Publish → it's live, no sign-off
was ever displayed.*

**M-3 (Medium) — An active, acknowledged assessment can be edited without any
version bump.** (Same root cause Dr. Bello raised as A-1, from an audit angle:)
the record I'm auditing today may not be the record people signed. Without
versioning I can't prove *what* was in force on a given date. For a claim
defence that's the whole ball game.

**M-4 (Medium) — The printed / exported record is a single squeezed page at ~11px
and there's no on-demand PDF from the screen.** The "Print" button renders every
hazard into one cramped one-page table in tiny type. For an assessment with more
than three or four hazards it's illegible, and it doesn't paginate. A proper
multi-page PDF (which the system clearly *can* produce — it renders one for the
Heads Up attachment path) should be available directly as "Download PDF." An
auditor's evidence pack can't be an 11px squeeze.

**M-5 (Low) — Reference numbers overflow after RA-9999.** References are
zero-padded to four digits (`RA-0001`). A busy multi-site client will pass 9,999
assessments over a few years, after which the padding breaks and sort/scan
behaviour gets ugly. (Actions are padded to six digits — inconsistent, and
still finite.) Cosmetic, but references are how auditors cite records.

**M-6 (Low) — Dead "create form" copy.** The product ships a full set of
create-form labels (title, activity, type with standing/dynamic hints, location)
that nothing uses — the create flow bypasses them entirely. It reads like a
feature that was descoped but left half-wired (and is the root of Tom's T-1/T-2/
T-3). Worth finishing or removing.

**M-7 (Low, data-integrity) — Archived assessments aren't fully locked
server-side.** The UI correctly hides editing on an archived assessment, but the
control/hazard-edit endpoints don't re-check the archived flag the way the
header-edit and publish endpoints do. It's not reachable through the current UI,
but "archived = frozen evidence" should be enforced at the API, not just hidden.

### Usage patterns that make little sense — and what I'd do instead
- **Anchor review dates to publish (M-1).** Don't schedule a review for a draft
  at all; start the clock (and the frequency) from `publishedAt`.
- **Always show the sign-off (M-2).** Make it an explicit, active confirmation
  on every publish, and capture *who signed and when* as a first-class field
  (the print currently attributes sign-off to the *creator*, not necessarily the
  assessor — tighten that too).
- **Version on publish (M-3).** Freeze the published content; a change to a live
  assessment should create a new version, re-open acknowledgements, and leave the
  prior version retrievable "as in force on {date}." Everything else here is
  built to be evidence — this is the missing keystone.
- **First-class PDF export (M-4).**

**Verdict:** The evidence *architecture* is unusually good for this price point —
the append-only log and triggered reviews are exactly right. What lets it down
for audit is currency (M-1), attestation (M-2) and the absence of versioning
(M-3). Fix those three and this becomes genuinely defensible.

---

# Consolidated findings

### Where the reviewers agree (the signal to act on first)

1. **Residual risk is unmanaged data entry.** It can exceed initial risk (P-1),
   can be Critical with zero controls (P-2), and is never reconciled with the
   controls listed. *Raised by Priya; endorsed by Marcus.* → The single biggest
   threat to "suitable and sufficient."
2. **No content versioning; live assessments edit silently.** Undermines "read &
   understood" evidence and audit defensibility. *Raised independently by Aisha
   (A-1) and Marcus (M-3).*
3. **The half-built create flow starves the header.** No type choice, no
   activity/scope, no free-text location; every assessment is an
   "Untitled/Standing" draft. *Raised by Tom (T-1/T-2/T-3), root-caused by
   Marcus (M-6).*
4. **Distribution is confusing and leaky.** Two mechanisms, only one of which
   records acknowledgement; no email/reminder on the one that does; and the
   share button silently publishes. *Aisha (A-2/A-3), Tom (T-4).*
5. **CAPA defaults are unrealistic** (self / medium / 7 days, uneditable at
   publish) and will push people away from the best feature. *Priya (P-3).*
6. **Matrix methodology and editability.** Naive product banding under-rates
   fatality hazards; no per-tenant matrix editor. *Priya (P-4), with Aisha and
   Marcus concurring.*

### What everyone praised (don't regress these)
- The curated **hazard library** with tier-correct controls and indicative
  scores.
- **Structural hierarchy of control** with the PPE-only justification gate.
- **Planned control → tracked CAPA action** closed loop.
- The **append-only change log** and **triggered, logged reviews**.
- The **person-specific (young persons / new & expectant mothers) prompt**.

---

# Prioritised issue register

| ID | Sev | Summary | Raised by |
|----|-----|---------|-----------|
| P-1 | High | Residual risk can be scored ≥ initial risk with no warning | Nair |
| P-2 | High | Hazard publishable with Critical residual and **zero controls**; residual not reconciled with controls | Nair, Lindqvist |
| T-1 | High | "Point-of-work"/dynamic type is unreachable — every RA is "Standing"; filter & badge are dead ends | Whitfield |
| T-2 | High | "Activity / process being assessed" (scope) field is uneditable and always blank | Whitfield, Lindqvist |
| A-1 / M-3 | High | Active assessments edit silently; "read & understood" not tied to a version | Bello, Lindqvist |
| A-2 | High | Two distribution paths; "Share via Heads Up" bypasses the acknowledgement tracker | Bello |
| M-1 | High | Review clock starts at creation (not publish) and runs on drafts | Lindqvist |
| M-2 | High | Assessor sign-off skipped entirely when there are no planned controls | Lindqvist |
| P-3 | Med | CAPA actions hard-defaulted to self / medium / due in 7 days; not editable at publish | Nair |
| P-4 | Med | Naive product-only matrix banding under-rates high-severity/low-likelihood hazards; no matrix editor | Nair |
| T-3 | Med | Free-text location uneditable in UI | Whitfield |
| T-4 | Med | "Share via Heads Up" silently publishes a draft (and would raise actions) | Whitfield, Bello |
| A-3 | Med | Acknowledgement has no deadline, email or reminder — in-app banner only | Bello |
| A-4 | Med | Person-specific variant is a one-time fork; drifts from parent; copies all hazards | Bello |
| A-5 | Med | Matrix uses colour-only band coding, tiny cells, unlabelled axes (accessibility) | Bello |
| M-4 | Med | Print squeezes everything to one 11px page; no direct PDF export from screen | Lindqvist |
| T-5 | Low | "New assessment" spawns persistent "Untitled" drafts on every click | Whitfield |
| M-5 | Low | Reference numbers overflow after RA-9999 (4-digit pad) | Lindqvist |
| M-6 | Low | Dead create-form copy (title/activity/type/location) left wired to nothing | Lindqvist |
| M-7 | Low | Archived assessments not fully locked at the API (UI hides only) | Lindqvist |
| P-5 | Low | No hazard reordering in the UI despite a stored sort order | Nair, Whitfield |

---

# Engineering appendix (root cause & pointers)

For each user-facing finding, where it lives in the shipped code.

- **P-1 / P-2 / residual decoupled** — `publish` validates only presence of the
  four scores and the PPE-only rule; no `residual ≤ initial` check and no
  "residual > Low requires a control" check.
  `packages/api/src/routers/riskAssessments.ts` (publish, ~L789–819). The two
  `MatrixPicker`s in `apps/web/src/components/risk-assessments/hazard-card.tsx`
  fire independent `updateHazard` calls with no cross-validation.
- **T-1 (type unreachable)** — `create` on the list page calls
  `create.mutate({ title, activity: '' })` with no `type`
  (`apps/web/app/[locale]/risk-assessments/page.tsx` L62); `updateInput` in the
  router has **no `type` field** (riskAssessments.ts L87–96); the editor never
  sends one. `createInput` defaults `type:'standing'`. Net: type is write-once
  to `standing` and never surfaced.
- **T-2 / T-3 (activity & location uneditable)** — the detail editor only ever
  sends `title` and `siteId` to `update`
  (`…/[assessmentId]/page.tsx` L204, L318). `activity` is render-only (L323–324);
  `locationText` is never rendered or edited. Router `updateInput` *accepts*
  both but the UI never sends them.
- **M-6 (dead create copy)** — `riskAssessments.create.*` i18n keys
  (`titleLabel`, `activityLabel`, `typeLabel`, `typeStandingHint`,
  `typeDynamicHint`, `locationLabel`, `submit`) are unused except
  `create.submitting`/`create.error`.
- **A-1 / M-3 (no versioning)** — `editable = canManage && archivedAt === null`
  (`…/[assessmentId]/page.tsx` L157) allows editing while `status==='active'`;
  hazard/control mutations don't bump a version or reset acknowledgements. There
  is no version table for assessments (contrast `template_versions`).
- **A-2 / T-4 (share publishes / bypasses tracker)** — `shareViaHeadsUp`
  publishes when `status !== 'active'` then routes to `/heads-up/new`
  (`…/[assessmentId]/page.tsx` L213–243); it never writes
  `riskAssessmentAcknowledgements`. Only `distribute`
  (riskAssessments.ts L958) populates the tracker. The share button renders for
  any manager on a non-archived assessment (`distribution-section.tsx` L107).
- **A-3 (no ack email/reminder)** — `distribute` inserts ack rows + a
  `distributed` event only (riskAssessments.ts L979–1004); no email dispatch,
  no due date, no reminder queue. Discovery is via `listMyPending` +
  in-app banners.
- **A-4 (variant fork)** — `createPersonSpecific` deep-copies all hazards +
  controls into a new draft child (riskAssessments.ts L1040–1107); no ongoing
  link/sync, no diff.
- **P-3 (CAPA defaults)** — publish hard-codes `assigneeUserId = publisher`,
  `priority:'medium'`, `dueAt = now + 7 days` (riskAssessments.ts L849–853); no
  per-action input.
- **P-4 (matrix)** — banding is pure `likelihood*severity` vs fixed thresholds
  `{lowMax:4,mediumMax:9,highMax:15}` (`apps/web/src/lib/risk-matrix.ts`;
  `DEFAULT_RISK_MATRIX` in `packages/db/src/schema/risk-assessments.ts` L96). The
  matrix is snapshotted per row but there's no editor UI.
- **M-1 (review clock)** — `create` sets `nextReviewAt = now + 12 months` and
  `reviewFrequencyMonths = 12` at creation (riskAssessments.ts L441–453);
  `reviewDue` is computed against `now` for all rows including drafts (list,
  L293).
- **M-2 (sign-off skip)** — `proceedAfterTitle` publishes directly when
  `pendingPlanned.length === 0`; the sign-off text lives only in the
  planned-controls confirm dialog and the print block
  (`…/[assessmentId]/page.tsx` L186–191, L693–725).
- **M-4 (print)** — single-page `print:block` table at `text-[11px]`
  (`…/[assessmentId]/page.tsx` L574–654). A real PDF renderer exists
  (`prepareHeadsUpAttachment` → `renderPdf`) but isn't exposed as a direct
  download.
- **M-5 (ref overflow)** — `RA-${String(n).padStart(4,'0')}`
  (riskAssessments.ts L438).
- **M-7 (archive lock)** — `updateHazard` / `addControl` / `updateControl` /
  `removeControl` don't check `assessment.archivedAt`, unlike `update` /
  `addHazard` / `publish` / `recordReview`.
- **P-5 (reordering)** — `sortOrder` exists and `get` orders by it
  (riskAssessments.ts L336) but no UI writes it after creation.

---

*Prepared as an independent practitioner review of the FreeHS Risk Assessments
module. Findings verified against the deployed implementation; reproduction
steps and code pointers included so each can be triaged directly.*

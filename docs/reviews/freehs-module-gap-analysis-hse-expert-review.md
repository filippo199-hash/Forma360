# FreeHS — Module gap analysis

## What four HSE practitioners still can't do on the platform — and how much it matters

**Product:** FreeHS (freehs.software)
**Question asked of the panel:** *"Look at everything FreeHS ships today.
What parts of your safety management system still have no home here? For
each gap: how important is it, what do you use instead today, and what
would a good-enough first version look like?"*
**Purpose:** product-strategy input — how much of a real HSE function the
platform covers, and which missing areas are worth building.
**Date:** 3 August 2026

---

## Methodology & scope (read this first)

This is not a defect review. The four practitioners from the previous five
reviews were asked to map their *actual safety management systems* — the
full set of registers, processes and records they are legally and
operationally required to run — against what FreeHS ships on `main` today,
and to name what's left over. Every claim about what the platform does or
doesn't contain was verified against the codebase (the same standard as the
prior reviews); the roadmap claims (what's already planned vs not on the
radar) were verified against the permission catalogue, the build plan and
the module specification.

**The importance scale** (used consistently by all four):

| Rating | Meaning |
|---|---|
| **Blocker** | "I cannot move my organisation onto FreeHS as its safety system without this. Its absence forces me to keep another system, and that system — not FreeHS — becomes the system of record." |
| **Major** | "I'd need it within the first year. I'd adopt FreeHS anyway, but I'd run a parallel spreadsheet/tool and resent it." |
| **Useful** | "Would deepen the platform's value and stickiness; wouldn't change my buying decision." |
| **Marginal** | "Wouldn't influence me; fine as an integration or never." |

**Roadmap ground truth** (verified in-repo): `training.*` (4 keys) and
`analytics.*` (4 keys) are already forward-declared in the permission
catalogue — planned, unbuilt. A **Compliance** module (ISO-framework
evidence mapping) is specced at length in `docs/modules-overview.html` and
the build plan but has no permission keys yet. **Incident/accident
management — the panel's unanimous number-one gap — appears almost nowhere
in the roadmap** (three passing mentions of the word "incident" in the
spec, none as a module). The panel's strongest single message is that the
roadmap's ordering does not match their needs: the most important missing
module is the one not yet planned.

**What exists today** (the baseline the panel mapped against): templates &
inspections (+schedules, approvals, signature workflows), observations
(hazard/near-miss reporting incl. anonymous QR), actions (CAPA), heads-up
comms, risk assessments, COSHH (incl. narrow health surveillance), permit
to work, fire safety (FRA, logbook, doors, drills, PEEPs, marshals),
assets & maintenance, documents, contractors (directory, compliance docs,
visits, gate, portal), sites, settings, AI assistant.

---

## The reviewers

| # | Reviewer | Role | Organisation | What their SMS must cover |
|---|----------|------|--------------|---------------------------|
| 1 | **Priya Nair, CMIOSH** | Group HSE Manager | Precision engineering, ~800 staff, 3 sites | Machinery safety, occupational disease prevention, ISO 45001 certification, board reporting |
| 2 | **Tom Whitfield, GradIOSH** | H&S Advisor | Building-services contractor, ~40 staff | CDM duties, RAMS for every job, workforce tickets/cards, client prequalification |
| 3 | **Dr. Aisha Bello, CFIOSH** | Head of OH&S | NHS trust | Staff safety at scale, occupational health, violence & aggression, estates safety |
| 4 | **Marcus Lindqvist, CMIOSH** | EHS consultant / ISO 45001 lead auditor | FM & logistics clients | Whatever the standard demands: audits, compliance evidence, management review |

---

# 1 · Priya Nair — Group HSE Manager, precision engineering

> *"I listed every register and process in our safety manual and ticked off
> what FreeHS could hold. It covers my proactive, preventive side well —
> genuinely well. What's missing is almost everything that happens **after
> something goes wrong**, and everything I need to **prove people are
> competent** and to **report upward**."*

### What FreeHS already covers for me (credit first)
Risk assessments, COSHH, permits, fire — the four hard registers — plus
inspections, hazard reporting, CAPA actions, contractor compliance, asset
maintenance and document control. On the preventive side I'd estimate
FreeHS holds **70–75% of my SMS** today. The gaps cluster on the reactive
and assurance side.

### What's missing, in my order of importance

**1. Incident & accident management — BLOCKER.**
The single biggest hole, and it isn't a niche request — it's the module
every HSE platform is bought around. Observations capture hazards and near
misses (well, actually), but there is nowhere to record an **injury**: no
accident book, no injured-person record, no body-part/injury
classification, no lost-time tracking, no **RIDDOR** assessment and
submission trail, no **investigation workflow** (evidence, witness
statements, root cause / 5-why, contributing factors), no link from
investigation findings to the risk assessment that should be re-reviewed.
Today this lives in a separate incident system plus paper accident books —
which means *that* system, not FreeHS, is my system of record, and every
"review RA after incident" trigger (which FreeHS's own RA module supports!)
starts from data FreeHS can't see. **What good-enough looks like:**
incident record (person, injury, time/place, severity), RIDDOR
determination checklist with deadline tracking, a staged investigation
with evidence attachments and root cause, actions raised from findings
(via the existing actions engine), and automatic "post-incident review"
triggers pushed into RA/COSHH/FRA — the hooks for which already exist.

**2. Training & competence — BLOCKER.**
Verified: the permission keys already exist (`training.view/take/manage/
courses.manage`) — this is planned, and it should be next. My permits
module ticks "competence verified" as a self-declared checkbox (its own
ADR flags this as the gap); fire marshal training dates are typed by hand;
contractor tickets are PDFs in a folder. I need a **competence matrix**:
role → required training → who holds it → expiry → gap list, with
certificates attached, expiry chasing (the platform's worker/dedup pattern
is already proven), and — the real prize — **hard enforcement hooks**:
a permit type that *requires* in-date confined-space training for the
acceptor; a marshal record that reads from the matrix instead of a typed
date. Today: a 2,000-row spreadsheet only I understand.

**3. Analytics & board reporting — BLOCKER** (restating the platform
review's PF-5 as a product answer, not a bug). My directors ask five
questions a quarter: incident frequency, overdue-action trend, inspection
completion, audit findings status, training compliance. FreeHS can answer
none without five CSV exports. The needs-attention strips already compute
the right per-module numbers — they need one roof and a trend line.

**4. Statutory examinations (LOLER / PUWER / pressure systems) — MAJOR.**
My cranes, lifting tackle, compressors and LEV need *thorough examination*
records with certificates, competent-person details and statutory
intervals (6/12/14 months). Assets + maintenance get 80% of the way; what's
missing is the certificate as a first-class record with an expiry that
blocks ("do not use after…"), and the written-scheme linkage. **I'd accept
this as an Assets extension rather than a module** — the fire module's
"failed check stays red" pattern is exactly what an out-of-cert asset
needs.

**5. Occupational health & surveillance — MAJOR.**
COSHH now has health surveillance (good — and the pattern generalises).
But my noise, HAVS and DSE surveillance sits outside COSHH: audiometry
recalls, HAVS tiers, referrals, fitness-for-work restrictions. I need the
COSHH surveillance concept lifted into a general OH register with recall
scheduling and restricted-visibility records (medical confidentiality —
the document-visibility machinery could carry this).

**6. Audit management — MAJOR** (see Marcus for the full case; for me it's
about keeping ISO 45001 certification without a parallel tool).

**Useful:** environmental register (aspects/impacts, waste transfer notes
— we're ISO 14001 too); PPE issue register (could be an asset type);
safety committee/meeting records (could be Heads Up + documents).
**Marginal for me:** lone-worker monitoring (we'd integrate a dedicated
device service), wellbeing programmes, visitor management beyond
contractors.

**Verdict:** Build incidents, training and analytics and FreeHS covers
~90% of my SMS and becomes the system of record. Without incidents, it
stays the excellent *preventive* half of a two-system estate.

---

# 2 · Tom Whitfield — H&S Advisor, building-services contractor

> *"For a small contractor the SMS is four things: RAMS for every job,
> proof my lads hold the right tickets, an accident book that handles
> RIDDOR, and the paperwork pack that wins us work. FreeHS has none of the
> four as first-class things — and two of them decide whether I can buy
> it at all."*

### What FreeHS already covers for me
Inspections (superb in the field), permits (now genuinely good), hazard
reporting via QR, contractor management *of my subbies*, asset/plant
registers, documents. Maybe **55–60% of my SMS** — lower than Priya
because my core deliverables (RAMS, tickets) aren't registers, they're
*documents I produce and prove*.

### What's missing, in my order of importance

**1. RAMS / method-statement & SSOW builder — BLOCKER.**
Every job we win requires a Risk Assessment **and Method Statement** pack,
job-specific, issued to the client, briefed to the crew, signed. FreeHS
has the RA half (good) and permits can *link* a method statement document
— but there's no way to **write** one: no sequenced-steps builder, no
plant/materials/PPE sections, no revision control tied to the job, no
combined RAMS PDF, no briefing-signature capture at the task level.
Today: Word templates, and the RA gets retyped into Word to sit beside the
method statement — so FreeHS's RA module ends up a side quest. **Good
enough:** a method-statement builder (sequenced steps, linked RA, plant/
COSHH references pulled from the registers that already exist), one
combined RAMS PDF, and a "briefed & understood" signature flow — which is
literally the RA distribution + Heads Up signature machinery, repointed.

**2. Training / tickets & cards — BLOCKER.**
Same module Priya wants, different flavour: for me it's CSCS/ECS cards,
gas-safe, IPAF, PASMA, asbestos awareness, first aid — with expiry
chasing and a **wallet view my supervisor can show at a site induction**.
Clients demand a training matrix in every tender. Today: a spreadsheet +
a folder of scans, both stale.

**3. Incident & accident management incl. RIDDOR — MAJOR** (Blocker-adjacent).
We're small — incidents are rare — but when one happens it's existential:
RIDDOR deadlines, an investigation the client and insurer will read, and
the paper trail. I'd adopt without it (unlike Priya) but I'd be one
reportable injury away from regretting it.

**4. Client-facing prequalification pack (SSIP/CHAS-style) — MAJOR.**
The commercial reason a contractor buys an HSE platform: assembling the
evidence pack — policies, insurance, RAMS samples, training matrix,
accident stats — that wins work. FreeHS holds most of the raw material
already (documents, contractors, stats-if-analytics-existed); what's
missing is the **export**: a branded evidence pack / shareable portfolio.
Cheap to build once the pieces exist; disproportionate commercial value
to exactly the SMB segment FreeHS targets.

**5. Toolbox talks — USEFUL, mostly covered.**
Honest assessment: Heads Up with sign-off *is* 80% of a toolbox-talk tool.
What's missing is a content library (standard talks), a delivered-by/
attendees-present record, and it counting toward the training matrix.
An extension, not a module.

**6. Asbestos register — USEFUL.** We work in other people's buildings;
a register of *their* surveys we've been shown, with refurb/demolition
survey prompts, would be nice. The fire-safety module's building-record
pattern is the template. Not adoption-critical.

**Marginal for me:** compliance frameworks, environmental registers,
occupational health beyond HAVS basics (we buy OH as a service),
analytics beyond simple accident stats.

**Verdict:** I'm the segment where FreeHS's polish matters most and its
gaps bite hardest: no RAMS and no tickets means the two documents my
business runs on stay in Word and Excel. Build those two and I move
everything in; the platform already does the rest better than anything
at my price point.

---

# 3 · Dr. Aisha Bello — Head of OH&S, NHS trust

> *"A trust measures its safety system by what it does for **people** —
> the injured porter, the nurse with a needlestick, the staff member
> assaulted on a ward, the theatre tech under health surveillance. FreeHS
> today is strong on **premises and process** and nearly silent on
> **people**. That's the axis to build along."*

### What FreeHS already covers for me
Fire safety (now excellent — the strongest fit for my estates function),
COSHH with surveillance, permits for estates work, contractors at the
gate, PEEPs (genuinely rare and welcome), inspections, hazard reporting.
For **estates safety** maybe 80%; for my **whole OH&S function, closer to
50%** — the people-side modules don't exist.

### What's missing, in my order of importance

**1. Incident management — BLOCKER, with two NHS-specific dimensions.**
Everything Priya said, plus: (a) **sharps/needlestick injuries** — high
volume, source-patient/exposure workflow, OH follow-up — and (b)
**violence & aggression** — sadly among our most frequent incident types,
needing a security dimension (police involvement, flagging, support for
the affected staff member). I do *not* need patient-safety incident
management (that stays in the national systems) — staff H&S incidents
only, cleanly scoped. Without this module FreeHS cannot be my system of
record, full stop.

**2. Occupational health — BLOCKER.**
The largest people-gap: pre-placement screening outcomes, immunisation
status (EPP roles), health surveillance beyond COSHH (noise, HAVS,
skin), management referrals, fitness-for-work restrictions and
adjustments — all with **strict medical confidentiality boundaries**
(a visibility model stricter than anything in the platform today,
though the document-visibility engine shows the team can build one).
COSHH's surveillance flag-and-recall is the seed; it needs to grow into
a register that OH clinicians, not safety managers, operate.

**3. Training & competence — BLOCKER** — at trust scale this is
statutory-and-mandatory training compliance by ward and role (thousands
of people), feeding the same enforcement hooks as Priya's permits. Our
LMS holds courses; FreeHS needs the **compliance matrix and the
enforcement**, not the e-learning itself. An import/integration surface
would satisfy me; a course player would not add value.

**4. Water safety / legionella register — MAJOR.**
For estates, the sibling of the fire module and the strongest evidence
that FreeHS's *patterns* are ready: an L8 register is buildings ×
outlets × scheduled checks (temperature monitoring, flushing, tank
inspections) with failed-results-stay-red and a competent-person log —
**the fire-safety module with different check types**. I'd expect this
to be cheap relative to its value, and it's a differentiator no
SMB-priced competitor does well.

**5. Wellbeing / stress — USEFUL** (higher for me than the others):
stress risk assessments exist via the RA library already; what's missing
is aggregate signals and a support-pathway record. I'd take this as an
RA template pack + analytics view, not a module.

**6. Waste & environmental (clinical waste) — USEFUL** — consignment
and audit trail; could start as document + inspection templates.

**Marginal for me:** RAMS builder (we consume contractors' RAMS — the
*contractor document* machinery already holds them), prequalification
packs, asbestos register (we hold ours in the estates CAFM — though the
building-record pattern tempts me), lone-worker hardware (integrate).

**Verdict:** FreeHS is becoming the best premises-safety platform in its
class. To be a *health and safety* platform it must now build the people
side: incidents, occupational health, training. Two of those three
aren't on the roadmap today — that's the strategic correction I'd urge.

---

# 4 · Marcus Lindqvist — EHS consultant & ISO 45001 lead auditor

> *"I asked one question of every gap: when the auditor — me — arrives,
> which clause fails? Working backwards from ISO 45001, the missing
> modules aren't a wishlist; they're the difference between 'FreeHS
> supports your certification' and 'FreeHS is one of the tools you
> maintain alongside your certification'."*

### The clause-driven gap list

**1. Incident management — BLOCKER (clause 10.2).**
Non-auditable without it. Incident → investigation → root cause →
corrective action → effectiveness check is the exact loop clause 10.2
demands, and today the loop's first three steps have no home. Note the
platform already owns the *back half* (actions, with effectiveness
implicit in closure) — the module would complete an existing loop, not
start a new one. This is also why it must integrate with the Actions hub
properly from day one (the platform review's PF-2 is a precondition:
source links must resolve).

**2. Audit management — BLOCKER for certified clients (clause 9.2).**
An internal-audit *programme*: schedule by area/clause, findings with
classifications (NC major/minor, OFI), clause references, findings →
actions, and status across the 3-year cycle. Inspections are checklists
— close, but an audit needs clause mapping and a programme view.
Verified: the **Compliance module specced in `modules-overview.html`**
(framework → rules → auto-collected evidence → clause-to-evidence
traceability) is precisely the right design — it's written down and
unbuilt, with no permission keys yet. Between the spec's
compliance-evidence engine and a modest findings register, my clause
9.1/9.2 problems dissolve.

**3. Analytics & management review — BLOCKER (clauses 9.1/9.3).**
"Monitoring, measurement, analysis and evaluation" cannot be five CSVs.
Management review needs trend data (incidents, actions, audit findings,
training compliance) and objectives tracked against it. The
forward-declared `analytics.*` keys say the team knows.

**4. Legal register & evaluation of compliance — MAJOR (clause 6.1.3).**
A register of applicable legislation with periodic evaluation. Often
served by a content subscription; FreeHS needs at minimum the register
+ evaluation-cadence machinery (its review-cadence pattern, again) even
if the legal content itself comes from a partner.

**5. Training/competence — MAJOR from my seat (clause 7.2)** — the
records auditors sample most. (Blocker for my clients; Major for me only
because I audit rather than operate.)

**6. Objectives & programmes — USEFUL (clause 6.2)** — could be a thin
layer over actions with target dates and KPIs once analytics exists.

**What I'd tell the team NOT to build:** an LMS/course player (integrate
— the matrix is the value, content is a commodity); lone-worker hardware
(integrate); patient-safety/quality incident systems (regulated national
ecosystems); HR/absence (adjacent, not core); a generic BI tool (opinionated
HSE dashboards beat configurable chart builders at this price point).

**Verdict & the strategic read:** FreeHS has, unusually, built the
*hard* registers first — permits, fire, COSHH are where competitors are
weakest, and they're strong. The gaps are the *common* modules every
competitor has: incidents, audits, training, analytics. That's a
sequencing choice with a silver lining — the differentiators exist; what
remains is table stakes with well-understood shapes, and the platform's
own primitives (append-only events, review cadences, worker/dedup
discipline, the actions engine, snapshot-at-action) are exactly the
right foundations for all four.

---

# Consolidated demand matrix

Ratings: ● Blocker · ◕ Major · ◑ Useful · ○ Marginal

| Missing module | Priya (Engineering) | Tom (Contractor) | Aisha (NHS) | Marcus (Auditor) | Roadmap status today |
|---|---|---|---|---|---|
| **Incident & accident mgmt (+ RIDDOR, investigation)** | ● | ◕ | ● | ● | **Not planned** — 3 passing mentions, no module, no keys |
| **Training & competence matrix** | ● | ● | ● | ◕ | Keys declared (`training.*`), unbuilt |
| **Analytics / dashboards / management reporting** | ● | ◑ | ◕ | ● | Keys declared (`analytics.*`), unbuilt (= platform review PF-5) |
| **Audit & compliance frameworks** | ◕ | ○ | ◕ | ● | Specced in modules-overview.html, no keys |
| **Occupational health & surveillance** | ◕ | ○ | ● | ◑ | Not planned; COSHH surveillance is the seed |
| **RAMS / method-statement builder** | ◑ | ● | ○ | ◑ | Not planned; permits already link MS documents |
| Statutory examinations (LOLER/PUWER) | ◕ | ◕ | ◑ | ◑ | Not planned; best as Assets extension |
| Water safety / legionella register | ○ | ○ | ◕ | ◑ | Not planned; fire-safety pattern reusable |
| Prequalification / evidence pack export | ○ | ◕ | ○ | ◑ | Not planned; assembles existing data |
| Legal register & compliance evaluation | ◑ | ○ | ◑ | ◕ | Not planned; content likely via partner |
| Environmental (aspects, waste) | ◑ | ○ | ◑ | ◑ | Not planned |
| Toolbox talks | ○ | ◑ | ○ | ○ | ~80% covered by Heads Up already |
| PPE register | ◑ | ◑ | ○ | ○ | Coverable as an asset type |
| Wellbeing / stress programme | ○ | ○ | ◑ | ○ | RA templates + analytics view suffice |
| Asbestos register | ○ | ◑ | ○ | ○ | Building-record pattern reusable |
| Lone-worker monitoring | ○ | ◑ | ○ | ○ | **Integrate, don't build** (hardware market) |
| LMS / course content | ○ | ○ | ○ | ○ | **Integrate, don't build** |

### Coverage verdict, per persona (their own estimates)
- Priya: **~70–75%** of her SMS today → ~90% with incidents + training + analytics.
- Tom: **~55–60%** → the two blockers (RAMS, tickets) are his whole remaining gap.
- Aisha: **~80% of estates safety, ~50% of the whole OH&S function** — the people-side modules are the missing half.
- Marcus: certification-support today is partial; incidents + audits + analytics make FreeHS *auditable as the system of record*.

---

# Build recommendations

### Tier 1 — build as modules (unanimous or near-unanimous Blockers)
1. **Incident & accident management** — 3× Blocker, 1× Major, **and the
   only Tier-1 item not on the roadmap at all**. The panel's unambiguous
   message: this is the module HSE platforms are bought around, and its
   absence makes *another* product the system of record. It also
   completes loops FreeHS already half-owns: post-incident review
   triggers exist in RA/FRA; the actions engine is the back half of
   clause 10.2; ADR 0007 snapshots and append-only events are the right
   evidence primitives. Scope guard per Aisha/Marcus: staff H&S incidents
   only — not patient safety, not quality.
2. **Training & competence** — 3× Blocker. Already key-declared; already
   demanded by three shipped modules (permit competence self-ticks,
   marshal training dates, contractor tickets). The matrix + expiry
   chasing + enforcement hooks are the value; explicitly *not* an LMS.
3. **Analytics** — 2× Blocker, and the panel treats the platform-review
   finding (PF-5) as a product gap, not a bug: one opinionated HSE
   dashboard (incidents, overdue actions, inspection completion, training
   compliance, per-site comparison) + scheduled board pack. The
   needs-attention strips already compute most inputs.

### Tier 2 — build next (strong segment-specific demand)
4. **Audit & compliance** — Marcus Blocker, two Majors; the existing
   spec in `modules-overview.html` is the right design — promote it.
5. **Occupational health** — Aisha Blocker, Priya Major; generalise the
   COSHH surveillance pattern; requires a stricter confidentiality
   visibility model (flagged as the hard part).
6. **RAMS / method-statement builder** — Tom Blocker; for the contractor
   segment this plus training is the entire buying decision. Reuses RA
   content, permits linkage, Heads Up signatures, render pipeline.

### Tier 3 — extensions of existing modules, not new modules
- **Statutory examinations** → Assets (certificate record + "out of cert
  stays red", per the fire pattern).
- **Legionella/water safety** → clone the fire-safety calendar shape.
- **Prequalification pack export** → a render/export over existing data;
  small build, outsized SMB-commercial value (Tom).
- **Toolbox talks** → Heads Up + content library + attendance capture,
  feeding the training matrix.
- **PPE** → asset type; **wellbeing** → RA template pack + analytics
  view; **asbestos register** → building-record pattern, later.

### Don't build — integrate or decline
Lone-worker hardware/monitoring; LMS course content; patient-safety
(Datix-class) systems; HR/absence; generic BI. The panel was unanimous
that focus beats breadth here.

### Two cross-cutting preconditions the panel attached
- **Fix the Actions hub first** (platform review PF-2/PF-4): every Tier-1
  module fans into actions; if source links don't resolve and nobody is
  notified, new modules amplify an existing weakness.
- **Every new module ships with its worker** (reminder/escalation with
  the established dedup pattern) **and its search/AI/analytics
  registration** — the platform review showed what happens when modules
  outrun the chrome.

---

# Appendix — why these builds are cheaper than they look

Evidence that the platform's primitives already fit the Tier-1/2 shapes:

- **Permission scaffolding:** `training.*` (catalogue.ts:129-132) and
  `analytics.*` (catalogue.ts:123-126) keys exist and are already granted
  by the seeded sets; only `incidents.*`, `audits.*`, `oh.*` keys would be
  new (catalogue append + seed backfill — noting the platform review's
  finding that a backfill migration mechanism is needed anyway, PF-8).
- **Compliance module design already written:**
  `docs/modules-overview.html` (framework → rules → auto-evidence →
  clause traceability, with worked ISO 45001 scenarios).
- **Evidence primitives:** append-only event logs (permits, fire, RA,
  actions, issues), ADR 0007 access/state snapshots, review-cadence +
  trigger pattern (RA/FRA reviews; COSHH SDS clocks) — an incident
  investigation and an audit finding are both "evidence + staged workflow
  + cadence", shapes the codebase builds well.
- **Worker discipline:** the dedup/cap/quiet-when-clean reminder pattern
  (`ra-ack-reminder`, `permit-expiry-watch`, `fire-due-digest`,
  `contractor-doc-reminder`) is exactly what training-expiry, statutory-
  exam, OH-recall and audit-programme chasing need — contingent on fixing
  the template-registry blocker (platform review PF-1).
- **Render pipeline:** inspection/permit/RA/FRA PDFs already exist; RAMS
  packs, incident reports, audit reports and board packs are the same
  machinery with new layouts.
- **Distribution & sign-off:** RA distribution + Heads Up signature
  invalidation are the "briefed & understood" flow RAMS and toolbox talks
  need.
- **The calendar engine:** fire-safety's profile-seeded, failed-stays-red
  statutory calendar is directly reusable for legionella, statutory
  examinations and OH recalls.

---

*Prepared as an independent practitioner gap analysis of the FreeHS
platform, following five prior reviews (four modules + whole-platform).
Coverage claims verified against the shipped implementation on `main`;
roadmap-status claims verified against the permission catalogue, build
plan and module specification.*

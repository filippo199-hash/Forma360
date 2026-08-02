# FreeHS — COSHH capability

## Independent review by four HSE practitioners

**Product:** FreeHS (freehs.software)
**Subject reviewed:** COSHH (Control of Substances Hazardous to Health) capability
**Where it lives today:** the *"Hazardous substances (COSHH)"* entry in the
hazard library inside the **Risk Assessments** module (there is no standalone
COSHH module)
**Date:** 2 August 2026

---

## Methodology & scope (read this first)

The four practitioners from the Risk Assessments review were asked a single
question: *"If I had to run my COSHH programme on FreeHS, could I — and where
would it fall down?"*

**Key finding up front — there is no dedicated COSHH module.** A full-repository
search (tRPC routers, web routes, database schema, permission catalogue, brand
module catalogue, product docs and build plan) found "COSHH" in exactly one
place: a single template in the Risk Assessments hazard library. FreeHS's only
brand-only module is `riskAssessments`; there is no substance register, no
Safety Data Sheet store, no exposure/health-surveillance data model, and COSHH
is not on the documented roadmap. So a COSHH assessment in FreeHS today *is* a
generic five-step risk assessment with one library row pre-filled.

This report is therefore a **capability & gap review**: (a) how well FreeHS
supports a COSHH assessment right now, (b) where it falls short of what COSHH
(Control of Substances Hazardous to Health Regulations 2002, as amended) and a
competent chemical-safety programme actually require, and (c) what a dedicated
COSHH module would need. As before, the live app is behind an authenticated
login wall (anonymous request → HTTP 403) and no browser automation was
available, so findings are verified against the **shipped implementation** —
the hazard-library entry, the Risk Assessments router/editor, the matrix logic
and the on-screen copy — with reproduction steps and code pointers in the
Engineering appendix.

Product-defect severities: **High** (defeats a legal COSHH duty or blocks the
core task), **Medium** (works but pushes users into non-compliant practice or
is confusing), **Low** (polish / edge case). COSHH-specific findings are
numbered **C-n**; where an inherited Risk Assessments defect bites COSHH
especially hard it is cross-referenced by its original ID (P-/T-/A-/M-).

---

## The reviewers

Same four practitioners as the Risk Assessments review, re-focused on the
chemical-safety angle each sees most of.

| # | Reviewer | Role | Organisation | COSHH lens |
|---|----------|------|--------------|------------|
| 1 | **Priya Nair, CMIOSH** | Group HSE Manager | Precision-engineering firm, ~800 staff | Solvents/degreasers, welding fume, LEV & its statutory testing, control banding |
| 2 | **Tom Whitfield, GradIOSH** | H&S Advisor | Building-services contractor, ~40 staff | Silica & wood dust, adhesives/resins, SDS on site, point-of-work chemical use |
| 3 | **Dr. Aisha Bello, CFIOSH** | Head of OH&S | NHS trust | Carcinogens/cytotoxics (CMR), sensitisers (glutaraldehyde, latex), biological agents, health surveillance, new/expectant mothers |
| 4 | **Marcus Lindqvist, CMIOSH (ISO 45001 lead auditor)** | EHS consultant / auditor | FM & logistics clients | COSHH Reg 6 conformance, SDS currency, WEL/EH40 evidence, surveillance & LEV-test records |

---

# 1 · Priya Nair — Group HSE Manager, precision engineering

> *"We run parts washers, degreasers, cutting fluids and a welding bay. My COSHH
> file is dozens of substances, each with a data sheet, an exposure limit and a
> ventilation control that has to be tested. I went looking for the substance
> and the ventilation."*

### What I did
Created a risk assessment, pulled the *"Hazardous substances (COSHH)"* entry
from the hazard library, and tried to build it into a real COSHH assessment for
a solvent degreaser served by local exhaust ventilation (LEV).

### What genuinely works for me
- **The library entry is a credible generic starting point.** It pre-fills the
  right harm language ("dermatitis, respiratory sensitisation, chemical burns,
  long-term ill health"), the right affected groups (including new & expectant
  mothers), and — crucially — controls in the correct hierarchy order:
  **substitute** a less hazardous product → **engineering** (LEV / ventilated
  areas) → **administrative** (COSHH assessments, SDS, exposure monitoring) →
  **PPE** (gloves and eye protection *per the safety data sheet*). For a generic
  chemical hazard that ordering is exactly right, and substitution being on top
  is the COSHH message I most want reinforced.
- **The PPE-only justification gate is very COSHH-relevant.** COSHH is explicit
  that PPE is the last resort; the tool refusing to publish a substances hazard
  controlled by gloves alone (without a written justification) enforces the law
  better than most dedicated tools.

### The COSHH-specific gaps

**C-1 (High) — There is no substance register.** A COSHH assessment is
organised *by substance and task*: parts-wash solvent, MIG welding fume, cutting
fluid mist, each with its own data. FreeHS gives me one generic "Hazardous
substances" hazard row with a free-text harm box. I cannot record the substance
name, supplier, form (liquid/dust/mist/fume/gas), quantity, or where it's used.
My COSHH inventory — the backbone of the whole programme — has nowhere to live.

**C-2 (High) — I can't attach or manage a Safety Data Sheet.** Every COSHH
assessment is built *from* the SDS. There is no way to attach an SDS to a
hazard/substance, and no way to record its revision date so I know it's current.
(The product has a Documents module, but it isn't linked to risk assessments or
substances.) An auditor's first question — "show me the data sheet for this" —
has no answer in the tool.

**C-3 (Medium) — LEV is a control word, not a managed control.** I can type
"Local exhaust ventilation" as an engineering control, but COSHH Reg 9 requires
that LEV is **thoroughly examined and tested (TExT) at least every 14 months**,
with records kept. There's no link between a listed engineering control and a
maintenance/examination schedule (the product *has* a maintenance module — it's
just not connected). So the tool records that I *have* LEV but nothing about
whether it still works.

**C-4 (Medium) — Scoring is a generic likelihood × severity guess, not
exposure-based.** COSHH control decisions come from exposure — the substance's
hazard band, how dusty/volatile it is, how much and how long (HSE's "COSHH
essentials"/control-banding approach), measured against a **Workplace Exposure
Limit (WEL, EH40)**. FreeHS asks me to hand-pick a 1–5 likelihood and severity
on a matrix. There is no field for the WEL, the route of exposure, or any
measured/estimated exposure, so the "risk" number is subjective and
unauditable.

**C-5 (Medium) — One generic template can't represent a real chemical
inventory.** Cleaning chemicals, welding fume, wood dust, silica and solvents
have completely different limits and controls, but there's a single "Hazardous
substances" library entry. Assessors will either lump everything into one row
(useless) or hand-build each — losing the whole benefit of the library.

### Usage patterns that make little sense — and what I'd do instead
- **Model the substance, not just the hazard (C-1/C-2).** A COSHH assessment
  should start from a substance record — name, supplier, SDS (with revision
  date), CLP hazard class, form, quantity, WEL — and the hazard/controls hang
  off that. Even a lightweight "substance" sub-entity on the assessment would
  transform this.
- **Wire engineering controls to maintenance (C-3).** When a control is LEV (or
  any tested control), let me attach the 14-month examination schedule from the
  maintenance module. The plumbing exists on both sides.
- **Offer control banding, not just a blank matrix (C-4).** Ask hazard band +
  amount + dustiness/volatility and suggest the control approach, the way HSE's
  COSHH essentials does.

**Verdict:** As a *generic* hazard, the substances template is well built and the
hierarchy discipline is excellent. As a *COSHH tool* it's missing the two things
a COSHH assessment is made of — the substance and its data sheet — plus the link
to LEV testing. Today I'd keep my COSHH register in a spreadsheet and use FreeHS
only for the task-level risk assessment.

---

# 2 · Tom Whitfield — H&S Advisor, building-services contractor

> *"On site it's silica from cutting, wood dust, two-pack resins, expanding foam,
> jointing compounds. The data sheet needs to be in the operative's hand before
> he opens the tin. That's the test I applied."*

### What I did
Tried to produce a point-of-work COSHH assessment for cutting blockwork
(respirable crystalline silica) and to get the data sheet and controls to the
operative on site.

### What works for me
- The generic entry's controls translate reasonably to site work: substitute
  (low-dust products), engineering (on-tool extraction / water suppression maps
  to "LEV / ventilated areas"), administrative (COSHH assessment, monitoring),
  PPE (RPE/gloves). The ordering nudges operatives away from "just wear a mask."
- The harm wording (respiratory disease, dermatitis) is honest and readable —
  operatives will understand it.

### The COSHH-specific gaps

**C-6 (High) — There's no point-of-work COSHH assessment, because there's no
point-of-work assessment at all.** Site COSHH is dynamic — different product,
different tin, different day. But (as in the Risk Assessments review, **T-1**)
the "Point-of-work" type is unreachable: every assessment is a "Standing" one,
built in a desktop editor. There is no fast, mobile, at-the-task chemical
assessment. For a contractor that's the main COSHH use case, missing.

**C-7 (High) — No Safety Data Sheet on site (C-2 from the operative's side).**
The one document that must reach the operative — the SDS — can't be attached to
the assessment, so it can't travel with it. "Share via Heads Up" sends a PDF *of
the assessment*, not the data sheets. Cross-reference **T-4**: that same share
button also silently publishes the draft.

**C-8 (Medium) — No respirable dust / RPE face-fit dimension.** Silica and wood
dust are about respirable dust exposure and correctly fitted RPE (with
face-fit-test records and a defined assigned protection factor). None of that
can be recorded — RPE is just "PPE" free text like any glove.

**C-9 (Medium) — Nowhere to describe the substance, the quantity or the
location.** Same root as **C-1** plus the Risk Assessments **T-2/T-3**: the
activity/scope and free-text location fields aren't editable in the UI, so I
can't even write "cutting 100 blocks, plant room B, no water available." On a
transient site that context is the assessment.

### UX / UI notes
- This is a desktop document builder, not a site tool. A supervisor will not
  complete a chemical assessment on a phone at the cutting station with a 5×5
  matrix grid and a two-column form.
- For a 40-person firm, hand-building each substance from the single generic
  template (no per-substance library, C-5) is more work than the paper system it
  would replace.

### Usage patterns that make little sense — and what I'd do instead
- **A real point-of-work COSHH flow (C-6):** pick the product (from a substance
  list with its SDS), confirm the task and controls, publish, done — on a phone,
  with the SDS attached and shareable.
- **Attach the SDS and let it travel (C-7):** an assessment shared to the crew
  should carry its data sheet(s), not just a PDF of itself.
- **Treat RPE as more than "PPE" (C-8):** capture RPE type, APF and face-fit
  status when respiratory exposure is the hazard.

**Verdict:** The content is sound but the delivery model is wrong for site COSHH:
no point-of-work mode, no data sheet in the operative's hand, no substance/RPE
detail. Good for writing a standing COSHH assessment at a desk; not for managing
chemical work on site.

---

# 3 · Dr. Aisha Bello — Head of OH&S, NHS trust

> *"Healthcare COSHH is the hard end — glutaraldehyde and formaldehyde
> sensitisers, cytotoxic drugs that are carcinogens, latex, and biological
> agents. Two duties dominate: classify the substance correctly, and put people
> under health surveillance. I tested both."*

### What I did
Built a substances assessment for a respiratory sensitiser affecting new &
expectant mothers, tried to flag it as a carcinogen/sensitiser, and looked for
health surveillance and biological-agent handling.

### What works for me
- **The person-specific prompt fires for chemical hazards too.** Because the
  library entry lists *new & expectant mothers* as an affected group, tagging the
  hazard triggers the recommendation to create a linked person-specific
  assessment — which is exactly right for reprotoxic and sensitising substances.
  That legal nudge is genuinely good and rare in the market.
- The harm text naming **respiratory sensitisation** and **dermatitis** shows the
  product understands the two classic COSHH ill-health routes.

### The COSHH-specific gaps

**C-10 (High) — No hazard classification (CLP/GHS), so the tool can't tell a
sensitiser or carcinogen from a mild irritant.** COSHH treatment is driven by
classification — H-statements, signal word, pictograms, and above all the CMR
(carcinogen/mutagen/reprotoxin) and respiratory-sensitiser categories. There's
no field to record any of it. Everything is "Hazardous substances," scored on
the same generic 1–5 matrix. The single most important COSHH data point — *what
kind of hazard is this substance* — cannot be captured.

**C-11 (High) — No health surveillance (COSHH Reg 11).** Respiratory
sensitisers, skin sensitisers, carcinogens and several other agents require
health surveillance with individual records kept for **40 years**. FreeHS has no
concept of health surveillance — I can't flag that a substance requires it,
can't record who is under it, can't schedule the recall. The review cadence on
an assessment is a single annual date (and, per **M-1**, it even starts from
creation). This is a categorical gap for a healthcare (or any exposure-heavy)
employer.

**C-12 (High) — Carcinogens/mutagens (CMR) get no special handling.** COSHH
requires CMRs to be reduced to *as low as reasonably practicable*, with extra
provisions (closed systems, designated areas, specific records). The tool can't
mark a substance as a CMR, so cytotoxic-drug handling looks identical to a
general-purpose cleaner. That will not survive scrutiny.

**C-13 (Medium) — No biological agents.** Blood-borne viruses, laboratory and
clinical biological agents fall under COSHH's biological-agents provisions
(containment levels, exposure groups). There is nothing for them — the model is
implicitly chemical-only, and even that thinly.

**C-14 (Medium) — Route of exposure isn't captured.** Inhalation vs skin/dermal
vs ingestion vs eye drives the control and the surveillance. There's no field —
so a skin sensitiser and an inhalation hazard are assessed with the same generic
row.

**C-15 (Medium) — "Read & understood" for the exposed group isn't version-safe.**
For sensitisers, the population who must acknowledge the assessment is exactly
the exposed cohort. But (inherited **A-1/A-2/A-3**) a live assessment can be
edited without re-acknowledgement, "Share via Heads Up" bypasses the
acknowledgement tracker, and the tracker has no reminders — so I can't reliably
prove the exposed staff read the *current* control measures.

**C-16 (Medium) — Person-specific variant drift (inherited A-4).** The
new/expectant-mothers COSHH variant is a one-time fork of the parent; if the
substance's controls change, the mothers' version silently diverges. For
reprotoxins that divergence is a patient-safety-grade risk.

### UX / UI notes
- Accessibility of the matrix (colour-only bands, tiny cells, unlabelled axes —
  **A-5**) applies here too.
- The person-specific banner and the "I have read and understood it" flow are
  well designed; they're the parts I'd most want to keep.

### Usage patterns that make little sense — and what I'd do instead
- **Classify first (C-10/C-12/C-14).** A substance record should carry CLP
  classification, CMR/sensitiser flags and route(s) of exposure, and those flags
  should *drive* the assessment (e.g. a sensitiser flag forces a surveillance
  question; a CMR flag forces the ALARP/closed-system controls).
- **Add health surveillance (C-11).** At minimum: a "surveillance required"
  flag, an enrolled-persons list, and a recall schedule with reminders.
- **Freeze content for the exposed cohort (C-15/C-16).** Version on publish;
  re-open acknowledgement when controls change; keep variants linked.

**Verdict:** The person-specific prompt shows real legal awareness, but for
clinical COSHH the essentials — classification, CMR handling, and health
surveillance — simply aren't there. I could not run trust COSHH on this today.

---

# 4 · Marcus Lindqvist — EHS consultant & ISO 45001 lead auditor

> *"I audit COSHH files for a living. Regulation 6 wants a suitable and
> sufficient assessment; the rest of COSHH wants the evidence behind it — data
> sheets, exposure limits, monitoring, surveillance, LEV test records. I checked
> whether that evidence chain exists."*

### What I did
Walked a substances assessment end to end asking, at each step, "where's the
record an inspector would ask for?"

### What works — and it matters
- **The append-only change log and triggered reviews carry over.** For COSHH the
  review *triggers* are especially apt — "change of process," "new equipment,"
  "change of legislation," "related incident" are precisely the COSHH re-assess
  triggers. Having them logged with who/when is good evidence.
- **Substitution-first hierarchy with the PPE-only gate** maps cleanly onto COSHH
  Reg 7. That's the correct spine.

### The COSHH-specific gaps (the evidence chain)

**C-17 (High) — No SDS, no SDS currency (C-2, audit view).** COSHH assessments
must be based on current data sheets. With no SDS store and no revision-date
tracking, I can't verify the assessment reflects the current SDS — and combined
with the Risk Assessments **no-versioning** defect (**A-1/M-3**), I can't prove
*which* SDS/controls were in force on a given date. That's the crux of a COSHH
defence, and it's absent.

**C-18 (High) — No exposure limit or monitoring record (C-4, audit view).**
There's no field for the WEL (EH40), no exposure-measurement log (COSHH Reg 10),
and no way to show exposure is *adequately controlled* against a limit. The
matrix score is subjective and won't satisfy an inspector who asks "controlled
to what?"

**C-19 (High) — No health surveillance record (C-11, audit view).** No way to
evidence Reg 11 surveillance, and the 40-year retention duty has no home at all.

**C-20 (Medium) — No LEV thorough-examination record (C-3, audit view).** Reg 9
records (14-month TExT) can't be attached or tracked against the LEV control.

**C-21 (Medium) — Sign-off gaps hit COSHH too (inherited M-2).** The assessor
"suitable and sufficient" attestation is skipped entirely when an assessment has
no *planned* controls — which is common for a mature COSHH assessment where
everything is already in place. So the very assessments most likely to be
audited are the ones published with no recorded sign-off.

**C-22 (Medium) — "Assessment" ≠ "COSHH register."** An inspector expects a
register of substances mapped to assessments. FreeHS has neither the register
(**C-1**) nor an export of one (the only output is the single-page ~11px print,
**M-4**). Reference numbers also overflow past RA-9999 (**M-5**) — minor, but I
cite records by number.

### Usage patterns that make little sense — and what I'd do instead
- **Build the evidence chain (C-17/C-18/C-19/C-20):** substance → current SDS →
  classification → WEL → exposure/monitoring → controls (with LEV test dates) →
  health surveillance. Each is a discrete, attachable record. Today none exist.
- **Always capture sign-off (C-21):** an explicit assessor attestation on every
  publish, with who and when.
- **Produce a register and a real PDF (C-22/M-4):** an exportable COSHH register
  and a paginated assessment PDF are table stakes for audit.

**Verdict:** The lifecycle *scaffolding* (change log, triggered reviews,
hierarchy gate) is genuinely good and COSHH-appropriate. But the COSHH
*evidence* — data sheets, exposure limits, monitoring, surveillance, LEV tests —
has nowhere to live, and the no-versioning defect means I can't fix the record
to a date. As it stands I would raise this as a non-conformity: not suitable and
sufficient for COSHH under Reg 6.

---

# Consolidated findings

### The one-line summary
FreeHS has **no COSHH module** — only a single generic "hazardous substances"
hazard template inside Risk Assessments. It can help you *write a task-level risk
assessment that mentions chemicals*; it cannot *run a COSHH programme*, because
the data a COSHH programme is made of has nowhere to live.

### Where the reviewers agree (act on these first)
1. **No substance register / SDS store / classification** (C-1, C-2, C-10). The
   three foundations of COSHH — the substance, its data sheet, its hazard class —
   are all absent. *All four reviewers.*
2. **No exposure basis** — no WEL/EH40, route of exposure, or monitoring; scoring
   is a subjective matrix guess (C-4, C-14, C-18). *Nair, Bello, Lindqvist.*
3. **No health surveillance** (C-11/C-19) and **no CMR/biological-agent handling**
   (C-12/C-13). *Bello, with Lindqvist on the evidence side.*
4. **No point-of-work / mobile chemical assessment and no SDS delivery to the
   operative** (C-6, C-7). *Whitfield.*
5. **The inherited Risk Assessments defects bite COSHH hard:** no content
   versioning (A-1/M-3 → C-15/C-17), leaky/silent distribution (A-2/A-3/T-4 →
   C-15), sign-off skipped (M-2 → C-21), review clock from creation (M-1 → C-11),
   and no real export (M-4 → C-22).

### What everyone praised (don't regress)
- Correct **hierarchy of control** (substitute-first) with the **PPE-only
  justification gate** — very COSHH-appropriate.
- Accurate harm language (respiratory sensitisation, dermatitis) and the
  **new & expectant mothers** person-specific prompt.
- The **append-only change log** and **triggered reviews**, whose trigger set
  matches COSHH re-assessment triggers well.

---

# Prioritised issue register

| ID | Sev | Summary | Raised by |
|----|-----|---------|-----------|
| C-1 | High | No substance register/inventory — can't record substance, supplier, form, quantity, location | Nair, Whitfield, Lindqvist |
| C-2 / C-17 | High | No Safety Data Sheet store or SDS revision-date tracking; can't prove assessment reflects current SDS | All four |
| C-10 | High | No CLP/GHS hazard classification; can't distinguish sensitiser/CMR from irritant | Bello |
| C-11 / C-19 | High | No health surveillance (COSHH Reg 11): no flag, no enrolled list, no recall, no 40-yr retention | Bello, Lindqvist |
| C-12 | High | No carcinogen/mutagen/reprotoxin (CMR) special handling / ALARP provisions | Bello |
| C-6 | High | No point-of-work / mobile COSHH assessment (inherits unreachable "dynamic" type, T-1) | Whitfield |
| C-7 | High | SDS can't be attached, so it can't travel to the operative; share sends only a PDF of the assessment | Whitfield |
| C-18 | High | No WEL (EH40), no exposure monitoring record (Reg 10); control adequacy unprovable | Nair, Lindqvist |
| C-3 / C-20 | Med | Engineering controls (LEV) not linked to Reg 9 thorough-examination schedule/records | Nair, Lindqvist |
| C-4 | Med | Scoring is generic L×S, not exposure/control-banding based | Nair |
| C-5 | Med | One generic library entry can't represent a real multi-substance inventory | Nair |
| C-8 | Med | RPE treated as generic "PPE" — no type/APF/face-fit record | Whitfield |
| C-13 | Med | No biological-agents provisions (containment, exposure groups) | Bello |
| C-14 | Med | Route of exposure (inhalation/skin/ingestion/eye) not captured | Bello |
| C-15 | Med | "Read & understood" not version-safe for the exposed cohort (inherits A-1/A-2/A-3) | Bello |
| C-16 | Med | New/expectant-mothers COSHH variant drifts from parent (inherits A-4) | Bello |
| C-21 | Med | Assessor sign-off skipped when no planned controls — common for mature COSHH RAs (inherits M-2) | Lindqvist |
| C-9 | Med | Activity/scope & location not editable, so substance context can't be described (inherits T-2/T-3) | Whitfield |
| C-22 | Low | No COSHH register export; only a cramped one-page print (inherits M-4); ref overflow past RA-9999 (M-5) | Lindqvist |

---

# Engineering appendix (root cause & pointers)

**There is no COSHH data model.** The entire COSHH surface is one record:

- The library template — `id: 'coshh'`, *"Hazardous substances (COSHH)"* — in
  `apps/web/src/lib/hazard-library.ts` (harm text, affected groups incl.
  `new_expectant_mothers`, initial 3×4 / residual 2×3, and the substitute →
  engineering(LEV) → administrative(SDS/monitoring) → ppe(gloves) control set).
- Everything else is the generic Risk Assessments machinery:
  `packages/api/src/routers/riskAssessments.ts`,
  `packages/db/src/schema/risk-assessments.ts`, and the editor under
  `apps/web/app/[locale]/risk-assessments/`.
- Confirmed absent: no `coshh`/`substance`/`chemical` router, route, schema,
  permission key, or brand-catalogue module (`BRAND_MODULES.freehs =
  ['riskAssessments']` in `packages/shared/src/brand.ts`); no mention in
  `docs/` or `FORMA360_BUILD_PLAN.md`.

Mapping each finding to where it would need to be built / what causes it:

- **C-1 (substance register)** — the hazard row
  (`riskAssessmentHazards`, schema L160–197) has `hazard`, `harmDescription`,
  `affectedGroups`, scores, `existingControls` — no substance/supplier/form/
  quantity fields. Needs a new substance sub-entity.
- **C-2 / C-17 (SDS)** — no attachment relation from hazards/controls to any
  file; the `documents` module (`packages/api/src/routers/documents.ts`) is not
  referenced by risk assessments. No revision-date field anywhere.
- **C-10 / C-14 (classification, route)** — no CLP/H-statement/pictogram/CMR/
  sensitiser or route-of-exposure fields on the hazard.
- **C-11 / C-19 (health surveillance)** — no surveillance model anywhere in the
  repo; the only cadence is `riskAssessments.reviewFrequencyMonths` /
  `nextReviewAt` (schema L135–137), which is per-assessment, annual, and (per
  **M-1**) counts from creation.
- **C-12 (CMR) / C-13 (biological agents)** — no substance-category concept.
- **C-3 / C-20 (LEV testing)** — controls (`riskAssessmentControls`, schema
  L202–233) have `tier`/`status`/`ppeJustification`/`actionId` but no link to
  `maintenancePrograms`/`maintenancePlans` for Reg 9 TExT.
- **C-4 / C-18 (exposure)** — banding is pure `likelihood*severity` vs fixed
  thresholds (`apps/web/src/lib/risk-matrix.ts`); no WEL or monitoring fields.
- **C-6 (point-of-work)** — inherits T-1: `create` never sets `type`;
  `updateInput` has no `type`; every RA is `standing`
  (`riskAssessments.ts` L79–96; list page L62).
- **C-7 (SDS delivery)** — `shareViaHeadsUp` sends a rendered PDF of the
  assessment only (`…/[assessmentId]/page.tsx` L213–243); no substance
  attachments exist to include. Also silently publishes (**T-4**).
- **C-8 (RPE)** — controls have no PPE-subtype/APF/face-fit fields.
- **C-9** — inherits T-2/T-3: editor only sends `title`/`siteId`; `activity`
  render-only, `locationText` never edited.
- **C-15 (version-safe acks)** — inherits A-1/M-3 (active assessments editable,
  no versioning; `editable = canManage && archivedAt === null`,
  `…/[assessmentId]/page.tsx` L157) and A-2/A-3 (Heads-Up bypasses
  `riskAssessmentAcknowledgements`; `distribute` has no email/reminder,
  `riskAssessments.ts` L958–1004).
- **C-16** — inherits A-4: `createPersonSpecific` one-time deep copy, no sync
  (`riskAssessments.ts` L1040–1107).
- **C-21** — inherits M-2: publish skips the sign-off dialog when
  `pendingPlanned.length === 0` (`…/[assessmentId]/page.tsx` L186–191).
- **C-22** — inherits M-4 (one-page 11px print, L574–654) and M-5 (`RA-` 4-digit
  pad, `riskAssessments.ts` L438); no register export.

### Recommendation
If COSHH is a target market for FreeHS (the healthcare and construction
reviewers both need it, and the brand is HSE-focused), it warrants a **dedicated
COSHH module** — a substance register with SDS + CLP classification, WEL/exposure
and monitoring, health surveillance, LEV-test linkage, and CMR/biological-agent
handling — sharing the Risk Assessments module's genuinely good spine (hierarchy
gate, change log, triggered reviews, person-specific prompt). Fixing the shared
Risk Assessments defects (versioning, sign-off, distribution, review-clock)
benefits both modules.

---

*Prepared as an independent practitioner review of FreeHS's COSHH capability.
Findings verified against the deployed implementation; because no COSHH module
exists, this is a capability & gap review with reproduction steps and code
pointers so each item can be triaged directly.*

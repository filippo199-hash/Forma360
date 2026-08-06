# FreeHS — Training & competence matrix

## What four HSE practitioners want it to look like, and what it must do

**Product:** FreeHS (freehs.software)
**Subject:** the training matrix — rated a **Blocker** by three of the four in
the module gap analysis, and a Major by the fourth
**Brief given to the panel:** *"Design the training matrix. Explicitly **not**
an LMS — no courses, no e-learning, no quizzes. Its job is to show who has done
what. How should it look, and what must it do?"*
**Date:** 3 August 2026

---

## Methodology & scope (read this first)

This is a design and requirements review, the second of its kind after the
navigation IA report, and it will be used as a base for a module
specification.

**The panel had already drawn this boundary themselves**, before being asked.
From the gap analysis:

> *"Our LMS holds courses; FreeHS needs the **compliance matrix and the
> enforcement**, not the e-learning itself. An import/integration surface would
> satisfy me; a course player would not add value."* — Bello

> *"A competence matrix: role → required training → who holds it → expiry →
> gap list, with certificates attached, expiry chasing, and — the real prize —
> **hard enforcement hooks**."* — Nair

So the "not an LMS" constraint is not a limitation imposed on the panel; it is
what they asked for. This report is them designing inside their own boundary.

**One finding before the design.** The platform reserves four permission keys
for this module — `training.view`, **`training.take`**, `training.manage`,
**`training.courses.manage`**. Two of those four (`take`, `courses.manage`)
describe an LMS: taking a course and administering a course catalogue. The
reserved key set anticipates a product the panel does not want. It should be
revised before it is built against (§8).

**And the reason this module is worth more than it looks.** Three shipped
modules are already faking a competence check because this one doesn't exist:

| Module | What it does today | Verified |
|---|---|---|
| **Permits** | "Competence of all operatives verified" is a **checkbox the issuer ticks** — in nine seeded permit types | `packages/shared/src/permits.ts:462, 481, 500, 517` |
| **Fire safety** | Marshal `trainedAt` / `trainingExpiresAt` are **typed by hand**, with a status function already written | `packages/shared/src/fire-safety.ts:410-425` |
| **Contractors** | Operatives' tickets are **PDFs against a requirement**, with expiry and a verify step | `packages/db/src/schema/contractors.ts:82-155` |

The training matrix is not new machinery. It is the **missing source of truth
that three modules are currently approximating** — and the fire-safety module
has already written the exact status vocabulary this module needs.

---

## The reviewers

| # | Reviewer | Organisation | Scale of their matrix |
|---|----------|--------------|------------------------|
| 1 | **Priya Nair, CMIOSH** | Precision engineering | ~800 people × ~30 requirements — today a 2,000-row spreadsheet only she understands |
| 2 | **Tom Whitfield, GradIOSH** | Building-services contractor | 40 people × ~8 cards — a folder of photographed cards and a stale Excel tab |
| 3 | **Dr. Aisha Bello, CFIOSH** | NHS trust | Thousands × statutory + mandatory, varying by ward and role — an LMS export nobody can act on |
| 4 | **Marcus Lindqvist, CMIOSH** | EHS consultant / ISO 45001 auditor | The records he samples most under clause 7.2 |

---

# 1 · Priya Nair — the matrix as a management tool

> *"Everyone pictures the grid. The grid matters — but I look at it once a
> month in a review meeting. What I need on a Tuesday morning is the **gap
> list**: who is missing what, sorted by how much it matters. Design the gap
> list first and derive the grid from it, not the other way round."*

### How she wants it to look

**The default landing view is the gap list, not the grid:**

```
TRAINING — GAPS                                    Site: All ▾   Role: All ▾

⛔ EXPIRED — 7
   Dave Mullins        Abrasive wheels           expired 12 days ago    [Record]
   Sarah Yeung         First aid at work         expired 3 days ago     [Record]
   …

⚠ EXPIRING — 30 days — 12
   Tom Baird           FLT counterbalance        expires 14 Aug         [Record]
   …

○ NEVER HELD — 4
   Nia Roberts         Manual handling           required by role       [Record]
```

**The grid is the second tab**, and it is the classic one — people down,
requirements across, one glyph per cell:

```
                    Man.  Abras. FLT   First  Conf.  IPAF  Fire
                    Hand. Wheels       Aid    Space        Marshal
────────────────────────────────────────────────────────────────
Dave Mullins         ●     ⛔     ●      ●      –      –     ●
Sarah Yeung          ●     –      –      ⛔     –      –     ●
Tom Baird            ●     ●      ⚠      ●      ●      –     –
Nia Roberts          ○     –      –      ●      –      –     –
────────────────────────────────────────────────────────────────
● in date   ⚠ expiring   ⛔ expired   ○ required, never held   – not required
```

Her requirements of the grid:
- **Filter by site, department, role and requirement** — 800 × 30 is not a
  screen, it's a query. The grid is only readable once filtered.
- **Cells are clickable** — a cell opens the record: date achieved, expiry, the
  certificate, who verified it.
- **Columns are sortable by gap count**, so the worst column comes first.
- **Export to Excel and PDF.** The grid is a board paper; it must leave the
  building looking like one.

### The functions she cares about most
1. **Requirements driven by role, not typed per person.** "Machine operator"
   requires manual handling + abrasive wheels + FLT. Add a person to that role
   and the requirements — and therefore the gaps — appear automatically. This is
   the single feature that makes the matrix maintainable at 800 people.
2. **Reverse lookup: "who is qualified for X?"** When a job needs two
   confined-space entrants tomorrow, I need to find them in ten seconds.
   The matrix already holds that answer; make it a query.
3. **Enforcement.** This is the real prize. My permits currently ask the issuer
   to *tick a box* saying competence was verified. Replace that tick with a
   check against this matrix for the named acceptor and gang, and the module
   pays for itself.
4. **Expiry chasing that reaches the manager, not just me.** The platform's
   reminder workers already do this well for permits and fire checks.

**What she does not want:** course content, booking, e-learning. *"I buy
training from providers. I need to know who's got it and when it dies."*

---

# 2 · Tom Whitfield — the matrix is a wallet, not a grid

> *"A grid is a manager's artefact. I have forty people and eight card types.
> What I actually need, three times a week, is to stand at a client's gate and
> show that this specific bloke holds a valid CSCS card. That's not a matrix,
> it's a wallet."*

### How he wants it to look

**The person view is his primary screen — one person, their cards:**

```
◂ Team          DAVE MULLINS — Operative                      [Add record]

  ┌─────────────────────────┐  ┌─────────────────────────┐
  │ CSCS — Blue Skilled     │  │ IPAF 3a / 3b            │
  │ No. 1234 5678 9012      │  │ No. IPAF-88213          │
  │ Expires 14 Mar 2027  ●  │  │ Expires 02 Sep 2026  ⚠  │
  │ [photo of card]         │  │ [photo of card]         │
  └─────────────────────────┘  └─────────────────────────┘

  ┌─────────────────────────┐  ┌─────────────────────────┐
  │ Asbestos Awareness      │  │ First Aid at Work       │
  │ Expired 21 Jul 2026  ⛔ │  │ Expires 30 Nov 2026  ●  │
  └─────────────────────────┘  └─────────────────────────┘
```

- **Card-shaped, not row-shaped.** A card has a number, an expiry and a photo
  of the physical thing. That is what a gate person wants to see.
- **The photo of the card is the evidence.** That is already how I work — I
  photograph the card on my phone. Let me do that here, on mobile, in the
  moment.
- **Show it from a phone, offline.** Site inductions happen in a cabin with no
  signal.

### The functions he cares about most
1. **Add a record in under a minute, from a phone**: person, card type, number,
   expiry, photograph. That's it. If it takes longer than photographing the card
   and typing an expiry date, I won't keep it current — and a stale matrix is
   worse than none.
2. **Expiry chasing to me and to the person.** Cards renew on a lead time; a
   CSCS card that lapses stops someone working.
3. **The client-facing training matrix as a PDF.** Every tender asks for it.
   Today I rebuild it in Excel the night before. This is the same commercial
   argument as the evidence pack — it wins work, and it is the reason a
   contractor pays for the product.
4. **Include my subcontractors' people.** Half the people on my jobs aren't my
   employees. If the matrix only covers payroll it doesn't cover my site.

**What he does not want:** anything with the word "course" in it. *"I don't
deliver training. I buy it, and I keep the certificate."*

---

# 3 · Dr. Aisha Bello — at scale, the grid stops being a grid

> *"Three thousand people and forty requirements is 120,000 cells. Nobody
> looks at that. At my scale the matrix is a **compliance percentage with a
> drill-down**, and the grid only appears at the bottom of the funnel."*

### How she wants it to look

```
TRAINING COMPLIANCE                                          As at 3 Aug 2026

  Overall  ████████████████░░░░  82%        Statutory only  ██████████████████░░  91%

  BY DIRECTORATE                          BY REQUIREMENT
  Surgery            ██████████░░  78% ▸   Fire safety        ████████████ 94% ▸
  Medicine           █████████████ 89% ▸   Manual handling    ██████████░░ 81% ▸
  Estates            ███████░░░░░  61% ▸   Sharps/IPC         ███████░░░░░ 64% ▸
  Facilities         ████████████  92% ▸   Resuscitation      █████████░░░ 73% ▸

  ▸ drill: Directorate → Ward → Role → the grid → the person
```

- **Percentages first, grid last.** Each level drills down; the grid is the
  final leaf, by then filtered to a readable size.
- **Statutory and mandatory reported separately.** They carry different
  consequences and my board asks for them apart.
- **"As at" date on every view.** Compliance is a moving number; a report
  without its date is meaningless.

### The functions she cares about most
1. **Bulk import — this is the make-or-break.** We have an LMS with tens of
   thousands of completion records. If FreeHS cannot ingest a CSV (and later,
   an integration) then the matrix is empty on day one and stays empty. **The
   import surface matters more to me than any screen in the module.**
2. **Requirements that vary by role *and* location.** A healthcare assistant on
   a surgical ward has a different set from the same role in facilities.
   Requirement sets must compose from role + area, not just role.
3. **No course player, no enrolment, no booking.** We have all of that. Adding a
   second one creates two sources of truth and my staff would use neither.
4. **Health surveillance is adjacent, not the same.** COSHH already holds
   surveillance in this platform. Keep them separate — one is "did you learn
   it", the other is "are you medically fit". Cross-link them, don't merge them.

**Her accessibility note:** never encode status in colour alone — the glyphs in
Priya's grid do real work. At 120,000 cells, a colour-blind reviewer with no
glyphs has no matrix at all.

---

# 4 · Marcus Lindqvist — what makes it evidence

> *"Clause 7.2 is the one I sample most, because it's the easiest place to find
> a gap. I pull five names and ask three questions: what were they required to
> hold, what did they hold, and can you show me the certificate. A matrix that
> can't answer the third question is a spreadsheet with better colours."*

### What makes a training record defensible
1. **The certificate is attached, and retrievable.** Not "we have a folder".
   The record links to the evidence.
2. **Someone verified it, and that's recorded separately from who typed it.**
   The contractor module already draws exactly this distinction —
   `verifiedByUserId` and `verifiedAt` alongside the upload. Reuse it.
   Self-declared training is a different evidential weight from checked
   training, and the record should say which it is.
3. **"As at" history.** After an incident I ask: *was this operator competent
   **on the day**?* A matrix that only shows today's status cannot answer that.
   Records must be immutable-by-append — a renewal is a new record, never an
   overwrite of the old expiry.
4. **Records survive the person.** A leaver's history must remain for the
   retention period. Deleting a user must not delete the evidence that they were
   trained — which also means this module has to be part of the
   anonymisation/retention design, not an afterthought.
5. **Provenance**: awarding body, certificate number, date achieved, expiry.
   "Manual handling ✓" is not a record.

### The enforcement point, from an auditor's seat
The self-ticked `competence_verified` precondition in the permits module is,
today, **the weakest control in the platform**. It asks the issuer to attest
something the system already could check. When this module exists, that tick
should become a real gate — and the same for fire marshals, whose training
dates are currently hand-typed into a different table.

> *"A matrix that only reports is worth having. A matrix that **stops** an
> uncompetent person being named on a permit is worth ten of them."*

---

# The converged design

## What it is, in one line
**A register of who holds what, against a definition of who needs what — with
the gap made visible, chased, exportable and enforceable.**

## The three objects
1. **Requirement** (the training type): name, category, statutory/mandatory
   flag, validity period (months, or "no expiry"), evidence expected,
   renewal lead time.
2. **Requirement assignment** (who needs it): by **role**, by **group/site**,
   or **individually**. Composable — a person's requirement set is the union.
3. **Record** (what someone holds): person, requirement, date achieved, expiry
   (auto-computed from validity, overridable), awarding body, certificate
   number, evidence attachment, source (`internal | external | imported |
   self_declared`), verified-by/at.

The **matrix is a derived view** over 2 and 3 — never a stored table. Status is
computed, exactly as fire-safety, permits and COSHH already compute theirs.

## Status vocabulary — already written, reuse it
`packages/shared/src/fire-safety.ts:412` defines
`not_trained | in_date | expiring_soon | expired`. Add `not_required` and this
module's vocabulary is done, with the marshal implementation as its reference:

| Status | Glyph | Meaning |
|---|---|---|
| `in_date` | ● | Held and valid |
| `expiring_soon` | ⚠ | Within the requirement's lead time |
| `expired` | ⛔ | Held but lapsed |
| `not_held` | ○ | Required, never recorded |
| `not_required` | – | Not in this person's set |

Glyph **and** colour, always — never colour alone (Bello).

## The four views, in priority order
1. **Gap list** (Nair) — the default landing view; expired, then expiring, then
   never-held; filterable; each row one click from recording the fix.
2. **Person / wallet** (Whitfield) — one person's cards, mobile-first, with the
   photographed certificate; the induction screen.
3. **Matrix grid** (Nair, Lindqvist) — people × requirements, filtered, cells
   clickable, exportable to Excel and PDF.
4. **Compliance roll-up** (Bello) — percentages by area/role/requirement with
   drill-down to the grid; statutory and mandatory reported separately;
   every view stamped "as at".

## Functions

**Must have**
- Requirement catalogue with validity periods and statutory/mandatory flags.
- Requirement assignment by role / group / site / individual, composable.
- Record a completion in under a minute from a phone, with a photograph.
- Computed status; the four views above; "as at" date on reporting views.
- **Bulk CSV import** of records and of requirement assignments (Bello's
  make-or-break; also everyone's migration path off their spreadsheet).
- **Expiry chasing** — a daily worker to the person and their manager, using
  the platform's proven dedup/quiet-when-clean pattern.
- **Export**: CSV, and a **branded PDF matrix** (Whitfield's tender document).
- **Reverse lookup**: who is qualified for requirement X, at site Y.
- **Contractor people included**, not only employees.
- **Enforcement hooks** (below).

**Should have**
- Verification step, distinct from entry (Lindqvist), reusing the contractor
  documents pattern.
- Renewal from an existing record (pre-filled, new row, old row retained).
- Cross-link to COSHH health surveillance without merging it (Bello).
- Offline capture of a record on mobile (Whitfield).

**Will not have — the boundary, stated plainly**
- Course content, hosting, e-learning, SCORM, quizzes, assessment.
- Enrolment, booking, scheduling, waiting lists, trainer diaries.
- Certificate *issuing* or awarding.
- Competency frameworks with proficiency levels and appraisal — adjacent, and a
  different product.

*If a feature answers "how do I train someone", it's out. If it answers "who
has done what, and what's missing", it's in.*

## The enforcement hooks — the highest-value part
Each of these replaces something the platform currently fakes:

| Hook | Today | With the matrix |
|---|---|---|
| **Permits** | Issuer ticks "competence verified" (9 seeded types) | Issue gate checks the named acceptor and gang hold the type's required training, in date — a per-type `requiredTraining` list, exactly like `requiresGasTesting` |
| **Fire safety** | Marshal training dates typed into `fire_marshals` | Marshal status reads from the matrix; the hand-typed columns become a fallback |
| **Contractors** | Tickets are PDFs on the company record | Contractor *people* appear in the matrix; company compliance can require their operatives to be in date |
| **RAMS** | Steps name "personnel and competence" as free text | A step's competence requirement resolves against the matrix; the briefing screen shows who is short |

The panel's unanimous view: **ship at least the permits hook in the same
release as the module.** Reporting alone is a spreadsheet with better colours;
the enforcement is the product.

## Permissions — revise the reserved keys
The reserved set (`training.view / take / manage / courses.manage`) encodes an
LMS. The panel's set:

```
training.view          -- the matrix, gap list, roll-up
training.record        -- add/edit records (a supervisor recording their crew)
training.verify        -- confirm a record against its evidence
training.manage        -- requirement catalogue and assignments
```

`training.record` separate from `training.manage` follows the
`fireSafety.record` / permits competent-person precedent both later modules got
right. Standard should hold `training.view` plus, ideally, "see my own
records" — people ask when their card expires.

---

# Priority

| # | Capability | Why first |
|---|---|---|
| 1 | Requirement catalogue + role assignment + record capture + computed status | Nothing works without the model |
| 2 | Gap list and person/wallet views | The two screens used daily |
| 3 | **Bulk CSV import** | Without it the matrix is empty on day one (Bello) — and it's everyone's migration path |
| 4 | Expiry chasing worker | The reason the matrix stays current |
| 5 | **Permits enforcement hook** | Turns reporting into control; retires the platform's weakest precondition |
| 6 | Matrix grid + branded PDF/CSV export | The board paper and the tender document |
| 7 | Compliance roll-up with drill-down | Needed at NHS scale, not at 40 people |
| 8 | Verification step, fire-marshal and contractor hooks, RAMS competence | Deepens it |

---

# Implementation notes

- **Status logic already exists**: `marshalTrainingStatus` in
  `packages/shared/src/fire-safety.ts:415-425` is the reference implementation —
  lift it into a shared training helper and have fire safety consume it back.
- **Verification pattern already exists**:
  `contractor_documents.verifiedByUserId` / `verifiedAt` with a
  `pending | verified | rejected` status (`schema/contractors.ts:92-129`) is the
  shape Lindqvist asked for.
- **Expiry chasing already exists** four times over — `ra-ack-reminder`,
  `permit-expiry-watch`, `fire-due-digest`, `contractor-doc-reminder`. Copy the
  dedup + per-run cap + quiet-when-clean discipline, and **register the email
  template with the IN-J04 completeness test** in the same PR.
- **Permit hook shape**: add `requiredTraining: string[]` to `permit_types`
  alongside `requiresGasTesting` etc., and a `trainingGateError` **pure helper
  in `packages/shared/src/permits.ts`** — not only in the router, so the permit
  UI can preview the blocker (the RS-A11 lesson from the RAMS review).
- **Records are append-only** (Lindqvist's "as at"): a renewal inserts a new
  row; nothing overwrites an expiry. The matrix reads the latest valid record
  per (person, requirement) — and an "as at" query reads the latest as of that
  date.
- **Retention**: records must survive the person. This module must be part of
  the anonymisation cascade design, which the platform review found is still a
  stub — worth resolving together.
- **Non-user people**: contractors' operatives and agency staff need records
  without accounts. The incidents module's person model (user *or* named person
  with a category) is the precedent.
- **Ship with the chrome**: search, AI tools, nav entry with `nav.training` in
  all 10 locales, and the full namespace translated at launch. Every review in
  this series has flagged a module that outran its chrome; the last one shipped
  a 404 on its primary button.

---

*Prepared as an independent practitioner design review of the proposed FreeHS
training matrix, following eight module, platform, gap-analysis, IA and
business-model reviews. The "not an LMS" boundary is the panel's own, stated in
the gap analysis before this brief was given. Claims about existing platform
hooks are verified against `main`.*

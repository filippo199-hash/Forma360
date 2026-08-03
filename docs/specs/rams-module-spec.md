# RAMS — Risk Assessment & Method Statement — module specification

**Module id:** `rams` (FreeHS module B6)
**Status:** Draft for review — base for development
**Sources:** the four-practitioner gap analysis
(`docs/reviews/freehs-module-gap-analysis-hse-expert-review.md`, where a
RAMS/method-statement builder was Whitfield's **Blocker** and the contractor
segment's single largest gap), plus the seven module and platform reviews whose
lessons this spec bakes in.
**Companion ADR (to write with the implementation):** *Method-statement content
model, RAMS pack versioning and briefing records* — next free ADR number
(0014 at time of writing).

---

## 1 · Why this module exists

From the gap analysis:

> *"Every job we win requires a Risk Assessment **and Method Statement** pack,
> job-specific, issued to the client, briefed to the crew, signed. FreeHS has
> the RA half (good) and permits can link a method statement document — but
> there's no way to **write** one. Today: Word templates, and the RA gets
> retyped into Word to sit beside the method statement — so FreeHS's RA module
> ends up a side quest."* — Whitfield

Three things follow, and they shape the whole design:

1. **The gap is the method statement, not the risk assessment.** FreeHS already
   has a strong, versioned, signed-off RA module. What is missing is the
   *how* — the sequenced safe system of work — and the **pack** that binds the
   two into one issuable artefact.
2. **Because the RA lives in Word today, the RA module is bypassed.** This is
   the expensive part: a missing method statement is currently costing FreeHS
   the use of a module it already built well.
3. **RAMS has two sides, and the platform only has one of them.** Contractors
   *produce* RAMS; clients *receive, review and accept* them. FreeHS today can
   store a received RAMS as a contractor document but cannot review one, and
   cannot produce one at all.

**One sentence:** build the safe system of work as structured, versioned,
reusable steps; bind it with the existing risk assessment and COSHH records
into one issued pack; prove the crew was briefed on the version that was in
force; and let a client review and accept a RAMS — their own or a
contractor's — before work starts.

### A note on the panel's ratings
In the gap analysis RAMS scored: Whitfield **Blocker**, Nair *Useful*,
Lindqvist *Useful*, Bello *Marginal*. Those ratings were given against a
**producer-only** reading of the module. Adding the **receive-and-accept** side
(§9) raises it materially for the other three — Nair and Bello both consume
contractors' RAMS constantly and have nowhere to review them, and Lindqvist's
audit question ("what was in force on the day?") is answered by the same
versioning. The receive side is what turns this from a one-segment feature into
a platform one, and it is cheap because the contractor and permit machinery
already exist.

---

## 2 · Scope

### 2.1 In scope
- **Method-statement authoring**: a sequenced safe system of work — steps, each
  with its own hazards/controls, plant, substances, PPE, personnel and optional
  hold points.
- **A method-statement library**: reusable templates, tenant-owned, seeded with
  a starter set for common trades.
- **RAMS packs**: binding a method-statement version + one or more risk
  assessments + COSHH assessments + supporting documents into one versioned,
  issuable artefact with a single PDF.
- **Versioning and issue**: draft → issued (immutable, signed) → superseded,
  mirroring the RA module.
- **Briefing records**: "briefed and understood" signature capture at the point
  of work, mobile-first and offline-capable, anchored to a specific pack
  version.
- **Client issue and acceptance**: send a pack to a client (login-free share
  link) and record their acceptance.
- **Receiving third-party RAMS**: a review-and-accept workflow over the
  contractor documents the platform already stores.
- Integration with permits (a permit type may require an accepted pack), sites,
  assets/plant, COSHH, actions, search, AI and analytics.

### 2.2 Explicitly out of scope
- **A generic rich-text/document editor.** Structure is the entire reason to
  build this. If the answer is "a big text box", Word already wins.
- **Re-stating hazards.** The method statement *references* the risk
  assessment; it never restates its hazards and controls. One source of truth.
- **Legal e-signature infrastructure** (DocuSign-class). The platform's
  signature pad plus an append-only audit trail is proportionate and consistent
  with permits, inspections and Heads Up.
- **CDM construction-phase plans, programme/Gantt planning, or a full
  pre-qualification portal.** Adjacent, larger, separate decisions. (The
  evidence-pack export the gap analysis flagged as a Tier-3 item can consume
  RAMS output later.)
- **Automatic hazard inference** ("AI writes your method statement"). See §12.

### 2.3 Brand scope
RAMS is contractor- and project-flavoured, which is the FreeHS profile.
**Recommendation: `BRAND_ONLY_MODULES` → FreeHS**, like B1–B5, built with the
`{ enabled }` router-deps pattern so a brand or entitlement switch stays a
one-line change (ADR 0010). Note for the commercial work: the *authoring* side
is the contractor tier's headline feature; the *receive-and-accept* side is
naturally a client-side capability. Both should sit inside the free tier's
"doing the safety work" line per the business-model review — the paid surfaces
here are branded client-facing output and the evidence pack.

---

## 3 · Acceptance scenarios

The tests the module must pass. Traceability in §16.

**T1 — Whitfield (contractor, the primary case).** Tom wins a job replacing AHU
filters in a plant room. He starts a RAMS pack from his "Plant room —
mechanical works" library template, which pre-fills eight sequenced steps. He
binds his existing "Working at height" and "Manual handling" risk assessments
(already in FreeHS, not retyped) and the COSHH assessment for the coil cleaner.
He tailors three steps, adds an isolation hold point, and issues version 1 —
signing it as author. One combined PDF goes to the client with his logo on it.
On site next morning he opens the pack on his phone, briefs three operatives,
and captures three signatures against **version 1** before work starts. Total
authoring time: under twenty minutes, because the template did the work.

**P1 — Nair (engineering, both sides).** Priya's team writes its own method
statement for a machine-guarding modification, binds the machinery RA, and
issues it. Separately, a specialist contractor sends her *their* RAMS: she
reviews it against a checklist, accepts it with an expiry tied to the project,
and the hot-work permit her team later issues **cannot be issued** until an
accepted pack is attached.

**A1 — Bello (NHS, receive-only).** Estates never authors a RAMS; they receive
them. A contractor's pack arrives against their contractor record, a named
reviewer works through it, rejects it once with comments, accepts version 2,
and the acceptance is visible from both the contractor record and the permit.
Aisha needs the *review trail*, not the builder.

**M1 — Lindqvist (audit).** Six months after an incident, Marcus asks: *what
RAMS was in force on the day, who had been briefed on that exact version, and
did the permit reference it?* He gets all three from the incident's date
without leaving the platform.

---

## 4 · Domain model

### 4.1 The three objects
- **Method statement** — the *how*. A sequence of steps. Reusable, versioned,
  owned by the tenant. Can exist independently of any job.
- **RAMS pack** — the *issuable artefact* for a specific job: one method
  statement version + N risk assessment versions + N COSHH assessments +
  supporting documents + job context (site/project, client, dates, personnel).
  This is what gets issued, briefed and accepted.
- **Briefing** — the record that a named person was briefed on a specific pack
  version and understood it.

Keeping the method statement separate from the pack is what makes the library
work: the same method statement is issued as five different packs across five
jobs, each binding different RAs and dates, without copy-paste.

### 4.2 Method-statement content — the step model
The core of the module. A method statement is an **ordered list of steps**,
each carrying:

| Field | Notes |
|---|---|
| `sequence` | 1..n, reorderable |
| `title` | short — "Isolate and prove dead" |
| `description` | what is actually done |
| `hazardRefs` | references to hazards in the bound RA(s) — **never restated** |
| `controlNotes` | step-specific control detail beyond the RA's control set |
| `plant` | equipment/tools; may reference `assets` rows |
| `substanceRefs` | references to COSHH substances/assessments |
| `ppe` | from a shared PPE vocabulary (multi-select + free text) |
| `personnel` | roles required and how many; competence note |
| `holdPoint` | optional: work stops here until a named check/sign-off (isolation proved, permit issued, inspection passed) |
| `environmentalNotes` | optional — spill/waste/noise considerations |

**Hold points are the feature that makes this more than a document.** They are
where a method statement becomes a *system of work*: the briefing UI shows
them, and the pack's PDF prints them prominently. v1 records them; a later
phase can require a signature at each hold point.

### 4.3 Emergency & logistics blocks
Beyond the steps, a method statement carries a small fixed set of blocks every
client and every reviewer looks for — first aid / emergency arrangements,
rescue plan (reuse the permits vocabulary where the type demands one), welfare,
waste and environmental, and site-specific access/egress notes. These are
structured fields, not free prose, so the review checklist (§9) can assert
their presence.

### 4.4 Lifecycle
Two independent lifecycles, both mirroring the RA module's proven shape.

**Method statement:** `draft → published → archived`, versioned on publish.
Editing a published method statement creates a new draft version; published
versions are immutable.

**RAMS pack:** `draft → issued → superseded / withdrawn`, versioned on issue.

```
draft ──issue──▶ issued ──reissue──▶ superseded
  │                 │
  └──cancel──▶      └──withdraw──▶ withdrawn   (reason required)
```

- **Issue freezes everything.** The pack version snapshots the method-statement
  version, the RA version ids, the COSHH assessment ids and the document
  references (ADR 0007's snapshot model, exactly as inspections pin a template
  version). A later RA revision never silently changes an issued pack.
- **Re-issue creates version n+1** and **invalidates briefings against version
  n** — see §7. Prior versions stay readable "as issued on {date}".
- **Withdraw** stops work under the pack (reason required) and is visible to
  everyone briefed.

---

## 5 · The library — the adoption feature

The gap analysis's clearest lesson from the very first review is that the
**hazard library** is what made the RA module usable ("the best thing here —
it would save my team hours"). RAMS needs the same, more so: a contractor does
the same twelve jobs repeatedly, and if every pack starts blank they will keep
using Word.

- **Tenant library**: any method statement can be saved as a template; starting
  a new one offers the library first.
- **Seeded starter set** (English, editable tenant data — the permits
  `DEFAULT_PERMIT_TYPES` stance): a small number of genuinely useful skeletons
  for common trades — plant-room mechanical works, electrical installation and
  testing, working at height / roof access, groundworks & excavation, hot works
  (welding/cutting/brazing), confined-space entry, lifting operation, and a
  generic maintenance visit. Six to ten steps each, with hold points marked.
- **Duplicate-and-tailor** is the default motion, everywhere.
- Library entries carry the same versioning; updating a template never touches
  packs already issued from it.

---

## 6 · Building a pack

Authoring flow, optimised for T1's twenty-minute bar:

1. **Start** — from a library template, by duplicating a previous pack (the
   commonest real motion: "same as the Riverside job"), or blank.
2. **Job context** — title, client, site/project (existing selector,
   terminology-aware), location, planned dates, author, and the supervisor in
   charge.
3. **Bind the risk assessments** — pick from the existing RA register. The
   builder shows the RA's hazards so steps can reference them; **published RA
   versions only** may be bound (a draft RA cannot back an issued pack).
4. **Bind COSHH** — pick substances/assessments; their SDS references travel
   into the pack.
5. **Write the steps** — reorderable, with the fields in §4.2, referencing the
   bound records rather than restating them.
6. **Attach supporting documents** — insurance, certificates, equipment
   certificates, training records, drawings; from the Documents module or
   uploaded.
7. **Review & issue** — a completeness gate (§6.1), then an explicit **author
   attestation** shown in full before signing, mirroring the RA module's
   sign-off (the M-2 lesson: the attestation must appear on *every* issue, not
   only when something else triggered a dialog).

### 6.1 The issue gate
Refuse issue unless:
- at least one step exists, and every step has a title and description;
- at least one risk assessment is bound, and every bound RA version is
  published (not draft, not archived);
- the emergency/first-aid block is completed;
- where any bound RA hazard has a residual rating above the tenant's
  configured threshold, at least one step references it (i.e. the highest
  risks are actually addressed by the method) — **the single most valuable
  validation in the module**, and the one that stops a RAMS being two unrelated
  documents stapled together;
- the author has actively confirmed the attestation.

Errors follow the platform's slug convention with a 1:1 i18n contract (the
incidents module's error-slug discipline is the model — 48 slugs, no orphans
either way).

---

## 7 · Briefing — "briefed and understood"

The most-used surface in the module, and the one that must work on a phone in a
plant room with no signal.

- **Anchored to a pack version.** A briefing record always names the version
  briefed. This is what answers M1.
- **Who**: platform users *and* named non-users (a subcontractor's operative
  with no account) — the incidents module's person model is the precedent.
- **Capture**: briefer, briefee, timestamp, optional signature (the existing
  signature pad), optional "questions raised" note.
- **Group briefing**: one session, several signatures, one after another — this
  is how a tailgate talk actually happens. The UI must support passing the
  phone around without leaving the flow.
- **Re-issue invalidates prior briefings.** Version 2 of a pack means everyone
  is briefed again — the Heads Up "editing the body invalidates every
  signature" behaviour, which the platform already implements correctly and
  which reviewers praised. The pack page shows *briefed on current version* vs
  *briefed on a superseded version*.
- **Offline-first.** Briefing and signature capture must persist locally and
  sync, following the inspection conduct flow's pattern (`localStorage` queue,
  `online` listener, retry, `beforeunload`) — and, per the incidents review's
  IN-A4/IN-A12 findings, **failures must be surfaced, never swallowed.**
- **Distribution** for non-briefing acknowledgement (office staff, the client's
  file) rides the existing RA-distribution / Heads Up machinery rather than
  inventing a third mechanism.

---

## 8 · Client issue & acceptance

- **Issue to a client**: generate a login-free share link (reuse
  `generateShareToken` / `validateShareToken` / `buildShareUrl` from
  `@forma360/render`, as the inspection and issue share links already do) plus
  a downloadable PDF.
- **Acceptance record**: the client can accept (name, organisation, timestamp,
  optional comment) or request changes. Recorded on the pack, visible in the
  timeline, printed on the PDF.
- **Revocable**, expiring, and always pointing at a specific version.
- **Branded output** — the client-facing PDF carries the tenant's logo and
  colour (the branding settings already exist). Per the business-model review
  this is a paid surface; the pack itself and its PDF are not.

---

## 9 · Receiving third-party RAMS (the client side)

What makes this a platform module rather than a contractor feature. Today a
contractor's RAMS arrives as a `contractor_documents` row against a
`contractor_requirements` entry — stored, never reviewed.

Add a **review workflow** over that existing record:

- **Submit for review** — from the contractor portal upload, or logged
  internally when a pack arrives by email.
- **Review** — a named reviewer works a short checklist: scope matches the
  work; hazards and controls credible; sequence includes isolation/permit hold
  points; emergency arrangements present; competence evidence attached; COSHH
  covered. Each item pass / fail / n-a with a comment.
- **Outcome** — `accepted` (with validity dates, normally tied to the job or
  the contract) / `rejected` (comments returned to the contractor) /
  `accepted_with_conditions` (conditions recorded and printed).
- **Consequences** — an accepted pack satisfies the contractor requirement and
  can be referenced by a permit (§10.2). An expired or rejected acceptance does
  not.

A FreeHS-authored pack issued *to* another FreeHS tenant should, in a later
phase, arrive natively rather than as a PDF. Out of scope for v1; do not model
anything that forecloses it.

---

## 10 · Integrations

### 10.1 Risk assessments (the point of the module)
Binding is by **RA version**, not RA id, so the pack is stable. The RA detail
page gains a "used in RAMS packs" list — closing the loop the gap analysis
described, where the RA module currently ends up bypassed.

### 10.2 Permits — a clean extension of an existing pattern
`permits` already carries `riskAssessmentId` and `methodStatementDocumentId`.

- Add `ramsPackVersionId` and **prefer it** over the loose document link.
- Add a per-type flag `requiresRamsPack` alongside the existing
  `requiresAuthoriser` / `requiresGasTesting` / `requiresIsolationCertificate`
  / `requiresRescuePlan` — the issue gate then refuses a permit without an
  issued (own) or accepted (third-party) pack. This is exactly the shape the
  permits module already uses, so it is a small, idiomatic change.
- The permit PDF references the pack version.

### 10.3 COSHH, assets, sites, documents
Substance references pull from the COSHH register (and carry the SDS
reference); plant may reference `assets`; site/project uses the existing
selector and terminology; supporting documents come from the Documents module
by reference (not copied).

### 10.4 Actions
A rejected client acceptance, a failed review item, or a briefing that surfaces
a problem can raise an action via the existing engine with
`sourceType: 'rams'`. **Precondition, learned the hard way:** the same PR must
extend the actions hub end to end — source union, `get` resolution, list/board
chips and the source filter — or these actions render as "Standalone" with no
back-link (platform review PF-2).

### 10.5 Incidents
An incident linked to a job should be able to reference the pack version in
force, which is how M1 is answered. One nullable FK.

### 10.6 Search, AI, analytics, exports — launch criteria, not follow-ups
Register the module in `search.global` (gated on `rams.view`), add read tools
to the AI agent, emit the countable facts (packs issued, briefings completed
vs outstanding, client acceptances, third-party reviews pending/overdue), ship
the CSV register export and the pack PDF **in the same release**. Every review
in this series has flagged a module that outran the chrome; this one should not.

---

## 11 · Data model (proposed — migration `0069_rams.sql`, next free number)

Conventions as elsewhere: ULID PKs via `newId()`, `tenant_id` NOT NULL →
`tenants.id` ON DELETE RESTRICT, timestamptz, append-only event log.

| Table | Purpose / key columns |
|---|---|
| `method_statements` | header: reference (`MS-` + **6-digit pad**), title, trade/category, status, `is_template`, owner, archived_at |
| `method_statement_versions` | `version_number`, `content` jsonb (steps + emergency/logistics blocks, Zod-validated), `published_by/_name/_at` — immutable; unique `(method_statement_id, version_number)` (mirrors `risk_assessment_versions`) |
| `rams_packs` | header: reference (`RAMS-` + 6-digit pad), title, client name, site_id (SET NULL), location, planned from/to, author, supervisor, status, withdrawn/cancelled reason |
| `rams_pack_versions` | `version_number`, `content` jsonb — the **snapshot**: method-statement version id + its content, bound RA version ids + summary, COSHH ids, document refs, job context; `issued_by/_name/_at`; unique `(pack_id, version_number)` |
| `rams_pack_risk_assessments` | join: pack ↔ RA **version** (queryable without opening jsonb) |
| `rams_pack_documents` | join: pack ↔ document (or uploaded storage key), with a `kind` |
| `rams_briefings` | pack_version_id, briefee (user or name + category), briefer, briefed_at, signature_data, questions_note — **append-only** |
| `rams_client_links` | share token, issued_to, expires_at, revoked_at; acceptance: accepted_by_name/org/at, decision, comment |
| `rams_reviews` | third-party review (§9): contractor_document_id, reviewer, checklist jsonb, outcome, conditions, valid_from/to, comments |
| `rams_events` | append-only audit log across the module — every version, issue, briefing, acceptance, review decision; workers write as `system` |

Indexes: `(tenant_id, status)`, `(tenant_id, site_id)`, `(tenant_id, planned_from)`,
briefings `(tenant_id, pack_version_id)`, reviews `(tenant_id, outcome, valid_to)`,
events `(tenant_id, pack_id, created_at)`.

---

## 12 · AI assistance — deliberate, bounded

The temptation is "generate my method statement". The panel's stance across
seven reviews has been consistent: the platform computes, the practitioner
judges. So:

- **Allowed**: suggest a starting template from the job title; suggest step
  *titles* for a known trade; flag on issue that a high-residual RA hazard is
  not referenced by any step (this is a rule, not a model, and belongs in the
  issue gate); summarise a received third-party RAMS to speed review.
- **Not allowed in v1**: generating step content presented as authored, or
  auto-populating controls. A method statement is a legal statement of how work
  will be done, signed by a named person. Anything that lets someone issue text
  they have not read is a liability for them and for FreeHS.
- Any AI surface must be permission-gated server-side like the existing read
  tools, and clearly labelled as a draft aid.

---

## 13 · Permissions

```
rams.view          -- register + read packs and method statements
rams.create        -- author method statements and draft packs
rams.issue         -- issue / re-issue / withdraw a pack (the attestation)
rams.brief         -- record briefings and capture signatures
rams.review        -- review and accept/reject third-party RAMS
rams.manage        -- library and template administration, archive
```

`rams.brief` is separate deliberately — a working supervisor briefs the crew
without holding authoring rights (the `fireSafety.record` / `permits` competent-
person lesson, which both later modules got right).

**Seeding:** Administrator and Manager get all six. Standard gets
`rams.view` + `rams.brief` (a supervisor must be able to brief). **Ship the
seed change with the SQL backfill for existing tenants** in the same migration
— the mechanism the incidents module established (PF-8) — and the permission
matrix i18n labels for the new module and keys, all locales, in the same PR.

---

## 14 · Web surfaces

| Route | Purpose |
|---|---|
| `[locale]/rams` | Register: needs-attention strip (packs awaiting issue, briefings outstanding, client acceptances pending, third-party reviews due/expiring), filters, table + mobile cards, CSV export |
| `[locale]/rams/new` | Start: from library / duplicate previous / blank |
| `[locale]/rams/[packId]` | The pack: job context, bound RAs & COSHH, steps preview, documents, briefing status, client acceptance, version history, timeline |
| `[locale]/rams/[packId]/build` | The builder: step editor (reorderable), bindings, documents, issue gate + attestation |
| `[locale]/rams/[packId]/brief` | **Mobile-first, offline-capable** briefing: read the steps, then capture signatures one after another |
| `[locale]/rams/library` | Method-statement library: templates, versions, duplicate |
| `[locale]/rams/reviews` | Third-party RAMS awaiting review + review workspace |
| `render/rams/[packVersionId]` + `/api/exports/rams-pdf` | HMAC print route + session-gated download (existing conventions) |
| `s/[token]` | Client view & acceptance (existing share-link route family) |

Navigation: per the IA review, `rams` belongs in the **"Do the work"** group,
adjacent to Permits — with its `nav.rams` key present in **all 10 locales in
the same PR** (the `nav.fireSafety` omission is the cautionary tale), and the
full `rams` namespace translated at launch, not English-mirrored.

---

## 15 · Shared library (`packages/shared/src/rams.ts`)

Pure and side-effect free, imported by schema, router, UI and any worker:
status enums + `canTransition` for both lifecycles; the step and content Zod
schemas; the PPE and plant vocabularies; the trade/category vocabulary; the
seeded starter templates (`DEFAULT_METHOD_STATEMENT_TEMPLATES`); the
review-checklist definition; `unreferencedHighRiskHazards(packContent, raVersions,
threshold)` for the §6.1 gate; reference formatters (`MS-` / `RAMS-`, 6-digit
pad that grows past 999999). Every helper unit-tested.

---

## 16 · Edge-case IDs (test-first)

`RS-E01..` in `packages/shared/src/rams.test.ts` (shared) and
`packages/api/src/routers/rams.test.ts` (router). Must-have set:

- **RS-E01** both lifecycle matrices — every illegal transition refused.
- **RS-E02** step content Zod round-trip; `sequence` dense and reorderable.
- **RS-E03** issue gate: no steps / step missing description → refused.
- **RS-E04** issue gate: binding a **draft** RA version → refused.
- **RS-E05** issue gate: high-residual RA hazard unreferenced by any step →
  refused (the §6.1 headline validation).
- **RS-E06** issue gate: emergency block incomplete → refused.
- **RS-E07** issue snapshots the method-statement version, RA versions and
  COSHH ids; a later RA revision does not alter the issued pack.
- **RS-E08** re-issue creates version n+1; version n stays readable and its
  briefings are marked superseded.
- **RS-E09** briefings are append-only (no update/delete surface) and always
  name a version.
- **RS-E10** briefing a non-user by name works; cross-tenant user rejected.
- **RS-E11** withdraw requires a reason and is visible to everyone briefed.
- **RS-E12** client share link: revoked / expired tokens refused; acceptance
  recorded against the version.
- **RS-E13** third-party review: accept sets validity; expiry stops satisfying
  a permit requirement.
- **RS-E14** permit with `requiresRamsPack` refuses issue without an issued or
  accepted pack (and accepts either).
- **RS-E15** cross-tenant scoping on every loader (RA, COSHH, site, document,
  contractor, asset).
- **RS-E16** reference-number continuity past `RAMS-999999`.
- **RS-E17** actions raised with `sourceType 'rams'` resolve a label and a
  working back-link in the actions hub.
- **RS-E18** library template publish/duplicate; updating a template does not
  alter packs already issued from it.

---

## 17 · Requirements traceability

| Requirement (§) | Source |
|---|---|
| Module exists; sequenced method statement; combined pack PDF | Gap analysis — Whitfield **Blocker** |
| Reference the RA, never restate it; bind published versions | Whitfield ("the RA gets retyped into Word"); RA module already versioned |
| Library / templates as the adoption feature (§5) | Hazard-library praise, RA review #1 (Nair) |
| "Briefed & understood" signature flow (§7) | Whitfield; reuses RA distribution + Heads Up signatures |
| Re-issue invalidates briefings | Heads Up signature-invalidation behaviour (praised, platform review) |
| Snapshot on issue (§4.4, RS-E07) | ADR 0007; RA review A-1/M-3 lesson |
| Attestation shown on every issue (§6) | RA review M-2 lesson |
| Receive-and-accept side (§9) | Nair P1, Bello A1 — the gap analysis's "we consume contractors' RAMS" |
| Permit `requiresRamsPack` (§10.2) | Nair P1; existing permits requirement-flag pattern |
| "What was in force on the day" (§10.5, RS-E08) | Lindqvist M1 |
| Offline briefing with **surfaced** failures (§7) | Platform PF-10; incidents IN-A4 / IN-A12 |
| Actions-hub source integration in the same PR (§10.4) | Platform PF-2 |
| Seed + SQL backfill + matrix i18n (§13) | Platform PF-8; incidents migration precedent |
| nav key + full i18n at launch (§14) | Platform PF-21 / PF-22 |
| Search / AI / analytics / CSV / PDF at launch (§10.6) | Platform PF-5 / PF-6 / PF-24 |
| 6-digit references (§11) | RA M-5 / permits PW-13 |
| Bounded AI (§12) | Panel stance across seven reviews |
| Free-tier placement; branded output paid (§2.3) | Business-model review |

---

## 18 · Delivery plan

1. **PR 1 — foundations:** `packages/shared/src/rams.ts` + tests
   (RS-E01..E06), schema + migration, permission keys + seed + **backfill**,
   event log.
2. **PR 2 — method statements:** CRUD, versioning, publish, the library and the
   seeded starter templates (RS-E18).
3. **PR 3 — packs:** create/bind/build, the issue gate + attestation,
   versioning and snapshot, withdraw (RS-E03..E08, E11, E15, E16).
4. **PR 4 — briefing + client issue:** briefing capture (mobile, offline,
   errors surfaced), share links and acceptance (RS-E09, E10, E12).
5. **PR 5 — receive side + permits:** third-party review workflow,
   `requiresRamsPack` and the permit issue-gate extension (RS-E13, E14).
6. **PR 6 — outputs & chrome:** pack PDF, CSV register, search + AI
   registration, actions-hub source integration (RS-E17), nav + full i18n,
   analytics facts.
7. **ADR** alongside PR 1; edge-case IDs into `docs/edge-cases` per PR.

**Sequencing note.** PRs 1–4 deliver Whitfield's Blocker end to end and are
independently shippable — a contractor can author, issue and brief a RAMS pack
after PR 4. PRs 5–6 broaden it to the other three practitioners and to the
platform. If the module has to be cut short, cut after PR 4, not before.

---

*Specification drafted from the four-practitioner gap analysis and the seven
prior review reports; every design constraint traces to a named finding so the
panel can verify the module answers the feedback that asked for it. Integration
points (RA versioning, permit FKs, contractor documents, share tokens, render
pipeline) are verified against `main`.*

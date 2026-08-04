# ADR 0015 — Method-statement content model, RAMS pack versioning and briefing records

**Status:** Accepted
**Date:** 2026-08-03
**Supersedes:** none
**Related:** [0007 — Access state at time of action](./0007-access-state-at-time-of-action.md),
[0009 — Template content schema](./0009-template-content-schema.md),
[0010 — Multi-brand, single codebase](./0010-multi-brand-single-codebase.md),
[0011 — Risk-assessment versioning and sign-off](./0011-risk-assessment-versioning-and-sign-off.md),
[0012 — Permit lifecycle and signature model](./0012-permit-lifecycle-and-signature-model.md)

## Context

FreeHS already had a strong, versioned, signed-off risk-assessment module.
It was being bypassed.

Every job a contractor wins requires a risk assessment **and a method
statement** issued as one pack, briefed to the crew and signed. FreeHS
had the RA half and no way to write the *how*. So the method statement
lived in Word — and because the two have to travel together, the RA was
retyped into Word beside it. The RA module became a side quest.

Two further facts shaped the design:

1. **RAMS has two sides.** Contractors *produce* RAMS; clients *receive,
   review and accept* them. The platform could store a received RAMS as
   a contractor document but could not review one, and could not produce
   one at all.
2. **Authoring effort is the adoption risk.** A contractor does the same
   twelve jobs repeatedly. If every pack starts blank they keep using
   Word regardless of how good the model is.

## Decision

### 1. Three objects, deliberately separate

- **Method statement** — the reusable *how*: an ordered list of steps,
  tenant-owned, versioned on publish, existing independently of any job.
- **RAMS pack** — the issuable artefact for a specific job: one method
  statement version + N risk-assessment versions + N COSHH assessments +
  documents + job context.
- **Briefing** — an append-only record that a named person was briefed on
  a specific pack *version*.

Keeping the method statement separate from the pack is what makes the
library work: the same method statement is issued as five different packs
across five jobs, each binding different RAs and dates, without
copy-paste. A pack keeps its **own** working copy of the step content, so
tailoring a pack for a job never touches the library entry.

### 2. The method statement references the risk assessment; it never restates it

Steps carry `hazardRefs` — `{ raVersionId, hazardIndex }` pointing into a
bound RA version's frozen content, plus a `hazardLabel` display snapshot
that is explicitly *not* the source of truth. One source of truth for a
hazard, and the RA module stops being bypassed because binding it is
cheaper than retyping it.

### 3. Binding is by RA *version*, not RA id

A pack binds `risk_assessment_versions.id`. Only published versions may
back an issued pack. This is what keeps an issued pack stable: revising
the RA afterwards creates version n+1 and the issued pack still points at
the version that was in force.

### 4. Issue freezes everything (ADR 0007's snapshot model)

`rams_pack_versions.content` is a complete snapshot — job context, the
step content as issued, the bound RA versions with their residual bands,
the COSHH records with their SDS references, and the document list.
Published/issued version content is **never UPDATEd**, mirroring
`risk_assessment_versions` and `template_versions`.

The PDF renderer reads the frozen version, so re-rendering an old issue
reproduces exactly what the client received.

### 5. Re-issue creates version n+1 and invalidates prior briefings

Re-issue stamps `supersededAt` on version n and writes version n+1. The
briefing rows against version n are **not deleted** — they simply stop
matching the pack's current version, which is how "briefed on a
superseded version" is computed and how "who had been briefed on the
version in force on the day" is answered six months later.

This is the Heads Up signature-invalidation behaviour, which reviewers
praised, applied to a second surface.

### 6. The issue gate refuses a pack that is two documents stapled together

`evaluateIssueGate` returns **every** failure at once (not first-fail) so
the builder shows one actionable checklist. It refuses issue unless:

- at least one step exists, and every step has a title and a description;
- at least one risk assessment is bound, and every binding resolves to a
  published version;
- the first-aid and emergency-procedure arrangements are present;
- **every bound hazard whose residual band is at or above the threshold
  is referenced by at least one step**;
- the author has actively confirmed the attestation.

The fourth is the headline validation and the reason this is a model
rather than a document editor: it is what stops a RAMS being an RA and a
method statement that have never been reconciled with each other.

Order matters in the gate: a pack that bound an assessment which has
never been published resolves to zero usable versions, so the
*unpublished* case is reported before the *empty* case — otherwise the
author is told "bind a risk assessment" when they already did.

### 7. Both lifecycles list their self-transition explicitly

`published → published` (republication) and `issued → issued` (re-issue)
are legal transitions in the matrices rather than special cases in the
router. A state machine that needs the router to know about exceptions is
not the source of truth it claims to be.

### 8. The attestation lives in the shared package, untranslated

`RAMS_AUTHOR_ATTESTATION` is a single exported constant consumed by the
router (which snapshots it onto the version row) and the builder UI
(which shows it in full before signing). It is deliberately **not**
translated: it is a legal declaration a named person signs, stored
verbatim and printed on the PDF, so it must be the same text everywhere
rather than whatever locale the author happened to be using.

Per the RA module's M-2 lesson, it is shown on *every* issue — not only
when something else triggered a dialog.

### 9. Briefings are append-only and version-anchored

The router exposes `forPack` and `record` and nothing else — no update,
no delete. `record` takes a batch, because a tailgate talk is one session
with several signatures and the phone gets passed around; the batch shape
is also what makes the offline queue replayable. Briefees may be platform
users (tenant-checked) or named non-users, mirroring the incidents person
model.

Offline capture queues in `localStorage` and syncs on `online`. **Sync
failures are surfaced with a manual retry, never swallowed** — the
incidents IN-A4 / IN-A12 finding. A briefing that silently vanished is
worse than one that visibly needs retrying.

### 10. The receive side reuses the contractor record

`rams_reviews` anchors to an existing `contractor_documents` row (or logs
a pack that arrived by email). A reviewer works a snapshotted checklist;
`accepted` is refused while any item failed, `accepted_with_conditions`
is the outlet and demands the conditions in writing, `rejected` demands
comments the contractor gets back.

An accepted, in-date review satisfies a permit that demands a pack —
exactly as an own issued pack does.

### 11. Permits gain one flag and two links

`permit_types.requires_rams_pack` joins the existing `requires_*` family;
`permits.rams_pack_version_id` and `permits.rams_review_id` are the two
things that can satisfy it. The seeded permit-type catalogue leaves the
flag at its column default (`false`) — turning it on for the seeded types
would change the issue gate under existing tenants.

### 12. Autofill is deterministic, not generative

`suggestBindings` ranks the tenant's own published RAs and COSHH
assessments against the job by token overlap plus a site match. It is a
rule, not a model. Per the panel's consistent stance across seven
reviews, the platform computes and the practitioner judges: a method
statement is a legal statement of how work will be done, signed by a
named person, so nothing generates step content presented as authored.

The seeded library (eight trade skeletons, six to ten steps each, hold
points marked) and clone-a-previous-pack carry the authoring-effort load
instead — and they are tenant data, editable, exactly as
`DEFAULT_PERMIT_TYPES` is.

## Consequences

**Good**

- The RA module stops being bypassed: binding an RA is cheaper than
  retyping it, and the RA detail page can show where it is used.
- "What was in force on the day, who was briefed on that exact version,
  did the permit reference it" is answerable from three joined tables.
- The receive side makes this a platform module rather than a
  single-segment feature, and it was cheap because the contractor and
  permit machinery already existed.

**Costs, accepted**

- A pack carries its own copy of the step content, so a library fix does
  not propagate to packs already built from it. That is the point
  (RS-E18), but it means the library is a starting point rather than a
  controlled document.
- The high-residual gate can be satisfied by referencing a hazard without
  genuinely addressing it. The rule proves the author looked at every big
  risk; it cannot prove they thought hard. No automated check can.
- No dependents-registry resolver: the registry's module union is closed,
  the same status as risk assessments, COSHH and permits.

**Deferred**

- Signature capture *at* a hold point (v1 records hold points and prints
  them; it does not gate work on a signature per point).
- A FreeHS-authored pack issued to another FreeHS tenant arriving
  natively rather than as a PDF. Nothing in the model forecloses it.
- Branded (tenant logo / colour) client-facing PDF output — the business
  model puts that on the paid tier; the pack and its plain PDF are not.

---

## Amendment — 4 August 2026 (HSE expert review disposition)

Four practitioners reviewed the module
([`docs/reviews/rams-hse-expert-review.md`](../reviews/rams-hse-expert-review.md);
disposition in
[`rams-hse-review-response.md`](../reviews/rams-hse-review-response.md)).
Their verdict — that the server work was sound and the product still did
not function — held, and the immediate cause was that the builder route
had been written and never committed. Three decisions in this amendment
change the model rather than just the code.

### Decision 11 — the frozen snapshot carries hazards, not just references

The original snapshot stored metadata *about* each bound RA version:
reference, title, worst residual band. That was enough to prove which
assessment was in force, and not enough for anyone to be briefed from it.
`PackVersionRiskAssessment.hazards` now carries, per hazard, the hazard
itself, who is at risk, the controls and the residual band, frozen at
issue like everything else.

This makes the pack self-sufficient — the briefing screen and the PDF
answer "what am I being briefed on" without joining back to a live RA
that may since have been revised. The field is optional so versions
issued before this change still parse; they render without the hazard
table, which is an honest depiction of what was frozen at the time.

### Decision 12 — briefing idempotency is a database constraint

Briefings are append-only and captured offline, which makes an
at-least-once delivery model inevitable. The router already accepted a
`clientRef` and discarded it. It is now stored, with a partial unique
index on `(pack_id, client_ref)` and `onConflictDoNothing` (migration
`0070`).

The alternative — trusting the client to send each entry exactly once —
is what produced the three queue bugs the review found. A briefing record
is a legal claim that a named person was briefed on a named version; a
duplicate is a false record, and a dropped one is a missing record. The
constraint makes both impossible regardless of what the client does.

### Decision 13 — a cross-module gate is a pure helper the caller can preview

The permit RAMS gate lived only inside the permits router, so the permit
page could not show the blocker until the mutation failed. `ramsGateError`
is now pure, in `packages/shared/src/permits.ts` beside `gasGateError`,
taking a `PermitRamsLink` describing what the link resolves to. The
router loads the facts; both the mutation and `permits.get` reach the
verdict through the same code.

The general rule this settles: **a gate that blocks an action must be
previewable by the surface that offers the action.** Loading the facts is
the router's job and stays async; deciding is pure and shared. Any future
module gating another module's action follows this shape.

### Not a decision, but the lesson

Two of the review's medium findings (RS-A8, RS-A9) and one earlier
platform finding (PF-6) were the same bug: a server-side vocabulary
duplicated by hand in a client file, where forgetting an entry is silent.
The actions-hub source table and the Cmd-K category table now live in
`apps/web/src/lib/`, each with a test that reads the router's own
declaration and fails when the two diverge. Where a client must mirror a
server enum, the mirror gets a test that scrapes the source of truth.

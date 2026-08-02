# ADR 0011 — Risk-assessment versioning, sign-off and residual-risk coherence

- **Status**: accepted
- **Date**: 2026-08-02

## Context

Practitioner feedback (round 2) on the FreeHS Risk Assessments module
(B1) surfaced a cluster of related evidentiary problems:

- an active assessment stayed fully editable with everyone's
  "read & understood" acknowledgement still showing green against content
  that had since changed (A-1), which also made the record unusable as
  evidence of "what was in force on {date}" (M-3);
- the assessor attestation only appeared as a side effect of the
  planned-controls dialog, was skipped entirely otherwise, and the print
  attributed sign-off to the *creator* rather than whoever published
  (M-2);
- the review clock started at creation and ran on drafts, so "next
  review" misrepresented currency to an auditor (M-1);
- residual risk was a free pick, never reconciled against the controls
  (could exceed the initial risk, could be scored with no controls at
  all, could stay Critical with no explanation) (P-1/P-2);
- every planned control silently became an action "assigned to the
  publisher, medium, due in 7 days" (P-3);
- the matrix banding was fixed, so a fatality-potential hazard at 1×5
  read "Medium" with no way to align bands to a corporate standard
  (P-4).

## Decision

**1. Immutable versions, cut at publish.** Every publish freezes the
full content (header, hazards, controls, matrix snapshot) into
`risk_assessment_versions`. Version rows are never UPDATEd. The working
rows stay editable; `content_updated_at` newer than the current version
row surfaces an "unpublished changes" banner instead of blocking edits.
A publish only cuts a new version when content actually changed — a
draft → active round trip with no edits re-activates the same version
without disturbing acknowledgements.

**2. Sign-off is a first-class, active act.** `publish` requires
`confirmSignOff: true` (Zod literal) on every call; the UI always shows
the attestation with a checkbox. The version row records `signedOffBy`,
a `signedOffByName` snapshot, and `signedOffAt`; the print/PDF attribute
the sign-off to the version's signer, never the creator.

**3. Acknowledgements are version-aware.** Each acknowledgement row
stores the version it asks for (`version_number`) and the version
actually acknowledged (`acknowledged_version`). Publishing a changed
version re-stamps every row to the new version — earlier
acknowledgements stay on record (events log + version snapshots preserve
the evidence), but pending state derives from
`acknowledged_version < version_number`, so nobody stays green against
content they have not read. The Heads Up share path records the same
rows for the heads-up's materialised recipients; it never publishes.

**4. The review clock anchors to publish.** Creation seeds only the
frequency. `next_review_at` is computed when a version goes live (and on
recorded reviews), and the list only flags active assessments as
review-due.

**5. Residual risk must cohere with the controls.** At publish: residual
> initial is refused (controls cannot increase risk); a scored residual
with no controls at all is refused; a residual banding High/Critical
needs either a planned control (the further action) or a tolerability
note (`residual_justification`). The editor enforces the same shape
live: the residual picker unlocks after a control exists and caps cells
at the initial score.

**6. Actions from planned controls are explicitly owned.** The publish
dialog collects an assignee and due date per planned control; the server
validates them (tenant member, active, not past-dated) and derives the
action's priority from the hazard's residual band. Publish refuses
otherwise — there is no "publisher / 7 days" default to train people
away from "planned".

**7. The matrix is tenant-configurable, snapshotted per row.**
`tenant_risk_matrix_settings` stores band thresholds plus per-severity
minimum bands ("severity 5 ⇒ at least High"). One shared implementation
(`@forma360/shared/risk-matrix`) is consumed by the API validation, the
web pickers/chips/print and the PDF renderer. Assessments snapshot the
matrix at creation (drafts can opt in when settings change); published
versions keep the matrix they were signed against, so history never
rescores itself.

## Consequences

- "Suitable and sufficient" now has a verifiable audit chain: signed
  version → acknowledgements against that version → retrievable
  "as in force" snapshot.
- Republishing content re-opens acknowledgements by design; teams that
  edit live assessments frequently will see more re-acknowledgement
  requests — that is the point.
- Existing active assessments published before this ADR have
  `current_version = 0`; their first republish creates version 1
  (self-healing). Drafts lost their premature `next_review_at` in
  migration 0058.
- The publish input is a breaking API change (`confirmSignOff`,
  `actionAssignments`) — accepted, since the module ships in one brand
  and the only caller is the web app.

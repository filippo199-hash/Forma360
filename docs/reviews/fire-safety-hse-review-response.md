# Fire Safety module — HSE review response

Point-by-point disposition of the four-practitioner review in
[`fire-safety-hse-expert-review.md`](./fire-safety-hse-expert-review.md).
All twelve findings are addressed in this round. Migration `0062`;
edge-case IDs cited per item.

| ID | Sev | Finding | Disposition |
|----|-----|---------|-------------|
| FS-1 | High | A failed check/inspection advances the schedule and reads green | **Fixed.** `fire_logbook_checks.last_result` / `fire_doors.last_outcome` persist the newest result (backfilled in 0062). A `fail` puts the check/door in a distinct red **failed** display state — `checkDisplayStatus` / `doorDisplayStatus` in `@forma360/shared/fire-safety` — that overrides the clock everywhere (building checks, register rows, tenant due list, overview counts `checksFailed`/`doorsFailed`) until a **newer pass** clears it. Backdated older entries can neither set nor clear it. The schedule still advances so cadence bookkeeping stays truthful; the failure is its own louder state, not a date. `defects_found` does not hold the state: the measure works and the defect is on an action path (see FS-2). FS-E25 (checks), FS-E26 (doors), FS-E08 (shared). |
| FS-2 | Med | Failed checks don't force a follow-up action | **Fixed.** `raiseAction` now defaults **on** server-side for `logbook.recordEntry` and `doors.recordInspection`; a non-pass result raises an action unless explicitly opted out (for when a duplicate action already exists). A pass never raises one. Combined with FS-1, opting out no longer hides anything — the failed state stays red regardless. FS-E27. |
| FS-3 | Med | No worker/email for the statutory calendar | **Fixed.** New daily worker `forma360-fire-due-digest` (06:00 UTC): one digest per tenant to every `fireSafety.manage` holder (admins qualify via `org.settings`) covering failed checks/doors, overdue, due-soon, FRA reviews due, PEEP reviews due and marshal-training expiry. Tenants with a clean calendar get nothing. Recipient resolution via the new `usersHoldingPermission` helper (`@forma360/permissions/holders`). FS-J01/FS-J02. |
| FS-4 | Med | An FRA can be signed with the assessment empty | **Fixed.** The publish gate now also requires persons at risk, sources of ignition, fuel and oxygen, and the evaluation — each with its own error code surfaced in the UI. A hollow attestation is unsignable. FS-E15 (full guard-chain walk). |
| FS-5 | Med | No FRA document | **Fixed.** `renderFraPdf` in `@forma360/render` (same Puppeteer→R2 pipeline as permits), HMAC-gated print route `/render/fra/[fraId]`, session-gated download `/api/exports/fra-pdf?fraId=`, `fras.renderPdf` procedure (DI, refuses unwired), and a **Download PDF** button on the FRA page. The document carries premises, occupancy, the fire-triangle narrative, findings with status, review history, the sign-off block — and prints DRAFT / stale-attestation warnings when applicable. FS-E30. |
| FS-6 | Med | "Intolerable" publishes as routine | **Fixed.** An intolerable FRA now (a) refuses to publish without at least one unresolved finding on an action path (`intolerable-needs-action`), (b) emails every `fireSafety.manage` holder on publish (`fra-intolerable-alert` template; best-effort, never rolls back the publish), (c) shows a red occupation-should-not-continue banner on the FRA page and an INTOLERABLE marker on the register, and (d) counts in the overview's needs-attention strip (`frasIntolerable`). The sign-off dialog warns before signing. FS-E28. |
| FS-7 | Med | A published FRA is silently editable; the signature isn't refreshed | **Fixed.** `content_updated_at` tracks content changes (update + finding add/edit/remove; resolving a finding is remediation, not a content change). An active FRA edited after sign-off shows **attestation stale** (banner with signer + date) until re-published. Every publish now stamps a *fresh* `publishedAt`/`publishedBy` — re-publishing an active FRA logs a `reattested` event. The PDF prints the stale warning too. FS-E29. |
| FS-8 | Low/Med | Marshal-gap noise across an estate | **Fixed.** `fire_buildings.requires_marshal_cover` (default on) + `marshal_target` (default 1). Buildings that don't need cover opt out on the Marshals tab; buildings that need more state their minimum. Coverage and the overview count a gap only where cover is required and in-date marshals < target. FS-E32. |
| FS-9 | Low/Med | No attestation statement or action preview on publish | **Fixed.** Publish always opens a sign-off dialog: the article-9 attestation the RP is signing (checkbox-gated), what content is still missing, the findings/actions preview, and the intolerable warning when applicable. Re-attestation uses the same dialog. |
| FS-10 | Low | FRA references overflow after FRA-9999 | **Verified + regression-tested.** `padStart` never truncates — FRA-10000 renders correctly; FS-E33 pins the behaviour so a future refactor can't break it. |
| FS-11 | Low | Source headers say "module B3" | **Fixed** in all three files (shared, schema, router) + the module documented as B4 in `CLAUDE.md`. |
| FS-12 | Med | Doors can only be added one at a time | **Fixed.** `doors.bulkCreate` (≤500/call) + a paste-import dialog on the Doors tab: one door per line (`ref[, floor[, kind]]`), parsed client-side by the shared `parseDoorImport` (unparseable lines are errors, never silently defaulted), duplicates — in-paste or against the live register, case-insensitive — skipped and reported. Regime-derived cadence applies to imported doors. FS-E31 + FS-E09. |

## Also in this round

- The FRA publish-error toasts (`publishErrors.*`) were missing from
  every locale bundle — latent since the module shipped; added in all
  ten locales along with ~42 new keys for the features above.
- Two new email templates: `fire-due-digest`, `fra-intolerable-alert`.

*(What the reviewers praised — the auto-seeded calendar, regime
classification, six-point door check, append-only evidence spine,
PEEP/marshal handling — is untouched.)*

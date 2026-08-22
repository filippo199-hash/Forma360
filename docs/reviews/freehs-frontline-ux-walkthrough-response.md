# UXW-2 frontline-day walkthrough — response & fix record

**Findings doc:** `freehs-frontline-ux-walkthrough.md` (10 findings)
**Adjudication:** product owner, 21 Aug 2026 — *implement all the fixes*
**Fix pass:** this branch. Nine dispositions are `fix`; UXW2-09 is
`fix (reframed)` — the triage check the findings doc asked for changed
what the defect was. The notes record the shape each fix took and where
it lives, so nobody re-litigates the choices.

| ID | Sev | Fix | Where |
| --- | --- | --- | --- |
| UXW2-07 | S2 | The created incident's identity now **outlives the component**: on create success the id + reference are stamped into `sessionStorage` (`forma360:incident:created:new`) alongside the draft machinery, and the mount effect restores that stage before it restores any draft — so the dead-zone remount (or an F5 on the photos step) re-lands on "Saved as IN-000001" with working Done/photo actions instead of a blank form. Done clears the stage; the photos step now also *shows* the reference (`new.savedAs`), so the worker has a receipt to quote before choosing. | `incidents/new/page.tsx`, bundles (`incidents.new.savedAs`) |
| UXW2-08 | S2 | The assignee can work his own action everywhere. Server: `actions.setStatus` drops from `actions.manage` to `actions.view` + an inline rule — a non-manager may move **his own** action along `open → in_progress → completed` only (never others', never cancel, never reopen a terminal state); the action-type group gate still binds him. UI: the full-page action view and the board side-sheet both show the status chips to the assignee (page offers the three worker states; managers keep all four). Three new router tests pin the rule, including the group-gate interaction. | `packages/api/src/routers/actions.ts` (+`.test.ts`), `actions/[actionId]/page.tsx`, `action-detail-panel.tsx` |
| UXW2-09 | S2 | **Reframed by triage, then fixed.** Re-verification with a saved hamburger screenshot showed the nav does NOT offer Training to Standard users — the walkthrough's "nav offers Training" was the harness's own `goto`, not a rendered link. And `/training/me` (the personal wallet) is already open to every user by design (TR-A5/TR-B10 — deliberately not behind `training.view`). The real defects were reachability and the refusal copy: the wallet had **no door** for users without the nav entry, and a FORBIDDEN rendered as a load failure (UXW2-10). Fixed: a "My training" item in the header user menu — the one surface every user holds — links `/training/me` in all locales. Standard deliberately does NOT gain `training.view` (that key is sight of *other people's* records; TR-B10 stands). | `user-menu.tsx`, bundles (`common.myTraining`) |
| UXW2-03 | S3 | Two-part fix. (a) The banner targets the provisioning visitor only: `load-sandbox-state` now gates on the session email carrying the `@sandbox.invalid` placeholder, so an invited member never sees "Save my work". (b) The triage check the finding asked for found the real hole and closed it: `sandbox.claim` now **refuses a non-placeholder caller** (`FORBIDDEN not-sandbox-owner`) — an invited member could previously repoint the workspace's ownership at their own inbox. Router-tested (SB-E38). | `load-sandbox-state.ts`, `packages/api/src/routers/sandbox.ts` (+`.test.ts`) |
| UXW2-05 | S3 | The People-affected row wraps (`flex-wrap`) and the name input carries `min-w-40 flex-1`, so on 390px it takes the full row under the category dropdown instead of squeezing to one character. | `incidents/new/page.tsx` |
| UXW2-06 | S3 | Submit now checks `navigator.onLine` first and, when offline, renders an amber "No signal — your report is saved on this phone…" card (`new.offlineSaved`) instead of spinning into a fetch that cannot resolve; the button never sticks at "Submitting…". The draft machinery is unchanged — the card describes what it already does. | `incidents/new/page.tsx`, bundles |
| UXW2-10 | S3 | The four training pages distinguish the refusal from the outage: a FORBIDDEN renders "You don't have access to the training register" + a **Go to my training** link (`/training/me` — always openable); everything else keeps "Could not load this view / Try again". | `training/{page,requirements,compliance,matrix}.tsx`, bundles (`training.errors.*`) |
| UXW2-01 | S4 | The seeded sandbox admin is now **"Demo Manager"** (name, firstName, and the invite-fallback string), so the compositions read "Demo Manager invited you…", "Created by Demo Manager". Existing sandboxes keep "You" — the rename is at provision time, deliberately not a backfill. | `packages/api/src/sandbox/provision.ts`, `freehs-users-admin.spec.ts` |
| UXW2-02 | S4 | The `/scan` frame now speaks the worker's word: heading composes "Report: Hazard" (the category name IS the noun), thanks copy drops "observation" — "Thanks! Your report has been submitted." / "Report another". All 10 locales. | bundles (`scanPage.*`), composition at `scan-report-form.tsx` |
| UXW2-04 | S4 | The register distinguishes "empty" from "filtered": with no search and no filter chips active it says "No incidents reported yet." (`list.emptyNoFilters`); with any filter it keeps the match copy. **Permits deliberately left unchanged**: its register boots with status *open* pre-selected — a real filter — so "match these filters" is true there; changing it would mislead. | `incidents/page.tsx`, bundles |

## Drive-by (not in the findings table)

- **UXW2-11** (spotted during the fix pass): the training wallet formatted
  dates with raw `useFormatter`, printing "Aug 21, 2026" on a UK product —
  the exact `en → en-US` class `format-date.ts` exists to prevent. Now
  goes through the house `formatDate`.
- The explorer driver gained the `upload` action
  (`{"upload": [selector, path]}` → `setInputFiles`) — the driver gap the
  findings doc flagged, needed before UXW-4's photo paths.

## Verification

- `pnpm typecheck` + `pnpm lint` green; targeted vitest on the touched
  routers (`actions.test.ts` incl. the three new UXW2-08 cases,
  `sandbox.test.ts` incl. SB-E38) and the web suite (K01 over the new keys
  in all 10 bundles); full `pnpm test` on this branch before merge.
- Explorer re-verification (UXW-2's own instrument, phone-390, as Marek):
  status chips present and working on the full-page action view; offline
  submit shows the no-signal card with the draft intact; the post-submit
  photos step shows "Saved as IN-…" and survives a reload; no sandbox
  banner for an invited member; "My training" in the user menu opens the
  wallet; `/scan` heading reads "Report: Hazard".

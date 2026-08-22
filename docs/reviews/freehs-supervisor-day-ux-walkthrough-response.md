# UXW-4 supervisor-day walkthrough — response & fix record

**Findings doc:** `freehs-supervisor-day-ux-walkthrough.md` (8 findings)
**Adjudication:** product owner, 22 Aug 2026 — *implement all the fixes*
**Fix pass:** this branch, shipped together with the UXW-5/6 pass (the
two share the W3 tenant and three of the fixes touch the same files).

| ID | Sev | Fix | Where |
| --- | --- | --- | --- |
| UXW4-01 | S3 | **Not fixed as reported — see below.** The two creation paths do share a default; what the walkthrough hit was the template's seeded first question already carrying a response set while "+ Add new" starts a plain text row. Changing the default risks silently mis-typing questions authors intended as text. Left for a product decision with the evidence attached. | — |
| UXW4-02 | S3 | `renderTitle`'s `{date}` token renders house format ("22 Aug 2026"), not ISO. It becomes the inspection's name everywhere — heading, register row, approvals queue, report header — so this one token was the whole document's voice. | `packages/api/src/routers/inspections.ts` |
| UXW4-03 | S3 | A check with no recorded result reads **"Not yet done"** (neutral chip) instead of a green "OK" beside "Last done —". The clock still escalates it through due-soon/overdue, and FS-1 is untouched: a fail still beats any clock state. The rewritten `fire-safety.test.ts` pin now states all three rules together. **A new display state had a tail — see below.** | `packages/shared/src/fire-safety.ts` (+`.test.ts`), `fire-safety/chips.tsx`, `routers/fireSafety.ts`, `workers/fire-due-digest.ts`, bundles |
| UXW4-04 | S4 | `SignaturePad` follows `defaultName` while the field is pristine and stops the moment the user edits it (ref, not a render closure — BUG-12 discipline). The briefer no longer re-types their own name for every crew member. | `inspections/signature-pad.tsx` |
| UXW4-05 | S4 | The handover submit is now **"Confirm handover"** — it and the panel toggle were both "Hand over", adjacent, and the natural second tap closed the panel and dropped the picked acceptor. | bundles (`permits.detail.actions.handoverConfirm`) |
| UXW4-06 | S4 | The close panel reads the **live entry log** and warns before the attestation is ticked ("N people are still logged in on this permit — log their exits before closing", ICU plural), instead of letting the supervisor attest something the server then refuses. The server refusal is unchanged — it stays the enforcement point. | `permits/[permitId]/page.tsx`, bundles |
| UXW4-07 | S4 | Authorise and Issue both go through `appConfirm` with copy naming what the signature means. The ceremony was inverted: the counter-signature the whole permit regime hangs on took one unconfirmed click while Accept asked "Are you sure?". | `permits/[permitId]/page.tsx`, bundles |
| UXW4-08 | S4 | "Apply <trade> template" renders only when a template matching that trade exists (same trim/lowercase match the server applies). It previously offered an action that could only ever toast a refusal. | `contractors/[contractorId]/page.tsx` |

## UXW4-03 — the tail the walkthrough could not see

Adding a display state is not a display-only change. Two places decided
what needs a human by asking `status !== 'ok'` — the tenant-wide
`logbook.due()` list and the daily `fire-due-digest` email — and a
negative filter widens itself every time a state is added. `not_yet_done`
therefore put **all seven checks of a day-zero building** into "what
needs doing" and into a manager's inbox, none of them due.

The register half failed loudly (FS-E19, in the full suite, on a test
whose own comment reads *"freshly seeded calendars are all 'ok' — nothing
due yet"*). The digest half was **silent**: FS-J02's "clean calendar"
check carries a `pass`, so a never-performed one never reached it. That
is the worse half — it is email, to a real person, daily.

Both now go through `checkNeedsAttention(status)`, which enumerates the
three states that are actually work. `CHECK_DISPLAY_STATUSES` is the
const tuple the type derives from, so the guard walks every state instead
of restating the list, and the next display state has to say for itself
whether it belongs on somebody's list. FS-J06 pins the digest case, and
was verified by reverting the one line and watching it mail the manager.

The general shape, worth carrying: **showing a state and acting on it are
different questions.** Answer the second one positively.

## UXW4-01 — why it is not fixed here

The finding is real as *experience* (an author extending the obvious
checklist ships a form demanding typed answers), but the mechanism I
proposed — inherit the previous question's response type — would silently
convert genuinely free-text questions into multiple choice for every
author who adds a text row after a Yes/No one. The safer shapes are a
visible response-type control on the new row, or a template-level default
the author sets once; both are product decisions rather than defect
repairs. Recorded here with the evidence so the decision is made
deliberately rather than by whoever touches the editor next.

## Verification

- `pnpm typecheck` + `pnpm lint` green; `fire-safety.test.ts` (35 —
  two new `checkNeedsAttention` cases), `fireSafety.test.ts` (44),
  `fire-due-digest.test.ts` (7 incl. FS-J06), `conduct-state.test.ts`
  (20 incl. the new UXW56-01 case), the web suite (63 files),
  `training.test.ts` + `inspections.test.ts` (26 incl. the three new
  `renderTitle` pins) all green; full `pnpm test` before merge —
  **read from the log's own exit marker**, since a background task's
  summary reports the last command in the chain, not the test run.
  That is not a hypothetical: this pass's first full run reported
  "exit code 0" while its log said `EXIT=1`, and the failure underneath
  was the real UXW4-03 regression above.
- Explorer re-verification on a production build of the fix pass, driven
  as Steve on the same W3 tenant: the fire register's never-done checks
  read neutral; the permit close panel warns while someone is logged in;
  Authorise and Issue both ask; the handover submit names itself; the
  contractor page no longer offers the impossible template.

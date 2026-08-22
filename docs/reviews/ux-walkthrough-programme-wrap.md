# The UX walkthrough programme — wrap report

**Programme:** UXW-1 … UXW-6 plus the cross-cutting sweeps, designed and
run end to end in one session against FreeHS.
**Method:** `docs/ux-walkthrough-playbook.md` — a persona enters through
the front door, writes down what they expect *before* each action, acts,
and records the mismatch. Mismatch is the finding; the persona's words,
not the developer's, decide whether the product answered.
**Instrument:** `tools/ux-explorer` driving a real production build with
a real database, real permissions, real tokens and real PDFs.

## What it found

| Pass | Persona / world | Filed | Standing | Shipped in |
| --- | --- | --- | --- | --- |
| UXW-1 first run | P5 owner-admin, day zero | 18 | 18 | PR #66 |
| UXW-2 frontline day | P3 roofer, phone + dead zone | 11 | 11 | PR #69 |
| UXW-3 outside the fence | P4 contractor, links only | 11 | 11 | PR #70 |
| UXW-4 supervisor day | P2 supervisor, W2→W3 | 8 | 8 | PR #71 |
| UXW-5/6 manager + audit | P1 / P6 on the lived-in W3 | 4 | 3 | PR #71 |
| Sweeps SWP-A..G | cross-cutting | 5 | 5 | PR #71 |
| **Total** | | **57** | **56** | |

Of the 56 standing findings, **55 are fixed and merged**; one (UXW4-01,
the template editor's response-type default) is parked with its evidence
because the obvious mechanism would silently mis-type free-text
questions — a product decision, not a defect repair. One finding
(UXW56-03) was **retracted** at triage as an instrument error, recorded
in place rather than deleted.

Severity mix of the standing set: **1×S1, 8×S2, 24×S3, 23×S4.**

## The five that mattered most

1. **A worker could not finish his own work** (UXW2-08). `actions.setStatus`
   required `actions.manage`, so the assignee the app had just told to do
   the job could not mark it done — on the page every My-work link opens.
   The fix lets an assignee move only their own action along
   open → in_progress → completed, with the action-type group gate still
   binding.
2. **The permission model contradicted its own copy** (SWP-G1). The
   seeded Manager set promises "Create templates"; clicking Templates
   redirected any non-admin to their profile without a word, because the
   shell gated on admin while the router gated on `templates.*`.
3. **A legal signature hung on a banned UI primitive** (UXW3-01). The
   external permit acceptance — the contractor's counter-signature —
   was captured with `window.prompt`, which kiosk and WebView browsers
   suppress outright: the button reads as dead and nothing is recorded.
   All four surviving prompts became real dialogs.
4. **A completed inspection could lose its site** (UXW56-01). A required
   site question never blocked submit, so a finished walk carried
   `site_id` NULL — blank on the printed report and invisible to every
   site-scoped view, with nobody told.
5. **Nine locales printed a raw key in the navigation** (SWP-E1), and a
   fresh building's every fire check read a green "OK" beside "Last done
   —" (UXW4-03): two different ways of telling a confident lie.

## What holds up (worth knowing, and worth keeping)

The safety machinery is the strongest part of this product and the
walkthroughs kept confirming it: the SIMOPs acknowledgement appearing
exactly when a second hot-work permit overlapped; the permit close
refused with *"The entry log still shows people inside — log their exits
before closing"*; the residual-risk matrix locked until a control is
recorded, refusing a residual above the initial and demanding written
justification for a High; the RAMS issue gate naming the high-residual
hazard no step addresses; the dead-zone incident draft surviving a
killed browser intact. None of that needed fixing.

## What the programme leaves behind

- **The playbook** — repeatable, persona-driven, with dispositions and
  severities defined so a finding is adjudicated rather than argued.
- **The instrument** — `tools/ux-explorer`, now able to fill by label,
  drive Radix controls, sign on a canvas, and fetch authed exports.
- **Two new guards in CI** — the dead-link pin (SWP-A) the playbook
  nominated after that class shipped twice, and nav key parity (SWP-E),
  which covers a hole `translation-keys` structurally cannot see.
- **Six findings docs with paired response records**, so every
  disposition — including the retraction and the parked one — is
  argued in writing where the next reader will find it.
- **Three process lessons** recorded in `CLAUDE.md`: the background-task
  exit-code trap, an instrument limitation manufacturing a finding
  against the app, and guards earning their keep by refusing my own
  changes.

## Where to point the next round

1. **UXW4-01** needs a product decision (response-type default in the
   template editor).
2. **SWP-D, error injection.** The driver can now fail *individual*
   requests (`failRequests`), which is what the pass was waiting on;
   the walk itself is the next one to run.
3. **The site-scoping posture on permits**: a permit can be raised, and
   its whole lifecycle worked, with no site at all. The register now
   names the gap; whether authority should demand a site is a design
   question this programme deliberately did not answer.
4. **The practitioner rounds stay.** This programme raises the floor
   between them — it will not tell you whether the RIDDOR guidance is
   *right*, whether the product feels trustworthy, or whether the market
   wants the feature. Those hours are the scarcest instrument you have;
   the walkthroughs exist so they are never again spent discovering that
   a button is dead.

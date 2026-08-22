# FreeHS — UXW-5/6, the manager's Monday and the audit eye

**Passes:** UXW-5 (P1 manager week) + UXW-6 (P6 audit day), run together
on the lived-in W3 tenant UXW-4 left behind (playbook §5 grants the
combination; volume is modest, so the week compresses to the Monday
triage and the audit day reads the documents that week produced).
**Personas:** P1 — the workspace admin at the desk (register
ergonomics, needs-attention truthfulness, export/dashboard trust);
P6 — an auditor with infinite patience for evidence and none for
evasion (document ↔ screen coherence, version and evidence trails).
**Date:** 22 August 2026
**Instrument:** `tools/ux-explorer` (+ new `save` action fetching authed
export routes with the profile's cookies) against the local production
build with the real PDF renderer enabled (`CHROMIUM_PATH`).
**Result:** Monday triage ran across my-work, fire, permits, sites and
the observation register; the audit day read the permit PDF, the full
RAMS pack PDF and the inspection report against their screens.
**4 filed → 3 stand after triage: 1×S2, 1×S3, 1×S4 (UXW56-03 retracted — instrument error).**

One-sentence verdict: **the registers tell Monday's truth and the RAMS
pack prints as an audit-grade document — but the inspection pipeline
let a completed walk lose its required site, and the inspection report
is the one document still speaking machine time.**

---

## Findings

| ID | Shape | Sev | Where | Finding |
| --- | --- | --- | --- | --- |
| UXW56-01 | E-act | **S2** | Conduct wizard → submit; report | The site-walk inspection **completed with its required Site empty** (`site_id` NULL in the record). The conduct's title page marks "Site*" required and the supervisor picked Northfield Works mid-walk, but the selection did not persist (autosave raced the page change) and **submit enforced nothing** — the required-question validation covers page questions, not the title-page details. Consequence chain: the PDF prints a blank "Site", the site page's compliance views never see the walk, and nobody was told. Two fixes: enforce required title-page fields at submit (name the missing field), and make the site pick a synchronous save like any answer. |
| UXW56-02 | E-words | S3 | Inspection report PDF header | The report header speaks system, not English: title "**2026-08-22**" (UXW4-02's token, now on paper), "**Completed: 2026-08-22T00:40:06.853Z**" — raw ISO **with milliseconds** on a printed document (the exact class format-date.ts exists to prevent), "Status: **completed**" (lowercase enum). The body is fine (questions, typed answers, "Conducted on 22 Aug 2026"). One header pass through the house formatter + status labels fixes the document's first impression. |
| UXW56-03 | — | — | Site page, compliance cards | **RETRACTED at triage.** The original observation ("the fire card shows no figure while siblings do") was an instrument error: the aria dump was truncated before the card's stat list. A fresh read shows the card rendering "**1 check failed**" against the failed alarm test, exactly as designed. Recorded rather than deleted (the FS-G05 rule): the walkthrough's dumps must include each card's full subtree before a card is accused. |
| UXW56-04 | E-flow | S4 | Permits register / site views | A permit raised with **no site** shows a bare "—" in the register's site column, is invisible to every site-scoped view and site compliance card, and offers no way to attach a site after issue. Paired with the posture note below (lifecycle actions all worked site-less), a site-less permit is a records gap nobody is prompted to close. |

## What held up

- **Needs-attention is truthful end to end**: the fire register's strip
  ("1 failed check awaiting re-test", "1 building without a marshal")
  agrees with the building row ("Failed — awaiting re-test", "No fire
  risk assessment") and with the building page; the manager's my-work
  shows honest zeros (the follow-up action belongs to the supervisor,
  and appears in *his* queue with priority and due date).
- **The RAMS pack PDF is audit-grade**, and every UXW-3 fix shows in
  it: house-format dates in the site clock ("issued 22 Aug 2026,
  01:34"), sections 1–9 unbroken with explicit "None for this job."
  entries, "Hazards addressed" printed on the step that answers the
  High hazard, the signed author declaration, and a **briefing register
  naming both crew, the briefer, times and "Signed: Yes"** — exactly
  what was captured on screen, in order.
- **Register defaults read like a manager thinks**: permits open on
  the live pile (2 Active), closed work is one filter away, and the
  site page's "View all" links land the registers pre-filtered
  (`?site=`).
- **The permit PDF renders the full two-page document** through the
  real engine; the closed canopy permit prints with its lifecycle
  intact.
- **Version history is navigable at current depth**: the pack page
  lists v1 with its own PDF link; the timeline carries create → bind →
  issue → briefings → client events in order.

## Harness notes (for triage, not findings)

- **Screen-vs-PDF times differ by one hour in this environment by
  design**: the headless browser runs UTC, so the app UI shows UTC
  wall-times while documents print the site clock (Europe/London,
  BUG-14 doctrine). A UK viewer's browser would agree with the paper.
  Filed as environment artifact, not a finding — but UXW-6's screen
  comparisons were done with that offset in mind.
- The register CSV exports build client-side (`download-csv.ts`) and
  headless downloads land in a temp profile dir; export *content* was
  not diffed this pass. The `save`-action route works for every
  server-side export (`/api/exports/*`), which is where document trust
  lives.
- FreeHS ships no free `/analytics` Overview (the nav has none);
  `/en/analytics` quietly lands on My work. Dashboard trust therefore
  reduces to the paid custom dashboards, out of scope for this tenant.
- The world's own data hygiene explains two zeros a manager would
  question: the height RA was authored site-less (so "Risk assessments
  0" on the site card is true-but-surprising), mirroring the no-site
  permit finding above.

## Route ledger (these passes)

`/[locale]/my-work` (admin) · `/[locale]/fire-safety` (strip + row
flags) · `/[locale]/permits` (defaults, site column) ·
`/[locale]/sites` + site page (compliance cards, pre-filtered links) ·
`/[locale]/observations` (row) · `/api/exports/permit-pdf` ·
`/api/exports/rams-pdf` · `/api/exports/pdf` (inspection report) —
each read against its source screen.

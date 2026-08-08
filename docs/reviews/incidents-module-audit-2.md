# FreeHS — Incidents & Investigations module audit

**Module:** Incident & Accident Management (register, per-kind detail blocks, RIDDOR engine, versioned investigations, findings → actions, effectiveness review)
**Surface:** 38 tRPC procedures · 8 tables · 5 permission keys · 3 workers
**Date:** 8 August 2026
**Deliverable:** 17 tests in `incidents.audit.test.ts`, of which **2 fail on one real defect**

---

## Why this module needed a different instrument

Incidents carries the only special-category data in the product. Two kinds —
`sharps_exposure` and `violence_aggression` — default to confidential at
creation, and the module's contract is unusually strong:

> confidential records are **counted, not readable** — enforced on every read,
> including search, AI and CSV.

`incidents.ts` backs that with **36 call sites** of `assertDetailAccess` /
`canViewConfidential` across 38 procedures. `incidents.test.ts` already checks
a sample (IN-E14).

**A sample is the wrong instrument for a claim about *every* read path.** So
this suite makes the confidentiality axis generated. It stamps unique sentinels
into a confidential incident's title, description and investigation finding,
then calls every `incidents.*` procedure as a caller holding view + report +
investigate + manage — everything except `incidents.confidential.view` — and
greps every response for them.

Two properties make the sweep hard to fool. A control test proves the sentinel
is genuinely stored and readable *by an authorised caller* first, so the sweep
cannot pass on an empty fixture. And a declared `READ_PATHS` list names the
query procedures that must be genuinely exercised — a read path that merely
rejects the probe input is a coverage hole that **fails** the test rather than
passing it quietly.

**The module's own gate is sound.** Nothing leaked from any of its 38
procedures. The defect is what happens when the content leaves.

---

## The finding

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **IN-C06 / IN-C07** | **High** | **A confidential incident's investigation finding becomes a plainly readable action title.** `approveInvestigation` builds the generated action as `Incident finding: ${finding.description.slice(0, 200)}` — and on a violence or sharps case the finding *is* the sensitive content. Proven at two surfaces: the actions hub, and full-text search. | `incidents.ts:2269` |

### What makes this one sharp

Look at what the code around it gets right. The action's **description** was
written carefully:

```ts
description: `Raised by incident ${incident.referenceNumber} — category: ${finding.category}.`
```

Reference number, not title. Deliberate.

The actions hub was written carefully too — it blanks the source card's title
for a confidential incident, **with a comment saying so**:

```ts
// Confidential incidents keep their title out of the action's
// source card — the reference alone is enough to navigate…
title: row === undefined || row.confidential ? null : row.title,
```

And the incidents module's own chase worker (`incident-chase.ts`) uses
`referenceNumber` throughout and never the title.

So three separate places got the confidentiality question right. The action's
**own title** — the field every one of those surfaces renders first — did not.
Somebody protected the label on the box and left the contents on the outside.

### Where it comes out

**IN-C06 — the actions hub.** The assignee in the test holds `actions.view` and
nothing whatsoever from incidents. `actions.list` returns them the finding
verbatim.

**IN-C07 — global search.** `search.global` matches `actions.title` for any
`actions.view` holder with **no confidentiality consideration at all**. So the
sentence the incidents module refuses to put in its own search results is
reachable from Cmd-K by typing it.

**A third surface, read but not tested here:** `action-reminders.ts:220`
interpolates `r.title` straight into the reminder email body — so the finding
also leaves the building by email, to whoever owns the action. I have not
written a test for that one; the root cause is identical and all three surfaces
are fixed by a single change at the source, which the two failing tests already
pin.

**The fix.** Title the action from the finding's *category* and the incident's
*reference* — `Incident finding (supervision) — IN-000412` — and leave the
description to the incident page, where detail access is re-checked. That keeps
the action navigable without carrying the content, exactly as the source card
already does.

---

## What holds

All asserted by passing tests, and the list is longer than usual because this
module is genuinely careful.

**The generated sweep is clean.** Not one of the 38 procedures returns a
confidential title, description or finding to a caller without the key — with
all six declared read paths (`list`, `get`, `overview`, `exportCsv`,
`renderPdf`, `reviewPromptCandidates`) genuinely exercised rather than skipped.

**Counted, not readable, means what it says.** The register returns the row with
`restricted: true` and `title: null` — the incident is *counted* in the
statistics a safety officer needs without being *named*. The CSV export writes
`Confidential` rather than dropping the row, which is the same distinction and
the harder one to remember.

**The gate is a gate, not a wall.** The reporter and the lead investigator keep
full access to their own case. This matters more than it looks: if the two
people who actually handle a violence case are locked out, the confidential
kinds become unusable and somebody files the next one as `injury` instead —
which is how a confidentiality feature makes things worse than none.

**Separation of duties is real.** The lead investigator cannot approve their own
investigation, and an independent approver can. An investigation signed off by
the person who wrote it is not an investigation, it is a statement — and the
entire evidential value of the record is that somebody independent accepted it.

**Approved investigations freeze**, and are not reopenable before closure.

**The permission split works at the bottom end too.** `incidents.report` files
an incident and cannot list the register, run the overview or export the CSV.
That is the right shape: anyone should be able to report, and almost nobody
should be able to browse a list of other people's injuries.

**Tenancy** — generated across all 38 procedures against a foreign incident,
plus siting at a foreign site and naming a foreign person.

---

## Test bugs of mine

Four, all shape errors, all caught by running: `violence_aggression` requires a
`details` block; `submitInvestigation` needs `immediateCause` and
`conclusionSummary` saved first; `incidents.list` returns a bare array;
`actions.list` returns `{ rows, totalCount }`.

One design correction worth recording. IN-C01 first counted "inconclusive"
procedures and passed if there weren't too many — which would have let a read
path drop silently out of coverage the moment its input schema changed. That is
the same failure mode as a sample, rebuilt inside a generated test. Replacing
the count with a declared `READ_PATHS` list that must be *exercised* is what
makes the sweep an assertion rather than a statistic.

---

## Eleven modules

| Module | Tests | Defects | Chosen for |
| --- | --- | --- | --- |
| Contractors | 52 | 18 | Cold, never reviewed |
| Training | 32 | 4 | Reviewed and fixed twice as prose |
| Documents | 34 | 3 | Load-bearing; own access layer |
| Heads-Up | 23 | 7 | Consumes that access layer |
| Assets | 21 | 3 | Reads three other modules |
| RAMS | 21 | 1 | Reads more modules than anything |
| Fire Safety | 20 | 2 | Where a stale record is the hazard |
| COSHH | 26 | 5 | Encodes regulation; has an AI boundary |
| Risk Assessments | 30 | 3 | Everything else depends on it |
| Permits | 20 | 4 | Best defended; densest consumer |
| **Incidents** | **17** | **1** | **Carries special-category data** |

**296 tests. 51 defects.** Every FreeHS module now has a suite that cannot
drift.

### Seventeen instances — and this one inverts the pattern

Every previous instance was a module **reading** another module's records and
applying only its own rule. This one is a module **writing into** another
module's records and carrying its own confidentiality out with the payload.
Incidents did not fail to check something; it failed to redact something on the
way out, and the actions module had no way to know it should.

That distinction matters for the fix. Sixteen instances say *the reader must
apply the owner's rule*. This one says *the writer must not export content the
owner protects*. A sweep that only inspects reads would have missed it entirely
— which is an argument for scoping the recommended cross-module sweep to
**both** directions of every join: what does this module read without checking,
and what does it write out without redacting.

That sweep and the untouched web layer remain the two pieces of work. Nothing
in these 296 tests reaches a `.tsx` file.

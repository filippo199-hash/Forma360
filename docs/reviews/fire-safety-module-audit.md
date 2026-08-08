# FreeHS — Fire Safety module audit

**Module:** Fire Safety (buildings, FRAs, significant findings, logbook, doors, drills, PEEPs, marshals)
**Surface:** ~35 tRPC procedures · 12 tables · 4 permission keys · 1 worker
**Date:** 8 August 2026
**Deliverable:** 20 tests in `fireSafety.audit.test.ts`, of which **2 fail on real defects**

---

## Why this module

Fire safety is the module where **a stale record is not an inconvenience, it
is the hazard.** A logbook that reads green past a failed alarm test, a marshal
whose competence expired in one register while another says it is current, an
FRA published without an evaluation — each of those is a document a fire
officer will read, and one a coroner may read afterwards.

The module's own code knows this. FS-1 exists specifically so that *"advancing
the schedule must never make a failed alarm test read green."* The audit was
built to test whether the code lives up to its own comments.

Mostly, it does.

---

## Findings

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **FS-G05** | High | **A published fire risk assessment can be edited in place.** `fras.update` accepts an FRA whose status is `published` and rewrites its text — no version bump, no return to draft, no event. The statutory document changes underneath whoever relied on it, and the audit trail shows nothing happened. The test publishes a complete FRA, edits its evaluation to `EDITED AFTER PUBLISH`, and finds the published row carrying that text. | `fireSafety.ts:1016-1080` |
| **FS-X01** | High | **Marshal competence is tracked in two registers that disagree.** `fire_marshals` carries its own `trainedAt` / `trainingExpiresAt`, and `marshalTrainingStatus` reads only that row. Nothing in the repo reconciles it against `training_records`. The test gives a marshal a lapsed local date **and** a current fire-marshal ticket in the training matrix; the fire register reports `expired`. | `fireSafety.ts:2635`, `fire-safety.ts:430` |

**On FS-G05.** RAMS gets exactly this right — its issued version row is never
`UPDATE`d, and editing produces a new draft (RS-I02). Fire safety has the same
publish concept and none of the protection. Given the FRA is the statutory
artefact under the Fire Safety Order, this is the more consequential of the two
places to have got it wrong.

**On FS-X01.** The module comment still reads *"training dates are carried
locally until Phase 10"* — and Training (module B7) has shipped. So a marshal
renews their certificate, the training matrix goes green, and the fire register
a fire officer inspects keeps saying expired while the daily digest keeps
chasing them. **The reverse case is worse:** somebody types a date into the
fire register and the marshal reads as competent with no training record behind
it at all. Two systems of record for one fact, and the wrong one is the one on
the fire document.

---

## Verified correct — no action

All asserted by passing tests. FS-1 is the one that mattered most, and it holds.

**The failed-state rule**

- A check recorded as `fail` holds a red `failed` state **regardless of the
  advanced due date**, and a subsequent pass is what clears it. The comment
  promises this; the code delivers it.
- The logbook exposes **no** update, edit or delete procedure at all — the
  evidential record is append-only by construction, not by convention. The
  test asserts the absence generically, so adding a mutator later fails it.

**The FRA publish gate** — nine preconditions, four of them tested directly:
an empty FRA is refused; one missing any leg of the fire triangle or its
persons-at-risk is refused; a complete one publishes; and an **intolerable**
rating carrying no actionable finding is refused. That last is the single worst
artefact this module could emit and it cannot be emitted.

**The permission split** — `fireSafety.record` genuinely separates. A caretaker
can log a check and cannot create buildings, archive them, create FRAs or
appoint marshals. This matters beyond its own module: it is the precedent the
Training catalogue explicitly cites for `training.record`, so if it did not
hold, the thing modelled on it was modelled on nothing.

**Tenancy** — building read, update, archive and `setupChecks`; the logbook and
marshal lists; FRA attachment to a foreign building; marshal appointment of a
foreign user; and a fire door binding an asset from another tenant. All refused
or empty, never leaking.

**Idempotency** — running `setupChecks` twice does not double the schedule,
which matters because the button is on the page and users press buttons twice.

---

## Three test bugs of mine, and why the third is worth recording

All the same species that has recurred through this series: **calling a
procedure by a name or shape it does not have.**

- `buildings.create` returns `{ id }`, not `{ buildingId }`.
- `logbook.recordEntry` takes `buildingId` + `checkType`, not `checkId`.
- The marshals sub-router is **`add`**, not `create`.

The third is the one to note. Until `tsc` caught it, FS-X01 was failing
*because the marshal had never been created* — not because the two registers
disagree. It was a red test for the wrong reason, which is only marginally
better than a green one for the wrong reason. It now fails on the real
assertion: `fireRegisterSays: 'expired'` against a current training record.

This is the fourth time in seven audits that a type error or a deliberate
sanity-check has been the thing that separated a real finding from an artefact
of my own test. It is the strongest argument for keeping these suites in
TypeScript against the real router rather than as scripts against HTTP.

---

## Seven modules in — stop, and sweep

| Module | Tests | Defects | Chosen for |
| --- | --- | --- | --- |
| Contractors | 52 | 18 | Cold, never reviewed |
| Training | 32 | 4 | Reviewed and fixed twice as prose |
| Documents | 34 | 3 | Load-bearing; own access layer |
| Heads-Up | 23 | 7 | Consumes that access layer |
| Assets | 21 | 3 | Reads three other modules |
| RAMS | 21 | 1 | Reads more modules than anything |
| Fire Safety | 20 | 2 | Where a stale record is the hazard |

**183 tests. 38 defects. Every module is now covered by a suite that cannot
drift**, because each one enumerates its procedures from the router at runtime
rather than from a list somebody has to maintain.

Two conclusions, and they have not changed since the Assets audit — they have
only got better supported:

**1. The cross-module sweep is overdue.** Twelve of the eighteen defects found
in the last four modules are one mistake: a module touching another module's
records without applying that module's rule. Heads-Up → Documents (four),
Assets → Observations/Actions/Inspections (three), RAMS → Documents (one), and
now Fire Safety → Training, which is the same failure in a new costume —
not a disclosure this time, but a duplicated source of truth. A seventh, eighth
and ninth module audited in isolation will keep finding it one instance at a
time. One generated sweep over every cross-module join, asking *does this apply
the owning module's rule?*, would find the rest in a single pass.

**2. The web layer is still untouched by all seven suites.** Every defect above
is router, worker or data. The last three prose reviews found their worst
defects in `.tsx` files, and none of these 183 tests can reach one.

Those are the two pieces of work now. Neither is another module.

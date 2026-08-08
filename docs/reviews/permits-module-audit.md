# FreeHS — Permits module audit

**Module:** Permit to Work (type catalogue, permit lifecycle, gas testing, isolation, SIMOPs, workers & entry log, handover, closure)
**Surface:** ~27 tRPC procedures · 4 tables · 4 permission keys · 1 worker
**Date:** 8 August 2026
**Deliverable:** 20 tests in `permits.audit.test.ts`, of which **4 fail on real defects**

---

## Why this suite is shaped differently

Permits arrives better defended than any module in this series.
`permits.test.ts` already carries 58 tests across PW-E10..E35, written
alongside the module and hardened after an HSE expert review. The lifecycle,
the gas gate, SIMOPs, handover, extension and closure are all covered.

So this suite deliberately does not re-run them. It goes at the three places a
suite written from **inside** a module systematically cannot reach.

**The generated permission matrix.** PW-E13 checks that a standard user cannot
create, issue or manage types. That is a sample. This suite enumerates every
`permits.*` procedure from the router at runtime, so a procedure added next
month cannot quietly ship ungated.

**The joins outward.** A permit is the document asserting that work has been
assessed and controlled, which makes it the densest consumer of other modules
in the product — risk assessments, RAMS packs, the training matrix, the
document library, sites, users. Nine audits had found the same defect fourteen
times before this one.

**The physical register.** The entry log is not bookkeeping. In a confined
space it is what the standby person reads to know how many people are inside,
and what a rescue team is handed.

All four defects are in the last two categories.

---

## Findings

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **PW-X03** | **High** | **The competence gate is satisfied by a namesake.** For a worker with no linked account the match is `personName.toLowerCase()`. An untrained "john smith" typed onto the gang passes on a ticket belonging to a *different* John Smith — and appears in no shortfall list, so the permit page shows him as competent. | `permits.ts:598-606` |
| **PW-S01** | **High** | **The same person can be logged into the entry register twice.** `logEntry` appends unconditionally. Two open rows for one body: the board reads two inside when one is there, and exiting one row leaves the register claiming somebody is still in the space. | `permits.ts:1646-1682` |
| **PW-X01** | Medium | **A method statement the issuer cannot open can be linked to a permit.** `loadDocumentInTenant` checks tenant and existence and nothing else — not `visibleToGroupIds`/`visibleToSiteIds`, not the folder cascade. `permits.get` then hands the document's name to every `permits.view` holder. | `permits.ts:256-267` |
| **PW-X02** | Medium | **An archived method statement can be cited as the safe system of work.** Same loader, second omission: no `isNull(documents.archivedAt)`. | `permits.ts:256-267` |

---

### PW-X03 — the gate that reports competence nobody holds

FreeHS B7 replaced the old "competence of all operatives verified" tickbox with
a real check against the training matrix. That was the right move, and it is
why this defect matters: **the tickbox was honest about being a human
assertion; the gate is not.** It prints a verdict.

The matrix legitimately supports unlinked records — a contractor with no
account, keyed by name. That is a deliberate design, and it is what makes name
matching necessary. But when the permit's gang carries a free-text name with
`userId: null`, the join is a case-insensitive string compare, and two people
called John Smith are one person as far as a hot-works permit is concerned.

The narrow fix is available without touching the Training module's design:
**where a permit type carries `requiredTrainingIds`, require a linked `userId`
on every named worker.** The gate can then be exact for exactly the permits
where it is load-bearing, and free-text names stay available everywhere else.

**This one nearly escaped.** The test originally asserted that `issue` refused,
and it did — so the test was green. But the refusal was `training-missing` for
*Sam Standard*, the acceptor, who had no ticket of his own. The namesake was
never flagged at all; he had sailed through, and the assertion happened to be
satisfied by an unrelated failure. It now asserts on the shortfall list
directly.

### PW-S01 — a register that cannot be counted

`openEntryCount` is the number the closure check uses ("personnel clear") and
the number the live board shows. `logEntry` will happily create a second open
row for a worker already inside.

The failure runs both ways, which is what makes it more than untidy:

- Log someone in twice and the board says **two people are inside** when one
  is. A rescue crew is told to find two.
- Exit one of those rows and the register still says **somebody is in there**,
  so closure is blocked and the count nobody can reconcile becomes the reason
  the permit stays open.

The module already refuses `entry-log-full` at 500 rows and validates the
worker id, so the shape of the guard exists — it just does not ask whether that
person is already inside.

### PW-X01 / PW-X02 — the pattern's seventh appearance, and the mildest

Same missing check, same file, one loader:

```ts
.select({ id: documents.id, name: documents.name })
.from(documents)
.where(and(eq(documents.id, id), eq(documents.tenantId, tenantId)))
```

Tenant and existence. No visibility, no archived filter.

**Stated precisely, because this one is milder than its predecessors:** the
permit surfaces only the document's *name*, and the bytes stay behind the
documents module's own access check. So PW-X01 is a name disclosure plus an
integrity gap, not a content leak — unlike RS-X01, which froze the disclosure
into a client-facing pack. PW-X02 is the one with the sharper edge: a
*withdrawn* method statement is exactly the document that must not be cited as
a safe system of work, because withdrawal is how the library says "do not work
to this."

---

## What holds

All asserted by passing tests. This module earns its reputation.

**The lifecycle is genuinely terminal.** Closed and cancelled permits refuse
every one of the nine lifecycle mutations — asserted **generated over the whole
list**, not sampled, so a lifecycle procedure added later is covered the day it
lands.

**The gas verdict is a true snapshot (PW-1).** A reading recorded as
out-of-range stays out-of-range after the type's limits are widened underneath
it. That has to hold: the reading is evidence of what the instrument said and
what it meant at the moment somebody decided to enter.

**Closure is blocked while anyone is inside** and unblocks the moment they log
out — the correct half of the register story.

**The authority model is real.** `permits.create` plans and cannot authorise,
issue, close, or create types. The acceptor — holding only `permits.view` —
can log entries at the face but cannot close the permit. That split (PW-9) is
what stops a site either handing out issuing authority to get the register
filled in, or leaving it blank.

**RS-A11 preview parity.** The blocker previewed on the permit page is exactly
the one `issue` enforces, both computed by the same pure helper. A preview that
said "ready" over a gate that refuses would be worse than no preview, because
the issuer stops checking.

**SIMOPs never crosses tenants.** Conflicts are matched on free-text location,
so an unscoped query would both leak that a rival tenant has work at "Tank 4"
*and* block your issue over it. It is properly scoped.

**Tenancy** — across `get`, `renderPdf`, all nine lifecycle mutations, siting,
worker naming, and all three safe-system-of-work links (risk assessment, RAMS
pack version, method-statement document).

---

## Ten modules — the series is complete

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
| **Permits** | **20** | **4** | **Best defended; densest consumer** |

**279 tests. 50 defects.** Every FreeHS module now has a suite that cannot
drift, because each enumerates its procedures from the router at runtime rather
than from a list somebody maintains.

**The COSHH fix pass landed during this audit** — all five of its defects,
including the critical cross-tenant health-surveillance disclosure, verified
fixed at 39 green tests.

### The cross-module sweep — sixteen instances, and no module left to find them one at a time

| Reader → owner | Rule skipped |
| --- | --- |
| Heads-Up → Documents (×4) | visibility |
| Assets → Observations / Actions / Inspections (×3) | visibility |
| RAMS → Documents | visibility |
| Fire Safety → Training | source of truth |
| COSHH → Users | **tenancy** |
| Permits → Risk Assessments | status |
| Permits → Documents (×2) | visibility, archived |
| Permits → Training | identity |

**Sixteen of the twenty-eight defects found in the last seven modules are one
mistake.** Note what the right-hand column has become: it started as
"visibility" and now includes tenancy, status, archived-ness and identity. It
is not one check being forgotten — it is the general habit of resolving another
module's row by id and tenant, and going no further.

Every module is now audited. **There is no eleventh module to find the
seventeenth instance in.** One generated sweep over every place a router
selects from another module's table — asking, of each, *does this apply the
owning module's rule?* — is one test in the shape of the permission matrix, it
cannot drift, and on the evidence of these ten audits it is the highest-value
work left in the codebase.

### The web layer remains untouched

All 50 defects are router, worker or data. The prose reviews found their worst
defects in `.tsx` files. None of these 279 tests can reach one.

Those two are the work now.

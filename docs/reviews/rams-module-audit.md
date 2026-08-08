# FreeHS — RAMS module audit

**Module:** RAMS (method statements, packs, versioning & issue, briefings, client acceptance links, contractor reviews)
**Surface:** ~34 tRPC procedures · 11 tables · 6 permission keys — the largest module in the product
**Date:** 8 August 2026
**Deliverable:** 21 tests in `rams.audit.test.ts`, of which **1 fails on a real defect**

---

## Why this module, and what was expected

RAMS is the densest cross-module node in FreeHS. A pack binds risk-assessment
**versions**, references COSHH records, attaches library documents, is issued
to a client over an opaque public link, is briefed to a crew, and is read back
by Permits as a precondition for issuing a permit to work.

The three audits before this found the same defect ten times over: a module
reading another module's records without applying that module's access rule.
RAMS reads more modules than anything else here, so it was going to be either
the worst case of that pattern or the place it was done properly.

**It is the best-built module audited so far.** Twenty of twenty-one pass.

---

## The one defect

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **RS-X01** | High | **`packs.addDocument` performs no visibility check.** It resolves the document by tenant and archived-ness only, so an author can attach a library document they cannot themselves open. RS-X00 is the control: `documents.get` refuses that same author outright. | `rams.ts:1453-1520` |

This is the pattern's sixth appearance, and here it is **sharper than
anywhere else**. In Heads-Up the equivalent defect had two possible fixes —
refuse at attach, or filter at render — and the shipped fix did both. In RAMS
only one of those exists:

> A pack snapshots its documents into an **immutable issued version**, and
> then serves that version to an **unauthenticated client** over a share link.
> There is no later render at which a filter could run.

So attach time is not the cheaper fix here, it is the *only* one. The good news
is that the fix is already written next door: Heads-Up's `create` now refuses
an author attaching a document they cannot open, and this is the same check in
the same shape.

---

## What holds — and the freeze is the part that had to

RAMS exists to answer one question: *what was in force on the day?* Everything
below is now asserted by a passing test.

**The freeze**

- **RS-I01** — publishing a new version of a bound risk assessment does **not**
  alter an issued pack. The test rewrites a hazard's wording in RA version 2
  and confirms the issued pack's content is byte-identical afterwards and does
  not contain the rewritten text.
- **RS-I02** — saving a draft against an issued pack never `UPDATE`s the issued
  version row. Editing produces a new draft; the crew's copy does not move
  underneath them.
- **RS-I03** — re-issuing writes version n+1 and leaves version n readable.
  Without that, "what was in force on the day" has no answer.

**The issue gate**

- **RS-G01** — the headline rule of ADR 0015 holds: a pack binding an
  assessment with a high residual risk, whose method describes no step
  addressing that hazard, is **refused**. That is the rule the module was
  designed around, and it is enforced.
- **RS-G02** — the same pack issues once a step references the hazard, so the
  gate is a gate and not a wall.
- **RS-G03** — issuing without confirming the attestation is refused. The
  attestation text is snapshotted onto the issued version as the record of what
  the signer asserted; letting it default would make that record a fiction.

**Six permission keys that mean six things**

- **RS-P02** — `rams.issue` genuinely separates from `rams.create`: a
  draughtsman who can author a pack cannot sign it.
- **RS-P03** — `rams.brief` lets a site supervisor record a crew briefing
  without authoring or issuing rights.

Worth naming plainly: this is the finest-grained permission catalogue in the
product, and every key checked does what its name says. The equivalent key in
Contractors (`contractors.gate`) gated nothing at all, so this is not a given.

**The client acceptance link**

- No `tenantId` on the unauthenticated payload.
- No token projected into the pack view — the test asserts the token appears
  **nowhere in the whole payload**, not merely off one projection.
- A revoked link stops resolving.
- An accepted decision **cannot be re-decided** from the public endpoint. That
  matters: the acceptance is recorded against the exact issued version and is
  the client's contractual answer.
- An unknown token resolves to nothing.

**Tenancy** — across read, draft, issue, archive, attach and bind, including
that a pack cannot bind a risk assessment from another tenant.

---

## One test bug of mine

`RS-C02` originally called `rams.client.list`, which does not exist — client
links come back through `packs.get`. Retargeted there, and improved in the
process: it now asserts the token appears nowhere in the serialised payload
rather than merely being absent from one projection.

---

## Six modules in — the sweep is overdue

| Module | Tests | Defects | Chosen for |
| --- | --- | --- | --- |
| Contractors | 52 | 18 | Cold, never reviewed |
| Training | 32 | 4 | Reviewed and fixed twice as prose |
| Documents | 34 | 3 | Load-bearing; has its own access layer |
| Heads-Up | 23 | 7 | Consumes that access layer |
| Assets | 21 | 3 | Reads three other modules |
| RAMS | 21 | 1 | Reads more modules than anything else |

**Eleven of the eighteen defects across the last four modules are one mistake**
— a module reading another module's records without applying that module's
access rule. Heads-Up did it to Documents in four places, Assets to
Observations, Actions and Inspections in three, RAMS to Documents in one.

The encouraging read is that RAMS — the module with the most opportunities to
get this wrong — got it wrong once. The discouraging read is that it still got
it wrong, in the module where the consequence is worst, because the disclosure
is frozen into an immutable artefact and mailed to a client.

Either way, the conclusion from the Assets audit stands and is now stronger: a
seventh module audited in isolation will keep finding this one instance at a
time. **The proportionate next step is a single generated sweep over every
cross-module join in the product** — every place one router selects from
another module's table — checked against one question: *does this apply the
owning module's access rule, or only its own?*

That is one test in the shape of the permission matrix, it cannot drift, and
it would cover the joins these six audits have not reached: permits ↔ RAMS,
fire safety ↔ assets, incidents ↔ nearly everything, COSHH ↔ documents.

The web layer remains untouched by all six suites.

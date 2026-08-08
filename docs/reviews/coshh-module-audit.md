# FreeHS — COSHH module audit

**Module:** COSHH (substances, locations, safety data sheets, assessments, exposure monitoring, LEV, health surveillance)
**Surface:** ~30 tRPC procedures · 10 tables · 3 permission keys · 1 AI import route
**Date:** 8 August 2026
**Deliverable:** 26 tests in `coshh.audit.test.ts`, of which **5 fail on real defects**

---

## Why this module is different from the seven before it

**It encodes regulation, not workflow.** Most modules here model a process —
raise, review, approve, close. COSHH's publish gate models the Control of
Substances Hazardous to Health Regulations themselves: routes of exposure
identified, controls present, a PPE-only control set justified because PPE is
the bottom of the hierarchy, and substitution considered before a carcinogen
goes live. Those are not product opinions. They are reg 6, reg 7(1), reg 9 and
reg 11. **A defect here is a defect in the advice the product gives**, which is
worse than a defect in its bookkeeping.

**It has an AI boundary.** The SDS import sends a supplier's safety data sheet
to a model and turns the answer into the substance record — hazard statements,
pictograms, workplace exposure limits. Ground rule 2 says every external
response is validated before we trust it, and a model is the most external
response there is.

The regulatory gate is the best-built thing in this module. The boundaries
around it are where the five defects are.

---

## Findings

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **CO-S05** | **Critical** | **Another tenant's people can be enrolled onto the health surveillance register, and their names come back on it.** `surveillance.enroll` takes `userId: z.string().min(1)` and never checks the user belongs to the tenant. `surveillance.list` then left-joins `user` for the display name **with no tenant predicate of its own**. The test enrols tenant B's admin against a tenant A substance and reads the name `Ada Admin` off tenant A's register. | `coshh.ts:1736-1785` |
| **CO-A02** | Medium | **`sds.attach` accepts a storage key from another tenant.** The key is a free `z.string().max(500)` with no `assertStorageKeyInTenant`. Six sibling routers apply that guard. | `coshh.ts:224-232, 949` |
| **CO-A01** | Medium | **The AI extraction is not validated at the tRPC boundary.** `extraction` is `z.unknown()`, cast into a `$type<SdsExtraction>()` column with `as never`, under the comment *"already validated by sdsExtractionSchema shape"*. The HTTP route does validate — but the route is not the only way in. | `coshh.ts:230-231, 979` |
| **CO-S03** | Medium | **A failed LEV thorough examination can be cleared without a passing one.** The fail correctly sets the unit `out_of_service`; `lev.update` then lets the status be set straight back to `in_service` with no passing examination on record — and the next-due date is already 14 months past the *failed* exam. | `coshh.ts:1594-1636` |
| **CO-R07** | Low–medium | **Editing a live assessment leaves no trail.** `assessments.update` writes no `coshh_events` row, while every other mutation in the module does. Republishing then clears the "changed since publish" flag, so no residue survives at all. | `coshh.ts:1098-1140` |

---

### CO-S05 is the one to fix first

This is the pattern these audits keep finding — a module touching another
module's records without applying that module's rule — but it is the **first
time it has produced a live cross-tenant disclosure of personal data.** Every
previous instance leaked within a tenant, between users who at least share an
employer. This one crosses the tenant boundary, which ADR 0002 exists to make
impossible, and the data it leaks is *who is under health surveillance for
exposure to a hazardous substance* — special-category data under UK GDPR
Article 9.

The root cause is one line missing, and the fix already exists in the codebase:

> `packages/api/src/routers/coshh.ts` imports **nothing** from
> `../tenant-guards`. `assertUsersInTenant` is right there, exported, used by
> six other routers.

That single omission also explains **CO-A02** — same file, same missing import,
different guard. Two of the five findings are one fix.

**On CO-A02's blast radius, stated precisely:** `/api/files` independently
re-checks that the key starts with the caller's tenant ID, so a foreign key
stored on an SDS row will not actually serve the file. This is a boundary gap
and a data-integrity hole, not a live read. It should still be closed — the
second layer holding is not a reason for the first one to be absent.

### CO-A01 — the comment is the defect

```ts
/** AI extraction snapshot, already validated by sdsExtractionSchema shape. */
extraction: z.unknown().optional(),
```

…then, at the insert:

```ts
extraction: (input.extraction ?? null) as never,
```

`sdsExtractionSchema` is already exported from `@forma360/shared/coshh`, whose
own module comment calls it *"the Zod boundary every AI-extracted safety data
sheet passes through before we trust it (ground rule 2)"*. It is applied on the
way **out of the model** and dropped on the way **into the database**. The `as
never` exists solely to smuggle `unknown` into a typed column, so the column's
`$type<SdsExtraction>` claim is false for anything written through the
procedure directly.

The fix is `extraction: sdsExtractionSchema.optional()` and deleting the cast.

### CO-S03 — the FS-1 rule, missing from the module next door

Fire Safety holds a failed check red until a pass clears it, specifically so
that *advancing the schedule can never make a failed alarm test read green*.
LEV has exactly the same shape and none of the protection: a thorough
examination is a statutory event under reg 9, a fail means the plant is not
fit for use, and what makes it fit again is a passing examination — not
somebody setting a dropdown back.

### CO-R07 — what this test does *not* claim

Worth being explicit, because the obvious reading is wrong. Unlike RAMS and the
FRA, a COSHH assessment here is **deliberately a living document**: `update` on
an active assessment is allowed, and `updatedAt > lastPublishedAt` drives a
"changed since publish" prompt in the UI. That is defensible — nobody holds a
countersigned copy of a COSHH assessment the way a crew holds a briefed RAMS
pack, so the immutability argument that applies to those does not apply here.

The defect is the **trail**, not the edit. Control added, control removed,
substitution updated, SDS attached, review recorded, published — all write to
`coshh_events`. `update` writes nothing. So the fields that decide the control
regime can be rewritten on a live assessment with no record of who did it or
what it said before, and republishing clears the only signal that anything
changed.

---

## Verified correct — no action

All asserted by passing tests.

**The publish gate — this is the module's reason to exist, and it holds**

- No routes of exposure → refused (`no-routes`).
- No controls at all → refused (`no-controls`).
- A control set that is entirely PPE/RPE with no written justification →
  refused. This is the single most common way a COSHH assessment is wrong in
  the field, and the product refuses to rubber-stamp it.
- The same assessment publishes once an engineering control is added — so the
  gate is a gate, not a wall.
- **Reg 7(1), substitution first:** a carcinogen whose substitution status is
  `not_assessed` cannot go active, and recording the decision unblocks it.

**The statutory intervals**

- A LEV test interval longer than the statutory **14 months** is refused at the
  boundary — you cannot type 24.
- A **back-dated** historical examination does not move the schedule backwards.
  Catch-up data entry is normal and must not make an in-date unit read overdue.
- A failed examination **does** take the unit out of service (it is the return
  path that is broken, above).
- **The WEL comparison never silently passes.** Recording a result against an
  agent with no limit on record, or against a period with no limit (a TWA on
  record but no STEL), returns `null` — "not comparable" — rather than
  collapsing to `false`. A green tick you have not earned is the dangerous
  outcome here, and the code gets it right.
- Health surveillance: one live enrolment per person per substance, and
  recording a check moves the recall date by the enrolment interval.

**The permission split** — `coshh.create` genuinely separates from
`coshh.manage`. An assessor can add a substance and draft an assessment and
cannot publish one, archive a substance, or rename it. Drafting the control
regime and signing it off are different authorities.

**Inventory hygiene** — the duplicate-name guard is case-insensitive and needs
an explicit `allowDuplicate` to override. Two records for one product is how an
inventory stops being an inventory: one gets the SDS, the other gets the
assessment, neither is complete.

**Tenancy** — substance read, update, archive, `setSubstitution` and assessment
creation against a foreign substance; locating a substance at a foreign site;
and a RAMS pack binding a foreign COSHH assessment. All refused.

---

## Three test bugs of mine

Same species as every module before it — calling a procedure by a shape it does
not have.

- `substances.setSubstitution` takes `{ status, notes }`, not
  `{ substitutionStatus, substitutionNotes }`, and the enum is
  `considered_rejected`, not `not_reasonably_practicable`.
- `locations.add` takes `locationText`, not `description`.
- CO-R07 was originally written as *"a published assessment is not editable"*,
  asserting against a design this module deliberately does not have. Reading
  `lastPublishedAt`'s two consumers in the web layer is what corrected it.

The second one is worth recording for the same reason the Fire Safety marshal
bug was: **CO-T01 was passing for the wrong reason.** It asserted that
`setSubstitution` against a foreign substance is refused — and it was, but by
Zod rejecting my wrong field name, before the tenant check ever ran. A green
test proving nothing. Fixing the field name is what made it a real assertion.

That is the fifth time in eight audits that a correction has separated a real
result from an artefact of my own test, and the third time the artefact was a
*pass*. Failing for the wrong reason wastes an hour; passing for the wrong
reason is what an audit exists to prevent.

---

## Eight modules in

| Module | Tests | Defects | Chosen for |
| --- | --- | --- | --- |
| Contractors | 52 | 18 | Cold, never reviewed |
| Training | 32 | 4 | Reviewed and fixed twice as prose |
| Documents | 34 | 3 | Load-bearing; own access layer |
| Heads-Up | 23 | 7 | Consumes that access layer |
| Assets | 21 | 3 | Reads three other modules |
| RAMS | 21 | 1 | Reads more modules than anything |
| Fire Safety | 20 | 2 | Where a stale record is the hazard |
| **COSHH** | **26** | **5** | **Encodes regulation; has an AI boundary** |

**209 tests. 43 defects.** Every module is covered by a suite that cannot drift,
because each enumerates its procedures from the router at runtime rather than
from a list somebody maintains.

### The two recommendations, now made for the fourth time

**1. The cross-module sweep.** Thirteen of the twenty-three defects in the last
five modules are one mistake — a module touching another module's records
without applying that module's rule. Heads-Up → Documents (four), Assets →
Observations/Actions/Inspections (three), RAMS → Documents (one), Fire Safety →
Training (one), and now COSHH → Users (one). **COSHH is the escalation that
should end the argument:** every prior instance leaked within a tenant; this one
crosses the tenant boundary and discloses special-category health data.

A ninth module audited in isolation will find this one instance at a time. One
generated sweep over every place a router selects from another module's table —
checked against *does this apply the owning module's rule, and the tenant
predicate?* — would find the remainder in a single pass. It is one test in the
shape of the permission matrix and it cannot drift.

**2. The web layer is untouched by all eight suites.** Every defect in this
series is router, worker or data. The prose reviews found their worst defects in
`.tsx` files, and none of these 209 tests can reach one.

Neither of those is another module. Both are now overdue.

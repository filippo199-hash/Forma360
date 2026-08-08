# FreeHS — Assets module audit

**Module:** Assets (register, types & custom fields, hierarchy, readings, linked records, QR tokens)
**Surface:** ~16 tRPC procedures across two routers · 6 web routes · no worker · 3 permission keys
**Date:** 8 August 2026
**Deliverable:** 21 tests in `assets.audit.test.ts`, of which **3 fail on real defects**

---

## Why this module

Two reasons, and the second turned out to matter more.

**It has churned.** Four commits landed on `main` in the last few days: the
overview rebuilt from six tabs to four, custom fields made visible and editable
after creation, a field-suggestion feature added, and the whole maintenance
feature removed. Recently-moved code is where defects live, and a module that
has just had a feature *deleted* is where dead surfaces get left behind.

**It is the platform's biggest reader of other modules.** The asset detail page
pulls linked records from observations, actions and inspections; contractors
and fire safety reference assets back. The Heads-Up audit had just established
the shape of the interesting defect in a system like this — a module's own
access rule holding perfectly, and being bypassed by whichever module reads
across the boundary. Assets was the obvious place to test whether that was one
module's mistake or a pattern.

It is a pattern.

---

## Findings

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **AS-X01** | High | **The asset page discloses observations to a caller with no `issues.view`.** `listLinkedObservations` joins `issue_assets → issues` gated on nothing but `assets.view`, returning title, status, priority and reference number. AS-X00 is the control: the same caller is refused by `issues.get` outright. A plant supervisor who cannot open the observations register reads the title of every observation raised against their plant — and the title is routinely the sensitive part (*"Brake failure — operator named in report"*). | `assets.ts:435-461` |
| **AS-X03** | High | **`listLinkedActions` and `listLinkedInspections` are the same shape beside it.** Both `assets.view` only. Inspections in particular carry a frozen access snapshot per ADR 0007 that this path never consults. Asserted together with AS-X01 because the fix is one decision, not three. | `assets.ts:379-434` |
| **AS-V01** | Medium | **The register cannot reach past its own cap.** `assets.list` takes `limit` (max 500, default 200) and **no cursor at all**, returning a bare array with no `hasMore`. A company with more plant than that simply cannot see the rest, and nothing on the response says so. The fixture seeds 520 to put it beyond argument. | `assets.ts:125-162` |

### Also noted, not a test

The asset **`qrToken` has no consumer**. It is generated on create, guarded by a
global unique index with retry-on-collision, and displayed as a raw string on
two pages — and a repo-wide grep finds nothing that resolves it. `/scan/[token]`
is the *issues* QR surface (`issues.publicGetByShareToken`), not this one. So
the register prints a code that nothing can scan. Not filed as a failing test
because the right fix is a product decision — wire it to an asset landing page,
or stop showing it — rather than a behaviour to assert.

---

## Two assertions I got wrong, in the module's favour

Both are worth recording, because in each case the shipped design is stronger
than the one I assumed.

**Archiving a parent.** I asserted that archiving a parent must not leave
children pointing at a dangling id. The router does something better: it
**refuses the archive outright** while sub-assets remain, and names the count
in the error so the UI can say how many. That matters more than it sounds,
because `assets.parent_id` carries **no foreign key and no ON DELETE rule** —
the router is the only guard that exists. The test now pins the refusal.

**Cross-tenant linked reads.** I asserted `listLinkedObservations` must throw
for a foreign asset id. It returns an empty array instead, because it scopes on
the *link table's* tenant rather than loading the asset first. No data crosses —
which is the part that matters — so this is a contract inconsistency, not a
leak, and AS-T02b now pins the emptiness and records the inconsistency
separately rather than overstating it.

---

## Verified correct — no action

All asserted by passing tests.

- **The depth-1 hierarchy cap.** Self-parenting is refused, and so is
  re-parenting a root under its own child — the shortest possible cycle. With
  no foreign key on `parent_id`, this cap *is* the cycle guard, and it holds.
- **`assets.readings.record` genuinely separates from `assets.manage`.** An
  operator holding only the readings key can log engine hours and cannot
  rename, archive or create anything. Worth naming: the equivalent key in
  Contractors (`contractors.gate`) turned out to gate nothing at all, so a
  separate key that actually separates is not a given in this codebase.
- **QR-token uniqueness is global, not per-tenant.** Correct, and important:
  the token goes on physical signage, and two tenants resolving the same
  sticker would be the worst kind of failure to discover after printing.
- **Tenancy** holds across read, mutate, parent, type, site and owner — a
  foreign `typeId`, `siteId` or `ownerUserId` is all refused on update.
- **Archived assets** drop out of the default listing and stay readable by id.
- **Readings** come back newest-first and complete.
- Every procedure refuses a caller holding no assets key.

---

## What to fix first

1. **AS-X01 / AS-X03** — one decision for all three endpoints. Either require
   the reader's own module key (`issues.view`, `actions.view`,
   `inspections.view`) alongside `assets.view`, or filter each linked list
   through that module's own visibility helper. The second is more work and
   more correct: inspections carry an ADR 0007 access snapshot that a
   permission check alone would not honour.
2. **AS-V01** — a cursor, matching the shape `contractors.list` was given in
   its fix pass (`{ rows, hasMore, nextCursor }`). Until then, at minimum
   return `hasMore` so the page can say it is truncated.
3. **The QR token** — decide. A code printed on a machine that nothing scans is
   worse than no code, because somebody will assume it works.

---

## Five modules in — the pattern is now the headline

| Module | Tests | Defects | Chosen for |
| --- | --- | --- | --- |
| Contractors | 52 | 18 | Cold, never reviewed |
| Training | 32 | 4 | Reviewed and fixed twice as prose |
| Documents | 34 | 3 | Load-bearing; has its own access layer |
| Heads-Up | 23 | 7 | **Consumes** that access layer |
| Assets | 21 | 3 | **Reads three other modules** |

Ten of the thirteen defects found in the last three modules are the same
mistake: **a module reading another module's records without applying that
module's access rule.** Heads-Up does it to Documents in four places. Assets
does it to Observations, Actions and Inspections in three.

That is no longer a per-module finding, and auditing a sixth module in
isolation will keep producing it one module at a time. The proportionate
response is a single sweep across every cross-module read in the product —
every place one router joins another module's table — checked against one
question: *does this apply the owning module's access rule, or only its own?*
That is a day's work as a generated test, in the same shape as the permission
matrix, and it would cover RAMS ↔ documents, permits ↔ RAMS, fire safety ↔
assets, incidents ↔ nearly everything, in one pass.

The web layer remains untouched by all five suites, and Assets has no e2e spec.
That gap has not moved since the Contractors audit and is now the larger of the
two.

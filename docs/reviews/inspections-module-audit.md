# FreeHS — Inspections module audit

**Module:** Inspections (conduct, signatures, approvals, exports, public share links) + the template pin
**Surface:** ~20 tRPC procedures across 4 routers · 4 tables · 5 permission keys
**Date:** 8 August 2026
**Deliverable:** 15 tests in `inspections.audit.test.ts`, of which **4 fail on real defects**

---

## Why this module, and what was expected

Inspections is the **oldest** module in the product. Templates and inspections
are Phase 2; every convention the later modules were built to — the dependents
registry, the tenant-guard helpers, `loadContractorScope` — arrived after this
code did. Old code that predates a convention is exactly where the convention
gets applied unevenly.

Two questions.

**Does the freeze hold?** An inspection pins its template version at start
(T-E04) and snapshots access state per ADR 0007. Both are promises about the
past: what the inspector was shown, and who could see it, must not move because
somebody later publishes a revision. Everything downstream — the PDF, the share
link, the approval — is only worth as much as that freeze.

**Does the contractor boundary hold at every door?** The Observations audit,
immediately before this one, found `loadContractorScope` called in exactly two
places in a 1,620-line router while three sibling reads resolved the record by
tenant and id alone. `inspections.ts` calls it in exactly two places as well.

The freeze holds. The boundary does not — and here it is worse, because a
portal contractor's `inspections` activity grants three permissions tenant-wide,
not one.

---

## Findings

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **IS-S02** | **Critical** | **A contractor portal user is handed a working public URL to another company's inspection.** `exports.listShareLinks` is gated on `inspections.view` — which the portal activity grants tenant-wide — and projects `buildShareUrl(token)` for every link on the inspection. | `exports.ts:116-148` |
| **IS-S04** | **High** | **They can sign it.** `signatures.sign` is gated on `inspections.sign`, also granted tenant-wide, and resolves by tenant + id. | `signatures.ts:120-135` |
| **IS-S03** | **High** | **They can overwrite its answers.** `saveProgress` is gated on `inspections.conduct`, likewise. | `inspections.ts:944-956` |
| **IS-S01** | Medium | **They can read the signature sheet** — slots, assignees and the signatures already collected. | `signatures.ts:59-72` |

---

### The shape of it

`CONTRACTOR_ACTIVITIES.inspections` grants:

```ts
inspections: ['inspections.view', 'inspections.conduct', 'inspections.sign'],
```

Three permissions, tenant-wide, to an external company's staff. That is fine —
it is the *data* scope that is supposed to constrain them, and
`loadContractorScope` exists for exactly that. It is called by `inspections.list`
and `inspections.get`. Both correct. Every other door those three grants open
resolves the inspection by tenant + id and stops there.

So `get` returns NOT_FOUND on another company's inspection, and the same caller
can still read its signature sheet, overwrite its answers, sign it, and collect
a public link to it.

**Ordered by what actually escapes:**

**IS-S02 is the one to fix first**, and it is worse than the equivalent finding
in Observations. Every other item here leaks *to the contractor*. This one leaks
*through* them: the share link is opaque, unauthenticated, and designed to be
forwarded. Handing it to the wrong company does not merely disclose the
inspection — it delegates the ability to disclose it to anyone, indefinitely,
outside any audit trail this product keeps.

**IS-S04 and IS-S03 are writes**, which is a category the Observations finding
only touched at the edge. A signature is an attestation by a named person that
they carried out a check. An inspection is the evidential record of a walk-round
somebody else will sign and a regulator may read. Both are now writable by an
outside company that cannot open the record it is writing into.

---

## What holds — the freeze is intact

All asserted by passing tests.

**T-E04, the template pin (IS-F01).** The test starts an inspection, then
publishes a revision that rewrites the question wording, then checks what the
inspector sees. The pin does not move, the rewrite does not appear, and the
original wording is still there. This is the property everything downstream
depends on: an inspector halfway through a walk-round on their phone must not
have the questions change underneath them, because answers already given would
become answers to questions nobody asked.

**ADR 0007, the access snapshot (IS-F02).** Written at start, with its
timestamp, rather than recomputed on read.

**T-E05, archive semantics (IS-F03).** Archiving the template stops new starts
**and** leaves the walk-round already in flight completable. Both halves matter:
the template is withdrawn because it is wrong, but the inspector is standing in
a plant room holding a phone.

**The share link's own controls (IS-L01, IS-L02).** Revocation takes effect, and
minting a link requires `inspections.export`, not `inspections.view` — the read
permission does not carry the right to publish. That separation is correct and
is precisely what IS-S02 undoes by handing the *already-minted* URL to a
`.view` holder.

**Tenancy (IS-T01, IS-T02)** — generated across every procedure, plus starting an
inspection from a foreign template and moving one to a foreign site.

---

## Two corrections of mine, and both are worth recording

**The matrix flagged two procedures as ungated. They are ungated on purpose.**
`inspections.signWorkflow` and `inspections.listAwaitingMySignature` carry no
`requirePermission` — they authorise by **named-signer membership** instead
(`signerUserId === ctx.auth.userId`, FORBIDDEN otherwise), because the person a
template asks to counter-sign may hold no inspections key at all. That is a
sound design, and reporting it as a defect would have been wrong. They are now
declared by name in the test with that reason, so a *third* ungated procedure
fails the matrix rather than joining a silent allowlist.

This is the matrix working as intended: it did not find a bug, it found two
procedures whose authorisation model differs from their neighbours' and made me
read them.

**IS-S04 first passed — for the wrong reason.** Zod rejected my input (`slotId`
missing, `signerName` misspelt as `signedName`), so the refusal I recorded as
"the boundary held" was the input validator. Corrected, it signs another
company's inspection.

That is the **third** time in this series a green test proved nothing — the
Fire Safety marshal, the Permits namesake, and now this. All three were caught
the same way: by asking *why* a test passed rather than accepting that it did.
The pattern is consistent enough to be worth stating as a rule for whoever picks
this up: **a passing test that asserts a refusal is not evidence until you have
seen the refusal reason.**

---

## Thirteen modules

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
| Incidents | 17 | 1 | Carries special-category data |
| Observations | 18 | 5 | The only unauthenticated write |
| **Inspections** | **15** | **4** | **The oldest code in the product** |

**329 tests. 60 defects.**

### The contractor boundary is not a module problem — it is a platform problem

Two consecutive audits, two modules, **nine defects, one mechanism.**
`loadContractorScope` is called in six places across the entire codebase:

| Router | Scoped | Unscoped and reachable |
| --- | --- | --- |
| `issues` | `list`, `get` | `comments.list`, `activity.list`, `attachments.list`, `comments.create` |
| `inspections` | `list`, `get` | `signatures.listSlots`, `signatures.sign`, `saveProgress`, `exports.listShareLinks` |
| `actions` | `list`, `get` | **not yet audited** |

The pattern is exact, and it is not a coincidence: in each router somebody
scoped the two procedures named `list` and `get`, and the scope stopped at the
name rather than at the boundary. **`actions` has the identical shape and has
not been checked** — the contractor activity grants `actions.view` +
`actions.create`, so the same question ("which doors does that open?") has an
unexamined answer today.

That is the single most valuable thing left to do, and it is smaller than
another module: one helper, applied at every procedure that resolves an
inspection, observation or action by id.

It also sharpens the sweep this series has been recommending. The generalisation
from the Observations report — **entity-level predicate parity**, *of every
procedure that resolves a record by id, does it apply every predicate the
canonical read applies?* — would have found all nine of these in one pass, plus
whatever is waiting in `actions`.

The web layer remains untouched by all 329 tests.

# FreeHS — Risk Assessments module audit

**Module:** Risk Assessments (assessments, hazards, controls, versions & sign-off, the tenant matrix, distribution & acknowledgement, person-specific variants)
**Surface:** ~24 tRPC procedures · 6 tables · 3 permission keys · 1 worker
**Date:** 8 August 2026
**Deliverable:** 30 tests in `riskAssessments.audit.test.ts`, of which **3 fail on real defects**

---

## Why this module last, and what was at stake

Risk Assessments is the module the rest of the product hangs off. RAMS binds
risk-assessment **versions** and freezes them into issued packs. Permits gate on
a linked RA. Incidents pull `nextReviewAt` forward after an event. COSHH is a
specialised assessment of the same shape. **If the versioning model here were
wrong, it would be wrong everywhere downstream too** — which is why it was worth
auditing even though it has been reviewed twice in prose and hardened once.

The versioning model is not wrong. It is the most carefully built thing in the
codebase, and all four of its hard properties hold under test.

The defects are all at the edges — where somebody else reads this module, and
where this module talks to a person.

---

## Findings

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **RA-X03** | **High** | **A permit to work can be issued citing a risk assessment that was never signed off, or one that was withdrawn.** `permits.issue` enforces `requiresRiskAssessment` as *presence* — `permit.riskAssessmentId === null` — and never checks status. The test builds a hot-works type requiring an RA, points one permit at a **draft** and another at an **archived** assessment, and issues both. | `permits.ts:1831` |
| **RA-D05** | Medium | **A leaver is counted as an outstanding acknowledgement forever.** The reminder worker filters `isNull(user.deactivatedAt)` so a deactivated user is never chased; `list` counts every acknowledgement row regardless. The assessment reads "1 of 2 acknowledged" permanently — nobody is nudged, and the number can never reach 100%. | `riskAssessments.ts:466-470` vs `ra-ack-reminder.ts:71` |
| **RA-D04** | Low–medium | **The distribution email is English-only, in both link and body.** `distribute` hardcodes `/en/` into `viewUrl` and never sets `TemplatedEmail.locale`. | `riskAssessments.ts:1505` |

---

### RA-X03 — the pattern, in the place it costs most

This is the same defect this series has now found nine times: **a module reading
another module's records and applying only its own rule.** Here the reading
module is Permits and the rule it skips is the one this entire module exists to
enforce — *an assessment is in force only when it has been signed off and not
withdrawn*.

Three things make it the worst instance so far.

**The information was already in hand.** `loadRiskAssessmentInTenant` in
`permits.ts` explicitly SELECTs `status`:

```ts
.select({ id: …, title: …, referenceNumber: …, status: riskAssessments.status })
```

…and no caller ever looks at it. The column was fetched for a check that was
never written.

**The same procedure gets the identical problem right ten lines below.** The
RAMS gate in `permits.issue` calls `ramsPackGateError`, which demands either an
issued pack version or an in-date accepted third-party review — status, freshness
and all. The RA gate two statements earlier checks a null. That asymmetry is what
makes this a gap rather than a deliberate policy: somebody knew what the check
should look like and wrote it for one of the two safe-systems-of-work links.

**The artefact is a permit.** A permit to work is the document that says the
work has been assessed and controlled. Issuing one against a draft assessment
means the permit's central assertion is unverified, and the permit prints the RA
reference next to it as though it were in force.

### RA-D05 — two halves of one feature that disagree

Neither half is wrong on its own. Not chasing a leaver is correct. Counting
every distribution row is a defensible default. Together they produce a state
nobody chose: an assessment permanently stuck one short, an outstanding item no
reminder will ever surface, and a compliance percentage that is wrong in the
direction that makes a manager look bad for something they cannot fix.

The Training module already made this decision explicitly — leavers drop out of
the matrix without taking the evidence with them. This is the same call, and
this module has not made it.

### RA-D04 — the last one of its kind

`packages/shared/src/app-link.ts` landed on main as the platform fix for
hardcoded locales, and **this module's own reminder worker already uses it**:

```ts
const viewUrl = appLink(deps.appUrl, r.locale, `/risk-assessments/${r.assessmentId}`);
```

The router's `distribute` does neither half — no `appLink`, no `locale` on the
email. So the chase-up mail is correctly translated and the **original request**
is not. The first message a worker receives, the one asking them to read and
acknowledge a legal document, arrives in English and lands them on an English
page; the nag that follows arrives in Polish. Small fix, and the awkward one to
explain to a customer.

---

## What holds — and the versioning model is why this module is worth trusting

All asserted by passing tests.

**ADR 0011, all four properties**

- **RA-V01** — publishing freezes the content and stamps a **named** signer with
  a timestamp. What was attested is recoverable, not inferred.
- **RA-V02** — editing after sign-off never rewrites the signed version. The test
  rewrites a hazard to `REWRITTEN AFTER SIGN-OFF` and confirms version 1's
  content is byte-identical and does not contain that string. This is the
  property every issued RAMS pack depends on.
- **RA-V03** — a changed republish cuts version n+1, flags re-acknowledgement,
  and leaves version n readable. "What was in force on the day" has an answer.
- **RA-V04** — and the harder half: **an unchanged draft round-trip cuts no new
  version and does not reopen anyone's acknowledgement.** Pulling an assessment
  back to draft to fix a title and re-activating it must not ask a whole
  workforce to re-read something that did not change. Getting this wrong is how
  acknowledgement becomes a thing people click through without reading, and the
  code explicitly guards it by comparing `contentUpdatedAt` against the current
  version's timestamp.

**The publish gate — reg 3 of the Management Regs, as code**

Eight preconditions, all tested: no hazards; a hazard missing any of its four
scores; **P-1** a residual above the initial (the classic transposition error);
**P-2** a residual score with no controls behind it; a residual that stays high
with neither a planned control nor a written tolerability note — *and* the same
assessment publishing once the note is supplied, so the gate is a gate and not a
wall; PPE as the whole answer; **M-2** publishing without confirming sign-off;
and **P-3** a planned control becoming an action only with a real owner and a due
date — **including refusing a deactivated user as the assignee.**

**The matrix**

- An internally inconsistent configuration is refused.
- **P-4** — editing the tenant matrix does **not** re-band a signed version. Last
  year's assessments keep saying what they said.
- **Severity floors drive the gate, not just the chip colour.** A 1 × 5 hazard
  scores 5, which lands in "medium" on the default thresholds — a hazard that can
  kill somebody labelled Medium because it is unlikely. Under a `severity 5 ⇒
  high` floor the publish gate correctly refuses it as an unexplained high
  residual. The floor is real, not cosmetic.

**Acknowledgement is genuinely version-aware** — an acknowledgement of v1 does
not count for v2, and the assessment reappears in the recipient's own pending
list. **Only people it was distributed to can acknowledge it.** A draft cannot be
distributed at all.

**Person-specific variants** (A-4) — a new/expectant-mother variant forks the
parent's hazards so it can diverge, starts as a draft, and correctly flags drift
the moment the parent's content moves on.

**The permission split** — `riskAssessments.create` authors and cannot sign off,
archive or distribute; and editing the tenant matrix requires `org.settings`, not
`riskAssessments.manage`, because what counts as "high" for the whole
organisation is a policy decision rather than an assessor's.

**Tenancy** — read, update, archive, publish, `getVersion`, `addHazard` and
`createPersonSpecific` against a foreign assessment; siting at a foreign site;
and distributing to a foreign user. All refused.

---

## Four test bugs of mine — and the fourth is the one worth recording

Three of the usual species: `list` returns a bare array rather than
`{ assessments }`; `listMyPending` returns `assessmentId`, not `id`; heads-up
recipients are resolved at `publish`, not `create` (my version silently fanned
out to all 212 users in the tenant, which is how I noticed).

The fourth is different, and it is the one to keep.

**RA-D04 originally read `locale` off the shared `__authStubMailbox`.** That
mailbox records `{to, templateKey, variables}` — it has **no `locale` field at
all**. So the assertion `localeOnEmail: null` was reading a property the stub
never records, and it would have reported "no locale" no matter what the router
did. It happened to name a real defect, but it could not have discovered one, and
it could never have gone green once fixed.

The fix was to build a second risk-assessments router with a `sendEmail` that
captures the whole `TemplatedEmail`. That is now a real observation of the real
router.

This is the sixth time in nine audits that a correction separated a genuine
finding from an artefact of my own test — and the second time the artefact was a
test that *agreed with me for the wrong reason*. Those are the dangerous ones: a
false red wastes an hour, a false green closes a question that was never asked.

---

## Nine modules in — the series is done, and so is the argument

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
| **Risk Assessments** | **30** | **3** | **Everything else depends on it** |

**239 tests. 46 defects.** Every FreeHS module now has a suite that cannot drift,
because each enumerates its procedures from the router at runtime rather than
from a list somebody maintains.

### The cross-module sweep is no longer a recommendation, it is the finding

**Fourteen of the twenty-four defects in the last six modules are one mistake.**
Heads-Up → Documents (four), Assets → Observations/Actions/Inspections (three),
RAMS → Documents (one), Fire Safety → Training (one), COSHH → Users (one), and
now **Permits → Risk Assessments**.

Look at what those six instances cost, in order of discovery: a document
disclosure inside a tenant; a stale asset link; a client-facing pack; a
duplicated source of truth on a fire document; a cross-tenant disclosure of
special-category health data; and a permit to work issued against an unsigned
assessment. The pattern has not got rarer as the modules got better built — it
has got more expensive.

A tenth module audited in isolation will find it a seventh time, one instance at
a time. **One generated sweep over every place a router selects from another
module's table** — asking, of each, *does this apply the owning module's rule and
the tenant predicate?* — is one test in the shape of the permission matrix, it
cannot drift, and on the evidence of these nine audits it would find several more
in a single pass.

### The web layer is still untouched

Every one of the 46 defects is router, worker or data. The prose reviews found
their worst defects in `.tsx` files. None of these 239 tests can reach one.

Those two remain the work. There is no tenth module left to do instead.

# FreeHS — Training & competence matrix audit

**Module:** Training & competence matrix (FreeHS module B7)
**Surface:** 17 tRPC procedures · 7 web routes · 1 worker · 4 permission keys
**Date:** 7 August 2026
**Deliverable:** 32 tests in `packages/api/src/routers/training.audit.test.ts`, of which **4 fail on real defects**
**Prior art:** `training-hse-expert-review.md` (round 1), `-round-2.md` (round 2). Both rounds fixed in `ce742fc`.

---

## Why this one was different

Contractors was audited cold. Training has been reviewed twice as prose and
fixed twice, so the question here was not *"what did nobody look at"* but:

> **Does the fix hold, and what do the axes a prose review cannot reach turn up?**

Both halves got an answer.

### The fix holds — and one thing is now proven that never was

The headline of both prior rounds was the permits competence gate: the
module's stated justification, and the thing that made it more than a
spreadsheet. Round 1 found it **written, tested and never called**. Round 2
found it **called and unreachable** — no UI could arm it, the permit page never
rendered the shortfall, and the refusal slugs were untranslated.

**TR-G01 to TR-G03 now prove it end to end**, which neither prose review could:

- Arm a permit type with a required ticket, name an operative whose card
  expired yesterday → `permits.get` previews the shortfall with
  `reason: 'training-expired'`, and `permits.issue` **refuses**.
- A card *inside* its renewal window does **not** block — correct, and
  non-obvious: `expiring_soon` is valid today, and a shift-long permit must not
  fail because a ticket lapses next month.
- Void a ticket **after** the preview was rendered and the issue is still
  refused — the gate re-reads rather than trusting a stale preview.

Everything else the two rounds fixed also holds under test: TR-B10 (Standard no
longer holds `training.view`, yet a standard user still reads their own wallet
and cannot read a colleague's), TR-B12, TR-B13, and the whole import rewrite
(TR-B4 / B5 / B6). The expiry worker went from the only untested reminder
worker in the repo to the best-tested one — 8 tests, covering notify-then-stamp,
dedup, per-requirement windows, quiet-when-clean, locale, superseded rows and
the deactivated-holder skip. **I wrote no worker tests because there was
nothing left to assert.**

### And four things neither review found

All four live on axes prose cannot reach: a second tenant, a second custom
field, concurrency, and volume.

---

## Findings

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **TR-T05** | High | **`addAssignment` accepts foreign-tenant keys.** It takes `groupId`, `siteId` and `userId` and validates only that the *requirement* belongs to the tenant. Round 2's TR-B12 fix added exactly this check to `addRecord.userId` and was not applied here. The effect is quieter than a leak and worse: the row writes, `resolveMatrix` builds its membership maps from this tenant's rows, so the assignment **matches nobody** — a rule that looks set and does nothing, which is the precise failure the procedure's own comment says it is guarding against. The FK cascades, so the other tenant deleting that group silently deletes the rule. | `training.ts:441` |
| **TR-C07** | Medium | **The role field is discovered nondeterministically.** `resolveMatrix` matches `/role\|job title\|position/i` against the custom-field *name*, collects every match, and writes all their values into one map keyed by user — so a tenant with two matching fields gets whichever row the database returned last. Seeding a decoy field called *"Roles and responsibilities"* silently strips a machine operator of his statutory abrasive-wheels requirement. And the failure is reassuring: the gap list simply gets shorter. | `training.ts:203-226` |
| **TR-I06** | Medium | **Import idempotency is advisory, not enforced.** The dedupe is an in-memory `seen` set built from a `SELECT` at the top of the mutation, with no unique index behind it. Two imports running at once both read the same set, both find nothing, and both insert — the guard holds only as long as nobody double-clicks or two people migrate at the same time. RAMS solved exactly this with a partial unique index (migration 0070). | `training.ts:1062-1087` |
| **TR-V02** | Medium | **The matrix is unbounded.** `resolveMatrix` loads every training record, every group membership, every site membership and every assignment in the tenant, then joins in JavaScript; `matrix` accepts no limit or cursor, only optional site/requirement filters. Fine at the seeded 200 × 4. The module was specified for **800 × 30**, which is 24,000 cells serialised per page load — and the procedure's own comment says *"800 × 30 is a query"*. | `training.ts:789` |

---

## Verified correct — no action

Recorded so the fix pass does not churn what is right. All of these are now
asserted by a passing test.

**The prior rounds' fixes**

- The permits competence gate refuses expired and never-held tickets, admits
  `expiring_soon`, and re-checks at issue rather than trusting the preview.
- `training.view` is out of the Standard set; the wallet is self-scoped and the
  org-wide read is gated inline; a standard user reading a colleague gets
  `FORBIDDEN`.
- A cross-tenant `userId` on `addRecord` is refused, as is a cross-tenant
  `requirementId`, and another tenant's record can be neither voided nor
  verified.
- An empty site filter reports `siteHasNoMembers` instead of an unexplained
  empty grid.
- Import: client-skipped rows reach the failure report; a row with no email
  matches the user by name; two people with the same name are reported rather
  than guessed; a dry run writes nothing; a re-run writes nothing.

**The derivation, through the router rather than in the domain library**

- A superseded record does not govern its cell — the voided 2099 typo does not
  make its holder permanently competent.
- A non-expiring qualification persists a null expiry and reads permanently
  in date.
- The lead window is the requirement's own (14 days for first aid), not the
  default 60.
- Month-end clamping survives the round trip: 31 January + 1 month persists as
  28 February.
- A leaver drops out of the matrix while their evidence survives.
- An account-less operative appears in the matrix keyed by name.
- `training.record` and `training.verify` are genuinely separate: a supervisor
  can enter a certificate and cannot then attest that they checked it.

**The domain library** in `@forma360/shared/training` remains the best-reasoned
in the platform and was not touched by either fix pass. That was the right call
both times.

---

## What to fix first

1. **TR-T05** — copy the tenant check that already exists in `addRecord` onto
   `addAssignment`'s three foreign keys. Ten lines, and it closes a ground-rule-4
   hole that also produces silently-dead rules.
2. **TR-C07** — stop guessing. Either make the role field an explicit tenant
   setting (a `roleFieldId` on the tenant, chosen once), or if the heuristic
   stays, pick deterministically — lowest `order`, then oldest — and surface
   which field was chosen in the requirements UI so it is not invisible.
3. **TR-I06** — a partial unique index on
   `(tenant_id, requirement_id, person_key, achieved_at) WHERE superseded_at IS NULL`,
   plus `ON CONFLICT DO NOTHING`. The RAMS migration is the template.
4. **TR-V02** — the module's own spec says 800 × 30. Either paginate the matrix
   or make the site/requirement filter mandatory above a threshold.

---

## What this says about the method, two modules in

Contractors produced 18 defects from a cold audit. Training produced 4, and
three of the four are on axes that only exist because the fixture has a second
tenant, a second custom field and volume. That difference is the useful signal:
**a module that has been reviewed and fixed twice is genuinely in better shape,
and the remaining defects are the ones no amount of reading finds.**

The gap is unchanged and now conspicuous. Everything above is router, worker and
data. The web layer — where round 2's two Criticals both lived, and where four
of the last three modules' worst defects lived — is still only reachable by
reading. Training's own `apps/web/e2e/training.spec.ts` asserts that six routes
exist and redirect to sign-in, and stops there.

Two modules is enough to say the runbook works. The next investment is not
another module; it is the authenticated browser journey.

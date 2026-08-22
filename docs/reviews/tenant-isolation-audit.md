# Tenant-isolation audit

**Scope:** every query, in every package that reaches Postgres, against
every table that carries a `tenant_id`.
**Question asked:** can any code path read or write a row belonging to a
tenant other than the caller's?
**Answer:** no path was found that can. The detail below is what that
claim rests on, and — as importantly — what it does not.

This is ground rule #4 and [ADR 0002](../adr/0002-multi-tenant-model.md).
It was enforced by discipline and review, which is to say by nothing that
fails a build. Half of what this audit leaves behind is the guard that
now does (`packages/db/src/tenant-scoping.test.ts`, TS-G01).

## Method

The schema is the authority on which tables are tenant-scoped: any
`pgTable` whose column block declares `tenantId`. That is **130 of 137**
tables. The seven without are `tenants` itself, better-auth's `account`,
`session`, `verification` and `two_factor`, plus `ai_messages` (a child of
a tenant-scoped conversation) and `whatsapp_opt_outs` — where the key is a
phone number and the opt-out is deliberately global, because a person who
says stop means stop, not stop-for-this-customer.

Every `.from(t)` / `.update(t)` / `.delete(t)` / `.insert(t)` in
`packages/{api,jobs,render,auth,permissions}` and `apps/web` was extracted
with its whole Drizzle chain — bracket-matched from the receiver, not read
off a line window — and each was classified by where the tenant appears:
in the filter, in a variable the filter references, in the enclosing
function, or nowhere.

**1,617 queries** on tenant-scoped tables. Every one resolves to one of
four shapes:

| Shape | What makes it safe |
| --- | --- |
| `where(and(eq(t.tenantId, ctx.tenantId), …))` | The rule, applied directly. The large majority. |
| Keyed on a parent id the same call path already proved | `loadActionForCallerOrThrow(ctx, input.actionId)` and its ~30 siblings run first; the child read then keys on the proven id. |
| Keyed on a token | Invitation tokens, share tokens, the contractor upload token. The token **is** the credential; the lookup is cross-tenant by design and returns the owning `tenantId` for every sibling query to use. |
| A worker sweeping every tenant | Reminder, RIDDOR-deadline and digest sweeps select `tenantId` in the projection and fan out per tenant. A statutory clock does not stop at a tenant boundary. |

## What the audit corrected on the way

Three passes of the extractor were wrong before one was right, and the
wrongness is worth recording because two of the three failed *safe* and
one could have failed *unsafe*:

1. **A fixed line window after `pgTable(`** spilled into the next table
   and marked `whatsapp_opt_outs` tenant-scoped when it has no such
   column. Harmless here — but the identical bug in the other direction
   marks a tenant-scoped table as global and **hides a real leak**. Table
   classification now parses each block to its own closing brace.
2. **A backwards walk for the "start of the chain"** produced 639
   findings whose quoted snippets were function signatures. The chain is
   now walked segment by segment with bracket matching.
3. **The enclosing-function detector ignored return-type annotations**
   (`): Promise<X> {`), so every annotated function looked tenant-blind:
   447 hits, almost all noise. A guard that cries wolf gets deleted, so
   this mattered as much as correctness.

The last version reports **six** queries with no tenant in scope, all
correct, all now on the guard's allowlist with a written reason.

## What was tightened anyway

Nine queries were safe only because a caller had already proved the
parent. Adding the tenant predicate to them costs nothing and removes a
class of future accident — a helper reached from seven call sites is one
refactor away from an eighth that skipped the check:

- `coshh.ts` `touchSubstance`, `fireSafety.ts` `touchFraContent` and
  `riskAssessments.ts` `touch` now take a `tenantId` and use it.
- `buildCoshhVersionContent` scopes its control read to the assessment's
  own tenant.
- The action activity and comment lists, and the dashboard-share lookup,
  scope explicitly rather than relying on the preceding load.

## The guard, and its limits

`TS-G01` derives the tenant tables from the schema (a table added next
month is covered with no edit here), extracts the chains the same way, and
fails on any query with no tenant anywhere in its enclosing function that
is not on the six-entry allowlist. It was verified to fail on a
deliberately planted `db.select().from(incidents).where(eq(incidents.id,
id))`.

What it does **not** do, stated plainly here because a guard whose
docstring overclaims is worse than no guard — the sandbox
withheld-permission list is already on record in `CLAUDE.md` as that
mistake:

- **It cannot see the 87 queries whose enclosing function mentions
  `tenantId` for another reason.** Each of those was read by hand for this
  audit and each is parent-scoped; nothing re-checks that, and a new one
  could be wrong.
- It reads text, not types. A query assembled through a helper that
  receives a pre-built `where` is invisible to it.
- Raw `` sql`…` `` is not parsed.

So the guard catches one specific shape: a new query written somewhere
that never knew the tenant. That is the shape a real isolation bug takes,
which is why it is worth having. It is **not** a proof of tenant
isolation.

## What would be a proof

Postgres row-level security — still open as **M1** in
[the security readiness review](./security-readiness-review.md). Under RLS
a missed predicate returns nothing instead of returning someone else's
data, and the property stops depending on 1,617 correct decisions. It is
the right next step and it is a real piece of work: every request needs a
tenant bound to its connection, which with a pooled client means either a
transaction per request or a per-request checkout. This audit deliberately
did not attempt it — a rushed RLS rollout risks availability, and the
audit says isolation is currently held.

## Where to point the next round

1. **M1 (RLS)** — the systemic backstop, above.
2. **The 87.** A second pass could assert the parent-proving pattern
   mechanically (a child read keyed on `X.parentId` must be preceded in
   the same function by a `loadParent*` that took `ctx.tenantId`) instead
   of by hand.
3. **M2/M3 (share tokens)** — orthogonal to isolation but the same blast
   radius: tokens are stored in plaintext and most never expire, so a
   single database read hands over live document access indefinitely.

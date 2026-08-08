# FreeHS — Observations module audit

**Module:** Observations (categories, QR public reporting, observation lifecycle, comments, timeline, attachments)
**Surface:** ~30 tRPC procedures · 5 tables · 5 permission keys · 1 unauthenticated write
**Date:** 8 August 2026
**Deliverable:** 18 tests in `issues.audit.test.ts`, of which **5 fail on real defects**

*(The router is `issues`; the product calls it Observations and the web route is `/observations`. PF-12 already fixed one round of emails that linked to `/issues`, a page which never existed. That detail turns out to matter — see OB-Q07.)*

---

## Why this module is the odd one out

**It is the only module in the product with an unauthenticated *write*.** Every
other public surface is a read: a RAMS pack served to a client, an inspection
behind a share link. Observations puts a QR code on a wall and lets whoever
scans it create a row inside a tenant with no account, no session and no
identity.

That inverts the usual question. Elsewhere the risk is *what can a stranger
see*. Here it is also *what can a stranger put in*, and *what does the poster on
the wall tell them before they do*.

**And it carries an access boundary that is not a permission.** External
contractor portal users hold tenant-wide `issues.view` by activity grant, but
must only see observations their own company reported. `loadContractorScope` is
the mechanism, and the code comment on it is unusually specific:

> PF-19: … **Every contractor-scoped read runs through here**, so an
> un-acknowledged (or stale-version) portal user now gets a FORBIDDEN…

This suite took that sentence literally. An observation's comments, its
timeline and its photographs are all reads.

---

## Findings

| ID | Severity | Finding | Root cause |
| --- | --- | --- | --- |
| **OB-S03** | **High** | **A contractor portal user can list the attachments of an observation they cannot open — and `attachments.list` mints a signed download URL per row.** This is the one where the leak is the file, not the metadata: working links to another company's site photography. | `issues.ts:1496-1520` |
| **OB-S02** | **High** | **The same user can read that observation's timeline**, which left-joins `user` and selects `actorName` **and `actorEmail`** — so they get the internal staff directory for the thread along with its history. | `issues.ts:1467-1490` |
| **OB-S01** | **High** | **And its comment thread.** | `issues.ts:1386-1400` |
| **OB-S04** | Medium | **They can also post into it.** `comments.create` is gated on `issues.view`, which they hold tenant-wide. Reading someone else's thread is a disclosure; writing into it puts an outside company's words into an internal record. | `issues.ts:1401-1426` |
| **OB-Q07** | Medium | **The URL the router hands out for the QR code does not resolve.** `generateShareToken` / `rotateShareToken` return `/<locale>/report/<token>`. The landing page is `/scan/<token>`; `/[locale]/report` is a different, localised, signed-in page — the harmed/not-harmed chooser — with no `[token]` segment. | `issues.ts:654, 677` |

---

### OB-S01..S04 — one omission, four doors

`loadContractorScope` appears **twice** in a 1,620-line router: `issues.list`
and `issues.get`. Both are correct. The three sub-routers resolve the
observation by tenant and id only:

```ts
// comments.list, activity.list, attachments.list — all three
await loadIssueOrThrow(ctx.db, ctx.tenantId, input.issueId);
```

So `get` closes the front door and the comment thread, the timeline and the
photo gallery are each a window beside it. The portal user does not even need
to guess an id in the ordinary sense — an observation id is a ULID, but it is
also the thing in every URL they were ever legitimately sent.

Ordering them by what actually escapes:

- **The photographs (OB-S03)** are the serious one. `attachments.list` signs a
  download URL for each row, so this is not "the filename leaked" — it is
  working access to another company's site photography, handed to an external
  contractor.
- **The timeline (OB-S02)** hands over `actorEmail` alongside `actorName`. Not
  just what happened, but the email address of everyone who touched it.
- **The comments (OB-S01)** are the internal discussion of a hazard — often
  including who is being blamed for it.
- **Posting (OB-S04)** is the write half, and it fails a different way round:
  an outside company's words land in an internal evidential record.

There is a second consequence worth naming. PF-19 made
`loadContractorScope` the **server-side induction gate** — an un-inducted portal
user is supposed to get `FORBIDDEN: induction_required` from every scoped read,
because the client-side version was walked past by deep links. Three paths never
call it, so three paths never check induction either. The fix for the disclosure
closes that too.

### OB-Q07 — a trap, not an outage, and worth saying so precisely

The router returns a URL for whoever prints the QR code:

```ts
url: appLink(appUrl, null, `/report/${cat.publicShareToken}`)
```

That produces `/en/report/<token>`. The unauthenticated landing page is
`/scan/<token>` — a different, deliberately unlocalised route. `/[locale]/report`
does exist, which is what makes this quiet: it is the **report chooser**, a
signed-in page asking "was anyone harmed?", and it has no `[token]` segment. So
the URL does not resolve, and a stranger who scans it is bounced to a sign-in
wall instead of the form.

**No QR code in the wild is dead today.** The one UI that calls these procedures
(`observations/qr-codes/page.tsx`) ignores the returned `url` entirely and
builds `window.location.origin + /scan/{token}` itself. That is what makes this
a loaded trap rather than an incident: the field is wrong, unused, and looks
authoritative. The second consumer to trust the router's own answer — an email,
an export, a printed sheet — prints a dead QR code onto a wall, and nobody finds
out until an injury goes unreported.

This module has been here before. The comment three functions away reads: *"the
route is /observations — /issues never existed as a page, so every one of these
emails 404ed."*

---

## What holds — and the anonymous write is genuinely well built

This was the part I expected to find problems in, and it is the strongest thing
in the module. All asserted by passing tests.

**The public submission is tightly bounded.** Rate-limited on both client IP and
token (10/minute each). The category is resolved by token **within** the claimed
tenant, so a token cannot be pointed at another tenant (**OB-Q03**). The site is
validated in-tenant. The row is written with `reportedByUserId: null`,
`reportedByName: 'Anonymous (QR)'`, `reportedVia: 'qr'`, an empty access
snapshot and a system-actor audit event — and the input schema has no status, no
assignee, no severity, no category override to abuse.

**The stranger cannot read anything back** — not the register, not the
observation they just filed, not its comments or attachments (**OB-Q01**).

**Anonymous media is properly fenced (OB-Q04):** keys must sit under the token
tenant's `issues/` prefix, and an image MIME allowlist blocks stored-XSS by
upload. Both refused in test.

**Token lifecycle works.** Revoke closes read *and* write (**OB-Q05**); rotation
invalidates the printed token while the new one works (**OB-Q06**). And
`generateShareToken` is deliberately idempotent — it preserves an existing
token, because rotating one silently would kill every QR code already printed on
a wall.

**The poster does not over-share (OB-Q02).** Sites ship only when the category's
site picker is on. Worth flagging as a correction of mine: I first asserted that
*no* sites should ever ship publicly. That premise was wrong — `site` is on by
default and the picker genuinely needs them — so the test was retargeted at the
real property, where it passes. A defect I talked myself into and then out of.

**Minting a token needs `issues.settings`, not `issues.manage` (OB-P02).** The
share token *is* the public write capability; exposing a tenant to anonymous
input is a settings decision, not something a manager should do while triaging.

**Exactly two procedures are public**, declared by name in the test — so a third
one appearing later fails the matrix rather than joining a silent allowlist.

**Observation → incident promotion links both ways**, and tenancy holds across
every procedure plus filing against a foreign category or site.

---

## Twelve modules

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
| **Observations** | **18** | **5** | **The only unauthenticated write** |

**314 tests. 56 defects.**

Fixes verified landing during this audit: **COSHH** (all five, including the
critical cross-tenant health-surveillance disclosure), **Permits** (all four)
and **Risk Assessments** (all three) — 60 green across their suites.

### The pattern, eighteenth instance — and a new shape of it

Sixteen instances were *a module reading another module's records without
applying that module's rule*. The seventeenth (Incidents → Actions) inverted it:
a module **writing** content out past its own confidentiality boundary.

This one is a third shape, and the most ordinary: **a module not applying its
own rule to its own sub-routers.** No module boundary is crossed at all.
`issues.get` and `issues.comments.list` are forty lines apart in the same file,
by the same author, and one of them checks.

That is worth separating out, because it changes what the recommended sweep has
to look at. A cross-module join analysis would not have found OB-S01..S04 —
there is no join. What finds it is asking, of every procedure that resolves a
record by id: **which access predicates does the canonical read of this entity
apply, and does this one apply all of them?** Run over `issues`, that question
returns four hits immediately, because `list` and `get` establish the answer and
three siblings dissent.

That generalisation — *entity-level predicate parity*, rather than cross-module
join checking — now covers all three shapes the eighteen instances have taken.
It remains the highest-value work in the codebase, alongside the web layer,
which none of these 314 tests still touches.

# FreeHS — Contractors module audit

**Module:** Contractors (register, requirements & documents, visits & calendar, gate kiosk, portal users, assets)
**Surface:** 52 tRPC procedures · 6 web routes · 2 workers · 9 migrations · 4 permission keys
**Date:** 7 August 2026
**Deliverable:** 52 tests in two suites, of which **18 fail on real defects**

---

## What is different about this one

The nine reviews before this were **source reviews**: read the code carefully
and reason about what it does. That found real defects, and it missed a class
that one click would have caught — a wallet page that renders empty for every
user, a Cmd-K link that 404s.

This module was **executed** instead. The repo's test harness boots pglite with
every migration and the real seeded permission sets in-process, so all 52
procedures can be driven against real data with no database, no deployment and
no login. The output is therefore tests rather than paragraphs:

| Artefact | What it is |
| --- | --- |
| `packages/api/src/routers/__fixtures__/world.ts` | The seeded world — reusable by every future module audit |
| `packages/api/src/routers/contractors.audit.test.ts` | 45 tests · 31 green · **14 failing on defects** |
| `packages/jobs/src/workers/contractors-worker.audit.test.ts` | 7 tests · 3 green · **4 failing on defects** |

Every failing test is titled `[BUG]` and written to assert **correct**
behaviour, so it fails today and passes when the defect is fixed. This file is
commentary; the suite is the acceptance criteria.

### The seeded world

- **Two tenants**, the second a near-mirror of the first (identical contractor
  and requirement names). Ground rule 4 is not testable with one tenant: a
  missing predicate returns the right rows by accident. With a mirror, a leak
  reads as a duplicate.
- **Permission sets beyond the seeded three** — a gate-only receptionist, a
  view+verifyDocs QS, a view-only reader, a holder of nothing. Administrator /
  Manager / Standard only ever exercise "everything" and "nothing", and the
  interesting failures live in the narrow sets a real customer builds.
- **200 users, 120 contractors** — above every default `limit: 50`, which is
  the threshold at which truncation defects become observable.
- **Boundary cases planted by name** — cover ending today, cover lapsed
  yesterday, pending-only, rejected-only, advisory-only gap, manual suspension
  over valid paperwork, a 30-hour overstay, a second-site visit, a cancelled
  visit.

### Method and its limits

Three sources, in this order: a nine-lens parallel audit with adversarial
verification (55 unique candidates); my own reading; and the tests themselves,
which arbitrate. **Every defect below was verified by hand before it was
written down**, and the tests are the evidence.

Two limits, stated plainly:

- **The web layer is not covered.** pglite reaches the router, the workers and
  the data. It cannot click. Six of the candidates below live in `.tsx` files
  and are reported from reading, not execution — they are marked *(read-only)*.
- The parallel audit **stalled during verification** with 5 of 55 candidates
  formally verified. I verified the rest myself rather than wait; the ones I
  could not confirm are listed under *Not carried forward*.

Two of my own early readings were wrong and were caught by writing the test:
`contractors.archive` **does** scope by tenant (no cross-tenant write is
possible — the defect is the false success), and `endDate >= today` **is**
correct (my first fixture pinned a fixed date against the router's wall clock).
The second mistake became CT-C09.

---

## Findings

18 pinned by a failing test. Severity is impact on a real site, not code smell.

### Critical

| ID | Finding | Root cause |
| --- | --- | --- |
| **CT-P06** | **`contractors.users.remove` deactivates any user in the tenant.** It takes a bare `z.string()` userId, deletes the (possibly non-existent) `contractor_users` row, then *unconditionally* sets `deactivatedAt` on any user with that id. `contractors.manage` — held by every seeded Manager — therefore bypasses the `users.deactivate` permission, the self-deactivation block, and the S-E02 last-admin guard that exists precisely so a tenant cannot be left with no administrator. A Manager can lock the company out of its own admin settings. | `contractors.ts:1784` |
| **CT-G08** | **Suspending a contractor lets them through the gate.** The schema documents `complianceOverride` as the way to bar a contractor "regardless of paperwork". `contractorComplianceStatus` returns `override ?? derived`; `selfCheckIn` refuses only `if (compliance === 'non_compliant')`. `'suspended'` is neither, so it passes — and because the override *replaces* the derived status, suspending a contractor whose insurance has lapsed converts a refusal into an admission. The control built to bar someone from site is the one that admits them. | `contractors.ts:132`, `:1443` |
| **CT-U01** *(read-only)* | **Portal uploads have no expiry, and therefore never expire.** `contractor-upload/[token]/page.tsx:30` appends only `token`, `requirementId`, `file`. The route stores `endDate: DATE_RE.test('') ? … : null` → `null`. `requirementSatisfied` reads `endDate === null` as *permanently valid*, and the reminder worker filters `isNotNull(endDate)`. So a certificate uploaded through the contractor's own portal — the primary intended path — satisfies its blocking requirement forever and is never chased. The module's central promise, defeated on its main road in. | `page.tsx:30`, `api/contractor-upload/route.ts:108`, `contractors.ts:114` |

### High

| ID | Finding | Root cause |
| --- | --- | --- |
| **CT-S01** | **The directory hands the portal credential to every reader.** `contractors.list` is `select()` with no projection, so it returns `uploadToken` — the bearer capability for the no-login upload portal — to every `contractors.view` holder, while minting one requires `contractors.manage`. 128 rows exposed it in the seeded world. `contractors.get` does the same. The token is a working credential: `/contractor-upload/<token>` accepts document uploads with no session. | `contractors.ts:272`, `:400` |
| **CT-G06** | **One gate token per tenant, not per site.** The kiosk token resolves a *tenant*; the listing filters on tenant and time only. Every reception screen in the company lists every site's contractor arrivals — names, companies, times — unauthenticated, and any kiosk can admit a visit booked for another site. Revocation is also all-or-nothing: regenerating for one compromised screen kills every other. | `contractors.ts:1345`, `contractor_gate_config` PK is `tenant_id` |
| **CT-L01** | **Staff check-in skips the questions marked required.** `gate.selfCheckIn` loads every required gate field and refuses a blank answer. `visits.checkIn` — the desk flow, which is how most arrivals are actually recorded — takes `capturedFields` as optional and never checks them. The resulting event is indistinguishable from one where the induction question was answered. | `contractors.ts:1094` |
| **CT-L02** | **A visit can be deleted while the person is still on site.** `visits.delete` sets `archivedAt` with no status guard; `onSiteNow` and the overstay worker both filter `archivedAt IS NULL`. Deleting a checked-in visit erases someone physically on the premises from the on-site board and from overstay detection, with no check-out event and no record they left. The on-site board is what a fire marshal reads at the assembly point. | `contractors.ts:1200` |
| **CT-L05** | **Someone checked in yesterday cannot check out.** The kiosk lists visits by `scheduledStart` within ±24 h. Anyone on a multi-day job, or anyone who overran, falls out of that window while still `checked_in`, so the only screen they have stops offering them a way out. They stay on the on-site board indefinitely and the overstay alert fires hourly with no way for them to clear it. | `contractors.ts:1361` |
| **CT-P03** | **`contractors.gate` gates nothing.** The key exists in the catalogue and is used in exactly two places — to show the Gate nav entry (`nav-model.ts:336`) and to pick overstay-alert recipients — and no procedure requires it. A receptionist granted exactly that key is shown a door that will not open: check-in demands `contractors.manage`, which also grants renaming contractors, deleting visits and regenerating the kiosk token. The separation the key names does not exist. | `catalogue.ts:151`, `nav-model.ts:336` |
| **CT-W01** | **The one lifetime document chase is spent on a dead link.** `contractors.create` never mints an `uploadToken` and the only writer in the repo is a manual button, so the default state of every contractor is "no link". The reminder degrades its "Upload a new document" CTA to the bare `APP_URL` — a sign-in page the external contractor has no account for — and stamps `reminderSentAt` anyway. One wasted mail, then permanent silence, on a blocking insurance certificate. | `contractor-doc-reminder.ts:100` |
| **CT-D01** *(read-only)* | **Documents are verified blind.** The verify / reject buttons render with no link to the uploaded file. `storageKey` is returned by the API and never used, and there is no download route wired for contractor documents — so the person approving an insurance certificate cannot open it. Verification is the control that makes the whole register meaningful. | `[contractorId]/page.tsx:574` |

### Medium

| ID | Finding | Root cause |
| --- | --- | --- |
| **CT-G05** | The kiosk accepts a repeat check-in: two arrival events for one arrival, and `checkedInAt` is re-stamped — which resets the clock the overstay worker measures from, so a contractor can clear their own overstay by re-scanning. | `contractors.ts:1449` |
| **CT-L03** | Check-out is not idempotent. `checkOut` guards only `checkedInAt === null`, so a second tap moves `checkedOutAt` forward and overwrites the recorded departure time. | `contractors.ts:1138` |
| **CT-L04** | `checkIn` never clears `checkedOutAt`, so re-entry produces a row reading `checked_in` while carrying a past departure time — on the board, unresolvable. | `contractors.ts:1096` |
| **CT-O02** | Overstay recipients are looped inside the `try` and the stamp sits outside it, so one failed send leaves the visit unstamped and the next run re-mails everyone who already received it. | `contractor-overstay.ts:119` |
| **CT-O04** | `gateGuardEmails` selects every active user in the **tenant** holding `contractors.gate` or `org.settings`, with no site predicate — so a group with twenty sites mails every gate watcher and every admin about one contractor overrunning at one of them. Permits and incidents both site-scope their manage-holder alerts. | `contractor-overstay.ts:89` |
| **CT-O03** | Every contractor email is English-only: `sendTemplatedEmail` is called with no `locale`, `boardUrl` is hardcoded `/en/`, and `worker.ts` assembles `" at ${siteName}"` in English and interpolates it into the translated template. Fifteen shipped non-English contractor templates can never render. | `worker.ts:295`, `contractor-overstay.ts:113` |
| **CT-C09** | Contractor compliance has **no as-at**. `today()` reads `new Date()` directly and no procedure accepts an `asOf`, so the register cannot answer "was their insurance in force on the day of the incident" — the question every other register here answers via ADR 0007. The document dates are retained; only the query is missing. | `contractors.ts:110` |
| **CT-V02** | No list endpoint in the module accepts a limit, offset or cursor. `contractors.list` loads the whole contractor + requirement + document graph on every call and feeds four dropdowns. | `contractors.ts:270`, `:748` |
| **CT-T03b** | `archive` is the one mutation that skips `loadContractorOrThrow`; it fires a bare `UPDATE … WHERE tenant AND id` and returns `{ ok: true }` for an id it matched zero rows on, so the UI shows an "Archived" toast for a contractor that is still live. | `contractors.ts:495` |

### Reported from reading, not pinned by a test

These are real and located, but live in the web layer or in surfaces the
pglite harness cannot reach. They need the authenticated browser journey.

- **No error-slug mapping.** Contractors has no equivalent of
  `permits/permit-error.tsx`. Every failure is `toast.error(err.message)`, so
  users in all ten locales get the router's raw English (`'Visit is cancelled'`,
  `'contractor_non_compliant'`) and an invalid email in the invite dialog
  toasts a raw `ZodError` JSON blob. `contractor-users.tsx:119`, `:315`
- **The `documents` portal activity grants tenant-wide `documents.view`** with
  no per-contractor scoping. The route allow-list confines the portal user to
  `/documents`, and `document-visibility.ts` applies per-document rules to
  non-managers — but the permission itself is unscoped, and an external
  contractor holding it should be reviewed against what that layer actually
  restricts. `contractor-activities.ts:39`
- **Cmd-K returns archived contractors**, unlike every sibling category, and
  the resulting `/contractors/{id}` link resolves to not-found. `search.ts:306`
- **The contractors register links to `/permits/{id}`** for anyone with
  `contractors.view`, but the permits detail page requires `permits.view`.
  `contractors/page.tsx:282`
- **`visits.update` has no UI caller**, so a scheduled visit can never be
  corrected — only cancelled and recreated. `contractors.ts:1038`
- **The asset picker is capped at 200 with no search**, the templates page
  renders a failed load as "No templates yet", the calendar's day "+" button
  computes a date the dialog ignores, and `gateFields.update` accepts
  `label` / `fieldType` / `sortOrder` while the page only ever sends
  `required` — so capture fields can never be renamed or reordered.

### Verified correct — no action

Recorded so the fix pass does not churn what is already right.

- `contractors.list` is **three queries and an in-memory join**, not an N+1.
  It is unpaginated, but its shape is right.
- Tenancy holds where it counts: every mutation carries
  `eq(contractors.tenantId, ctx.tenantId)`, and CT-T03 proves a cross-tenant
  write is impossible even where the call falsely reports success.
- The document expiry worker is genuinely **notify-then-stamp**, dedupes
  correctly, and honours the lead window (CT-W02, CT-W03 pass).
- The overstay threshold is correct (CT-O01 passes).
- `/api/contractor-upload` is well-built apart from the dates: MIME allowlist,
  size cap, filename sanitisation, tenant-scoped object key, and a check that
  the requirement belongs to the token's contractor.
- `/api/files` enforces the tenant prefix, so a forged `evidenceKey` cannot
  reach another tenant's blob.
- Compliance derivation itself is right: `endDate >= today` correctly counts
  the last day of cover, pending and rejected documents do not satisfy a
  blocking slot, an unmet advisory requirement does not block, and a manual
  override is exposed alongside the derived value rather than replacing it in
  the payload (CT-C01..C08 all pass).
- `contractors.publicByToken` returns exactly `contractorName` and
  `requirements` — no notes, no contacts, no compliance state.

### Not carried forward

Candidates raised by the parallel audit that I could not confirm, or that are
design observations rather than defects: `recurrenceMonths` and
`contractors.status` being inert (both are persisted-but-unread, which is a
roadmap question, not a bug); the two workers' unindexed cross-tenant scans
(true, but every worker in the package does this and the row counts do not yet
justify it); missing tenant FKs in `0042_contractors.sql` (the Drizzle schema
declares them and the app always scopes, so this is a hardening item).

---

## What to fix first

1. **CT-P06** — one guard. Refuse a `userId` that is not a contractor portal
   user in this tenant, and route the deactivation through the same path as
   `users.deactivate` so the last-admin guard applies.
2. **CT-G08** — one condition: refuse on `'suspended'` as well as
   `'non_compliant'`, in both `selfCheckIn` and `visits.checkIn`. Currently the
   safety control is inverted.
3. **CT-U01** — the portal form must capture the period of cover. Until it
   does, every document uploaded the intended way is permanently valid.
4. **CT-S01** — project the columns in `list` and `get`. `uploadToken` should
   never leave the server except to the person who minted it.
5. **CT-L02 / CT-L05 / CT-L01** — the visit lifecycle needs an actual state
   machine. Three procedures each guard one condition and none guards status.
   The on-site board is a life-safety artefact and it is currently editable
   out from under the person standing on site.
6. **CT-G06** — bind the kiosk token to a site.

Everything else can follow. CT-P03 is worth doing at the same time as the
lifecycle work, because a real gate operator is the person who would otherwise
need `contractors.manage` — which is how CT-P06 becomes reachable in practice.

## What this says about the method

The mechanical track paid for itself. The generated permission matrix
(CT-P01) enumerates all 52 procedures at runtime and cannot drift; the seeded
world exposed CT-S01 (128 leaking rows) and CT-P06 (deactivating the tenant's
only admin) simply by having more than one actor and more than one tenant. A
prose review would have found some of this; it would not have proved any of it.

The gap is the web layer. Six findings above are read-only because pglite
cannot click, and two of the three worst modules reviewed before this had their
worst defects there. Contractors should be the last module audited without an
authenticated browser journey.

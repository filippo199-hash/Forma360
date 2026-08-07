# FreeHS — Training & competence matrix module

## Round 2 — re-review by the same four HSE practitioners

**Product:** FreeHS (freehs.software)
**Module reviewed:** Training & competence matrix (FreeHS module B7)
**Change under review:** `a9a227f fix(training): resolve all 15 findings from the practitioner review (#33)`, plus `a933a4c` (module sub-navigation)
**Round 1 document:** `docs/reviews/training-hse-expert-review.md`
**Date:** 7 August 2026

---

## Methodology & scope (read this first)

This is a **re-review**, not a fresh one. The panel's job here is narrower and
harder than round 1: for each of the fifteen findings, decide whether the thing
that was actually shipped closes it — and then look for what the fix pass
introduced or moved.

**How it was performed.** Same as every prior review in the series: the live
site is not reachable from this environment (HTTP 403, no browser automation),
so findings are verified against the shipped source on `main` — the merged diff,
the router, all seven web routes, the components, the worker, the email
registry, the permission sets, the nav model, the search catalogue and the
tests. Dependencies are not installed in this environment, so **the test suite
was not executed**; the commit's claim of 1,222 green tests is taken at face
value, and every finding below is instead derived by reading the code path end
to end. Each finding carries reproduction steps and a `file:line` root cause so
it can be checked in seconds.

**Two corrections to the panel's own working notes**, recorded because a review
that only reports what it got right is not a review:

- A reviewer flagged the matrix's requirement drill-down as ignoring its URL
  parameter. It does not — `matrix/page.tsx:43` reads `requirementId` correctly.
  The real defect is one step further in, and is written up as **TR-B7**.
- A reviewer flagged the training-expiry email as shipping in only 6 of 10
  locales. It does, and so does **every one of the 35 email templates in the
  product** — emails are a 6-locale surface by house convention while the UI is
  10. That is a platform-level observation, not a training defect, and is not
  counted as a finding.

**Headline.** Thirteen of the fifteen round-1 findings are genuinely and often
elegantly closed, including both Criticals. The domain layer remains the best
in the platform and has not been disturbed. The panel wants that said plainly
and first.

But **the module's central promise is still unfulfilled, for a new reason.**
Round 1's headline was that the permits competence gate was written, tested and
never called. It is now called — and cannot be switched on, because
`/permits/types` has no control that sets `requiredTrainingIds`, the permit page
never renders the shortfall preview the fix promises, and the two error slugs it
throws are untranslated. The gate moved from *unwired* to *wired and
unreachable*. Every one of the nine seeded types still ships an empty list, so
in the product as delivered, nothing is enforced.

And the personal door built for TR-A5 — the fix the panel cared about most for
ordinary staff — **shows an empty wallet to every user in every tenant**, because
the page passes `{ personName: '' }` where the server's default-to-caller branch
requires an absent field.

The structural root cause named three reviews running is still open. Web tests
were added, and they are unauthenticated route-existence smoke tests. Four of
the findings below live strictly on the far side of the sign-in page that those
tests stop at.

Severities: **Critical** (the module's central promise is unfulfilled, or data
is silently wrong), **High** (a specified must-have has no working door),
**Medium**, **Low**.

---

## The reviewers

| # | Reviewer | Organisation | What they re-tested |
|---|----------|--------------|---------------------|
| 1 | **Priya Nair, CMIOSH** | Precision engineering, ~800 people × ~30 requirements | The enforcement she called "the real prize", and the numbers on the board |
| 2 | **Tom Whitfield, GradIOSH** | Contractor, 40 people × ~8 cards | The wallet, the personal door, recording from a phone |
| 3 | **Dr. Aisha Bello, CFIOSH** | NHS trust, thousands | The import surface she called the most important in the module |
| 4 | **Marcus Lindqvist, CMIOSH** | EHS consultant / ISO 45001 auditor | Clause 7.2 evidence, the void trail, who can see what |

---

## Round 1 scorecard

| ID | Round 1 finding | Verdict |
|----|-----------------|---------|
| TR-A1 | Permits competence gate is dead code | **Partially closed** — server-side wired; unreachable from the UI → **TR-B1** |
| TR-A2 | Person picker truncates at 50, mis-files as contractor | **Closed** — server-side search, explicit category |
| TR-A3 | CSV import has no door | **Closed with defects** → **TR-B4**, **TR-B5**, **TR-B6** |
| TR-A4 | No wallet view | **Closed for `/training/person`; broken for `/training/me`** → **TR-B2** |
| TR-A5 | No personal door for standard users | **Not closed** — door exists but is empty (**TR-B2**) and the privacy problem behind it is untouched (**TR-B10**) |
| TR-A6 | Worker's inner join skips account-less people | **Closed** — left join, chase via recorder; one side effect → **TR-B9** |
| TR-A7 | Gap list / compliance count unrequired records | **Closed** — `required` on every cell, both consumers filter |
| TR-A8 | Nothing writes `supersededAt`; no void | **Closed** — `supersedeRecord` + wallet control + reason kept on the row |
| TR-A9 | Chase link hardcoded to `/en/` | **Closed** — recipient locale on link and email |
| TR-A10 | No as-at or site controls; site membership unresolved | **Closed** — both controls, `siteMembers` now resolves |
| TR-A11 | Requirements not editable | **Closed** — full edit, all four assignment scopes |
| TR-A11b | No certificate upload | **Closed** — new endpoint, session + permission + brand gated |
| TR-A12 | Compliance has no drill-down or by-area | **Closed with a defect** → **TR-B7** |
| TR-A13 | Training missing from Cmd-K | **Closed then broken** — registered, but the link 404s → **TR-B3** |
| TR-A14 | Error states, sorting, labelled export | **Closed** |
| TR-A15 | Nav placement | **Closed** — moved to the organisation group, asserted by test |

**13 of 15 fully closed. 2 partially. 13 new findings.**

---

# 1 · Priya Nair — "you built the gate and then bricked up the door to it"

> *"I led round 1 with one line: the enforcement is the real prize. I've read
> the fix. The gate is genuinely there now — it reads the matrix, it checks the
> acceptor and every named member of the gang, it does one query instead of
> thirty, and it lets `expiring_soon` through, which is exactly right for a
> shift-long permit. Whoever wrote `loadTrainingShortfalls` understood the
> problem. Then I went to switch it on."*

### What is genuinely fixed
- **The gate is real code on the real path.** `permits.issue` refuses when any
  named operative is `expired` or `not_held`. The stale "until the Training
  module (Phase 10) lands" comment is gone.
- **`expiring_soon` does not block.** Correct and non-obvious: a card valid
  today should not fail a permit because it lapses next month.
- **The gap list and my board number are finally the same population.** TR-A7 is
  properly closed — every cell carries `required`, and both the gap list and the
  compliance denominator filter on it. My 94% is now a real 94%.
- **Statutory and mandatory report apart**, and by-area is there. That is the
  slide I actually present.
- **As-at works on every view.** I can answer "was this operator competent on
  the day" from the UI now, not just from the domain library.

### TR-B1 (Critical) — the competence gate cannot be switched on
The gate is armed by `permit_types.requiredTrainingIds`. Three things are true
at once:

1. **Nothing in the UI can set it.** `permits/types/page.tsx:24-30` defines
   `FLAG_KEYS` as the five toggles it renders, and `requiredTrainingIds` is not
   among them — nor is there a requirement picker anywhere on the page. A
   repo-wide grep finds `requiredTrainingIds` in the router, the schema, the
   shared helper and the tests, and **in no `.tsx` file at all**. The only way to
   arm it is a raw tRPC call.
2. **All nine seeded types ship `[]`**, which the commit message correctly
   describes as safe — and which means the delivered behaviour is byte-for-byte
   what it was before the fix.
3. **The promised preview does not exist.** `permits.get` returns
   `trainingShortfalls` (`permits.ts:1061-1075`), and the permit page never reads
   it: `[permitId]/page.tsx` renders `ramsGate` at `:464`, `:472` and `:1031`,
   and consults it in the Issue button's `disabled` at `:1041`. `trainingShortfalls`
   appears nowhere. The issuer sees nothing.
4. **And if it ever does fire, the message is meaningless.** `issue` throws
   `training-expired` / `training-missing` (`permits.ts:1858-1866`). Neither slug
   is in `KNOWN_SLUGS` (`permit-error.tsx:19-61`) and neither has an i18n key —
   so `PermitErrorText` falls through to `t('generic')`. The issuer at the job
   face gets "something went wrong", with no names and no reason.

> *"So: I can't turn it on, and if I could I couldn't see who was short, and if
> I pressed Issue anyway I'd get a shrug. Round 1 said the gate was built and
> never called. Round 2 says it's called and can't be reached. That is progress
> in the code and no progress at all on my site."*

**Reproduce:** open `/en/permits/types` → no training control on any type. Then
set `requiredTrainingIds` via the API, open a permit whose gang includes someone
with an expired card → the page shows no warning → press Issue → generic error.

**Fix:** a requirement multi-select on the types page (the data is one
`training.listRequirements` call away); a shortfall block on the permit page
next to the RAMS one, feeding the same `disabled` expression; the two slugs
added to `KNOWN_SLUGS` and `permits.errors.*`.

### TR-B7 (Medium) — the requirement drill-down misreports every other column
Clicking a requirement on the compliance page goes to
`/training/matrix?requirementId=X`. The page reads the param correctly
(`matrix/page.tsx:43,57`) and the router filters `cells` by it — but the
`matrix` procedure returns **all** requirements as columns
(`training.ts:745-752`), and the page falls back to `not_required` for any cell
it can't find (`matrix/page.tsx:104,313`).

So drilling into "Abrasive wheels" renders 29 other columns of "–", asserting
that 800 people are not required to hold tickets they are in fact required to
hold — and `exportRows()` at `:104` writes that same assertion into the CSV and
the PDF, where it leaves the building.

**Fix:** one line — filter `requirements` by `input.requirementId` in the
`matrix` procedure, so a filtered grid has one column.

### TR-B13 (Low) — an empty site filter looks like an empty site
Site scoping resolves through `site_members`, which is a curated table. A tenant
that has never curated it gets an empty grid from the site filter and no
`byArea` rows, with nothing on screen explaining why. The empty state should say
"no one is a member of this site yet" and link to site membership.

---

# 2 · Tom Whitfield — "my page is blank, and it's blank for everyone"

> *"Round 1 I said the wallet was the half that didn't ship. It shipped. The
> card layout is right — number, expiry, the photo of the actual thing, and now
> a void button with a reason. That's the screen I asked for. Then I opened
> `/training/me` on my phone and it said I have no records. I do have records."*

### What is genuinely fixed
- **The wallet is card-shaped, not row-shaped**, and works from
  `/training/person?userId=…` — the gate screen, linkable, exactly as asked.
- **Recording from a phone is a minute's work.** The picker searches the server
  now, so I can find anyone; the category is a choice instead of a guess; the
  camera is one tap; expiry fills itself in.
- **The photo upload is properly gated** — session, `training.record` or
  `training.manage`, brand-gated, size- and MIME-capped, filename sanitised.
  Nothing to complain about.
- **Voiding a record works and keeps the reason on the row.** That is the right
  call for an append-only store.

### TR-B2 (Critical) — `/training/me` shows an empty wallet to every user
The server-side fix is correct: `training.person` defaults to the caller when
called with no arguments (`training.ts:697-705`).

The page never calls it with no arguments. `/training/me` renders
`<PersonWallet heading=… />` with no `userId` and no `personName`, and
`person-wallet.tsx:47-49` does:

```ts
const query = trpc.training.person.useQuery(
  userId !== undefined ? { userId } : { personName: personName ?? '' },
);
```

so it sends `{ personName: '' }`. The server's condition is
`input.userId === undefined && input.personName === undefined` — `''` is not
`undefined`, so the default-to-caller branch never runs. The records query
becomes `WHERE person_name = ''`, which matches nothing, and the page renders
the "no records" empty state for every user in every tenant.

There is a **second, latent bug in the same procedure** that will still bite
after that one is fixed: `training.ts:709` computes the cell key from
`input.userId`, not `target.userId`:

```ts
const key = input.userId ?? personKeyOf(null, (input.personName ?? '').trim());
```

With no arguments that resolves to `name:`, so `cells` comes back empty even
once `records` is right — meaning the "what am I missing" half of the wallet
stays blank, because a `not_held` requirement exists only as a cell and never as
a record.

**Reproduce:** sign in as anyone with training records, open `/en/training/me`.
Expected: your cards. Actual: "no records".

**Fix:** `PersonWallet` sends `{}` when it has neither prop; `person` uses
`target.userId` on line 709. Two lines. Then a signed-in test that opens the
page and asserts a card is present.

### TR-B11 (Low/Medium) — the personal door has no way back
Neither `/training/me` nor `/training/person` renders `TrainingTabs`, and the
tab bar itself (`training-tabs.tsx:16-23`) has no "My training" entry. So the
one page built for ordinary staff sits outside the module's own navigation:
you arrive from a link and leave with the browser back button.

### TR-B8 (Medium) — the chase email doesn't say whose card it is
The worker now correctly routes an account-less operative's chase to whoever
recorded the card, and sets `viaRecorder: true` to mark it
(`training-expiry.ts:121`). **Nothing reads that flag.** `worker.ts:739-751`
passes only `personName`, `requirementName`, `expiresOn` and `url`, and the
template (`emails/en/training-expiry.json`) reads *"Hi {personName}, Your
training record for … expires …"*.

So I get an email addressed to my subcontractor's operative, telling me that my
training expires, about a card that isn't mine.

> *"I'll work it out. But this is the one email the module sends, and it's the
> one that goes to the person who can actually do something. It should say
> 'Dave Okafor's abrasive wheels ticket expires on the 14th — you recorded it.'
> The flag to do that is already sitting there unused."*

**Fix:** pass `viaRecorder` into the template variables and add a second body
string; both dispatchers already substitute per-variable.

---

# 3 · Dr. Aisha Bello — "the import is there, and it loses rows without telling me"

> *"I said the import surface matters more to me than any screen in the module,
> because without it the matrix is empty on day one and stays empty. It now
> exists, it takes a file or a paste, it has a downloadable template, and it
> reports per-row failures instead of failing the batch. Four things I asked for.
> Then I tested it the way I'd actually use it, with a real extract, and I don't
> trust the result."*

### What is genuinely fixed
- **File and paste, one validation path, per-row errors.** The right shape.
- **A downloadable template with the exact column names.** Removes the guessing.
- **`source: 'imported'`** is stamped on every row, so imported evidence is
  distinguishable from checked evidence. That was Lindqvist's ask and it's
  honoured.
- **The compliance page reports mandatory apart from statutory, and by area**,
  and both drill down. That's my board slide.

### TR-B4 (High) — the importer silently drops rows
`parseCsv` skips any row missing `personName`, `requirementName` or `achievedAt`
with a bare `continue` (`import-dialog.tsx:97-100`). Those rows never reach the
server, so they are not in `imported`, not in `failed`, and not in `errors`.

A 2,000-row extract with 40 rows missing an achievement date imports 1,960 and
reports **"Imported 1,960"** with no failures and no mention of the 40. The
component's own doc comment (`:13-16`) promises the exact opposite: *"failures
are reported per row with a reason … a 2,000-row paste with three bad dates
imports 1,997 and names the three."*

Compounding it: the row numbers that *are* reported are indices into the
post-filter array (`training.ts:783`, `row: i + 1`), so once anything is
dropped, every reported row number is offset from the user's spreadsheet.

> *"Silent truncation on an import is the worst failure mode there is. I'd
> present that 1,960 to a board as complete. It isn't, and the tool told me it
> was."*

**Fix:** collect skipped lines with their original 1-based file line number and
a reason, and merge them into the result set before display. Report the row
number from the source file, not the array index.

### TR-B5 (High) — the importer creates a duplicate person for anyone without an email
`importRecords` links a row to a user **only** by `userEmail`
(`training.ts:773-775`). Rows without one get `userId: null` and a name-only
person.

`resolveMatrix` keys users by id and record-people by lowercased name
(`training.ts:126`), and the dedup set is built from user ids
(`training.ts:259`), so a name-only record for someone who *does* have an
account never collapses into them. The result: **the same nurse appears twice in
the matrix** — once as an employee with a wall of `not_held`, once as a name-only
person holding all the cards. The compliance percentage is wrong in both
directions at once.

Most LMS extracts carry a payroll or staff number, not an email. This is the
module's primary onboarding path.

**Fix:** fall back to a case-insensitive name match against tenant users when
`userEmail` is absent, report ambiguous matches as per-row failures rather than
guessing, and show a pre-import summary ("612 rows matched to users, 188 will be
recorded as name-only") before anything is written.

### TR-B6 (Medium) — the import is not idempotent
Re-running the same file inserts every row a second time. There is no
`clientRef`, no natural key, no dry run. Because the store is append-only, the
only undo is `supersedeRecord`, one row and one typed reason at a time.

The RAMS module already solved exactly this — an offline briefing queue keyed on
`clientRef` with a partial unique index (migration 0070). The pattern exists in
the repo.

**Fix:** a unique index on `(tenant_id, requirement_id, person_key, achieved_at)`
and `ON CONFLICT DO NOTHING`, plus a dry-run toggle that reports what would be
written.

### One more, smaller
An extract with one unknown course name produces one `unknown-requirement:<name>`
error **per row** — up to 2,000 identical lines in a `max-h-40` scroll box. Group
distinct unknown requirement names, count them, and offer to create them.

---

# 4 · Marcus Lindqvist — "the evidence trail is right; the access model isn't"

> *"I'll start where I'm pleased. The void is done properly: the row stays,
> `supersededAt` is stamped, and the reason is appended to the notes on the
> record itself rather than hidden in a side table. For a clause 7.2 audit that
> is the correct construction — I can see that a record was withdrawn, when, and
> why, without the record disappearing. The append-only claim is now true in
> both directions."*

### What is genuinely fixed
- **`supersedeRecord` closes TR-A8 properly**, including the `already-superseded`
  conflict guard.
- **The certificate photograph is stored and served safely.** I checked the read
  path: `/api/files` validates the object-key shape and requires the key to start
  with the caller's `tenantId` (`api/files/route.ts:38-45`), so a forged
  `evidenceKey` cannot reach another tenant's blob. Good.
- **Verification is distinct from entry**, with `verifiedByUserId` and
  `verifiedAt` kept apart from `recordedByUserId`, and the wallet now has the
  control. Self-declared and checked training are distinguishable in the record.
- **The as-at query answers the audit question from the UI.**
- **The worker finally has a test** covering notify-then-stamp, dedup, the
  per-requirement window and quiet-when-clean.

### TR-B10 (Medium) — the privacy problem TR-A5 named is untouched
Round 1's objection was not only "there is no personal page". It was that a
standard user's *only* door into the module was a named list of every
colleague's competence shortfalls. A personal page was added **beside** that
door, not in place of it.

`training.view` is in the seeded Standard set (`permissions/src/seed.ts:46`), and
it gates the gap list, the matrix and the compliance roll-up — all three
org-wide, all three naming individuals. `TrainingTabs` shows all three to a user
with no `training.manage`. The `/training/me` page's own header comment states
the problem and then does not solve it.

Under GDPR data-minimisation this is the finding I'd write up on a client site:
competence data is special-category-adjacent, and "every employee can list every
colleague's expired tickets by name" is not a defensible default.

**Fix:** the personal wallet should not require `training.view`; the org-wide
views should sit behind a `training.view` that is **not** in the Standard set.
That is a seed change plus a backfill migration — the same PF-8 shape the module
already used to add its keys.

### TR-B3 (High) — every training result in Cmd-K is a 404
TR-A13 was closed by registering a `training` category
(`search-categories.ts:82-88`) with `basePath: 'training/requirements'`.
`global-search.tsx:153` builds the href as
`` `/${locale}/${cat.basePath}/${item.id}` ``, so a hit navigates to
`/en/training/requirements/<ulid>`.

**That route does not exist.** `apps/web/app/[locale]/training/` contains exactly
seven files and no `requirements/[id]` segment. Every training result in the
command palette dead-ends.

Two further mismatches on the same path: the search procedure is gated on
`training.view` (which Standard holds) while `/training/requirements` is gated on
`training.manage` (`requirements/page.tsx:73,133`), so even with the route
present, a standard user would get hits they cannot open — and the hit is a
*requirement definition*, which is an admin object, when what a searcher almost
certainly wants is a **person's** record.

> *"The guard test the previous review asked for was written, and it passed —
> because it asserts that a server category has a client entry, not that the
> entry resolves to a page. The bug moved one inch to the right of the test. I'd
> rather that than no test, but the lesson generalises: assert the URL, not the
> table row."*

**Fix:** point `basePath` at `training/person` and return people rather than
requirement definitions from the training search branch; or add the missing
detail route. Extend the existing category test to assert every `basePath`
corresponds to a real route segment.

### TR-B9 (Medium) — a leaver's cards now chase their manager
The old query excluded deactivated holders outright
(`isNull(user.deactivatedAt)` in the `WHERE`). The new code sets
`holderReachable = false` for a deactivated holder and falls through to
`recorderEmail` (`training-expiry.ts:110-113`) — while the comment immediately
above it says *"A deactivated holder is nobody's to chase."* The code does the
opposite of its comment.

Effect: for a month or so after someone leaves, whoever recorded their tickets
gets a chase email per lapsing card, for a person who no longer works there.

**Fix:** `if (r.holderDeactivatedAt !== null) continue;` before the recorder
fallback, so the fallback only applies to genuinely account-less people — which
is what TR-A6 asked for.

### TR-B12 (Low) — `addRecord` trusts a client-supplied `userId`
`recordInput.userId` is `z.string().min(1).nullable()` and is inserted directly
(`training.ts:557`) with no check that the user belongs to the calling tenant —
ground rule 4 says every query scopes by tenant and the tenant id is never taken
from client input. `importRecords` is safe (it resolves through a tenant-scoped
email map); `addRecord` is not.

The impact is containment, not disclosure: `/api/files` blocks the cross-tenant
read, and `resolveMatrix` skips a record whose `userId` isn't a tenant user, so
the record simply vanishes. But it is a silent data-integrity hole and a
one-line fix.

---

# Consolidated findings

| ID | Severity | Finding | Root cause |
|----|----------|---------|------------|
| **TR-B1** | **Critical** | Competence gate is wired but cannot be armed, previewed or explained | `permits/types/page.tsx:24-30`; `[permitId]/page.tsx:1041`; `permit-error.tsx:19-61` |
| **TR-B2** | **Critical** | `/training/me` shows an empty wallet to every user | `person-wallet.tsx:47-49`; `training.ts:709` |
| **TR-B3** | High | Every Cmd-K training result 404s; wrong object, wrong permission | `search-categories.ts:86`; `global-search.tsx:153` |
| **TR-B4** | High | CSV import silently drops rows and reports success | `import-dialog.tsx:97-100`; `training.ts:783` |
| **TR-B5** | High | Import duplicates every person who has no email in the extract | `training.ts:773-775`; `training.ts:126,259` |
| **TR-B6** | Medium | Import is not idempotent; undo is one row at a time | `training.ts:816-819` |
| **TR-B7** | Medium | Requirement drill-down renders 29 columns of false "not required", and exports them | `training.ts:745-752`; `matrix/page.tsx:104,313` |
| **TR-B8** | Medium | Chase email addressed to the operative, sent to the recorder; `viaRecorder` unused | `worker.ts:739-751`; `emails/en/training-expiry.json` |
| **TR-B9** | Medium | A leaver's expiring cards now chase whoever recorded them | `training-expiry.ts:110-113` |
| **TR-B10** | Medium | Every standard user can still list every colleague's shortfalls by name | `permissions/src/seed.ts:46`; `training-tabs.tsx:27-30` |
| **TR-B11** | Low/Med | The personal door is outside the module's own navigation | `training-tabs.tsx:16-23` |
| **TR-B12** | Low | `addRecord` accepts an unvalidated cross-tenant `userId` | `training.ts:70,557` |
| **TR-B13** | Low | Empty site filter reads as an empty site | `training.ts:298-301` |

---

# Verified correct — no action

Recorded so the fix pass doesn't churn what is already right:

- `packages/shared/src/training.ts` is **untouched by the fix pass**, which was
  the correct decision. Append-only semantics, `currentRecord` preferring
  furthest-reaching cover with ties on later achievement, month-end clamping in
  `computeExpiry`, `compliancePercent` returning `null` on an empty denominator,
  glyph-never-colour-alone. It remains the best-reasoned domain library in the
  platform.
- `loadTrainingShortfalls` (`permits.ts:544-622`) — one query for the whole gang,
  in-memory decision, `expiring_soon` deliberately non-blocking, account-less
  workers matched the same way the matrix keys them. The logic is right; only its
  doors are missing.
- `/api/upload/training-certificate` — session, permission, brand, size, MIME and
  filename all handled, mirroring the COSHH route.
- `/api/files` tenant-prefix enforcement blocks a forged `evidenceKey`.
- `myWork` training rows are scoped to `userId = me` by construction and cannot
  surface a colleague.
- `resolveMatrix`'s person dedup is correct — `if (rec.userId !== null) continue`
  at `training.ts:261` prevents the duplicate-person class in the *manual* path
  (TR-B5 is an importer bug, not a matrix bug).
- Email templates in 6 of 10 locales matches all 35 templates in the product.
- `matrix/page.tsx:88-94` copies before sorting — no cache mutation.
- The nav placement test (TR-A15) asserts behaviour rather than arguing in a
  comment. More of this.

---

# The structural finding, third review running

Round 1 named the root cause: **no test touches a web path**, so router-ahead-of-UI
gaps ship green. The fix pass responded, and the panel wants to be precise about
what it responded with:

- `apps/web/e2e/training.spec.ts` — **unauthenticated**. It asserts each of six
  routes returns < 400 and redirects to `/sign-in`.
- `import-dialog.test.ts` — parses CSV strings. Real value, and it is the test
  that *should* have caught TR-B4; it doesn't, because it tests what `parseCsv`
  returns rather than what the user is told.
- `nav-model.test.ts` — asserts nav placement and gating.
- `training-expiry.test.ts` — the worker test that was missing. Genuinely good.

Every route test stops at the sign-in redirect. **TR-B2, TR-B3, TR-B4 and TR-B7
all live past it.** So does TR-B1: the assertion that would have caught it is
"the permit types page can set every field `typeUpdateInput` accepts".

> **Nair:** *"Three reviews have said the same sentence and three fix passes have
> added tests that stop one step short of the defect. The missing thing isn't
> more tests, it's one authenticated Playwright journey per module: sign in,
> open the module's primary screen, do the module's primary action, assert the
> result. For training that's four assertions and it catches five of the thirteen
> findings in this document."*

---

# Prioritised register

### Do before anyone is told the gate exists
1. **TR-B1** — requirement multi-select on `/permits/types`; shortfall block and
   `disabled` on the permit page; both slugs in `KNOWN_SLUGS` and
   `permits.errors.*`. Until this lands, the module's headline claim is not true
   of the shipped product.
2. **TR-B2** — two lines (`PersonWallet` sends `{}`; `person` uses
   `target.userId`), plus one signed-in test. The personal door is currently
   broken for 100% of users.

### Do in the same pass
3. **TR-B4** + **TR-B5** — the import is the day-one path, and it currently loses
   rows quietly and duplicates people. Both are contained in one dialog and one
   procedure.
4. **TR-B3** — repoint the Cmd-K category at people, and extend the existing
   category test to assert the URL resolves.
5. **TR-B7** — one line in the `matrix` procedure.

### Next
6. **TR-B8**, **TR-B9** — the worker's two remaining rough edges; both small.
7. **TR-B10** — the permission change plus backfill. Worth doing before the first
   customer with a works council or an EU DPO.
8. **TR-B6**, **TR-B11**, **TR-B12**, **TR-B13**.

### Structural
9. One authenticated end-to-end journey per module, starting with training. The
   panel has now asked three times.

---

# Closing note from the panel

> **Whitfield:** *"Round 1 I said the module had a good engine and half a car.
> It's now got most of a car. The wheels are on, the doors open — except the
> driver's door, which is the one I use."*
>
> **Bello:** *"Thirteen of fifteen, properly done, in one pass, without breaking
> the domain layer. I've reviewed products that took three releases to close
> five. Say that first, then fix the import."*
>
> **Lindqvist:** *"The evidence model is now audit-ready — void trail, verified
> flag, as-at, the certificate itself. That's the hard half and it's done. What's
> left is access control and a handful of wiring. I'd sign the record model
> today."*
>
> **Nair:** *"My line hasn't changed since round 1: the enforcement is the prize.
> It's ten feet closer and still behind glass. Put the multi-select on the types
> page and the shortfall list on the permit, and I'll have the thing I asked for
> — which no other product in this market gives me."*

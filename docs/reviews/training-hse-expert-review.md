# FreeHS — Training & competence matrix module

## Independent review by four HSE practitioners

**Product:** FreeHS (freehs.software)
**Module reviewed:** Training & competence matrix (FreeHS module B7)
**Surface reviewed:** `/en/training` — gap list, matrix, compliance, requirements, the expiry worker, and the integrations
**Date:** 3 August 2026

---

## Methodology & scope (read this first)

The ninth review in the series, and the first of a module built from a
**design review by this same panel** — `freehs-training-matrix-hse-expert-review.md`,
which specified the four views, the function list, the enforcement hooks and
the explicit not-an-LMS boundary. That document is the acceptance criteria, and
this review is scored against it.

**How the review was performed.** As with every prior review, findings are
verified against the shipped implementation on `main` — the domain library, the
schema, the 823-line router, the four web routes and their components, the
expiry worker, the email registry, the tests and every integration point. The
two most consequential findings were re-verified by hand.

**Headline.** The domain layer is the best-reasoned in the platform, and several
of the panel's most specific asks were honoured exactly — the append-only
"as at" model, month-end clamping, glyph-never-colour-alone, the permission
keys revised to remove the LMS ones. **The web surface is a partial shell over
it.** Six router procedures have no UI caller at all — including the wallet
view, the CSV import and the reverse lookup — and their translations are
already shipped in all ten locales, which tells you the interface was scoped
and then not built.

And the module's stated justification is unwired: **the permits competence gate
was written to the letter, tested, and is never called.** The self-ticked
checkbox the panel called *"the weakest control in the platform"* is still
self-ticked, and the permits router still carries a comment saying the Training
module hasn't landed.

Severities: **Critical** (the module's central promise is unfulfilled, or data
is silently wrong), **High** (a specified must-have has no door), **Medium**,
**Low**.

---

## The reviewers

| # | Reviewer | Organisation | What they tested |
|---|----------|--------------|------------------|
| 1 | **Priya Nair, CMIOSH** | Precision engineering, ~800 people × ~30 requirements | The gap list she asked to be the default, the grid, and the enforcement she called "the real prize" |
| 2 | **Tom Whitfield, GradIOSH** | Contractor, 40 people × ~8 cards | The wallet at a client's gate, and recording a card from a phone |
| 3 | **Dr. Aisha Bello, CFIOSH** | NHS trust, thousands | Bulk import, the compliance roll-up and its drill-down |
| 4 | **Marcus Lindqvist, CMIOSH** | EHS consultant / ISO 45001 auditor | Clause 7.2: what was required, what was held, show me the certificate |

---

# 1 · Priya Nair — the right default, the wrong numbers, and the missing prize

> *"I asked for the gap list to be the landing view and it is. That's the
> single best thing here and I want to say so first. Then I looked at what the
> list actually contains, and at whether any of it stops anyone doing
> anything."*

### What was built exactly as asked
- **The gap list is the default route**, ordered expired → expiring → never
  held, with each row one click from recording the fix, pre-filled. My #1 point,
  done properly.
- **Requirements driven by role** works — assign to "machine operator" and the
  requirement, and therefore the gap, appears for everyone in that role.
- **Status is a glyph plus colour plus text**, never colour alone.

### TR-A1 (Critical) — the enforcement is dead code

This was my "real prize", and the panel's unanimous instruction was to ship it
in the same release. It was built — properly. `trainingGateShortfalls` and
`trainingGateError` sit in the shared permits library exactly where we asked
(*not* only in the router, so the permit UI can preview the blocker), they
return **every** shortfall rather than the first so the UI can name names, and
they correctly let `expiring_soon` through while blocking `expired` and
`not_held`. There is a `requiredTrainingIds` column on the permit type. There is
a test suite, PW-E12.

**And nothing calls any of it.** A repository-wide search for
`trainingGateError`, `trainingGateShortfalls` or `requiredTrainingIds` returns
the definitions, the schema column, and the test file. No router import, no UI,
no seeding. The nine seeded permit types still carry their
`competence_verified` checkbox untouched, and the permits router still opens
with a comment describing competence checks as *"a precondition checklist line
until the Training module (Phase 10) lands."*

It has landed. Nobody moved the wire.

### TR-A7 (Medium) — my gap list and my board number are both wrong

The matrix emits a cell whenever a record exists, **even when the person is not
required to hold it** — and the status helper then returns that record's real
state rather than "not required". The consequence shows up in the two views I
use most:

- **The gap list lists people against training they don't need.** Dave moves
  from the shop floor to the office; his abrasive-wheels card lapses; he is not
  required to hold it any more; he appears in my expired list. That is noise in
  the one view designed to be actionable, and noise is how a gap list stops
  being trusted.
- **The compliance percentage counts it against me.** The roll-up passes every
  cell through, and the helper only excludes `not_required` — so a lapsed
  voluntary card drags the number I put in front of my board. The per-requirement
  gap counts are inflated the same way.

The fix is small: the gap list and the compliance denominator should count only
cells where the requirement is actually assigned.

### The grid — three of my four requirements missing
I asked for four things. **Cells are not clickable** (they're plain spans, so a
cell can't open the record). **Columns don't sort by gap count.** **The filter
is requirement-only** — no site, department or role, which is what makes 800 × 30
readable at all. Export is CSV only, **no PDF**, so my board paper doesn't
exist — and the CSV emits raw enum values (`not_required`, `in_date`) rather
than the labels or glyphs, which is not a document I can circulate.

### TR-A11 (Medium) — the catalogue can only express a fraction of itself
Creating a requirement hardcodes `renewalLeadDays: 60` with no field and no
edit screen, so *"a CSCS card needs chasing months out and a toolbox talk does
not"* — the module's own justification for the column — cannot be expressed. The
worker's entire chase window is driven by that value. Assignment is **role-only**
in the UI: the chips render `group`, `site` and `person` scopes and the
translations exist, but nothing can create them, which kills the "composable
union" that makes the model worth having.

**Verdict:** The view I asked for is the view I got, and I'm pleased. But the
numbers in it are wrong in a way that will show up in my first board pack, and
the enforcement — the reason I said this module pays for itself — is sitting in
the repository doing nothing.

---

# 2 · Tom Whitfield — my half of the module wasn't built

> *"I was clear that a grid is a manager's artefact and mine is a wallet. I
> get to a client's gate, I open one person, I show their card. That screen
> does not exist."*

### TR-A4 (High) — no wallet view
There is no person page. The router has a `person` procedure that returns
exactly what I described — their cells and their records — and **no page calls
it.** The strings for it are translated in all ten locales
(`training.person.title`, `noRecords`, `verified`, `unverified`) and are dead.
The interface was scoped, translated, and not built.

### TR-A11b (High) — no photograph, which was the whole point
I said the photo of the physical card *is* the evidence, because that is
already how I work. The schema has `evidenceKey` and `evidenceFilename`. The
translation `training.record.evidence` exists in ten locales. **The record
dialog has no file input, no camera capture, no upload.** So the module records
that a card exists and cannot show it — which also makes the verification step
meaningless, because there is nothing to verify against.

The dialog is a desktop form with two dropdowns. "Under a minute from a phone"
is not met, and nothing here is offline.

### TR-A2 (Critical) — the person picker quietly breaks at 50 people
This one bit me even at forty. The dialog asks the server for users with no
arguments; the server defaults to **fifty**, with cursor pagination the dialog
never uses and no search box. Nothing says so.

Past the fiftieth person you have to type the name free-text — and the dialog
then does this:

```
personCategory: userId === '' ? 'contractor' : 'employee'
```

So **an employee typed by hand is filed as a contractor with no user link.**
That record lands under a different key in the matrix from that person's
account, so their competence is split across two rows. And the expiry worker
inner-joins the user table, so **a record with no user link is never chased.**

At my scale it's an annoyance. At Priya's 800 or Aisha's 3,000 it means most of
the workforce is mis-filed on entry and silently excluded from every reminder.

### No client-facing PDF
The training matrix as a branded PDF was the commercial reason a contractor
pays for this — every tender asks for it. CSV of raw enum values is not that.

**Verdict:** The manager's half of this module shipped and mine didn't. No
wallet, no photo, no phone flow, no tender document — and a person picker that
mis-files anyone past the fiftieth name.

---

# 3 · Dr. Aisha Bello — the door I said mattered most has no handle

> *"I said one thing more forcefully than anything else: **the import surface
> matters more to me than any screen in the module.** Without it the matrix is
> empty on day one and stays empty."*

### TR-A3 (High) — the CSV import exists and is unreachable
The router procedure is genuinely well built: 1–2,000 rows, resolves
requirements by name and people by email, and reports **per-row** failures with
reasons rather than failing whole — the docstring even explains why, in my own
terms. It is tested.

**There is no file input, no paste box and no button anywhere in the
application.** The five `training.import.*` strings are translated into ten
locales and orphaned. My LMS holds tens of thousands of completion records and
there is no way to get any of them in. On day one my matrix is empty; on day
one hundred it is still empty.

### TR-A12 (Medium) — my funnel is one dead link
The compliance page exists and reports **statutory separately** — thank you,
that was mine. But:
- Each requirement links to the matrix **with no filter attached**, and the
  matrix reads its filter from local state rather than the URL. So clicking
  "Sharps/IPC — 64%" lands on the unfiltered grid of everyone. The
  directorate → ward → role → grid → person funnel I described is a single
  broken hop.
- There is **no by-area breakdown at all** — only by requirement. My board
  asks by directorate first.
- **Mandatory is not reported separately** from the rest, only statutory. I
  asked for both apart.

### TR-A5 (High) — and there is no personal door, which makes the only door a privacy problem
I argued nine in ten users only ever want *"when does my card expire?"* — hence
"My training" as a tile in My work. **It doesn't exist**: no tile, no filter, no
`training` kind in the queue. Only a tenant-wide badge count was added.

So a standard employee's single entry point to this module is the **gap list —
a named list of every colleague's competence shortfalls**, which their
`training.view` key grants by default. That is the opposite of what I asked
for, and in a trust it is a conversation with the information-governance team.

### What I'd defend
The glyph work is done properly and thoroughly — glyph, colour *and* text, with
`sr-only` labels and a learnable legend, and the compliance bar marked
`aria-hidden` with the comment *"the bar is decoration; the number above it is
the fact."* My accessibility note was taken seriously. The translation
namespace is 79 keys at **exact parity across all ten locales**, which is the
best-executed part of this release.

**Verdict:** Good bones, and my accessibility point was honoured. But my
make-or-break has no door, my funnel is broken, and the only way in for most of
my staff is a list of their colleagues' failings.

---

# 4 · Marcus Lindqvist — the evidence layer, and a pattern I have now written up four times

> *"I ask three questions: what were they required to hold, what did they hold,
> and can you show me the certificate. This module answers the first two
> beautifully and cannot answer the third at all."*

### What is genuinely excellent
The domain library is the best-reasoned code I have read in this platform, and
its tests are the reason I believe it:
- **Records are append-only**, and `currentRecord` resolves the governing record
  as *the furthest-reaching cover*, not the newest row — with the test spelling
  out why: a backdated entry typed after a renewal must not override it, and a
  never-expiring qualification outranks any dated one.
- **"As at" works**: the same call answers "expired on the day of the incident"
  and "in date today". That is my post-incident question, implemented.
- **Month-end clamping**: 31 January + 12 months is 31 January, and + 1 month is
  28/29 February — tested in a leap year. Certificates dated the 31st do not
  silently gain days.
- **Compliance over an empty set returns null**, not 0% or 100%, so a ward with
  no requirements reads "—" instead of a lie in either direction.
- **Records survive the person**: the user FK is `ON DELETE SET NULL` and the
  person's name is always stored, so anonymising a user leaves the evidence
  that training happened. I asked for that explicitly.

### TR-A11b (High, my angle) — but I cannot see a certificate
No evidence upload means clause 7.2 question three has no answer, and the
`verifyRecord` procedure — verification kept distinct from entry, exactly as I
asked, and also unwired — has nothing to verify. The record can say
"verified" about a document that does not exist.

### TR-A8 (Medium) — append-only with no correction path is a trap
The schema promises that *"superseded rows stay readable but drop out of the
current matrix."* Read paths filter on `supersededAt` — and **nothing anywhere
sets it.** There is no void, no supersede and no delete.

Combined with `currentRecord` preferring the **furthest** expiry, a fat-fingered
expiry of 2099 wins forever: that person is permanently in date, permanently
absent from the gap list, and — once the permits gate is wired — permanently
passes it. An append-only record system needs a supersede path precisely
*because* it can't edit; shipping the filter without the writer is the worst of
both.

### TR-A10 (Medium) — my question is implemented and has no door
`asOf` is accepted by the gap list, the matrix and the compliance roll-up.
**No page passes it.** All three render "as at" from the server's clock. The
one capability that distinguishes this from a spreadsheet is reachable only
from the API. `siteId` is the same story.

### The pattern — fourth module running
I have now written this paragraph four times. Incidents shipped six procedures
with no UI (IN-A7, Medium). RAMS shipped twenty and could not complete its own
workflow (RS-A1, Critical). **Training ships six**, including the two the panel
ranked #2 and #3, plus a fully-built enforcement hook with no caller.

The RAMS review named the root cause: **no test touches a web path.** That has
reproduced verbatim — the only `apps/web` test mentioning training is a badge
key in a list. Every defect in this review lives in a web path. And this module
is the **only reminder worker in the repository without a test**, so its one
genuinely correct safety property — notify-then-stamp — is pinned by nothing.

### Smaller, but mine
- **Not in global search** — in a file whose own comment records fixing PF-6 and
  says *"every module the nav shows is now searchable."* Training is in the nav.
- **Fire safety still hand-types marshal training dates.** The brief asked for
  the status helper to be lifted and consumed back; the lift happened, the
  consume-back did not, so two divergent vocabularies now coexist
  (`not_trained` vs `not_held`).
- A failed query renders the **empty state** — for a gap list, "no gaps" and
  "the query failed" look identical, and the safe-looking one is the lie.

**Verdict:** The evidence model is the best in the platform and the evidence
itself cannot be attached. Fix the certificate upload, the supersede path and
the "as at" control, and this becomes the most auditable module here.

---

# Consolidated findings

### Where the reviewers agree
1. **TR-A1 — the permits gate is dead code.** Built to the letter, tested, zero
   callers; the stale comment still says Training hasn't landed. The module's
   stated justification. *All four.*
2. **TR-A2 — the person picker truncates at 50**, silently mis-files employees
   as contractors, and those records are invisible to the expiry worker.
   *Whitfield, with Nair and Bello on the scale consequences.*
3. **Three specified must-haves have no door**: CSV import (A3), the wallet
   view (A4), "My training" in My work (A5) — all with routers built and
   strings translated.
4. **The numbers are wrong** (A7): the gap list and compliance percentage count
   training people aren't required to hold.
5. **No evidence upload** (A11b), which also makes verification meaningless.
6. **Root cause, fourth module running**: no test touches a web path; no worker
   test at all.

### What everyone praised (protect these)
- The **domain library and its tests** — append-only "as at", furthest-reaching
  cover, month-end clamping, null on an empty denominator.
- **Glyph + colour + text, never colour alone**, with `sr-only` labels, a
  learnable legend and the decorative bar marked `aria-hidden`.
- **The gap list as the default landing view**, correctly ordered and one click
  from the fix.
- **The permission keys revised to `view / record / verify / manage`**, with the
  LMS keys removed and the reason recorded — exactly as the panel asked.
- The **worker's notify-then-stamp ordering**, per-run cap, quiet-when-clean,
  and per-requirement lead time computed in SQL.
- **79 i18n keys at exact parity across ten locales**; the email registry
  still 1:1 under the IN-J04 test.
- **Records survive anonymisation** by design.
- The **`trainingGateShortfalls` design** — returns every shortfall so the UI
  can name names. It deserves to be called.

---

# Prioritised issue register

| ID | Sev | Summary | Raised by |
|----|-----|---------|-----------|
| TR-A1 | **Critical** | Permits competence gate is dead code — helper, schema column and tests exist; no production caller; permits router comment still says Training hasn't landed | All four |
| TR-A2 | **Critical** | Person picker defaults to 50 users with no search/pagination → anyone past #50 typed free-text is filed as `contractor` with no user link → split matrix identity **and** invisible to the expiry worker | Whitfield, Nair, Bello |
| TR-A3 | High | CSV bulk import built and tested; **no UI** — the brief's make-or-break | Bello |
| TR-A4 | High | No person/wallet view; `person` procedure and its 10-locale strings unused | Whitfield |
| TR-A5 | High | No "My training" tile/tab in My work → a standard user's only door is a named list of colleagues' gaps | Bello |
| TR-A6 | High | Expiry worker chases **neither managers nor contractor/non-user people** (inner-join on `user`) | Nair, Whitfield |
| TR-A11b | High | No evidence/certificate upload despite `evidenceKey` in schema and translated strings; makes `verifyRecord` (also unwired) meaningless | Whitfield, Lindqvist |
| TR-A7 | Med | Gap list and compliance % include held-but-not-required records → noisy list, understated compliance, inflated gap counts | Nair |
| TR-A8 | Med | No correction path: nothing writes `supersededAt` (filtered but never set), no void/delete; a typo'd far-future expiry permanently marks someone competent | Lindqvist |
| TR-A9 | Med | Expiry email drops recipient `locale` — 5 translations unreachable, 9 sibling call sites pass it; CTA URL hardcoded to `/en/` | Bello |
| TR-A10 | Med | `asOf` and `siteId` implemented server-side, unreachable in the UI — the "was he competent on the day" control has no door | Lindqvist |
| TR-A11 | Med | Assignment scope role-only (group/site/person renderable but not creatable); `renewalLeadDays` hardcoded to 60 with no editor; `source` hardcoded; `evidenceNote`/`description` unreachable | Nair |
| TR-A12 | Med | Compliance drill-down link carries no filter; no by-area breakdown; mandatory not reported separately from statutory | Bello |
| TR-A13 | Med | Not in global search (PF-6 regression); fire-safety marshal status still hand-typed, two divergent vocabularies | Lindqvist |
| TR-A14 | Low/Med | Matrix cells not clickable, columns not sortable, filter is requirement-only, CSV emits raw enums, no PDF export; requirements route not permission-guarded; archive has no confirmation; all mutation errors collapsed to a generic toast; a failed query renders "no gaps" | All |
| TR-A15 | Low | Nav placed in `groupRecords`, not `groupOrg` next to Contractors — a reasoned deviation argued in a code comment but not recorded against the brief, and it discards the "two competence registers side by side" argument; no nav placement or brand-gate test for training | Lindqvist |

---

# Engineering appendix (root cause & pointers)

- **TR-A1** — `packages/shared/src/permits.ts:381` (`trainingGateShortfalls`),
  `:411` (`trainingGateError`); `packages/db/src/schema/permits.ts:98`
  (`requiredTrainingIds`); tests `permits.test.ts:496-570` (PW-E12).
  Repo-wide grep for all three names returns only definitions + tests. Stale
  comment: `packages/api/src/routers/permits.ts:34-37`. Seeded checkboxes
  untouched at `permits.ts:604, 623, 642, 659, 679, 696, 720, 745, 761`.
- **TR-A2** — `apps/web/src/components/training/record-dialog.tsx:43`
  (`users.list.useQuery({})`) vs `packages/api/src/routers/users.ts:48-53`
  (`limit … .default(50)`); coercion at `record-dialog.tsx:87`; worker
  exclusion at `packages/jobs/src/workers/training-expiry.ts:68`
  (`innerJoin(user, eq(trainingRecords.userId, user.id))`).
- **TR-A3 / A4** — `packages/api/src/routers/training.ts:746`
  (`importRecords`), `:603` (`person`), `:716` (`qualifiedFor`), `:542`
  (`verifyRecord`), `:469` (`listRecords`), `:354` (`updateRequirement`) — no
  callers in `apps/web`.
- **TR-A5** — `apps/web/src/components/my-work/my-work-queue.tsx:48, 124-143`
  (no training tile/filter); `myWork.ts` kinds carry no `training`; only the
  badge count was extended (`myWork.ts:240-258`).
- **TR-A6 / A9** — `training-expiry.ts:64-68` (selects `user.email` only,
  inner-joins `user`); `packages/jobs/src/worker.ts:739-750` omits `locale`
  while `:346, 384, 427, 477, 521, 567, 601, 654, 691` all pass it;
  `training-expiry.ts:117` hardcodes `/en/training`.
- **TR-A7** — `packages/api/src/routers/training.ts:283` emits a cell when
  `!isRequired && held.length > 0`; `:284-292` calls `statusAsOf` which returns
  the record's real state for `required: false`
  (`packages/shared/src/training.ts:169-172`); `gaps` filters on status alone
  (`training.ts:590-592`); `compliance` passes all cells
  (`training.ts:686, 705`).
- **TR-A8** — `supersededAt` filtered at `training.ts:177` and
  `training-expiry.ts:72`; no writer anywhere; `addRecord` (`training.ts:503`)
  only inserts; `currentRecord` prefers furthest expiry
  (`shared/src/training.ts:194-208`).
- **TR-A10 / A11 / A12** — `asOf` accepted at `training.ts:571-580, 631-641,
  669-671`, passed by no page; `requirements/page.tsx:240`
  (`renewalLeadDays: 60`, `evidenceNote: null`, `description: null`),
  `:278-285` (`scope: 'role'` hardcoded); `record-dialog.tsx:94`
  (`source: 'external'`); `compliance/page.tsx:105-109` (link without filter)
  vs `matrix/page.tsx:29` (filter from `useState`).
- **TR-A13** — `packages/api/src/routers/search.ts:16-34, 66-81` (training
  absent) with the PF-6 comment at `:60-63`;
  `packages/shared/src/fire-safety.ts:420-431` still reads its own fields.
- **TR-A14 / A15** — `status-chip.tsx:56-64` (non-interactive spans);
  `matrix/page.tsx:60` (raw enum in CSV), `:88-100` (requirement-only filter);
  `requirements/page.tsx` (no `useHasPermission`), `:134` (archive, no
  confirm); error toasts at `record-dialog.tsx:74` and
  `requirements/page.tsx:60, 70, 78, 83`; `page.tsx:81` (error → empty state);
  nav at `apps/web/src/lib/nav-model.ts:305-324` with the deviation rationale
  inline.
- **Verified correct (no action):** notify-then-stamp ordering
  (`training-expiry.ts:115-126`), per-run cap (`:31, 83`), quiet-when-clean
  (`:112`), per-requirement lead in SQL (`:79`); email registry
  (`packages/shared/src/email.ts:41, 68`) with IN-J04 still exact 1:1
  (`email.test.ts:117, 151-162`); domain tests TR-E01..E08
  (`shared/src/training.test.ts`) and router tests TR-E10..E19; permission keys
  (`packages/permissions/src/catalogue.ts:131-140`); `nav.training` and the
  79-key namespace at parity in all 10 locales; anonymisation-safe FKs
  (`schema/training.ts:161-162`).

### Suggested sequencing
1. **First, and it is one afternoon:** wire the permits gate (TR-A1) — the
   helper, the column and the tests already exist — and delete the stale
   comment. This is the release's stated purpose.
2. **Then the data-integrity pair:** the person picker (TR-A2 — add search and
   pagination, and stop inferring `contractor` from an empty user id), and
   scope the gap list and compliance denominator to assigned requirements
   (TR-A7).
3. **Then the missing doors:** CSV import (TR-A3), the wallet view with
   certificate upload (TR-A4 + A11b), and the My work tile (TR-A5).
4. **Then:** worker recipients and locale (TR-A6, A9), a supersede path
   (TR-A8), the `asOf`/`siteId` controls (TR-A10), search registration (A13).
5. **Structural, and the reason for all of the above:** one Playwright spec
   that records a card and reads it back from the gap list, plus a
   `training-expiry.test.ts` pinning notify-then-stamp. The same two omissions
   have now produced the same class of defect in four consecutive modules.

---

*Prepared as an independent practitioner review of the FreeHS Training &
competence matrix, scored against this panel's own design review. Findings
verified against the shipped implementation on `main`; the two Critical
findings were re-verified by hand.*
